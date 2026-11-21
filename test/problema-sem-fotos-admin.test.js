'use strict';
// b778 — pedido do dono (21/11): "caso seja o admin fazendo triagem, só serve pra admin isso hein, se o admin nao
// quiser tirar foto do produto triado com problema, ele nao precisa anexar as 6 imagens — dar uma opcao pro admin
// ao reportar problema, marcar sem fotos".
//
// Prova por HTTP, no server.js de verdade com as 3 empresas (PostgREST falso atras), em POST /api/triagem/problema:
//   estoquista, 0 fotos                      → 400 "Minimo 6 fotos"   (na fabrica isto e NOVO: antes so a tela conferia)
//   estoquista, 0 fotos, sem_fotos:true      → 403 "so pro admin", nada gravado
//   admin,      0 fotos, SEM marcar          → 400 (admin tambem precisa marcar "Sem fotos" — nao e automatico)
//   admin,      0 fotos, sem_fotos:"true"    → 400 (so o booleano vale)
//   admin,      0 fotos, sem_fotos:true      → 200 e o defeito entra na tabela DESTA empresa, com problema_fotos vazio
// Roda com: node test/problema-sem-fotos-admin.test.js
const { subir } = require('./_boot-real');
const { subirPostgrest } = require('./_postgrest-falso');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };

const EMPRESAS = [
  { nome: 'GOOD', rota: '', sufixo: '', prefixo: 'GOOD_', cookie: 'sessao' },
  { nome: 'AMB', rota: '/amb', sufixo: '_amb', prefixo: 'AMB_', cookie: 'sessao_amb' },
  { nome: 'Girassol', rota: '/girassol', sufixo: '_girassol', prefixo: 'GIRASSOL_', cookie: 'sessao_girassol' },
];

(async () => {
  const pg = await subirPostgrest({ tabelas: {} });
  for (const e of EMPRESAS) for (const t of ['devolucoes', 'recados', 'sku_depara', 'defeito_pedidos', 'pecas_retiradas']) pg.tabela(t + e.sufixo);
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
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome + ' (' + (e.rota || '/') + ', tabela devolucoes' + e.sufixo + ')');
      const esto = await login(e, 'esto', 's1'), dono = await login(e, 'dono', 's2');
      ok(esto && dono, '  login do estoquista e do admin');
      const tabela = pg.tabela('devolucoes' + e.sufixo);
      const corpo = (extra) => Object.assign({
        shipment_id: 'SHIP-' + e.nome, order_id: 'PED-' + e.nome, marketplace: 'mercadolivre', tracking: 'TRK-' + e.nome,
        produto_sku: 'SKU-' + e.nome, produto_titulo: 'Luminaria ' + e.nome, produto_qtd: 1,
        descricao: 'globo trincado', localizacao: 'DEF-A3', defeito_qtd: 1, fotos: [],
      }, extra || {});
      const antes = tabela.length;

      const r1 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: esto, corpo: corpo() });
      ok(r1.status === 400 && /Minimo 6 fotos/.test((json(r1) || {}).erro || ''), '⚠️ estoquista sem fotos: 400 "Minimo 6 fotos" (' + r1.status + ' ' + ((json(r1) || {}).erro || '') + ')');
      const r2 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: esto, corpo: corpo({ sem_fotos: true }) });
      ok(r2.status === 403 && /so pro admin/.test((json(r2) || {}).erro || ''), '⚠️ estoquista marcando sem_fotos: 403 "so pro admin" (' + r2.status + ')');
      ok(tabela.length === antes, '  e nada foi gravado (' + tabela.length + ')');
      const r3 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: dono, corpo: corpo() });
      ok(r3.status === 400 && /Minimo 6 fotos/.test((json(r3) || {}).erro || ''), '  admin sem marcar "Sem fotos": 400 tambem (' + r3.status + ')');
      const r4 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: dono, corpo: corpo({ sem_fotos: 'true' }) });
      ok(r4.status === 400, '  sem_fotos como texto nao vale: 400 (' + r4.status + ')');
      ok(tabela.length === antes, '  ainda nada gravado');
      const r5 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: dono, corpo: corpo({ sem_fotos: true }) });
      ok(r5.status === 200 && (json(r5) || {}).ok === true, '⚠️ ADMIN com "Sem fotos": 200 (' + r5.status + ' ' + String(r5.corpo).slice(0, 140) + ')');
      const nova = tabela[tabela.length - 1] || {};
      ok(tabela.length === antes + 1, '  o defeito entrou em devolucoes' + e.sufixo + ' (' + tabela.length + ')');
      ok(Array.isArray(nova.problema_fotos) ? nova.problema_fotos.length === 0 : (nova.problema_fotos == null), '  com problema_fotos vazio (' + JSON.stringify(nova.problema_fotos) + ')');
      ok(/globo trincado/.test(String(nova.problema_descricao || '')), '  e a descricao do admin gravada');
      ok(!('sem_fotos' in nova), '  e o sem_fotos NAO vai pro banco (coluna que nao existe derrubaria a gravacao inteira)');
    }
    for (const e of EMPRESAS) ok(pg.tabela('devolucoes' + e.sufixo).length === 1, '  devolucoes' + e.sufixo + ' tem so o defeito da ' + e.nome + ' (' + pg.tabela('devolucoes' + e.sufixo).length + ')');
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    await s.matar(); await pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
