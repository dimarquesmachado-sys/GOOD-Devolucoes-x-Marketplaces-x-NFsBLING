'use strict';
// b525/b526 — auditoria (Codex, 04/10): a sonda confere a CONTA do token do ML, a captura recente e os canais.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
const { CHECAGENS } = require(path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'));
const checagem = (re) => CHECAGENS.find((c) => re.test(c.nome));

(async () => {
  ok(/return \{ aceito: true, conta \};/.test(s) && /token de OUTRA conta/.test(s) && /cfg\.ml\.userId/.test(s), '⚠️ token do ML de OUTRA conta reprova; identidade esperada vem da config da empresa (GOOD legado incluso)');
  ok(/conta NAO VERIFICADA — falta/.test(s) && /respondeu sem o id do dono/.test(s), '⚠️ ML sem ML_USER_ID, ou /users/me sem id, REPROVA (nao aprova sem verificar)');
  ok(!!checagem(/captura recente/) && !!checagem(/canais/), '  as checagens novas estao registradas (o modulo carrega)');

  // ── captura: decide pelo BATIMENTO do servidor, nao pela idade de linha ──
  const cap = checagem(/captura recente/).fn;
  const h = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  let r = await cap('good', { capturaEstado: () => ({ ultima: h(0.2), gravadas: 0, erro: null }) });
  ok(r.ok === true && /CONFIRMADO/.test(r.detalhe), '⚠️ ciclo recente com 0 gravadas (sem devolucao no periodo) = OK');
  r = await cap('good', { capturaEstado: () => ({ ultima: h(8), gravadas: 0, erro: null }) });
  ok(r.ok === false, '  ciclo parado ha 8 h reprova');
  r = await cap('good', { capturaEstado: () => ({ ultima: null, gravadas: 0, erro: null }) });
  ok(r.ok === false, '  captura que nunca rodou no boot nao aprova');
  r = await cap('good', { capturaEstado: () => ({ ultima: h(0.1), gravadas: 0, erro: 'boom' }) });
  ok(r.ok === false && /boom/.test(r.detalhe), '  ultimo ciclo com erro reprova');

  // ── captura sem batimento (CLI): busca com TIMEOUT e nao decide pela idade da linha ──
  const guarda = { fetch: global.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY };
  process.env.SUPABASE_URL = 'http://sb.invalid'; process.env.SUPABASE_KEY = 'k';
  let sinal = null;
  global.fetch = async (u, o) => { sinal = o && o.signal; return { ok: true, json: async () => [{ visto_por_ultimo: h(30) }] }; };
  r = await cap('good', {});
  ok(sinal != null && r.ok === true && /NAO VERIFICADO/.test(r.detalhe), '⚠️ sem batimento: a leitura leva AbortSignal e linha velha NAO reprova nem confirma');
  global.fetch = async () => new Promise((_, rej) => setTimeout(() => rej(new Error('abortado')), 5));
  r = await cap('good', {});
  ok(r.ok === false, '  leitura que estoura o tempo reprova (nao trava)');
  global.fetch = guarda.fetch;
  if (guarda.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = guarda.url;
  if (guarda.key === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = guarda.key;

  // ── canais: Magalu legado da GOOD e ponte sem credencial ──
  const can = checagem(/canais/).fn;
  const E = ['MAGALU_ACCESS_TOKEN', 'MAGALU_TENANT_ID', 'GOOD_MAGALU_ACCESS_TOKEN', 'GOOD_MAGALU_TENANT_ID', 'MOVER_PEDIDOS_URL', 'MOVER_PEDIDOS_KEY', 'SHOPEE_PROXY_URL', 'SHOPEE_PROXY_KEY'];
  const salvo = {}; E.forEach((k) => { salvo[k] = process.env[k]; delete process.env[k]; });
  process.env.SHOPEE_PROXY_URL = 'x'; process.env.SHOPEE_PROXY_KEY = 'y';
  process.env.MAGALU_ACCESS_TOKEN = 'tok';   // legado, sem prefixo
  r = await can('good');
  ok(/Magalu: FALHOU \(falta/.test(r.detalhe), '⚠️ Magalu legado (sem prefixo) da GOOD e visto: sem tenant FALHA, nao "NAO APLICAVEL"');
  ok(/TikTok: FALHOU/.test(r.detalhe) && r.ok === false, '⚠️ ponte sem MOVER_PEDIDOS_URL/KEY reprova (nao "mapeado na ponte")');
  process.env.MOVER_PEDIDOS_URL = 'http://m.invalid'; process.env.MOVER_PEDIDOS_KEY = 'k'; process.env.MAGALU_TENANT_ID = 't';
  r = await can('good');
  ok(r.ok === true && /TikTok: mapeado na ponte/.test(r.detalhe) && /Magalu: configurado/.test(r.detalhe), '  com tudo configurado a checagem passa');
  E.forEach((k) => { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; });

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ERRO', e); process.exit(1); });
