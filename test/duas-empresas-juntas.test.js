'use strict';
// ⚠️ DUAS EMPRESAS NO MESMO PROCESSO, SEM CRUZAR NADA.
//
// Este teste substitui o freio que o `server.js` tinha (recusar boot com mais
// de uma empresa ativa). O freio protegia contra o NÚMERO; este protege
// contra o VAZAMENTO, que é o que importa de verdade.
//
// 📌 Enquanto ele passar, duas empresas podem subir juntas. Se alguém voltar
// um módulo para instância de processo, ele acusa — e nomeia o que vazou.

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

process.env.ADMIN_SESSION_SECRET = 'segredo-fixo-de-teste-com-40-caracteres!!';
process.env.ADMIN_KEY = 'chave-de-teste';
process.env.AMB_USERS = 'ana:s1';
process.env.AMB_ADMIN_USER = 'ana';
process.env.AMB_SUPABASE_URL = 'https://teste.supabase.co';
process.env.AMB_SUPABASE_KEY = 'chave-de-teste';

// ── nenhum módulo de estado é instância de processo ──────────────────
{
  const app = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const soltos = [];
  const re = /const (\w+) = require\('\.\/lib-AMB\/([\w-]+)'\)(\.criar\()?/g;
  let m;
  while ((m = re.exec(app))) {
    if (m[3]) continue;                    // veio de fábrica
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${m[2]}.js`), 'utf8');
    // ⚠️ guarda estado MUTÁVEL no escopo do módulo?
    const linhas = src.split('\n');
    let prof = 0;
    const cand = [];
    for (const l of linhas) {
      const t = l.trim();
      if (prof === 0 && !t.startsWith('//')) {
        const d = /^(?:let|var) (\w+)|^const (\w+)\s*=\s*(?:new Map\(\)|new Set\(\)|\[\]|\{)/.exec(t);
        if (d) cand.push(d[1] || d[2]);
      }
      let str = null;
      for (let k = 0; k < l.length; k++) {
        const c = l[k];
        if (str) { if (c === '\\') { k++; continue; } if (c === str) str = null; continue; }
        if (c === '"' || c === "'" || c === '`') { str = c; continue; }
        if (c === '/' && l[k + 1] === '/') break;
        if (c === '{') prof++; else if (c === '}') prof--;
      }
    }
    const comEscrita = cand.filter((v) => new RegExp(
      `\\b${v}\\.\\w+\\s*=[^=]|\\b${v}\\.(set|clear|delete|push|shift)\\(`).test(src));
    if (comEscrita.length) soltos.push(`${m[2]} (${comEscrita.join(', ')})`);

    // ⚠️ E O SINAL MAIS FORTE: o módulo EXPORTA `criar` e o app não usa.
    //
    // Minha 1ª versão só olhava estado no escopo — e não pegou a regressão
    // que eu mesmo introduzi para testar: o `impressao-AMB` já move o estado
    // para dentro da fábrica, então "sem estado solto" ficava verde enquanto
    // o app usava a instância única.
    //
    // 📌 Se o módulo tem fábrica, usar sem ela é erro — não há motivo válido.
    if (/module\.exports = \{ criar \}/.test(src)
        || /^\s*criar,?\s*$/m.test(src.slice(src.lastIndexOf('module.exports')))) {
      soltos.push(`${m[2]} (tem .criar() e o app NAO usa)`);
    }
  }
  ok(soltos.length === 0,
     '⚠️ nenhum modulo de ESTADO e instancia de processo'
     + (soltos.length ? ` — vazam: ${soltos.join('; ')}` : ''));
}

// ── ⚠️ e duas instâncias sobem juntas sem se cruzar ──────────────────
{
  const mod = require(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'));
  ok(typeof mod.criar === 'function', 'o app-AMB e uma fabrica');

  // ⚠️ b366 (Codex, P2): eu criava AS DUAS com 'ambtotal'.
  //
  // Assim o teste passaria mesmo que `empresaAlvo` fosse IGNORADO e toda
  // instancia lesse as credenciais, tabelas e rotas da AMB — que e
  // exatamente a regressao que o `require('./config-AMB')` ainda causa.
  //
  // 📌 Duas instancias da MESMA empresa provam que o objeto e novo. Nao
  // provam ISOLAMENTO, que e o que este teste existe pra garantir.
  const umaEmpresa = mod.criar('ambtotal');
  const outra = mod.criar('good');
  ok(umaEmpresa !== outra, '  2 chamadas dao routers DIFERENTES');

  // ⚠️ e a chave MUDA o que a instancia le — senao o argumento e decorativo
  const { obterEmpresa } = require(path.join(RAIZ, 'lib', 'empresas'));
  const tabA = (obterEmpresa('ambtotal').tabelas || {}).devolucoes;
  const tabB = (obterEmpresa('good').tabelas || {}).devolucoes;
  ok(tabA !== tabB,
     `⚠️ empresas diferentes usam TABELAS diferentes (${tabA} x ${tabB})`);

  const app = express();
  app.use('/e1', umaEmpresa);
  app.use('/e2', outra);
  const srv = http.createServer(app);

  const pedir = (caminho, cabecalhos) => new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: srv.address().port, path: caminho,
      method: cabecalhos && cabecalhos.method ? cabecalhos.method : 'GET',
      headers: (cabecalhos && cabecalhos.headers) || {},
    }, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => resolve({ status: r.statusCode, corpo: b, cab: r.headers }));
    });
    req.on('error', () => resolve({ status: 0, corpo: '' }));
    if (cabecalhos && cabecalhos.body) req.write(cabecalhos.body);
    req.end();
  });

  srv.listen(0, '127.0.0.1', async () => {
    // as duas rotas respondem
    const r1 = await pedir('/e1/api/etiqueta/proxima');
    const r2 = await pedir('/e2/api/etiqueta/proxima');
    ok(r1.status !== 0 && r2.status !== 0, '⚠️ as 2 empresas respondem no mesmo processo');

    // ⚠️ e a fila de impressão de uma NÃO aparece na outra
    const corpo = JSON.stringify({ zpl: '^XA^XZ', estacao: 'teste' });
    await pedir('/e1/api/etiqueta/fila', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
      body: corpo,
    });
    const f1 = await pedir('/e1/api/etiqueta/proxima');
    const f2 = await pedir('/e2/api/etiqueta/proxima');
    let restam1 = null; let restam2 = null;
    try { restam1 = JSON.parse(f1.corpo).restam; } catch (e) { /* rota protegida */ }
    try { restam2 = JSON.parse(f2.corpo).restam; } catch (e) { /* idem */ }
    // ⚠️ o 1º rascunho comparava `restam1 > 0 && restam2 > 0` — e os DOIS
    // vieram `undefined` (a rota exige login), então a comparação passava
    // sem provar NADA. Teste que passa por acidente é pior que teste nenhum.
    //
    // 📌 Então provo no nível que EU controlo: as gavetas das 2 instâncias.
    //
    // ⚠️ b367 (Codex, P2): eu chamava `mod.gavetasDaEmpresaParaTeste()` — a
    // FABRICA solta, sem nenhum vinculo com `umaEmpresa`/`outra`. Isso cria
    // um par de gavetas novo e vazio, desligado dos routers: mutar um lado
    // nunca alcancaria o outro mesmo que os routers de verdade
    // compartilhassem tudo. O teste passava sem provar isolamento nenhum.
    //
    // 📌 Agora lê a gaveta que CADA router de verdade usa (exposta em
    // `router.gavetasParaTeste`, ver app-AMB.js).
    const gav1 = umaEmpresa.gavetasParaTeste;
    const gav2 = outra.gavetasParaTeste;
    ok(gav1 !== gav2, '⚠️ as gavetas das 2 instancias sao objetos diferentes');

    gav1.triagem.pendentes.set('pedido-da-1', {});
    gav1.acesso.falhasLogin.set('ana', 5);
    gav1.caches.espreita = { dados: 'da empresa 1' };
    ok(gav2.triagem.pendentes.size === 0, '  a triagem de uma nao aparece na outra');
    ok(!gav2.acesso.falhasLogin.has('ana'), '  ⚠️ e travar o login de uma NAO trava na outra');
    ok(gav2.caches.espreita === null, '  nem a espreita vaza');

    // ⚠️ e os módulos de estado dão instâncias separadas
    const separados = [];
    for (const nome of ['impressao-AMB', 'compat-AMB', 'email-AMB',
                        'nf-entrada-AMB', 'ml-motivo-AMB', 'shopee-AMB', 'magalu-AMB']) {
      const m2 = require(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', `${nome}.js`));
      if (typeof m2.criar !== 'function') { separados.push(`${nome} (sem criar)`); continue; }
      // ⚠️ b377: os modulos agora EXIGEM os clientes da empresa — antes caiam
      // na instancia padrao (config-AMB fixo), que era justamente o vazamento
      // que este teste existe pra impedir.
      //
      // 📌 Clientes falsos bastam: o que se prova aqui e que 2 chamadas dao
      // objetos DIFERENTES, nao o que cada cliente faz.
      const falso = () => ({ chamarBling: async () => ({ ok: true }), cfg: {} });
      const base = (pref) => ({
        PREFIXO_ENV: pref,
        clienteBling: falso(), clienteMl: falso(), clienteEmail: falso(),
      });
      const x = m2.criar(base('AMB_'));
      const y = m2.criar(base('GIRASSOL_'));
      if (x === y) separados.push(`${nome} (a MESMA)`);
    }
    ok(separados.length === 0,
       '⚠️ os 7 modulos de estado dao instancias separadas'
       + (separados.length ? ` — falharam: ${separados.join(', ')}` : ''));

    // ── ⚠️ e os links do HTML saem da BASE da instância ───────────────
    //
    // Havia 48 links `/amb/...` escritos à mão. Com a Girassol em
    // `/girassol`, todos levariam o usuário dela para dentro da AMB — e como
    // a sessão é por empresa, ele cairia num login que não é o dele.
    const appSrc = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
    ok(/const BASE = CFG_EMPRESA\.PREFIXO_ROTA;/.test(appSrc),
       '⚠️ a BASE vem do prefixo da instancia, ja com o fallback da rota montada');

    // ⚠️ apontamento do Codex no PR #318: o check antigo so olhava aspas
    // fechadas NA MESMA LINHA (`["'`][^"'`\n]*\/amb\/...`). Um template
    // multilinha com a abertura da crase numa linha e `/amb/...` la embaixo
    // passava batido — foi exatamente o caso de `app-AMB.js:657-666`.
    //
    // 📌 Depois de tirar as linhas de comentario `//`, procuro o literal
    // `/amb/` solto no restante do arquivo, sem exigir aspas na mesma linha.
    // Conferido: hoje isso da zero ocorrencias (nenhuma rota, template ou
    // require legitimo contem esse substring fora de comentario).
    const semComent = appSrc.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    const pos = semComent.indexOf('/amb/');
    ok(pos < 0,
       '⚠️ nenhum link `/amb/` cravado no codigo'
       + (pos >= 0 ? ` (perto de: ${semComent.slice(Math.max(0, pos - 30), pos + 20).trim()})` : ''));

    // ── ⚠️ O QUE AINDA IMPEDE 2 EMPRESAS — medido, não lembrado ────────
    //
    // Eu tirei o freio 2 vezes cedo demais. Na 1ª conferi só o que mexi; na
    // 2ª varri o repo procurando `/amb/` em STRING — e o que faltava eram
    // ENVS, que não têm essa forma.
    //
    // 📌 Este bloco LISTA o que falta, em vez de eu lembrar. Enquanto
    // acusar, o freio do server.js fica.
    const ENVS_CRAVADAS = [];
    const dirLib = path.join(RAIZ, 'amb-devolucoes', 'lib-AMB');
    for (const f of fs.readdirSync(dirLib)) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dirLib, f), 'utf8');
      const semC = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      const achadas = [...new Set((semC.match(/process\.env\.AMB_[A-Z_]+/g) || []))];
      for (const e of achadas) ENVS_CRAVADAS.push(`${f}: ${e.replace('process.env.', '')}`);
    }
    // ⚠️ b372 (Codex, P2) - zerar as ENVS nao basta: `defeitos-ciclo-AMB.js`
    // grava em tabelas FIXAS (`defeito_comentarios_amb`, `defeito_pedidos_amb`)
    // mesmo sem ler nenhuma env cravada. Sem este placar, o bloco abaixo
    // declararia o freio removível so por zerar env, e uma 2a empresa
    // continuaria gravando defeito na tabela da AMB.
    // ⚠️ b373 - VARRE TODOS OS MODULOS, nao so o de defeitos.
    //
    // Minha versao anterior olhava tabela SO no `defeitos-ciclo-AMB` — e a
    // `defeito_pedidos_amb` mora no `supabase-AMB`. O teste disse "pode
    // tirar o freio" com uma tabela da AMB cravada.
    //
    // 📌 3a vez que meco o lugar errado. Agora: todos os arquivos, todas as
    // formas.
    const TABELAS_CRAVADAS = [];
    for (const f of fs.readdirSync(dirLib)) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dirLib, f), 'utf8');
      const semC = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const t of new Set(semC.match(/['"][a-z][a-z_]*_amb['"]/g) || [])) {
        // ⚠️ nem todo `*_amb` e tabela. Falso positivo ensina a ignorar o
        // vermelho — entao excluo o que CONFERI que nao e:
        //   sessao_amb         nome do cookie (correto, e por empresa)
        //   nf_via_indice_amb  rotulo de AVISO na tela, nao tabela
        if (/sessao_amb|nf_via_indice_amb/.test(t)) continue;
        TABELAS_CRAVADAS.push(`${f}: ${t}`);
      }
    }

    // ⚠️ não falho aqui: é um PLACAR, não um veredito. O freio é que protege.
    console.log(ENVS_CRAVADAS.length
      ? `    📌 ainda faltam ${ENVS_CRAVADAS.length} env(s) AMB_ cravada(s) — o freio fica:`
      : '    ✅ nenhuma env AMB_ cravada nos modulos');
    for (const e of ENVS_CRAVADAS.slice(0, 6)) console.log('       ' + e);
    console.log(TABELAS_CRAVADAS.length
      ? `    📌 ainda ha ${TABELAS_CRAVADAS.length} tabela(s) AMB fixa(s) — o freio fica:`
      : '    ✅ nenhuma tabela fixa da AMB no ciclo de defeitos');
    for (const t of TABELAS_CRAVADAS) console.log('       ' + t);

    // ⚠️ b373 - E A 3a FORMA: usar a INSTANCIA PADRAO do modulo.
    //
    // `require('./bling-AMB')` sem `.criar()` devolve a instancia criada com
    // o `config-AMB` fixo — a da AMB. Nao aparece como env nem como tabela,
    // e foi o que sobrou depois de eu limpar as outras duas formas.
    //
    // 📌 3 vezes hoje eu disse "pode tirar o freio" olhando UMA forma. Agora
    // o teste olha as tres.
    const INSTANCIA_PADRAO = [];
    for (const f of fs.readdirSync(dirLib)) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dirLib, f), 'utf8');
      const semC = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const m2 of semC.matchAll(/require\('\.\/([\w-]+-AMB)'\)(?!\.criar)/g)) {
        // ⚠️ b377: `require` guardado como `xPadrao` E FALLBACK, nao uso.
        //
        // O modulo pega o cliente da empresa (`cfg.clienteMl`) e so cai na
        // instancia padrao se ela nao vier. Contar isso como vazamento seria
        // falso positivo — e falso positivo ensina a ignorar o vermelho.
        //
        // 📌 O que importa e se o valor CHEGA da config. Confiro isso.
        const guardaComoFallback = new RegExp(
          `const \\w+Padrao = require\\('\\./${m2[1]}'\\)`).test(semC);
        // ⚠️ o nome da variavel varia (`cfg`, `cfgEmpresa`) — minha 1a regex
        // exigia `cfg` e dava falso positivo no `nf-entrada`.
        const pegaDaConfig = /\(\s*cfg\w* && cfg\w*\.cliente\w+\s*\)/.test(semC);
        if (guardaComoFallback && pegaDaConfig) continue;
        INSTANCIA_PADRAO.push(`${f} -> ${m2[1]}`);
      }
    }
    if (INSTANCIA_PADRAO.length) {
      console.log(`    📌 e ${INSTANCIA_PADRAO.length} uso(s) da instancia PADRAO (config-AMB fixo):`);
      for (const x of INSTANCIA_PADRAO.slice(0, 6)) console.log('       ' + x);
    }

    // e o freio TEM que estar la enquanto houver env OU tabela cravada
    const srvSrc = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    const temFreio = /const naoAMB = ativas\.filter/.test(srvSrc);
    const faltaAlgo = ENVS_CRAVADAS.length > 0 || TABELAS_CRAVADAS.length > 0
      || INSTANCIA_PADRAO.length > 0;
    ok(faltaAlgo ? temFreio : true,
       faltaAlgo
         ? '⚠️ ha env ou tabela AMB cravada, entao o freio do server.js DEVE existir'
         : '  (sem envs nem tabelas cravadas — o freio ja pode sair)');

    // ── ⚠️ e a PWA de cada empresa é um app DIFERENTE ─────────────────
    //
    // `start_url` e `scope` já saíam da BASE, mas o NOME continuava
    // "AMBTotal - Devoluções" para todas — e é o nome que o celular usa para
    // decidir se é o mesmo app. Duas empresas com o mesmo nome se instalam
    // como UM só, e a segunda sobrescreve o atalho da primeira.
    const appSrcPwa = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
    ok(/id: BASE \+ '\/'/.test(appSrcPwa),
       '⚠️ o manifest declara `id` por empresa (identidade da PWA)');
    ok(/name: nomeEmpresa \+ ' - Devolucoes'/.test(appSrcPwa),
       '  e o NOME sai da ficha (nao e fixo na AMB)');

    // ── ⚠️ e o titulo do atalho no iOS (Safari) tambem e por empresa ───
    //
    // Apontamento do Codex no PR #327: o manifest.json ja saia com nome por
    // empresa, mas quem instala pela Safari/iOS usa a meta
    // apple-mobile-web-app-title do HTML — que continuava cravada
    // "Devolucoes AMB" pras duas.
    const [rE1, rE2] = await Promise.all([pedir('/e1/'), pedir('/e2/')]);
    const tituloIOS = (corpo) => {
      const m3 = /apple-mobile-web-app-title" content="([^"]*)"/.exec(corpo);
      return m3 && m3[1];
    };
    const tit1 = tituloIOS(rE1.corpo);
    const tit2 = tituloIOS(rE2.corpo);
    ok(!!tit1 && !!tit2 && tit1 !== tit2,
       `⚠️ o titulo do atalho no iOS muda por empresa (${tit1} x ${tit2})`);
    ok(tit2 !== 'Devolucoes AMB',
       '  a 2a empresa nao fica com o titulo cravado da AMB');

    // ── ⚠️ e a etiqueta de defeito nao sai cravada "AMBTotal" ──────────
    //
    // Apontamento do Codex no PR #327: zplDefeito() escrevia o literal
    // "DEFEITO - AMBTotal" direto no ZPL, ignorando a empresa que a fabrica
    // recebeu — a peca da Girassol sairia rotulada como da AMB.
    const impressaoMod = require(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'impressao-AMB.js'));
    const zplAmb = impressaoMod.criar({ NOME_EMPRESA: 'AMBTotal' }).zplDefeito({ sku: 'SKU1' });
    const zplGira = impressaoMod.criar({ NOME_EMPRESA: 'Magazine Girassol' }).zplDefeito({ sku: 'SKU1' });
    ok(zplAmb.includes('DEFEITO - AMBTotal'), '  a etiqueta da AMB continua dizendo AMBTotal');
    ok(zplGira.includes('DEFEITO - Magazine Girassol') && !zplGira.includes('DEFEITO - AMBTotal'),
       '⚠️ a etiqueta da Girassol sai com o nome dela, nao da AMB');

    // ── ⚠️ e o NOME nas telas sai da ficha, não é "AMBTotal" fixo ─────
    //
    // As telas de conexão e os avisos de OAuth diziam "AMBTotal" em 12
    // lugares. Montada a Girassol, o usuário dela leria "Bling da AMBTotal
    // conectado" e "confira que o navegador esteja logado na conta da
    // AMBTotal" — instrução ERRADA, e justo na tela onde errar grava o token
    // na conta errada.
    const appNome = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
    const semCom = appNome.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/const NOME_EMPRESA = \(FICHA_AMB && FICHA_AMB\.nome\)/.test(semCom),
       '⚠️ o nome das telas sai da ficha');
    // ⚠️ sobra 1: o fallback do próprio NOME_EMPRESA e o do manifest
    const fixos = (semCom.match(/AMBTotal/g) || []).length;
    ok(fixos <= 2,
       `  e quase nao sobrou "AMBTotal" cravado (${fixos}, so os fallbacks)`);

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  });
}
