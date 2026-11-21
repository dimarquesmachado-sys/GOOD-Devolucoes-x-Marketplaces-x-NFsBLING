'use strict';
// b782 — T-02 (parte 2, auditoria do Codex 15/11): o APP DE VERDADE gravando no BANCO DE VERDADE.
//
// server.js (3 empresas, filho, como no Render) → supabase-js → PostgREST REAL (test/_postgrest-real.js) → PostgreSQL 16
// com o schema de producao (test/_postgres-descartavel.js, export de 20/11). Diferente do PostgREST falso, aqui uma
// coluna que a tabela nao tem RECUSA a gravacao inteira (PGRST204), tipo errado da erro, constraint vale, e a
// sequencia/uuid do id e a do banco — exatamente o que pega em producao e passava nos testes.
//
// Fluxos da triagem, nas 3 empresas (GOOD em `devolucoes`, AMB em `devolucoes_amb`, Girassol em `devolucoes_girassol`):
//   - estoquista APROVA um pacote → a linha nasce no banco, na tabela da empresa;
//   - admin reporta PROBLEMA sem fotos (b778) → linha 'problema' com descricao, local e qtd;
//   - estoquista marca CONSERTADO → linha aprovada com o conserto registrado;
//   - nenhuma escrita (POST/PATCH) que esses fluxos fazem e recusada pelo PostgREST; e nenhuma linha cai na tabela de
//     outra empresa.
// Precisa do PostgreSQL 16 (initdb/pg_ctl) e baixa o PostgREST fixado (sha256 conferido). Roda com:
//   node test/postgrest-real-triagem.test.js
const { subirPostgres } = require('./_postgres-descartavel');
const { subirPostgrestReal } = require('./_postgrest-real');
const { subir } = require('./_boot-real');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };

const EMPRESAS = [
  { nome: 'GOOD', rota: '', sufixo: '', cookie: 'sessao' },
  { nome: 'AMB', rota: '/amb', sufixo: '_amb', prefixo: 'AMB_', cookie: 'sessao_amb' },
  { nome: 'Girassol', rota: '/girassol', sufixo: '_girassol', prefixo: 'GIRASSOL_', cookie: 'sessao_girassol' },
];

(async () => {
  let pg = null, rest = null, s = null;
  try {
    pg = await subirPostgres();
    rest = await subirPostgrestReal(pg);
    ok(true, '  PostgreSQL 16 com o schema de producao + PostgREST ' + rest.versao + ' de verdade na frente');
    const chave = rest.chave('service_role');
    const env = {
      SUPABASE_URL: rest.url, SUPABASE_KEY: chave, GOOD_SUPABASE_URL: rest.url, GOOD_SUPABASE_KEY: chave,
      USERS: 'esto:s1:Estoquista,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Estoquista,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
      SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
    };
    for (const e of EMPRESAS.slice(1)) {
      env[e.prefixo + 'SUPABASE_URL'] = rest.url; env[e.prefixo + 'SUPABASE_KEY'] = chave;
      env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
      env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
    }
    s = await subir({ env, tetoMs: 60000 });
    ok(s.subiu, '⚠️ o server.js subiu falando com o PostgREST de verdade' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''));
    if (!s.subiu) throw new Error('nao subiu');
    const login = async (e, u, p) => {
      const r = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario: u, senha: p } });
      return ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0];
    };
    const marcaEscritas = () => rest.pedidos.length;
    for (const e of EMPRESAS) {
      console.log('\n── ' + e.nome + ' (devolucoes' + e.sufixo + ')');
      const esto = await login(e, 'esto', 's1'), dono = await login(e, 'dono', 's2');
      ok(esto && dono, '  login do estoquista e do admin');
      const base = (n) => ({
        marketplace: 'mercadolivre', order_id: '20000' + e.nome.length + '00000000' + n, shipment_id: '4' + e.nome.length + '00000000' + n,
        tracking: 'TRK' + e.nome + n, buyer_nome: 'Cliente ' + e.nome, produto_sku: 'SKU-' + e.nome, produto_titulo: 'Produto ' + e.nome,
        produto_qtd: 1, nf_numero: '1234' + n, nf_serie: '1',
      });
      const desde = marcaEscritas();
      const T = 'devolucoes' + e.sufixo;
      const linha = (where) => pg.sql(`select row_to_json(t) from public.${T} t where ${where} limit 1`);   // shipment unico por caso

      // 1. aprovar
      const r1 = await s.pedir(e.rota + '/api/triagem/aprovar', { metodo: 'POST', cookie: esto, corpo: Object.assign(base(1), { fotos: [] }) });
      ok(r1.status === 200 && (json(r1) || {}).ok === true, '⚠️ APROVAR grava no banco de verdade (' + r1.status + ' ' + String(r1.corpo).slice(0, 220) + ')');
      const l1 = JSON.parse(linha(`shipment_id = '${base(1).shipment_id}'`) || 'null');
      ok(l1 && l1.produto_sku === 'SKU-' + e.nome && l1.funcionario, '  a linha esta em ' + T + ' (id ' + (l1 && l1.id) + ', tipo ' + (l1 && l1.tipo) + ', status ' + (l1 && l1.status) + ')');

      // 2. problema sem fotos (admin)
      const r2 = await s.pedir(e.rota + '/api/triagem/problema', { metodo: 'POST', cookie: dono, corpo: Object.assign(base(2), { descricao: 'tampa amassada', localizacao: 'DEF-A3', defeito_qtd: 2, fotos: [], sem_fotos: true }) });
      ok(r2.status === 200 && (json(r2) || {}).ok === true, '⚠️ PROBLEMA (admin, sem fotos) grava no banco de verdade (' + r2.status + ' ' + String(r2.corpo).slice(0, 220) + ')');
      const l2 = JSON.parse(linha(`shipment_id = '${base(2).shipment_id}'`) || 'null');
      ok(l2 && /tampa amassada/.test(l2.problema_descricao || '') && l2.localizacao === 'DEF-A3' && Number(l2.defeito_qtd) === 2,
        '  descricao, local e quantidade gravados (' + JSON.stringify(l2 && { status: l2.status, tipo: l2.tipo, localizacao: l2.localizacao, defeito_qtd: l2.defeito_qtd }) + ')');

      // 3. consertado
      const r3 = await s.pedir(e.rota + '/api/triagem/consertado', { metodo: 'POST', cookie: esto, corpo: Object.assign(base(3), { descricao: 'fio solto', peca: 'soquete', fotos: [] }) });
      ok(r3.status === 200 && (json(r3) || {}).ok === true, '⚠️ CONSERTADO grava no banco de verdade (' + r3.status + ' ' + String(r3.corpo).slice(0, 220) + ')');
      const l3 = JSON.parse(linha(`shipment_id = '${base(3).shipment_id}'`) || 'null');
      ok(l3 && /CONSERTADO/.test(String(l3.problema_descricao || '') + String(l3.conserto_info || '')), '  o conserto ficou registrado na linha');

      // 4. recado: admin cria, edita; estoquista da ciente (o editar e o ciente da fabrica eram UPDATE com limit)
      const txt = 'conferir a tampa ' + e.nome;
      const rc = await s.pedir(e.rota + '/api/admin/recado', { metodo: 'POST', cookie: dono, corpo: { chave: 'PEDREC' + e.nome, identificador: 'PEDREC' + e.nome, texto: txt } });
      ok(rc.status === 200 && (json(rc) || {}).ok === true, '  RECADO criado (' + rc.status + ' ' + String(rc.corpo).slice(0, 160) + ')');
      const idRec = pg.sql(`select id from public.recados${e.sufixo} where texto = '${txt}' limit 1`);
      const re = await s.pedir(e.rota + '/api/admin/recado/' + idRec, { metodo: 'PUT', cookie: dono, corpo: { chave: 'PEDREC' + e.nome, identificador: 'PEDREC' + e.nome, texto: txt + ' e o fio' } });
      ok(re.status === 200 && (json(re) || {}).ok === true, '⚠️ RECADO editado (' + re.status + ' ' + String(re.corpo).slice(0, 160) + ')');
      const rk = await s.pedir(e.rota + '/api/recado/' + idRec + '/ciente', { metodo: 'POST', cookie: esto, corpo: {} });
      ok(rk.status === 200 && (json(rk) || {}).ok === true, '⚠️ RECADO: estoquista deu ciente (' + rk.status + ' ' + String(rk.corpo).slice(0, 160) + ')');
      const lr = JSON.parse(pg.sql(`select row_to_json(t) from public.recados${e.sufixo} t where id = ${/^\d+$/.test(idRec) ? idRec : "'" + idRec + "'"} limit 1`) || 'null');
      ok(lr && lr.texto === txt + ' e o fio' && lr.ciente_por === 'esto', '  no banco: texto editado e ciente do estoquista (' + JSON.stringify(lr && { texto: lr.texto, ciente_por: lr.ciente_por }) + ')');

      // nada recusado pelo PostgREST nas escritas desta empresa
      const recusadas = rest.pedidos.slice(desde).filter((p) => /POST|PATCH|PUT|DELETE/.test(p.metodo) && p.status >= 400);
      ok(recusadas.length === 0, '⚠️ nenhuma escrita recusada pelo PostgREST (coluna inexistente, tipo, constraint)' + (recusadas.length ? ': ' + recusadas.map((p) => p.metodo + ' ' + p.caminho.slice(0, 80) + ' → ' + p.status + ' ' + p.erro).join(' | ') : ''));
    }
    // cada empresa na sua tabela
    const cont = (t) => Number(pg.sql(`select count(*) from public.${t}`));
    ok(cont('devolucoes') === 3 && cont('devolucoes_amb') === 3 && cont('devolucoes_girassol') === 3, '⚠️ 3 linhas em cada tabela — nenhuma empresa gravou na tabela da outra (' + [cont('devolucoes'), cont('devolucoes_amb'), cont('devolucoes_girassol')].join('/') + ')');

    // o que o app LE e o banco de verdade nao tem (tabela/coluna): aparece aqui, como informacao
    const leiturasRecusadas = rest.pedidos.filter((p) => p.metodo === 'GET' && p.status >= 400);
    const porMotivo = {};
    for (const p of leiturasRecusadas) { const k = (p.caminho.split('?')[0]) + ' → ' + p.status + ' ' + String(p.erro || '').replace(/\s+/g, ' ').slice(0, 140); porMotivo[k] = (porMotivo[k] || 0) + 1; }
    console.log('\n  leituras recusadas pelo PostgREST no boot + fluxos (' + leiturasRecusadas.length + '):');
    for (const [k, n] of Object.entries(porMotivo)) console.log('     ' + n + '× ' + k);
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
    if (s && s.fimDoLog) console.log(s.fimDoLog());
  } finally {
    if (s) await s.matar();
    if (rest) rest.parar();
    if (pg) pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
