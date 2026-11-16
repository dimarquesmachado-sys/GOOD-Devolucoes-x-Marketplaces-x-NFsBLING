'use strict';
require('./_fonte-fabrica');   // le a fabrica com os modulos lib-AMB embutidos (teste de fonte da fabrica exige)
// b707 — P1-02 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): CALLBACK DEVOLVE TEXTO, NAO HTML DO PROVEDOR.
//
// Dois buracos:
//   - fabrica (`oauth-callback-AMB.js`, as 3 empresas): `?error=…&error_description=<tag>` entrava CRU no HTML, e ANTES
//     de conferir o state — qualquer um na internet montava uma pagina da empresa com o conteudo que quisesse. O mesmo
//     pro `code`/escopo/conta/erro do provedor nas paginas de sucesso e falha.
//   - GOOD (`server.js`): `/callback` e `/bling/callback` imprimiam `code` cru; `/bling/setup` e `/ml/setup` o escopo,
//     o user_id e o erro do provedor.
//
// Aqui o registrador REAL da fabrica roda com deps simuladas (router falso captura o handler), e a resposta e inspecionada.
// A GOOD e conferida no fonte, com marcador exclusivo por rota (as rotas vivem no server.js e nao sobem sem boot).
//
// Roda com: node test/oauth-callback-escape.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

const PAYLOAD = '<img src=x onerror=alert(1)>';
const PAYLOAD_ESC = '&lt;img src=x onerror=alert(1)&gt;';
// tag VIVA = um `<img` de verdade ou um atributo on*= dentro de uma tag aberta; `&lt;img … onerror=…&gt;` e texto
const temTagViva = (html) => /<img\b/i.test(html) || /<[a-z][^>]*\son\w+=/i.test(html);

// ── a fabrica, de verdade ──
const registrar = require(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'oauth-callback-AMB.js'));
function montar({ state, servico, troca }) {
  let handler = null;
  const router = { get(rota, fn) { if (rota === '/oauth/callback') handler = fn; } };
  const consumidos = [];
  const deps = {
    BASE: '/girassol',
    bling: { trocarCodePorToken: async (c) => troca(c), testeDeVida: async () => ({ ok: true }) },
    ml: { trocarCodePorToken: async (c) => troca(c), testeDeVida: async () => ({ ok: true, conta: PAYLOAD }) },
    mlReturns: { preAquecer() {} },
    magalu: { trocarCodePorToken: async (c) => troca(c), preAquecer() {}, temTenant: () => true },
    NOME_EMPRESA: 'Girassol', PREFIXO_ENV_EMPRESA: 'GIRASSOL_',
    consumirState: (s) => { consumidos.push(s); return s === state ? { servico } : null; },
    redirectOAuth: () => 'https://x/oauth/callback',
    pagina: (titulo, corpo) => `<!doctype html><title>${titulo}</title>${corpo}`,
    jaPreAquecidoPeloOAuth: {},
  };
  registrar(router, deps);
  if (!handler) throw new Error('a fabrica nao registrou /oauth/callback');
  async function chamar(query) {
    let status = 200, body = null;
    const res = { status(s) { status = s; return this; }, send(b) { body = String(b); return this; }, json(j) { body = JSON.stringify(j); return this; } };
    await handler({ query }, res);
    return { status, body };
  }
  return { chamar, consumidos };
}

(async () => {
  // 1. erro do provedor com state INVALIDO: nao ecoa nada do provedor, e o state foi conferido
  {
    const t = montar({ state: 'bom', servico: 'ml', troca: async () => ({}) });
    const r = await t.chamar({ error: 'access_denied', error_description: PAYLOAD, state: 'qualquer' });
    ok(t.consumidos.length === 1 && t.consumidos[0] === 'qualquer', '⚠️ fabrica: com ?error= o state e conferido ANTES de responder');
    ok(r.status === 400 && !/alert|onerror|access_denied/.test(r.body), '  state invalido + erro do provedor: 400 "link invalido", sem ecoar o erro (' + r.status + ')');
  }
  // 2. erro do provedor com state VALIDO: mostra como texto
  {
    const t = montar({ state: 'bom', servico: 'ml', troca: async () => ({}) });
    const r = await t.chamar({ error: 'access_denied', error_description: PAYLOAD, state: 'bom' });
    ok(r.body.includes(PAYLOAD_ESC) && !temTagViva(r.body), '⚠️ fabrica: error_description vira TEXTO (entidades), nao tag');
  }
  // 3. sucesso: o que o provedor devolve (conta, user_id, escopo) tambem e texto
  {
    const t = montar({ state: 'bom', servico: 'ml', troca: async () => ({ persistiu: true, user_id: PAYLOAD, expira_em_s: 21600 }) });
    const r = await t.chamar({ code: 'abc', state: 'bom' });
    ok(r.body.includes('conectado') && !temTagViva(r.body) && (r.body.match(new RegExp(PAYLOAD_ESC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2,
       '⚠️ fabrica (ML): conta e user_id do provedor saem escapados (2 ocorrencias) — nenhuma tag viva');
    const tb = montar({ state: 'bom', servico: 'bling', troca: async () => ({ persistiu: true, dados: { scope: PAYLOAD } }) });
    const rb = await tb.chamar({ code: 'abc', state: 'bom' });
    ok(rb.body.includes(PAYLOAD_ESC) && !temTagViva(rb.body), '  fabrica (Bling): escopo do provedor escapado');
  }
  // 4. falha na troca: a mensagem do provedor e texto
  {
    const t = montar({ state: 'bom', servico: 'magalu', troca: async () => { const e = new Error('x'); e.response = { data: { error: PAYLOAD } }; throw e; } });
    const r = await t.chamar({ code: 'abc', state: 'bom' });
    ok(/Nao consegui concluir/.test(r.body) && !temTagViva(r.body) && /&lt;img/.test(r.body), '⚠️ fabrica: erro do provedor na falha da troca sai escapado');
  }

  // ── a GOOD, no fonte: cada rota com marcador exclusivo ──
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  function bloco(ini, fim) {
    const i = SRV.indexOf(ini); const f = SRV.indexOf(fim, i + 1);
    ok(i >= 0 && f > i, `  marcadores existem: ${ini.slice(0, 40)}…`);
    return SRV.slice(i, f);
  }
  const cb = bloco("app.get('/callback'", "app.get('/bling/callback'");
  const cbB = bloco("app.get('/bling/callback'", "app.get('/bling/setup'");
  ok(/escaparHtml\(req\.query\.code/.test(cb) && !/\$\{req\.query\.code/.test(cb), '⚠️ GOOD /callback: o code sai escapado (nunca cru)');
  ok(/escaparHtml\(req\.query\.code/.test(cbB) && !/\$\{req\.query\.code/.test(cbB), '⚠️ GOOD /bling/callback: idem');
  const setupB = bloco("app.get('/bling/setup'", "app.get('/ml/setup'");
  const setupM = bloco("app.get('/ml/setup'", "\n});\n", );
  ok(/escaparHtml\(data\.scope/.test(setupB) && /escaparHtml\(detalhe\)/.test(setupB) && !/\$\{detalhe\}/.test(setupB), '  GOOD /bling/setup: escopo e erro do provedor escapados');
  ok(/escaparHtml\(data\.user_id/.test(setupM) && /escaparHtml\(data\.scope/.test(setupM) && /escaparHtml\(detalhe\)/.test(setupM) && !/\$\{detalhe\}/.test(setupM), '  GOOD /ml/setup: user_id, escopo e erro escapados');
  ok(/const \{ escaparHtml \} = require\('\.\/lib\/html-texto'\)/.test(SRV), '  GOOD importa o escaparHtml da peca unica lib/html-texto.js');

  // ── a peca ──
  const { escaparHtml } = require(path.join(RAIZ, 'lib', 'html-texto.js'));
  ok(escaparHtml(`<a href="x" onclick='y'>&</a>`) === '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;', 'escaparHtml: & < > " \' virados em entidade');
  ok(escaparHtml(null) === '' && escaparHtml(undefined) === '' && escaparHtml(12) === '12', '  nulo vira vazio, numero vira texto');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
