'use strict';
// A busca por CHAVE da DANFE e por NUMERO de NF RESPONDE nas 3 empresas (GOOD, AMB, Girassol).
// Desde o b472 (#397) uma variavel declarada dentro do `else` do caminho do numero era lida
// fora dele: ReferenceError nos dois caminhos, rota async sem captura -> pedido SEM RESPOSTA
// ate o Render cortar (a tela via "Unexpected token '<'"). Nenhum teste batia nessa rota.
// Este faz BOOT REAL e bipa chave e numero em cada empresa, exigindo resposta (qualquer
// status — sem Bling de verdade o resultado e erro, mas nunca silencio).
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const PORTA = 4000 + Math.floor(Math.random() * 900);
// Nenhuma credencial real herdada do ambiente: com token vencido o cliente gastaria o refresh
// token de verdade e gravaria o novo no Render. Apaga tudo que parece credencial/persistencia.
for (const k of Object.keys(process.env)) {
  if (/TOKEN|SECRET|KEY|PASS|CLIENT|SUPABASE|RENDER|_URL$|_USERS$|_USER$/i.test(k)) delete process.env[k];
}
// No CI o runner TEM internet: o Bling/ML com credencial falsa respondia devagar (refresh, retentativa)
// e o pedido passava do prazo — no sandbox a rede externa ja falha na hora. Proxy morto pro axios
// (que respeita HTTPS_PROXY) deixa os dois ambientes iguais: chamada externa falha imediatamente.
Object.assign(process.env, { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', http_proxy: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' });
Object.assign(process.env, {
  RENDER: '1', ADMIN_SESSION_SECRET: 'x'.repeat(44), ADMIN_KEY: 'ktest', PORT: String(PORTA), USERS: 'g:g1',
  AMB_USERS: 'ana:s1', AMB_ADMIN_USER: 'ana', AMB_SESSION_SECRET: 'segredo-da-amb-16-mais-chars',
  GIRASSOL_BLING_CLIENT_ID: 'x', GIRASSOL_BLING_CLIENT_SECRET: 'x', GIRASSOL_ML_CLIENT_ID: 'x', GIRASSOL_ML_CLIENT_SECRET: 'x',
  GIRASSOL_USERS: 'gi:s2', GIRASSOL_ADMIN_USER: 'gi', GIRASSOL_SESSION_SECRET: 'x'.repeat(32),
});
const rejeicoes = [];
process.on('unhandledRejection', (e) => { rejeicoes.push(String(e && e.message || e)); });
// erro de CODIGO (variavel fora de escopo, propriedade de undefined) — o que trava a rota de verdade
const rejeicoesDeCodigo = () => rejeicoes.filter((m) => /is not defined|Cannot read propert|is not a function/.test(m));
require(path.join(__dirname, '..', 'server.js'));
const base = 'http://127.0.0.1:' + PORTA;
const CHAVE = '35260727548456000147550020000492861144343275';
async function login(prefixo, usuario, senha) {
  for (const rota of [prefixo + '/api/auth/login', prefixo + '/api/login', prefixo + '/login']) {
    try {
      const r = await fetch(base + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha, user: usuario, pass: senha, username: usuario, password: senha }), redirect: 'manual' });
      const ck = (r.headers.get('set-cookie') || '').split(';')[0];
      if (ck) return ck;
    } catch (e) {}
  }
  return '';
}
async function bipar(rot, url, cookie) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { headers: cookie ? { cookie } : {}, signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, tipos: (j.tentativas || []).map((x) => x.tipo) };
  } catch (e) { return { semResposta: true }; }
  finally { clearTimeout(t); }
}
setTimeout(async () => {
  for (const [nome, prefixo, u, s] of [['AMB', '/amb', 'ana', 's1'], ['Girassol', '/girassol', 'gi', 's2'], ['GOOD', '', 'g', 'g1']]) {
    const ck = await login(prefixo, u, s);
    ok(!!ck, `⚠️ ${nome}: login do teste devolveu sessao`);
    if (!ck) continue;
    const antes = rejeicoesDeCodigo().length;
    const rc = await bipar(nome + ' chave', base + prefixo + '/api/devolucao/identificar/' + CHAVE, ck);
    ok(!rc.semResposta && rejeicoesDeCodigo().length === antes, `⚠️ ${nome}: bipe da CHAVE da DANFE responde (status ${rc.status || ('sem resposta em 30s' + (rejeicoesDeCodigo().length > antes ? ' — ERRO DE CODIGO: ' + rejeicoesDeCodigo().slice(-1)[0] : ', sem erro de codigo'))})`);
    ok(!rc.semResposta && rc.tipos.includes('chave_danfe'), `  ${nome}: ... e passou pelo caminho da chave (chave_danfe)`);
    const antesN = rejeicoesDeCodigo().length;
    const rn = await bipar(nome + ' numero', base + prefixo + '/api/devolucao/identificar/' + encodeURIComponent('126421/1'), ck);
    ok(!rn.semResposta && rejeicoesDeCodigo().length === antesN, `⚠️ ${nome}: bipe do NUMERO/serie responde (status ${rn.status || ('sem resposta em 30s' + (rejeicoesDeCodigo().length > antesN ? ' — ERRO DE CODIGO: ' + rejeicoesDeCodigo().slice(-1)[0] : ', sem erro de codigo'))})`);
    ok(!rn.semResposta && rn.tipos.includes('numero_nf'), `  ${nome}: ... e passou pelo caminho do numero (numero_nf)`);
  }
  ok(rejeicoesDeCodigo().length === 0, '⚠️ nenhum erro de codigo solto na rota (' + (rejeicoesDeCodigo().join(' | ') || 'zero') + ')');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
}, 9000);
