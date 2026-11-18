'use strict';
// b750 — T-06 (auditoria do Codex, 15/11): SMOKE COM REQUISICOES REAIS AO SERVIDOR E AS ROTAS DE CADA EMPRESA.
//
// O "Boot real" do CI so dava require('./server.js') e esperava 5s — nao pedia nada. Este smoke sobe o server.js de
// verdade (test/_boot-real.js) com GOOD + AMB + Girassol ativas e, por HTTP, em cada empresa:
//   - a pagina de entrada responde 200 com HTML da empresa certa (marca no titulo, nao a da outra);
//   - TODO script/estilo local que essa pagina referencia (src/href relativos, com ?v=) responde 200 com o tipo
//     certo — e o que pega `?v=` apontando pra arquivo que nao existe, pasta errada (js/ x js-AMB/) e copia apagada;
//   - /api/auth/me sem sessao e { ok:false } sem usuario; login da empresa funciona; o painel sem sessao nao abre (401/302);
//   - a rota de uma empresa nao serve a pagina da outra.
// Nao precisa de banco: sao as rotas que a tela carrega antes de qualquer consulta.
// Roda com: node test/smoke-rotas-empresas.test.js
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const EMPRESAS = [
  { nome: 'GOOD', rota: '', prefixo: '', marca: /GOOD/i, painel: '/painel-novo.html' },
  { nome: 'AMB', rota: '/amb', prefixo: 'AMB_', marca: /AMB/i, painel: '/painel' },
  { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_', marca: /Girassol/i, painel: '/painel' },
];

function referenciasLocais(html) {
  // src="..." e href="..." de <script>/<link rel=stylesheet>, so os relativos (sem http(s):, sem data:, sem vazio)
  const fora = new Set();
  const re = /<(script|link)\b[^>]*?\b(src|href)="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase(); const url = m[3].trim();
    if (!url || /^(https?:)?\/\//i.test(url) || /^(data|mailto|javascript):/i.test(url) || url.startsWith('#')) continue;
    if (tag === 'link' && !/rel="?(stylesheet|icon|shortcut icon|manifest)/i.test(m[0])) continue;
    fora.add(url);
  }
  return [...fora];
}
const tipoEsperado = (url) => /\.css(\?|$)/.test(url) ? /text\/css/ : /\.m?js(\?|$)/.test(url) ? /javascript/ : /\.(png|ico|svg|webp|jpe?g)(\?|$)/.test(url) ? /image\//i : /./;

(async () => {
  const env = {
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) {
    env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
    env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
  }
  const s = await subir({ env, tetoMs: 45000 });
  try {
    ok(!s.morreuCedo, '⚠️ o server.js NAO morreu no boot com as 3 empresas' + (s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    ok(s.subiu, '⚠️ /health 200' + (!s.subiu && !s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('o servidor nao subiu');
    const paginas = {};
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome + ' (' + (e.rota || '/') + ')');
      const idx = await s.pedir(e.rota + '/');
      ok(idx.status === 200 && /text\/html/.test(String(idx.headers['content-type'])) && /<html/i.test(idx.corpo), '⚠️ pagina de entrada: 200 text/html (' + idx.status + ')');
      const titulo = (/<title>([^<]*)<\/title>/i.exec(idx.corpo) || [])[1] || '';
      ok(e.marca.test(titulo), '  o <title> e da empresa certa ("' + titulo.slice(0, 50) + '")');
      paginas[e.nome] = idx.corpo;
      const refs = referenciasLocais(idx.corpo);
      ok(refs.length >= 5, '  a pagina referencia ' + refs.length + ' scripts/estilos locais');
      const quebrados = [];
      for (const url of refs) {
        const caminho = url.startsWith('/') ? url : e.rota + '/' + url;
        const r = await s.pedir(caminho);
        const tipo = String(r.headers['content-type'] || '');
        if (r.status !== 200 || !tipoEsperado(url).test(tipo) || !r.corpo.length) quebrados.push(url + ' → ' + r.status + ' ' + tipo.split(';')[0]);
      }
      ok(quebrados.length === 0, '⚠️ todos os ' + refs.length + ' arquivos referenciados respondem 200 com o tipo certo' + (quebrados.length ? ' — QUEBRADOS: ' + quebrados.join(' | ') : ''));
      const me = await s.pedir(e.rota + '/api/auth/me');
      let meJ = null; try { meJ = JSON.parse(me.corpo); } catch (err) { meJ = null; }
      // contrato: a tela consulta /me ao abrir — sem sessao responde 200 { ok:false } (nao 401), e e isso que se preserva
      ok(me.status === 200 && meJ && meJ.ok === false && !meJ.usuario, '  /api/auth/me sem sessao = 200 { ok:false } sem usuario (' + me.status + ' ' + me.corpo.slice(0, 40) + ')');
      const login = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario: 'dono', senha: 's2' } });
      const cookie = ((login.headers['set-cookie'] || []).find((x) => /^sessao/.test(x)) || '').split(';')[0];
      ok(login.status === 200 && cookie, '  login do admin da empresa: 200 com cookie (' + login.status + ')');
      const meOk = await s.pedir(e.rota + '/api/auth/me', { cookie });
      ok(meOk.status === 200 && /dono/i.test(meOk.corpo), '  /api/auth/me com sessao = 200 e diz quem e (' + meOk.status + ')');
      const painelSem = await s.pedir(e.rota + e.painel);
      ok([401, 302].includes(painelSem.status), '  painel sem sessao nao abre: ' + painelSem.status);
      const painelCom = await s.pedir(e.rota + e.painel, { cookie });
      ok(painelCom.status === 200 && /<html/i.test(painelCom.corpo), '⚠️ painel com sessao de admin: 200 com HTML (' + painelCom.status + ')');
      const refsPainel = referenciasLocais(painelCom.corpo);
      const quebradosPainel = [];
      for (const url of refsPainel) {
        const caminho = url.startsWith('/') ? url : e.rota + '/' + url;
        const r = await s.pedir(caminho, { cookie });
        if (r.status !== 200 || !tipoEsperado(url).test(String(r.headers['content-type'] || ''))) quebradosPainel.push(url + ' → ' + r.status);
      }
      ok(refsPainel.length > 0 && quebradosPainel.length === 0, '⚠️ os ' + refsPainel.length + ' arquivos do painel respondem 200' + (quebradosPainel.length ? ' — QUEBRADOS: ' + quebradosPainel.join(' | ') : ''));
    }
    console.log('\n── uma empresa nao serve a pagina da outra');
    ok(paginas.AMB !== paginas.Girassol && paginas.GOOD !== paginas.AMB, '  as 3 paginas de entrada sao diferentes entre si');
    const girassolNaAmb = /Girassol/i.test((/<title>([^<]*)<\/title>/i.exec(paginas.AMB) || [])[1] || '');
    ok(!girassolNaAmb, '  o titulo da AMB nao e o da Girassol');
  } finally {
    s.matar();
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
