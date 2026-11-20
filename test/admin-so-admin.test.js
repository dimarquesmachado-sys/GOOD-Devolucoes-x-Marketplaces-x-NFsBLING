'use strict';
// b773 — V-02 (auditoria do Codex 15/11; regra do dono 20/11: "a tela de admin, so admin entra; estoquista nao tem
// que ter acesso ao ADMIN do Devolucoes"). Duas provas, nas 3 empresas, no server.js de verdade (PostgREST falso atras):
//   1. RECADO PRO ESTOQUISTA e coisa de admin: criar, listar, editar e remover/resolver. O estoquista so marca "ciente".
//      Antes, a GOOD ja era assim e a fabrica (AMB/Girassol) deixava o estoquista criar, listar e resolver pelos
//      aliases do painel E pelas rotas nativas /api/recados*.
//   2. O PAINEL ADMIN E TODA ROTA /api/admin/* fecham pro estoquista (401/403) — a GOOD servia /painel-novo.html com
//      requerAdmin; a fabrica deixava o estoquista abrir /painel e sete rotas de leitura do painel (orfaos, devolucoes,
//      sku-depara, espreita, espreita/nota, indice-nf-devolucao, sem-retorno) com login comum. Aqui o teste VARRE as
//      rotas /api/admin/* registradas na fabrica (lendo o fonte) e bate em cada uma com o cookie do estoquista: toda
//      resposta tem que ser 401/403 — rota nova com requerLogin cai aqui.
// Roda com: node test/admin-so-admin.test.js
const fs = require('fs');
const path = require('path');
require('./_fonte-painel'); require('./_fonte-fabrica');   // o teste le o app-AMB.js e cita o painel-AMB.html: le a fonte COMPOSTA (fatias de volta no lugar)
const { subir } = require('./_boot-real');
const { subirPostgrest } = require('./_postgrest-falso');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };

const EMPRESAS = [
  { nome: 'GOOD', rota: '', sufixo: '', prefixo: 'GOOD_', cookie: 'sessao',
    criar: { rota: '/api/admin/recado', corpo: { chave: 'PED-GOOD', texto: 'segunda caixa chega amanha' } },
    listar: '/api/admin/recados', remover: (id) => '/api/admin/recado/' + id + '/remover', ciente: (id) => '/api/recado/' + id + '/ciente' },
  { nome: 'AMB', rota: '/amb', sufixo: '_amb', prefixo: 'AMB_', cookie: 'sessao_amb',
    criar: { rota: '/api/admin/recado', corpo: { identificador: 'PED-AMB', texto: 'segunda caixa chega amanha' } },
    listar: '/api/admin/recados', remover: (id) => '/api/admin/recado/' + id + '/remover', ciente: (id) => '/api/recado/' + id + '/ciente',
    nativas: { listar: '/api/recados', criar: '/api/recados', resolver: (id) => '/api/recados/' + id + '/resolver' } },
  { nome: 'Girassol', rota: '/girassol', sufixo: '_girassol', prefixo: 'GIRASSOL_', cookie: 'sessao_girassol',
    criar: { rota: '/api/admin/recado', corpo: { identificador: 'PED-GIR', texto: 'segunda caixa chega amanha' } },
    listar: '/api/admin/recados', remover: (id) => '/api/admin/recado/' + id + '/remover', ciente: (id) => '/api/recado/' + id + '/ciente',
    nativas: { listar: '/api/recados', criar: '/api/recados', resolver: (id) => '/api/recados/' + id + '/resolver' } },
];

(async () => {
  const pg = await subirPostgrest({ tabelas: {} });
  for (const e of EMPRESAS) pg.tabela('recados' + e.sufixo);
  const env = {
    SUPABASE_URL: pg.url, SUPABASE_KEY: 'k-good', GOOD_SUPABASE_URL: pg.url, GOOD_SUPABASE_KEY: 'k-good',
    USERS: 'esto:s1:Estoquista GOOD,dono:s2:Dono GOOD', ADMIN_USER: 'dono',
    GOOD_USERS: 'esto:s1:Estoquista GOOD,dono:s2:Dono GOOD', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789',
    ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) {
    env[e.prefixo + 'SUPABASE_URL'] = pg.url; env[e.prefixo + 'SUPABASE_KEY'] = 'k-' + e.nome.toLowerCase();
    env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
    env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
  }
  const s = await subir({ env, tetoMs: 45000 });
  try {
    ok(s.subiu, '⚠️ o server.js subiu com as 3 empresas' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    const login = async (e, usuario, senha) => {
      const r = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario, senha } });
      return ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0];
    };
    const negado = (st) => st === 401 || st === 403;
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome + ' (' + (e.rota || '/') + ', tabela recados' + e.sufixo + ')');
      const esto = await login(e, 'esto', 's1'), dono = await login(e, 'dono', 's2');
      ok(esto && dono, '  login do estoquista e do admin');
      const tabela = pg.tabela('recados' + e.sufixo);
      const antes = tabela.length;

      // ── estoquista: nada alem do "ciente" ──
      const eCriar = await s.pedir(e.rota + e.criar.rota, { metodo: 'POST', cookie: esto, corpo: e.criar.corpo });
      ok(negado(eCriar.status), '⚠️ estoquista NAO cria recado: ' + eCriar.status);
      ok(tabela.length === antes, '  e nada foi gravado na tabela (' + tabela.length + ')');
      const eListar = await s.pedir(e.rota + e.listar, { cookie: esto });
      ok(negado(eListar.status), '⚠️ estoquista NAO lista recados: ' + eListar.status);
      const eRemover = await s.pedir(e.rota + e.remover(1), { metodo: 'POST', cookie: esto });
      ok(negado(eRemover.status), '⚠️ estoquista NAO remove recado: ' + eRemover.status);
      if (e.nativas) {
        const n1 = await s.pedir(e.rota + e.nativas.criar, { metodo: 'POST', cookie: esto, corpo: { identificador: 'X', texto: 'y' } });
        const n2 = await s.pedir(e.rota + e.nativas.listar, { cookie: esto });
        const n3 = await s.pedir(e.rota + e.nativas.resolver(1), { metodo: 'POST', cookie: esto });
        ok(negado(n1.status) && negado(n2.status) && negado(n3.status), '⚠️ rotas nativas /api/recados* tambem fecham pro estoquista (' + n1.status + '/' + n2.status + '/' + n3.status + ')');
        ok(tabela.length === antes, '  e nada foi gravado por elas');
      }
      const semSessao = await s.pedir(e.rota + e.listar);
      ok(semSessao.status === 401, '  sem sessao: 401 (' + semSessao.status + ')');

      // ── admin: cria, lista, e o recado cai na tabela desta empresa ──
      const aCriar = await s.pedir(e.rota + e.criar.rota, { metodo: 'POST', cookie: dono, corpo: e.criar.corpo });
      ok(aCriar.status === 200 && (json(aCriar) || {}).ok, '⚠️ admin cria recado: ' + aCriar.status + ' ' + String(aCriar.corpo).slice(0, 80));
      ok(tabela.length === antes + 1, '  gravado em recados' + e.sufixo + ' (' + tabela.length + ')');
      const idRecado = tabela[tabela.length - 1].id;
      const aListar = await s.pedir(e.rota + e.listar, { cookie: dono });
      ok(aListar.status === 200, '  admin lista: ' + aListar.status);

      // ── estoquista: "ciente" continua liberado ──
      const eCiente = await s.pedir(e.rota + e.ciente(idRecado), { metodo: 'POST', cookie: esto, corpo: {} });
      ok(eCiente.status === 200 && (json(eCiente) || {}).ok !== false, '⚠️ estoquista marca CIENTE: ' + eCiente.status);
      ok(!!tabela[tabela.length - 1].ciente_por, '  ciente_por gravado (' + tabela[tabela.length - 1].ciente_por + ')');

      // ── admin remove ──
      const aRemover = await s.pedir(e.rota + e.remover(idRecado), { metodo: 'POST', cookie: dono });
      ok(aRemover.status === 200, '  admin remove: ' + aRemover.status);
    }
    // ── 2. o painel e TODAS as rotas /api/admin/* da fabrica, com o cookie do estoquista ──
    const fontes = ['amb-devolucoes/app-AMB.js', 'amb-devolucoes/lib-AMB/compat-AMB.js', 'amb-devolucoes/lib-AMB/rotas-admin-AMB.js', 'amb-devolucoes/lib-AMB/sem-retorno-AMB.js']
      .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
    const rotasAdmin = [...fontes.matchAll(/(?:router|app)\.(get|post|put|delete)\('(\/api\/admin\/[^']*)'/g)]
      .map((m) => ({ metodo: m[1].toUpperCase(), rota: m[2].replace(/:[a-zA-Z_]+/g, '1') }));
    const vistas = new Set();
    ok(rotasAdmin.length >= 20, '  ' + rotasAdmin.length + ' rotas /api/admin/* registradas na fabrica (lidas do fonte)');
    for (const e of EMPRESAS.slice(1)) {
      console.log('\n── ' + e.nome + ': painel e /api/admin/* com o cookie do estoquista');
      const esto = await login(e, 'esto', 's1'), dono = await login(e, 'dono', 's2');
      for (const rota of ['/painel', '/painel-AMB.html']) {
        const r = await s.pedir(e.rota + rota, { cookie: esto });
        ok(negado(r.status), '⚠️ estoquista NAO abre o painel admin ' + rota + ': ' + r.status);
        const a = await s.pedir(e.rota + rota, { cookie: dono });
        ok(a.status === 200 && /<html/i.test(String(a.corpo)), '  admin abre ' + rota + ': ' + a.status);
      }
      let abertas = [];
      for (const { metodo, rota } of rotasAdmin) {
        const chave = metodo + ' ' + rota; if (vistas.has(e.nome + chave)) continue; vistas.add(e.nome + chave);
        const r = await s.pedir(e.rota + rota, { metodo, cookie: esto, corpo: {} });
        if (!negado(r.status)) abertas.push(chave + ' → ' + r.status);
      }
      ok(abertas.length === 0, '⚠️ nenhuma rota /api/admin/* responde ao estoquista com outra coisa que 401/403' + (abertas.length ? ':\n      ' + abertas.join('\n      ') : ' (' + rotasAdmin.length + ' rotas)'));
    }

    // isolamento: cada empresa gravou SO na sua tabela
    for (const e of EMPRESAS) ok(pg.tabela('recados' + e.sufixo).length === 1, '  recados' + e.sufixo + ' tem exatamente o recado da ' + e.nome + ' (' + pg.tabela('recados' + e.sufixo).length + ')');
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    await s.matar(); await pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
