'use strict';
// b698 — A SONDA DA EMPRESA CONFERE AS PERMISSOES DO APLICATIVO DO ML.
//
// ⚠️ O CASO (GOOD, 14/11/2026): o `/users/me` respondia — a checagem "o dono entrega o token" passava — e o ML
// negava TODA busca de reclamacao e de anuncio (403 do PolicyAgent). O aplicativo de onde vinha o token (o do
// Mover-Pedidos, porque o eixo le do dono) estava sem duas permissoes no DevCenter. Uma tarde pra achar; e no
// dia seguinte, pra conferir a AMB e a Girassol, de novo link por link.
//
// A regra:
//   - uma leitura minima por permissao que o servico usa, com o MESMO token que a producao usaria;
//   - so o 403 do PolicyAgent reprova como "falta permissao" — dizendo QUAL e em QUAL aplicativo;
//   - 401, 429, 5xx, rede e 403 de outra regra sao "nao consegui confirmar" (nao sei != nao);
//   - e continua SO LEITURA, sem guardar dado de cliente.
//
// ⚠️ Roda a checagem DE PRODUCAO (scripts/sonda-empresa.js) com o leitor de token de producao contra um
// Mover-Pedidos de verdade (HTTP); so o Mercado Livre e de mentira (`global.fetch`).
//
// Roda com: node test/sonda-permissoes-ml.test.js

const http = require('http');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const abs = (p) => require.resolve(path.join(RAIZ, p));

const { ehBloqueioDePolitica, PERMISSOES_USADAS, classificarResposta } = require('../lib/ml-permissoes');
const CORPO_POLITICA = { code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', blocked_by: 'PolicyAgent', status: 403, message: 'At least one policy returned UNAUTHORIZED.' };
const CORPO_OUTRO_403 = { message: 'The caller is not authorized to access this resource', error: 'forbidden', status: 403 };

// ════════ A — a peca (lib/ml-permissoes.js) ════════
{
  ok(ehBloqueioDePolitica(CORPO_POLITICA) === true, 'A1 o corpo do PolicyAgent e reconhecido (objeto)');
  ok(ehBloqueioDePolitica(JSON.stringify(CORPO_POLITICA)) === true, '   e como texto tambem');
  ok(ehBloqueioDePolitica(CORPO_OUTRO_403) === false, '⚠️ A2 outro 403 NAO e bloqueio de politica (seria culpar a permissao por palpite)');
  for (const vazio of [null, undefined, '', {}, 0]) {
    ok(ehBloqueioDePolitica(vazio) === false, '   corpo vazio (' + JSON.stringify(vazio) + '): nao e bloqueio de politica');
  }

  ok(classificarResposta({ ok: true, status: 200, corpo: null }) === 'liberada', 'A3 2xx = liberada');
  ok(classificarResposta({ ok: false, status: 403, corpo: CORPO_POLITICA }) === 'negada', '   403 do PolicyAgent = negada');
  const naoSei = [
    ['403 de outra regra', { ok: false, status: 403, corpo: CORPO_OUTRO_403 }],
    ['403 sem corpo', { ok: false, status: 403, corpo: null }],
    ['401', { ok: false, status: 401, corpo: { message: 'invalid access token' } }],
    ['429', { ok: false, status: 429, corpo: null }],
    ['500', { ok: false, status: 500, corpo: null }],
    ['rede (sem status)', { ok: false, status: null, corpo: null, falha: 'ECONNRESET' }],
    ['401 com a palavra PolicyAgent no corpo', { ok: false, status: 401, corpo: CORPO_POLITICA }],
    ['nada', undefined],
  ];
  for (const [nome, r] of naoSei) ok(classificarResposta(r) === 'nao_sei', '⚠️ A4 ' + nome + ' = nao_sei (so o 403 do PolicyAgent e "negada")');

  ok(PERMISSOES_USADAS.length >= 2 && PERMISSOES_USADAS.every((p) => p.chave && p.nome && p.acesso && p.pra_que && typeof p.caminho === 'function'),
     'A5 cada permissao tem nome e acesso (os da tela do DevCenter), pra que serve e a consulta que a prova');
  ok(new Set(PERMISSOES_USADAS.map((p) => p.chave)).size === PERMISSOES_USADAS.length, '   sem chave repetida');
  for (const p of PERMISSOES_USADAS) {
    const c = p.caminho('987654');
    ok(c.startsWith('/') && c.includes('987654') && /[?&]limit=1(&|$)/.test(c), '   ' + p.chave + ': consulta da conta do token, e de UM item so (' + c.split('?')[0] + ')');
  }
  const nomes = PERMISSOES_USADAS.map((p) => p.nome).join(' | ');
  ok(/Comunicações pré e pós-vendas/.test(nomes) && /Publicação e sincronização/.test(nomes), '   as duas medidas na GOOD em 14/11 estao na lista');
}

(async () => {
  // ════════ o Mover-Pedidos (dono do token), de verdade em HTTP ════════
  const dono = { modo: 'ok', leituras: 0 };
  const servidor = http.createServer((req, res) => {
    dono.leituras++;
    if (dono.modo === 'fora') return req.socket.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access: 'TOK-DONO', expira_em: null, versao: 1 }));
  });
  await new Promise((r) => servidor.listen(0, r));

  // ════════ o Mercado Livre, de mentira ════════
  const fetchReal = global.fetch;
  const ml = { chamadas: [], eu: null, reclamacoes: null, anuncios: null, leuCorpoDeSucesso: false };
  const resposta = (r, ehConsultaDePermissao) => {
    if (r instanceof Error) throw r;
    const status = r.status || 200;
    const sucesso = status >= 200 && status < 300;
    return {
      ok: sucesso,
      status,
      json: async () => {
        if (sucesso && ehConsultaDePermissao) ml.leuCorpoDeSucesso = true;   // dado de cliente: a sonda nao tem por que ler
        return r.corpo === undefined ? {} : r.corpo;
      },
    };
  };
  global.fetch = async (url, opts) => {
    const u = String(url);
    ml.chamadas.push({ url: u, auth: (opts && opts.headers && opts.headers.Authorization) || '', metodo: (opts && opts.method) || 'GET', temPrazo: !!(opts && opts.signal) });
    if (/\/users\/me$/.test(u)) return resposta(ml.eu, false);
    if (/\/post-purchase\/v1\/claims\/search/.test(u)) return resposta(ml.reclamacoes, true);
    if (/\/users\/\d+\/items\/search/.test(u)) return resposta(ml.anuncios, true);
    throw new Error('consulta inesperada na sonda: ' + u);
  };

  const ENVS = ['MOVER_PEDIDOS_URL', 'ADMIN_TOKEN_LEITURA_KEY', 'TOKEN_POLITICA_GIRASSOL_ML', 'TOKEN_POLITICA_GIRASSOL_BLING', 'GIRASSOL_ML_ACCESS_TOKEN'];
  const envAntes = {};
  for (const k of ENVS) envAntes[k] = process.env[k];

  /** monta o cenario e devolve a checagem de PRODUCAO, com o leitor de token zerado */
  function cenario({ politica, donoModo, tokenLocal, eu, reclamacoes, anuncios }) {
    for (const k of Object.keys(process.env)) if (/^TOKEN_POLITICA_/.test(k)) delete process.env[k];
    process.env.MOVER_PEDIDOS_URL = 'http://127.0.0.1:' + servidor.address().port;
    process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
    if (politica) process.env.TOKEN_POLITICA_GIRASSOL_ML = politica;
    if (tokenLocal) process.env.GIRASSOL_ML_ACCESS_TOKEN = tokenLocal; else delete process.env.GIRASSOL_ML_ACCESS_TOKEN;
    Object.assign(dono, { modo: donoModo || 'ok', leituras: 0 });
    Object.assign(ml, {
      chamadas: [], leuCorpoDeSucesso: false,
      eu: eu === undefined ? { status: 200, corpo: { id: 111222333, nickname: 'LOJA' } } : eu,
      reclamacoes: reclamacoes === undefined ? { status: 200, corpo: { data: [{ id: 5, cliente: 'dado de cliente' }] } } : reclamacoes,
      anuncios: anuncios === undefined ? { status: 200, corpo: { results: ['MLB1'] } } : anuncios,
    });
    delete require.cache[abs('lib/token-leitor.js')];
    const { CHECAGENS } = require('../scripts/sonda-empresa');
    return CHECAGENS.find((c) => /permiss/i.test(c.nome));
  }
  const calar = () => { const c = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; return () => Object.assign(console, c); };
  const rodar = async (cfg) => { const chk = cenario(cfg); const falar = calar(); try { return await chk.fn('girassol'); } finally { falar(); } };
  const NEGA = { status: 403, corpo: CORPO_POLITICA };

  // ════════ B — a checagem existe e roda logo depois da do token ════════
  {
    const { CHECAGENS } = require('../scripts/sonda-empresa');
    const nomes = CHECAGENS.map((c) => c.nome);
    const iTok = nomes.indexOf('o dono entrega o token');
    const iPerm = nomes.findIndex((n) => /permiss/i.test(n));
    ok(iPerm >= 0, 'B1 a sonda da empresa tem a checagem das permissoes do aplicativo do ML');
    ok(iTok >= 0 && iPerm === iTok + 1, '   logo depois de "o dono entrega o token" (usa o token que ela acabou de reler)');
  }

  // ════════ C — token do DONO (`sombra`, o padrao, com o Mover-Pedidos no ar) ════════
  {
    const r = await rodar({});
    ok(r.ok === true, 'C1 tudo liberado: a checagem aprova');
    ok(/reclamacoes: liberada/.test(r.detalhe) && /anuncios: liberada/.test(r.detalhe), '   dizendo o que conferiu');
    ok(/token do dono \(Mover-Pedidos\)/.test(r.detalhe) && /conta 111222333/.test(r.detalhe), '   com que token, e de que conta');
    ok(ml.chamadas.length === 1 + PERMISSOES_USADAS.length, '   uma leitura da conta + uma por permissao (' + ml.chamadas.length + ' chamadas)');
    ok(ml.chamadas.every((c) => c.auth === 'Bearer TOK-DONO'), '⚠️ todas com o token que o DONO entregou — o mesmo da producao');
    ok(ml.chamadas.every((c) => c.metodo === 'GET' && c.temPrazo), '   so leitura, e com prazo (um ML parado nao trava a sonda)');
    ok(ml.chamadas.some((c) => /players\.user_id=111222333/.test(c.url)) && ml.chamadas.some((c) => /\/users\/111222333\/items\/search/.test(c.url)),
       '   as consultas levam a conta DO TOKEN (a que o /users/me respondeu)');
    ok(ml.leuCorpoDeSucesso === false, '⚠️ resposta liberada: o corpo (dado de cliente) nem e lido');
  }
  {
    const r = await rodar({ reclamacoes: NEGA });
    ok(r.ok === false, '⚠️ C2 reclamacoes negada pelo PolicyAgent: REPROVA');
    ok(/reclamacoes: NEGADA — falta "Comunicações pré e pós-vendas"/.test(r.detalhe) && /anuncios: liberada/.test(r.detalhe), '   o detalhe separa a negada da liberada');
    ok(/"Comunicações pré e pós-vendas" = Leitura e escrita/.test(r.erro || ''), '   o erro diz QUAL permissao ligar, e com que acesso');
    ok(!/Publicação e sincronização/.test(r.erro || ''), '   e nao acusa a que esta liberada');
    ok(/do MOVER-PEDIDOS desta empresa/.test(r.erro || '') && !/DESTE serviço/.test(r.erro || ''), '⚠️ o token veio do dono: o aplicativo a corrigir e o do MOVER-PEDIDOS');
    ok(/AUTORIZE DE NOVO/.test(r.erro || '') && /PLUGAR-EMPRESA-NOVA/.test(r.dica || ''), '   lembra de autorizar de novo, e aponta o passo a passo');
  }
  {
    const r = await rodar({ anuncios: NEGA });
    ok(r.ok === false && /"Publicação e sincronização" = Leitura \(/.test(r.erro || '') && !/Comunicações pré e pós-vendas/.test(r.erro || ''),
       'C3 anuncios negada: acusa "Publicação e sincronização" (Leitura), e so ela');
  }
  {
    const r = await rodar({ reclamacoes: NEGA, anuncios: NEGA });
    ok(r.ok === false && /Comunicações pré e pós-vendas/.test(r.erro || '') && /Publicação e sincronização/.test(r.erro || ''), 'C4 as duas negadas: o erro lista as duas');
  }

  // ════════ D — "NAO SEI" nao e "NAO" ════════
  {
    const r = await rodar({ reclamacoes: { status: 403, corpo: CORPO_OUTRO_403 } });
    ok(r.ok === false && /reclamacoes: não consegui confirmar \(HTTP 403\)/.test(r.detalhe), '⚠️ D1 403 que NAO e o do PolicyAgent: "nao consegui confirmar"');
    ok(!/Falta no aplicativo/.test(r.erro || '') && /NÃO é prova de permissão faltando/.test(r.erro || ''), '   e o erro NAO manda mexer em permissao');
  }
  for (const [nome, falha, marca] of [
    ['429', { status: 429, corpo: null }, /HTTP 429/],
    ['500', { status: 500, corpo: null }, /HTTP 500/],
    ['401', { status: 401, corpo: { message: 'invalid access token' } }, /HTTP 401/],
    ['rede/prazo', new Error('The operation was aborted due to timeout'), /aborted due to timeout/],
  ]) {
    const r = await rodar({ anuncios: falha });
    ok(r.ok === false && /anuncios: não consegui confirmar/.test(r.detalhe) && marca.test(r.detalhe) && /reclamacoes: liberada/.test(r.detalhe) && !/Falta no aplicativo/.test(r.erro || ''),
       '⚠️ D2 ' + nome + ': nao confirma (nao aprova) e nao acusa permissao; a outra consulta segue valendo');
  }
  {
    const r = await rodar({ reclamacoes: NEGA, anuncios: { status: 500, corpo: null } });
    ok(r.ok === false && /Falta no aplicativo/.test(r.erro || '') && /Comunicações/.test(r.erro || '') && !/Publicação/.test(r.erro || '') && /anuncios: não consegui confirmar/.test(r.detalhe),
       'D3 uma negada + uma sem resposta: acusa so a negada; a sem resposta fica no detalhe');
  }

  // ════════ E — sem a conta do token nao ha o que perguntar ════════
  {
    const r = await rodar({ eu: { status: 401, corpo: { message: 'invalid access token' } } });
    ok(r.ok === false && /NAO VERIFICADO/.test(r.detalhe) && /HTTP 401/.test(r.detalhe) && /não é prova de permissão faltando/.test(r.erro || ''), 'E1 /users/me recusado: NAO VERIFICADO (nao e veredito de permissao)');
    ok(ml.chamadas.length === 1, '   e nenhuma consulta de permissao sai sem a conta');
  }
  {
    const r = await rodar({ eu: { status: 200, corpo: { nickname: 'SEM-ID' } } });
    ok(r.ok === false && /NAO VERIFICADO/.test(r.detalhe) && ml.chamadas.length === 1, 'E2 /users/me sem o id: NAO VERIFICADO');
  }
  {
    const r = await rodar({ eu: new Error('ECONNRESET') });
    ok(r.ok === false && /NAO VERIFICADO/.test(r.detalhe) && /ECONNRESET/.test(r.detalhe), 'E3 ML fora na primeira leitura: NAO VERIFICADO, com o motivo');
  }

  // ════════ F — de QUEM e o token decide QUAL aplicativo corrigir ════════
  {
    const r = await rodar({ politica: 'local', tokenLocal: 'TOK-LOCAL', reclamacoes: NEGA });
    ok(ml.chamadas.length > 1 && ml.chamadas.every((c) => c.auth === 'Bearer TOK-LOCAL') && dono.leituras === 0, 'F1 eixo `local`: usa o token local e nem consulta o dono');
    ok(r.ok === false && /DESTE serviço/.test(r.erro || '') && !/MOVER-PEDIDOS/.test(r.erro || '') && /token local \(app deste serviço\)/.test(r.detalhe),
       '⚠️ e o aplicativo a corrigir e o DESTE servico — nao o do Mover-Pedidos');
  }
  {
    const r = await rodar({ donoModo: 'fora', tokenLocal: 'TOK-LOCAL', anuncios: NEGA });
    ok(dono.leituras > 0 && ml.chamadas.length > 1 && ml.chamadas.every((c) => c.auth === 'Bearer TOK-LOCAL'), 'F2 `sombra` com o dono fora do ar: cai no token local, como a producao');
    ok(r.ok === false && /DESTE serviço/.test(r.erro || '') && /Publicação e sincronização/.test(r.erro || ''), '⚠️ e ai a permissao que falta e a do app DESTE servico (acusar o do dono mandaria mexer no app errado)');
  }
  {
    const r = await rodar({ donoModo: 'fora' });
    ok(r.ok === false && /NAO VERIFICADO — sem token do ML/.test(r.detalhe) && ml.chamadas.length === 0, 'F3 dono fora e sem token local: NAO VERIFICADO, sem chamar o ML');
  }
  {
    const r = await rodar({ politica: 'remoto', anuncios: NEGA });
    ok(r.ok === false && /do MOVER-PEDIDOS desta empresa/.test(r.erro || '') && ml.chamadas.every((c) => c.auth === 'Bearer TOK-DONO'), 'F4 eixo `remoto`: token do dono, aplicativo do Mover-Pedidos');
  }
  {
    const r = await rodar({ politica: 'bloqueado', reclamacoes: NEGA });
    ok(r.ok === true && /bloqueado/.test(r.detalhe) && ml.chamadas.length === 0 && dono.leituras === 0, 'F5 eixo `bloqueado`: nada pra testar — nenhuma chamada sai (quem reprova o bloqueio e a checagem da politica)');
  }

  // ════════ G — a dica do indice (b695) usa a MESMA definicao de bloqueio ════════
  {
    const fonte = require('fs').readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js'), 'utf8');
    const semComentario = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/require\('\.\.\/\.\.\/lib\/ml-permissoes'\)/.test(semComentario) && !/\/PolicyAgent\|PA_UNAUTHORIZED\//.test(semComentario),
       'G1 ml-returns-AMB nao tem uma segunda copia da assinatura do PolicyAgent: usa a da peca');
  }

  global.fetch = fetchReal;
  for (const k of ENVS) { if (envAntes[k] === undefined) delete process.env[k]; else process.env[k] = envAntes[k]; }
  delete require.cache[abs('lib/token-leitor.js')];
  await new Promise((r) => servidor.close(r));

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + ((e && e.stack) || e)); process.exit(1); });
