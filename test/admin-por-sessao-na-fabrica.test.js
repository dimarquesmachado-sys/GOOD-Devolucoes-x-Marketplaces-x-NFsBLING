'use strict';
// b756 — V-03 (auditoria do Codex, 15/11): O USO HUMANO DAS ROTAS ADMIN MIGRA PRA SESSAO; A CHAVE NA URL DEIXA DE SER EMITIDA.
//
// A GOOD ja aceitava a sessao de admin nas rotas de chave (adminOk, b325). A fabrica NAO: `/amb/conectar`, `/amb/config`,
// `/amb/auth/diag` etc. so abriam com `?k=ADMIN_KEY` (ou header) — e a pagina /conectar ainda carimbava a chave em
// todos os links. Agora, no servidor real (3 empresas por HTTP):
//   - admin logado no painel da empresa abre a rota sem chave; estoquista logado e sem sessao: 404 como antes;
//   - header x-admin-key segue valendo (caminho de servico);
//   - /conectar aberto por SESSAO nao tem `k=` em link nenhum; aberto por ?k= (link salvo) mantem a chave nos links
//     (transicao: nao quebrar o fluxo antigo ate o dono rotacionar a ADMIN_KEY);
//   - a sessao de admin da AMB nao abre a rota admin da Girassol.
// Roda com: node test/admin-por-sessao-na-fabrica.test.js
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CHAVE = 'chave-admin-de-teste-que-nao-e-a-de-producao';

(async () => {
  const env = {
    ADMIN_KEY: CHAVE,
    USERS: 'esto:s1:Esto,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Esto,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
    AMB_USERS: 'esto:s1,dono:s2', AMB_ADMIN_USER: 'dono', AMB_SESSION_SECRET: 'segredo-da-amb-so-pra-teste-0123456789',
    GIRASSOL_USERS: 'esto:s1,dono:s2', GIRASSOL_ADMIN_USER: 'dono', GIRASSOL_SESSION_SECRET: 'segredo-da-girassol-so-pra-teste-0123456789',
  };
  const s = await subir({ env, tetoMs: 45000 });
  try {
    ok(s.subiu && !s.morreuCedo, '⚠️ o server.js subiu' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    const login = async (rota, usuario, senha) => {
      const r = await s.pedir(rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario, senha } });
      return ((r.headers['set-cookie'] || []).find((x) => /^sessao/.test(x)) || '').split(';')[0];
    };
    const sessoes = {};
    for (const e of [{ nome: 'AMB', rota: '/amb' }, { nome: 'Girassol', rota: '/girassol' }]) {
      console.log('\n── ' + e.nome);
      const dono = await login(e.rota, 'dono', 's2'); const esto = await login(e.rota, 'esto', 's1');
      sessoes[e.nome] = dono;
      ok(dono && esto, '  logins ok');
      const semNada = await s.pedir(e.rota + '/auth/diag');
      ok(semNada.status === 404, '  sem sessao e sem chave: 404 (' + semNada.status + ')');
      const comEsto = await s.pedir(e.rota + '/auth/diag', { cookie: esto });
      ok(comEsto.status === 404, '  estoquista logado: 404 (' + comEsto.status + ')');
      const comDono = await s.pedir(e.rota + '/auth/diag', { cookie: dono });
      ok(comDono.status === 200 && /"ok":true/.test(comDono.corpo), '⚠️ admin logado no painel abre a rota de chave SEM chave na URL (' + comDono.status + ')');
      const comHeader = await new Promise((resolve) => {
        const http = require('http');
        const req = http.request({ host: '127.0.0.1', port: s.porta, path: e.rota + '/auth/diag', headers: { 'x-admin-key': CHAVE } }, (res) => { let c = ''; res.on('data', (x) => { c += x; }); res.on('end', () => resolve({ status: res.statusCode, corpo: c })); });
        req.on('error', () => resolve({ status: 0, corpo: '' })); req.end();
      });
      ok(comHeader.status === 200, '  header x-admin-key (servico) segue valendo (' + comHeader.status + ')');
      const conectarSessao = await s.pedir(e.rota + '/conectar', { cookie: dono });
      ok(conectarSessao.status === 200 && /<html/i.test(conectarSessao.corpo), '  /conectar por sessao: 200 (' + conectarSessao.status + ')');
      const linksComK = (conectarSessao.corpo.match(/href="[^"]*[?&]k=[^"]*"/g) || []);
      ok(linksComK.length === 0, '⚠️ /conectar por SESSAO nao carimba a chave em link nenhum (' + linksComK.length + ' com k=)');
      ok(!conectarSessao.corpo.includes(CHAVE), '  e a chave nao aparece no HTML');
      const conectarK = await s.pedir(e.rota + '/conectar?k=' + encodeURIComponent(CHAVE));
      const linksK = (conectarK.corpo.match(/href="[^"]*[?&]k=[^"]*"/g) || []);
      ok(conectarK.status === 200 && linksK.length >= 6, '  /conectar por ?k= (link salvo) segue abrindo e mantem a chave nos links durante a transicao (' + linksK.length + ')');
      // b757 (review do Codex no #618): rota que muta ou e global NAO abre por sessao (CSRF via SameSite=Lax; sessao e da empresa)
      for (const rotaSensivel of ['/tokens/preventiva?forcar=1', '/ml/token/preventiva?forcar=1', '/nf/entrada/indice/construir', '/magalu/indice/construir', '/ml/indice/construir', '/nf/indice/construir', '/api/debug/ml-get?path=/users/me', '/shopee/teste?refresh=1']) {
        const porSessao = await s.pedir(e.rota + rotaSensivel, { cookie: dono });
        ok(porSessao.status === 404, '⚠️ ' + rotaSensivel + ' por SESSAO: 404, so a chave abre (' + porSessao.status + ')');
      }
      // b759 (Codex #618): ?coletar=1 dispara coleta na ponte TikTok — so com a chave; a leitura segue por sessao
      const coletaSessao = await s.pedir(e.rota + '/api/debug/tiktok-devolucoes?coletar=1&dias=60', { cookie: dono });
      ok(coletaSessao.status === 404, '⚠️ tiktok-devolucoes?coletar=1 por SESSAO: 404 (' + coletaSessao.status + ')');
      const leituraSessao = await s.pedir(e.rota + '/api/debug/tiktok-devolucoes', { cookie: dono });
      ok(leituraSessao.status !== 404, '  tiktok-devolucoes so leitura por sessao segue abrindo (' + leituraSessao.status + ')');
      const chaveErrada = await s.pedir(e.rota + '/auth/diag?k=errada');
      ok(chaveErrada.status === 404, '  chave errada: 404');
    }
    console.log('\n── entre empresas');
    const cruzado = await s.pedir('/girassol/auth/diag', { cookie: sessoes.AMB });
    ok(cruzado.status === 404, '⚠️ sessao de admin da AMB NAO abre rota admin da Girassol (' + cruzado.status + ')');
    const cruzado2 = await s.pedir('/amb/auth/diag', { cookie: sessoes.Girassol });
    ok(cruzado2.status === 404, '  e vice-versa (' + cruzado2.status + ')');
  } finally { s.matar(); }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
