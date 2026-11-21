'use strict';
// b794 (V-14) — ENTRADA DE FORMATO HOSTIL NAO DERRUBA O PROCESSO, EM ROTA NENHUMA (o server.js de verdade, as 3 empresas).
//
// Medido em 21/11: o Express 4 entrega um OBJETO pra `?campo[toString]=x`; `String(objeto)` estoura; num handler `async`,
// fora de `try`, isso virava rejeicao sem dono e o Node ENCERRAVA O PROCESSO (o Render reinicia: ~1 minuto fora do ar pras
// 3 empresas). A varredura achou 46 rotas assim — duas PUBLICAS (os retornos do OAuth), derrubaveis por qualquer um.
// A classe foi fechada num ponto so (lib/rota-segura.js). Este teste e a TRAVA: ele nao le o codigo procurando o padrao —
// ele EXECUTA. Tira do fonte a lista de rotas e de nomes de campo, e manda pra cada rota, em cada empresa, como visitante,
// estoquista e admin, os formatos que quebram conversao: objeto com `toString` que nao e funcao, lista, numero, nulo, e
// o cookie em formato JSON. Rota nova entra na varredura sozinha.
//   - o processo tem que estar de pe depois de CADA pedido que nao voltou, e no fim;
//   - as sessoes do teste tem que continuar valendo no fim (senao a varredura teria batido em "nao logado" e provado nada);
//   - os dois retornos publicos do OAuth respondem um erro curto, sem pilha.
//
// ⚠️ AMBIENTE LIMPO: este teste manda lixo, como ADMIN, pra TODAS as rotas (inclusive as que gravam e apagam). O servidor
// que ele sobe nao pode herdar credencial nenhuma de quem rodou o teste — nem banco, nem Bling, nem marketplace. Por isso
// a primeira coisa que ele faz e esvaziar o proprio ambiente (o `subir` repassa o `process.env` pro filho).
// Roda com: node test/entrada-hostil-nao-derruba.test.js
for (const k of Object.keys(process.env)) if (!/^(PATH|HOME|TMPDIR|TEMP|TMP|LANG|LC_ALL|SystemRoot|windir)$/.test(k)) delete process.env[k];
require('./_fonte-fabrica');   // a fabrica e lida com as fatias dela de volta no lugar (regra do test/fabrica-fonte-unica.test.js)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { subir } = require('./_boot-real');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const EMPRESAS = [{ nome: 'GOOD', pre: '', cookie: 'sessao' }, { nome: 'AMB', pre: '/amb', cookie: 'sessao_amb', env: 'AMB_' }, { nome: 'Girassol', pre: '/girassol', cookie: 'sessao_girassol', env: 'GIRASSOL_' }];
const FABRICA = EMPRESAS.filter((e) => e.pre).map((e) => e.pre);
// sair derruba a sessao do proprio teste (o resto da varredura bateria em "nao logado"): fica de fora, e so ela
const FORA = /^POST \S*\/api\/auth\/logout$/;

function arquivos() {
  const out = [['server.js', ['']], ['amb-devolucoes/app-AMB.js', FABRICA]];
  for (const f of fs.readdirSync(path.join(RAIZ, 'lib')).sort()) if (f.endsWith('.js')) out.push(['lib/' + f, [''].concat(FABRICA)]);
  for (const f of fs.readdirSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB')).sort()) if (f.endsWith('.js')) out.push(['amb-devolucoes/lib-AMB/' + f, FABRICA]);
  return out;
}
function rotasDe(fonte) {
  const out = []; let m;
  const re = /\b(?:app|router|r|rota|api)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`\n]+)\2/g;
  while ((m = re.exec(fonte))) if (m[3].startsWith('/')) out.push({ metodo: m[1].toUpperCase(), caminho: m[3] });
  return out;
}
function camposDe(fonte, onde) {
  const nomes = new Set(); let m;
  const r1 = new RegExp('req\\.' + onde + '\\.(\\w+)', 'g'); while ((m = r1.exec(fonte))) nomes.add(m[1]);
  const r2 = new RegExp('req\\.' + onde + "\\[['\"](\\w+)['\"]\\]", 'g'); while ((m = r2.exec(fonte))) nomes.add(m[1]);
  const r3 = new RegExp('\\{([^}]{1,300})\\}\\s*=\\s*(?:req\\.' + onde + '|\\(?req\\.' + onde + ' \\|\\| \\{\\}\\)?)', 'g');
  while ((m = r3.exec(fonte))) for (const p of m[1].split(',')) { const n = p.split(/[:=]/)[0].trim(); if (/^\w+$/.test(n)) nomes.add(n); }
  return [...nomes].slice(0, 60);
}
// ⚠️ CONEXOES REAPROVEITADAS, E NENHUMA FICA PENDURADA. Sao ~5 mil pedidos: com uma conexao nova por pedido, sobravam
// milhares de portas locais em TIME_WAIT por 60 s (medido: 6.690, um terco da faixa 39000-39899) — e o teste seguinte que
// sorteia uma porta pra subir o servidor dele dava com a porta ocupada (o health-eixos-de-verdade ficou vermelho assim).
// Entao: um agente com keep-alive (as conexoes sao reusadas), o pedido que nao respondeu a tempo e cortado com RESET (sem
// TIME_WAIT), e no fim o servidor morre ANTES de o agente fechar (quem fecha primeiro e ele, nao este lado).
const agente = new http.Agent({ keepAlive: true });
function pedir(porta, metodo, caminho, { cookie, corpo, tetoMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    let feito = false; let relogio = null;
    const fim = (r) => { if (feito) return; feito = true; clearTimeout(relogio); resolve(r); };
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, agent: agente,
      headers: Object.assign({}, cookie ? { cookie } : {}, dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}) }, (res) => {
      let c = ''; res.on('data', (x) => { if (c.length < 4000) c += x; });
      res.on('end', () => fim({ status: res.statusCode, corpo: c, tipo: String(res.headers['content-type'] || '') }));
      res.on('error', () => fim({ status: -1, corpo: '' }));
    });
    relogio = setTimeout(() => {
      fim({ status: 'tempo', corpo: '' });
      try { if (req.socket && typeof req.socket.resetAndDestroy === 'function') req.socket.resetAndDestroy(); else req.destroy(); } catch (e) { /* ja foi */ }
    }, tetoMs);
    req.on('error', (e) => fim({ status: 0, corpo: '', erro: e.code || e.message }));
    if (dados) req.write(dados);
    req.end();
  });
}

(async () => {
  const env = { USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!' };
  for (const e of EMPRESAS) if (e.env) { env[e.env + 'USERS'] = 'esto:s1,dono:s2'; env[e.env + 'ADMIN_USER'] = 'dono'; env[e.env + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789'; }

  let s = null; let sessoes = null;
  const levantar = async () => {
    s = await subir({ env, tetoMs: 60000 });
    if (!s.subiu) return false;
    sessoes = {};
    for (const e of EMPRESAS) {
      const login = async (u, p) => { const r = await s.pedir(e.pre + '/api/auth/login', { metodo: 'POST', corpo: { usuario: u, senha: p } }); return ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0]; };
      sessoes[e.pre] = { sem: null, estoquista: await login('esto', 's1'), admin: await login('dono', 's2'),
        // o cookie em formato JSON (o leitor de cookie transforma `j:{...}` em OBJETO): outra porta pro mesmo formato hostil
        'cookie hostil': e.cookie + '=' + encodeURIComponent('j:{"toString":"x"}') };
    }
    return true;
  };
  const deP = async () => { for (let i = 0; i < 3; i++) { const h = await pedir(s.porta, 'GET', '/health', { tetoMs: 5000 }); if (h.status === 200) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
  const sessoesValem = async () => {
    const ruins = [];
    for (const e of EMPRESAS) for (const papel of ['estoquista', 'admin']) {
      const r = await pedir(s.porta, 'GET', e.pre + '/api/auth/me', { cookie: sessoes[e.pre][papel] });
      if (r.status !== 200 || !/"ok"\s*:\s*true/.test(r.corpo)) ruins.push(e.nome + '/' + papel + ' → ' + r.status + ' ' + r.corpo.slice(0, 40));
    }
    return ruins;
  };

  try {
    ok(await levantar(), '⚠️ o server.js subiu' + (s && !s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    const herdadas = Object.keys(process.env).filter((k) => !/^(PATH|HOME|TMPDIR|TEMP|TMP|LANG|LC_ALL|SystemRoot|windir)$/.test(k));
    ok(herdadas.length === 0, '⚠️ o servidor da varredura sobe SEM herdar variavel nenhuma de quem rodou o teste (nenhuma credencial de verdade ao alcance do lixo)' + (herdadas.length ? ' — sobrou: ' + herdadas.slice(0, 5).join(', ') : ''));
    let ruins = await sessoesValem();
    ok(ruins.length === 0, '⚠️ as 6 sessoes do teste valem (estoquista e admin, nas 3 empresas)' + (ruins.length ? ' — ' + ruins.join(', ') : ''));

    // ── as rotas e os campos, tirados do fonte ──
    const alvos = []; const vistos = new Set();
    for (const [arq, prefixos] of arquivos()) {
      const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
      const rotas = rotasDe(fonte);
      if (!rotas.length) continue;
      const q = camposDe(fonte, 'query'), b = camposDe(fonte, 'body');
      for (const r of rotas) for (const pre of prefixos) {
        const k = r.metodo + ' ' + pre + r.caminho;
        if (vistos.has(k) || FORA.test(k)) continue;
        vistos.add(k); alvos.push({ arq, pre, metodo: r.metodo, caminho: r.caminho, q, b });
      }
    }
    ok(alvos.length >= 400, '⚠️ a varredura enxerga as rotas (' + alvos.length + ' combinacoes de rota e empresa, tiradas de ' + new Set(alvos.map((a) => a.arq)).size + ' arquivos) — se este numero despencar, ela parou de achar rota e nao prova mais nada');
    ok(alvos.some((a) => a.metodo === 'GET' && a.pre === '' && a.caminho === '/magalu/callback') && FABRICA.every((p) => alvos.some((a) => a.pre === p && a.caminho === '/oauth/callback')),
      '  entre elas, os retornos PUBLICOS do OAuth (GOOD e fabrica)');

    // ── a varredura ──
    const formatos = {
      objeto: { q: (n) => encodeURIComponent(n) + '[toString]=x', b: () => ({ toString: 'x' }) },
      lista: { q: (n) => encodeURIComponent(n) + '=a&' + encodeURIComponent(n) + '=b', b: () => ['a', 'b'] },
      numero: { q: null, b: () => 7 },
      nulo: { q: null, b: () => null },
    };
    const mortes = []; const conta = { pedidos: 0, s500: 0, tempo: 0 }; const mudos = [];
    const ESPERA_MS = 800;
    const t0 = Date.now();
    // todos os pedidos de UMA rota (papel x formato)
    const loteDe = (a) => {
      const caminho = a.pre + a.caminho.replace(/:(\w+)\??/g, '1').replace(/\*/g, 'x');
      const temCorpo = a.metodo !== 'GET' && a.metodo !== 'DELETE';
      const lote = [];
      for (const papel of ['sem', 'estoquista', 'admin', 'cookie hostil']) {
        const lista = papel === 'cookie hostil' ? [['objeto', formatos.objeto]] : Object.entries(formatos);
        for (const [nomeF, f] of lista) {
          if (!f.q && !temCorpo) continue;
          const qs = f.q && a.q.length ? '?' + a.q.map(f.q).join('&') : '';
          lote.push({ a, papel, formato: nomeF, url: caminho + qs, corpo: temCorpo ? Object.fromEntries(a.b.map((n) => [n, f.b()])) : undefined });
        }
        // o corpo INTEIRO como lista (e nao um objeto com campos)
        if (temCorpo && papel !== 'cookie hostil') lote.push({ a, papel, formato: 'corpo-lista', url: caminho, corpo: [{ toString: 'x' }] });
      }
      return lote;
    };
    // manda um punhado de pedidos juntos; devolve se o processo CAIU (e, nesse caso, sobe de novo)
    const mandar = async (lote, contar) => {
      const respostas = await Promise.all(lote.map((p) => pedir(s.porta, p.a.metodo, p.url, { cookie: sessoes[p.a.pre][p.papel], corpo: p.corpo, tetoMs: ESPERA_MS })));
      let semResposta = false;
      respostas.forEach((r, i) => {
        if (contar) { conta.pedidos++; if (r.status === 500) conta.s500++; if (r.status === 'tempo') { conta.tempo++; mudos.push(lote[i].a.metodo + ' ' + lote[i].a.pre + lote[i].a.caminho); } }
        if (r.status === 0 || r.status === -1 || r.status === 'tempo') semResposta = true;
      });
      if (!semResposta || await deP()) return null;
      const motivo = s.fimDoLog().split('\n').map((l) => l.replace(/^\s*\|\s?/, '')).filter((l) => /Error|^\s+at /.test(l)).slice(0, 3).join(' ⏎ ');
      const quem = lote.filter((p, i) => respostas[i].status === 0 || respostas[i].status === -1).map((p) => p.papel + ' / ' + p.formato);
      try { await s.matar(); } catch (e) { /* ja morreu */ }
      if (!(await levantar())) throw new Error('nao subiu de novo depois de cair');
      return { motivo, quem: [...new Set(quem)] };
    };
    // As rotas vao de 12 em 12, e cada pedido espera so ESPERA_MS: a conversao que derruba acontece na ENTRADA do handler
    // (em milissegundos); quem ainda nao respondeu depois disso esta esperando um servico de fora, e nao interessa aqui
    // (em fila e esperando cada um, a varredura levava ~90 s). Se o processo cair num punhado, as rotas dele sao refeitas
    // UMA POR UMA pra dizer qual foi; e o /health do fim pega a queda que viesse atrasada.
    const DE_QUANTAS = 12;
    for (let i = 0; i < alvos.length; i += DE_QUANTAS) {
      const grupo = alvos.slice(i, i + DE_QUANTAS);
      const caiu = await mandar([].concat(...grupo.map(loteDe)), true);
      if (!caiu) continue;
      let achou = false;
      for (const a of grupo) {
        const c = await mandar(loteDe(a), false);
        if (c) { achou = true; mortes.push(a.metodo + ' ' + a.pre + a.caminho + ' [sem resposta: ' + c.quem.join(', ') + '] ' + c.motivo.slice(0, 220)); }
      }
      if (!achou) mortes.push('um destes (caiu no punhado, nao caiu sozinho): ' + grupo.map((a) => a.metodo + ' ' + a.pre + a.caminho).join(', ') + ' — ' + caiu.motivo.slice(0, 220));
    }
    ok(mortes.length === 0, '⚠️ NENHUM pedido derrubou o processo (' + conta.pedidos + ' pedidos em ' + Math.round((Date.now() - t0) / 1000) + ' s; ' + conta.s500 + ' responderam 500, ' + conta.tempo + ' nao responderam a tempo' + (mudos.length ? ': ' + [...new Set(mudos.map((m) => m.replace(/ \[.*$/, '')))].slice(0, 12).join(', ') : '') + ')'
      + (mortes.length ? '\n   DERRUBARAM (' + mortes.length + '):\n   - ' + mortes.slice(0, 60).join('\n   - ') : ''));
    ok(await deP(), '⚠️ e no fim o /health responde 200');
    ruins = await sessoesValem();
    ok(ruins.length === 0, '⚠️ as sessoes do teste continuam valendo no fim (a varredura bateu nas rotas LOGADA, nao em "faca login")' + (ruins.length ? ' — perdidas: ' + ruins.join(', ') : ''));

    // ── os casos medidos, um por um ──
    const curto = (r) => r.status === 500 && /json/.test(r.tipo) && /"ok"\s*:\s*false/.test(r.corpo) && /erro interno/.test(r.corpo) && !/\bat \/|node_modules|\.js:\d|toString/.test(r.corpo);
    let r = await pedir(s.porta, 'GET', '/magalu/callback?state[toString]=x&code[toString]=x');
    ok(curto(r), '⚠️ PUBLICA (sem sessao) — GET /magalu/callback com `state[toString]`: erro curto em JSON, sem pilha — ' + r.status + ' ' + r.corpo.slice(0, 70));
    for (const p of FABRICA) {
      r = await pedir(s.porta, 'GET', p + '/oauth/callback?state[toString]=x&code[toString]=x');
      ok(curto(r), '⚠️ PUBLICA (sem sessao) — GET ' + p + '/oauth/callback: idem — ' + r.status + ' ' + r.corpo.slice(0, 70));
    }
    r = await pedir(s.porta, 'GET', '/magalu/callback?state=nao-existe');
    ok(r.status === 400 && /invalido ou expirado/i.test(r.corpo), '  (a mesma rota com `state` de texto continua respondendo o "link invalido" dela)');
    r = await pedir(s.porta, 'GET', '/api/produtos/buscar?q[toString]=x', { cookie: sessoes[''].estoquista });
    ok(curto(r), '⚠️ ESTOQUISTA — GET /api/produtos/buscar com `q[toString]` (GOOD): erro curto, processo de pe — ' + r.status);
    r = await pedir(s.porta, 'GET', '/amb/api/triagem/identificar?codigo[toString]=x', { cookie: sessoes['/amb'].estoquista });
    ok(curto(r), '⚠️ ESTOQUISTA — GET /amb/api/triagem/identificar com `codigo[toString]` (fabrica): idem — ' + r.status);
    ok(/\[erro-rota\] GET \/magalu\/callback|\[erro-rota\] GET \S*\/oauth\/callback/.test(s.log()), '  e cada um deixa a linha `[erro-rota]` no registro (da pra achar a rota que errou)');
    ok(await deP(), '  /health 200 depois dos casos medidos');
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    try { if (s) await s.matar(); } catch (e) { /* tanto faz */ }
    await new Promise((r) => setTimeout(r, 300));   // o servidor fecha o lado dele primeiro...
    agente.destroy();                                 // ...e so entao este lado solta as conexoes que sobraram
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
