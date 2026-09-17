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
    const gav1 = mod.gavetasDaEmpresaParaTeste();
    const gav2 = mod.gavetasDaEmpresaParaTeste();
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
      const x = m2.criar({ PREFIXO_ENV: 'AMB_' });
      const y = m2.criar({ PREFIXO_ENV: 'GIRASSOL_' });
      if (x === y) separados.push(`${nome} (a MESMA)`);
    }
    ok(separados.length === 0,
       '⚠️ os 7 modulos de estado dao instancias separadas'
       + (separados.length ? ` — falharam: ${separados.join(', ')}` : ''));

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  });
}
