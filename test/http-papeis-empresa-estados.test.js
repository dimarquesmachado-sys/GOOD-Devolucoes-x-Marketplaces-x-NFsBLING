'use strict';
// b748 — T-01 (auditoria do Codex, 15/11): PAPEIS, EMPRESA E ESTADOS POR HTTP, NO SERVIDOR DE VERDADE, NAS 3 EMPRESAS.
//
// Sobe o server.js como na producao (filho, env com GOOD + AMB + Girassol ativas) falando com um PostgREST falso na
// porta (test/_postgrest-falso.js) e bate nas rotas com cookies reais. O que fica provado, por empresa:
//   papeis   — estoquista nao autoriza/recusa (403), nao abre rota de admin (401); admin abre;
//   estados  — a maquina mora no servidor (P1-04): concluir pendente = 409, autorizar de novo = 409, recusar
//              autorizado = 409; pendente → autorizado → concluido so nessa ordem; o banco reflete;
//   empresa  — cada empresa so toca a SUA tabela (sufixo); o cookie de uma nao abre a outra; a foto de outra
//              empresa e 404 no proxy (P1-09).
// Roda com: node test/http-papeis-empresa-estados.test.js
const { subir } = require('./_boot-real');
const { subirPostgrest } = require('./_postgrest-falso');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };

const EMPRESAS = [
  { nome: 'GOOD', rota: '', sufixo: '', prefixo: '', chaveDados: 'good', cookie: 'sessao' },
  { nome: 'AMB', rota: '/amb', sufixo: '_amb', prefixo: 'AMB_', chaveDados: 'amb', cookie: 'sessao_amb' },
  { nome: 'Girassol', rota: '/girassol', sufixo: '_girassol', prefixo: 'GIRASSOL_', chaveDados: 'girassol', cookie: 'sessao_girassol' },
];
const URL_FOTO = (pgUrl, chave) => `${pgUrl}/storage/v1/object/public/fotos-problema/${chave}`;

(async () => {
  // ── banco: um pedido pendente de DESCARTE por empresa (descarte nao toca o Bling) + a devolucao dona de uma foto ──
  const tabelas = {};
  const objetos = {};   // Storage falso: a foto de cada empresa, com bytes proprios
  const pg = await subirPostgrest({ tabelas, objetos });
  const FOTO = (e) => `fotos-problema/${e.chaveDados}/foto-${e.nome}.jpg`;
  for (const e of EMPRESAS) objetos[FOTO(e)] = { tipo: 'image/jpeg', bytes: Buffer.from('\xff\xd8\xff\xe0 JPEG-' + e.nome, 'latin1') };
  for (const e of EMPRESAS) {
    tabelas['defeito_pedidos' + e.sufixo] = [
      { id: 10, status: 'pendente', tipo: 'descarte', defeito_id: 100, sku: 'SKU-' + e.nome, quantidade: 1 },
      { id: 11, status: 'pendente', tipo: 'descarte', defeito_id: 101, sku: 'SKU-' + e.nome, quantidade: 1 },
    ];
    tabelas['devolucoes' + e.sufixo] = [
      { id: 100, tipo: 'defeito_estoque', status: 'problema', sku: 'SKU-' + e.nome, estado_atual: null, problema_fotos: [URL_FOTO(pg.url, e.chaveDados + '/foto-' + e.nome + '.jpg')] },
      { id: 101, tipo: 'defeito_estoque', status: 'problema', sku: 'SKU-' + e.nome, estado_atual: null, problema_fotos: [] },
    ];
  }
  // o falso ja esta no ar: as tabelas semeadas depois entram pela referencia
  for (const [t, linhas] of Object.entries(tabelas)) pg.tabela(t).push(...linhas);

  const env = {
    SUPABASE_URL: pg.url, SUPABASE_KEY: 'k-good', GOOD_SUPABASE_URL: pg.url, GOOD_SUPABASE_KEY: 'k-good',
    USERS: 'esto:s1:Estoquista GOOD,dono:s2:Dono GOOD', ADMIN_USER: 'dono',
    GOOD_USERS: 'esto:s1:Estoquista GOOD,dono:s2:Dono GOOD', GOOD_ADMIN_USER: 'dono',
    SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789',
    ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
  };
  for (const e of EMPRESAS.slice(1)) {
    env[e.prefixo + 'SUPABASE_URL'] = pg.url; env[e.prefixo + 'SUPABASE_KEY'] = 'k-' + e.chaveDados;
    env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2';   // a fabrica e `usuario:senha` (a GOOD aceita um 3o campo, o nome)
    env[e.prefixo + 'ADMIN_USER'] = 'dono';
    env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.chaveDados + '-so-pra-teste-0123456789';
  }
  const s = await subir({ env, tetoMs: 45000 });
  try {
  ok(!s.morreuCedo, '⚠️ o server.js NAO morreu no boot com as 3 empresas' + (s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
  ok(s.subiu, '⚠️ /health 200' + (!s.subiu && !s.morreuCedo ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
  if (!s.subiu) throw new Error('o servidor nao subiu');

  const sessoes = {};   // nome -> { esto, dono } cookies
  async function login(e, usuario, senha) {
    const r = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario, senha } });
    const cookie = ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0];
    return { status: r.status, cookie, tipo: (json(r) || {}).tipo };
  }
  const decidir = (e, id, acao, cookie) => s.pedir(`${e.rota}/api/defeitos/pedido/${id}/decidir`, { metodo: 'POST', cookie, corpo: { acao } });

  const janelas = {};   // nome -> [inicio, fim) no log de requisicoes do banco: so o que ESTA empresa provocou
  for (const e of EMPRESAS) {
    console.log('\n── ' + e.nome + ' (' + (e.rota || '/') + ', tabelas *' + (e.sufixo || '(sem sufixo)') + ')');
    janelas[e.nome] = [pg.pedidos.length, null];
    const esto = await login(e, 'esto', 's1');
    const dono = await login(e, 'dono', 's2');
    ok(esto.status === 200 && esto.cookie && esto.tipo !== 'admin', '  login estoquista ok (tipo ' + esto.tipo + ', cookie ' + e.cookie + ')');
    ok(dono.status === 200 && dono.cookie && dono.tipo === 'admin', '  login admin ok (tipo ' + dono.tipo + ')');
    ok((await login(e, 'esto', 'errada')).status === 401, '  senha errada: 401');
    sessoes[e.nome] = { esto: esto.cookie, dono: dono.cookie };

    // ── papeis ──
    const semSessao = await decidir(e, 10, 'autorizar', null);
    ok(semSessao.status === 401, '  sem sessao: decidir = 401 (' + semSessao.status + ')');
    const estoAut = await decidir(e, 10, 'autorizar', esto.cookie);
    ok(estoAut.status === 403, '⚠️ estoquista NAO autoriza: 403 (' + estoAut.status + ')');
    const estoRec = await decidir(e, 10, 'recusar', esto.cookie);
    ok(estoRec.status === 403, '⚠️ estoquista NAO recusa: 403 (' + estoRec.status + ')');
    const rotaAdmin = e.rota ? '/api/admin/foto/x.jpg' : '/painel-novo.html';
    const estoAdmin = await s.pedir(e.rota + rotaAdmin, { cookie: esto.cookie });
    ok([401, 302, 403].includes(estoAdmin.status), '⚠️ estoquista em rota de admin (' + rotaAdmin + '): ' + estoAdmin.status);

    // ── estados (P1-04): a maquina mora no servidor ──
    const concluirPendente = await decidir(e, 10, 'concluir', esto.cookie);
    ok(concluirPendente.status === 409 && (json(concluirPendente) || {}).de === 'pendente', '⚠️ concluir um PENDENTE = 409 (' + concluirPendente.status + ': ' + ((json(concluirPendente) || {}).erro || '') + ')');
    ok(pg.tabela('defeito_pedidos' + e.sufixo).find((p) => p.id === 10).status === 'pendente', '  o banco segue pendente');
    const aut = await decidir(e, 10, 'autorizar', dono.cookie);
    ok(aut.status === 200 && (json(aut) || {}).ok && json(aut).pedido.status === 'autorizado', '⚠️ admin autoriza pendente: 200 → autorizado (' + aut.status + ')');
    ok(pg.tabela('defeito_pedidos' + e.sufixo).find((p) => p.id === 10).status === 'autorizado', '  o banco diz autorizado');
    const aut2 = await decidir(e, 10, 'autorizar', dono.cookie);
    ok(aut2.status === 409 && (json(aut2) || {}).de === 'autorizado', '⚠️ autorizar DE NOVO = 409 (' + aut2.status + ')');
    const rec = await decidir(e, 10, 'recusar', dono.cookie);
    ok(rec.status === 409, '⚠️ recusar um autorizado = 409 (' + rec.status + ')');
    const conc = await decidir(e, 10, 'concluir', esto.cookie);
    ok(conc.status === 200 && (json(conc) || {}).ok && json(conc).pedido.status === 'concluido', '⚠️ estoquista conclui o AUTORIZADO: 200 → concluido (' + conc.status + ')');
    const conc2 = await decidir(e, 10, 'concluir', esto.cookie);
    ok(conc2.status === 409, '  concluir de novo = 409 (' + conc2.status + ')');
    const recusa = await decidir(e, 11, 'recusar', dono.cookie);
    ok(recusa.status === 200 && json(recusa).pedido.status === 'recusado', '  admin recusa o outro pendente: 200 → recusado');
    ok((await decidir(e, 11, 'autorizar', dono.cookie)).status === 409, '  autorizar um recusado = 409');
    ok((await decidir(e, 999, 'autorizar', dono.cookie)).status === 404, '  pedido inexistente = 404');
    ok((await decidir(e, 10, 'teleportar', dono.cookie)).status === 400, '  acao desconhecida = 400');
    const dev = pg.tabela('devolucoes' + e.sufixo).find((d) => d.id === 100);
    ok(/DESCARTE AUTORIZADO/.test(String(dev.estado_atual || '')), '  a devolucao dona do pedido recebeu a decisao (' + String(dev.estado_atual || '').slice(0, 30) + '…)');
    janelas[e.nome][1] = pg.pedidos.length;
  }

  // ── empresa: cada uma so tocou a sua tabela ──
  console.log('\n── isolamento entre empresas');
  // Codex #610: dentro da JANELA de cada empresa, TODA escrita nas tabelas do ciclo tem que ser na tabela dela —
  // uma escrita fora (ex.: AMB comentando na `defeito_comentarios` da GOOD) e rejeitada, nao contada pra outra
  for (const e of EMPRESAS) {
    const [ini, fim] = janelas[e.nome];
    const escritas = pg.pedidos.slice(ini, fim).filter((p) => (p.metodo === 'PATCH' || p.metodo === 'POST' || p.metodo === 'DELETE') && /^(defeito_pedidos|devolucoes|defeito_comentarios|pecas_retiradas)/.test(p.tabela));
    const minhas = (t) => new RegExp('^(defeito_pedidos|devolucoes|defeito_comentarios|pecas_retiradas)' + e.sufixo + '$').test(t);
    const fora = escritas.filter((p) => !minhas(p.tabela));
    ok(escritas.length > 0 && fora.length === 0, '⚠️ ' + e.nome + ': todas as ' + escritas.length + ' escritas da sua janela foram em tabelas *' + (e.sufixo || '(sem sufixo)') + (fora.length ? ' — FORA: ' + fora.map((p) => p.metodo + ' ' + p.tabela).join(', ') : ''));
  }
  for (const e of EMPRESAS) for (const o of EMPRESAS) {
    if (e === o) continue;
    const cruzado = await decidir(o, 10, 'autorizar', sessoes[e.nome].dono);
    ok(cruzado.status === 401, '⚠️ cookie de admin da ' + e.nome + ' na rota da ' + o.nome + ': 401 (' + cruzado.status + ')');
  }
  // nenhuma escrita de outra empresa nos pedidos: os ids 10/11 de cada tabela mudaram UMA vez cada pelo seu proprio dono
  for (const e of EMPRESAS) {
    const p10 = pg.tabela('defeito_pedidos' + e.sufixo).find((p) => p.id === 10);
    ok(p10.status === 'concluido' && /^(esto|Estoquista )/.test(String(p10.quem_decidiu)), '  ' + e.nome + ': #10 concluido pelo estoquista desta empresa (' + p10.quem_decidiu + ')');
  }

  // ── P1-09: o proxy de fotos so entrega foto da propria empresa (fabrica) ──
  console.log('\n── proxy de fotos (P1-09)');
  for (const e of EMPRESAS.slice(1)) {
    const outra = EMPRESAS.find((o) => o !== e && o.rota);
    const minha = await s.pedir(`${e.rota}/api/admin/foto/${e.chaveDados}/foto-${e.nome}.jpg`, { cookie: sessoes[e.nome].dono });
    // Codex #610: exige a ENTREGA — 200, image/jpeg e os bytes desta empresa (um 401/500/timeout nao passa por "nao e 404")
    ok(minha.status === 200 && /image\/jpeg/.test(String(minha.headers['content-type'])) && minha.corpo.includes('JPEG-' + e.nome), '⚠️ ' + e.nome + ': foto da propria empresa = 200 image/jpeg com os bytes dela (' + minha.status + ', ' + String(minha.headers['content-type']) + ')');
    const alheia = await s.pedir(`${e.rota}/api/admin/foto/${outra.chaveDados}/foto-${outra.nome}.jpg`, { cookie: sessoes[e.nome].dono });
    ok(alheia.status === 404 && /nesta empresa/.test(alheia.corpo), '⚠️ ' + e.nome + ': foto da ' + outra.nome + ' = 404 "nao encontrada nesta empresa" (' + alheia.status + ')');
    const semAdmin = await s.pedir(`${e.rota}/api/admin/foto/${e.chaveDados}/foto-${e.nome}.jpg`, { cookie: sessoes[e.nome].esto });
    ok(semAdmin.status === 401, '  ' + e.nome + ': estoquista no proxy de fotos = 401 (' + semAdmin.status + ')');
  }

  } finally {
    // Codex #610: o filho (server.js real) e o banco falso morrem TAMBEM quando uma asserção estoura — senao o
    // servidor ficava orfao, com listener e rotinas de fundo, depois do teste vermelho
    s.matar();
    await pg.parar();
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
