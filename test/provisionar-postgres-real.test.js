'use strict';
// b777 — T-02 (parte 1) + H-03: o PROVISIONADOR rodando num PostgreSQL 16 de verdade, com o SCHEMA DE PRODUCAO
// (sql/schema-producao-2026-11-20.json, exportado do SQL Editor em 20/11 — test/_postgres-descartavel.js).
//
// O export mostrou que as 6 tabelas com `id` da Girassol numeram com a sequencia da AMB (o `LIKE ... INCLUDING ALL`
// do provisionador copia o default `nextval('..._amb_id_seq')`) — e a sequencia PERTENCE a tabela da AMB.
// Este teste prova, no banco de verdade:
//   1. o risco: apagar devolucoes_amb leva o default do id da Girassol junto → gravacao da Girassol falha;
//   2. o conserto: provisionar_empresa('_girassol') da a cada tabela a sua sequencia (dona = a coluna), comecando
//      depois do maior id que ja existe; os ids existentes ficam; gravar continua; a AMB nao e tocada; depois disso
//      apagar a tabela da AMB NAO quebra a Girassol;
//   3. H-03 respondido: no schema real, rodar o provisionador na Girassol NAO acrescenta coluna nenhuma (ela ja
//      esta em dia com o molde) — o unico DDL e o das sequencias;
//   4. idempotente: a 2a rodada nao muda nada;
//   5. empresa NOVA: nasce com as 9 tabelas, sequencias proprias, FKs pras tabelas DELA, RLS ligado; independe da AMB;
//   6. as travas: sufixo invalido e reservado sao recusados.
// Roda com: node test/provisionar-postgres-real.test.js
const fs = require('fs');
const path = require('path');
const { subirPostgres } = require('./_postgres-descartavel');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const FUNCAO = fs.readFileSync(path.join(__dirname, '..', 'sql', 'provisionar-empresa.sql'), 'utf8');
const COM_ID = ['devolucoes', 'espreita_notas', 'recados', 'pecas_retiradas', 'defeito_comentarios', 'defeito_pedidos'];
const linhas = (txt) => String(txt).split('\n').filter(Boolean);
const donoDa = (pg, t) => pg.sql(`select coalesce(pg_get_serial_sequence('public.${t}','id'), '-')`);

(async () => {
  let pg;
  try {
    pg = await subirPostgres();
    ok(Number(pg.sql("select count(*) from pg_tables where schemaname='public'")) === 29, '  schema de producao carregado (29 tabelas)');

    // dados como em producao: a Girassol e a AMB gravando intercalado no mesmo numerador
    pg.sql(`insert into devolucoes_amb (marketplace) select 'ml' from generate_series(1,5);
            insert into devolucoes_girassol (marketplace) select 'ml' from generate_series(1,3);
            insert into devolucoes_amb (marketplace) values ('ml');
            insert into recados_girassol (identificador, texto) values ('PED-1','aviso');
            insert into defeito_pedidos_girassol (tipo) values ('descarte');`);
    const idsGirassol = linhas(pg.sql('select id from devolucoes_girassol order by id'));
    ok(idsGirassol.join(',') === '6,7,8', '  antes: a Girassol pegou os ids 6,7,8 do numerador da AMB (' + idsGirassol.join(',') + ')');
    for (const b of COM_ID) ok(donoDa(pg, b + '_girassol') === '-', '  antes: ' + b + '_girassol sem sequencia propria');

    // ── 1. o risco ──
    const risco = pg.sql('begin; drop table devolucoes_amb cascade; insert into devolucoes_girassol (marketplace) values (\'x\'); rollback;', { semErro: true });
    ok(!risco.ok && /null value in column "id" of relation "devolucoes_girassol"/.test(risco.erro), '⚠️ RISCO REPRODUZIDO: apagar devolucoes_amb derruba o id da Girassol (' + (risco.erro.match(/ERROR:[^\n]*/) || [''])[0] + ')');

    // ── 2/3. o conserto, no schema real ──
    pg.sql(FUNCAO);
    const r1 = linhas(pg.sql("select tabela || ' | ' || resultado from provisionar_empresa('_girassol')"));
    console.log('     provisionar_empresa(\'_girassol\') no schema real:\n       ' + r1.join('\n       '));
    const seqs = r1.filter((l) => /sequencia propria/.test(l));
    ok(seqs.length === 6, '⚠️ 6 tabelas ganham sequencia propria (' + seqs.length + ')');
    ok(!r1.some((l) => /acrescentada/.test(l)), '⚠️ H-03: NENHUMA coluna acrescentada — a Girassol ja esta em dia com o molde; o unico DDL e o das sequencias');
    ok(r1.filter((l) => /colunas em dia/.test(l)).length === 9, '  as 9 tabelas "colunas em dia"');
    for (const b of COM_ID) ok(donoDa(pg, b + '_girassol') === 'public.' + b + '_girassol_id_seq', '  ' + b + '_girassol → sequencia propria, dona = a coluna');
    ok(/devolucoes_girassol \| coluna id: sequencia propria devolucoes_girassol_id_seq \(antes nextval\('devolucoes_amb_id_seq'::regclass\)\), proximo 9/.test(r1.join('\n')), '  devolucoes_girassol continua depois do maior id existente (9)');
    ok(linhas(pg.sql('select id from devolucoes_girassol order by id')).join(',') === '6,7,8', '  os ids que ja existiam NAO mudam');
    pg.sql(`insert into devolucoes_girassol (marketplace) values ('novo')`);
    ok(pg.sql("select max(id) from devolucoes_girassol") === '9', '  gravar continua: proximo id 9');
    pg.sql(`insert into devolucoes_amb (marketplace) values ('amb')`);
    ok(pg.sql("select max(id) from devolucoes_amb") === '10' && donoDa(pg, 'devolucoes_amb') === 'public.devolucoes_amb_id_seq', '  a AMB nao foi tocada (segue no numerador dela: 10)');
    const depois = pg.sql('begin; drop table devolucoes_amb, recados_amb, defeito_pedidos_amb, defeito_comentarios_amb, espreita_notas_amb, pecas_retiradas_amb cascade; insert into devolucoes_girassol (marketplace) values (\'y\'); insert into recados_girassol (identificador, texto) values (\'P\',\'t\'); insert into defeito_pedidos_girassol (tipo) values (\'recuperado\'); select max(id) from devolucoes_girassol; rollback;', { semErro: true });
    ok(depois.ok && /10/.test(depois.saida), '⚠️ depois do conserto, apagar as tabelas da AMB NAO quebra a Girassol (' + (depois.ok ? 'gravou' : depois.erro.trim()) + ')');

    // ── 4. idempotente ──
    const r2 = linhas(pg.sql("select tabela || ' | ' || resultado from provisionar_empresa('_girassol')"));
    ok(!r2.some((l) => /sequencia propria|acrescentada|criada/.test(l)) && r2.filter((l) => /colunas em dia/.test(l)).length === 9, '  2a rodada: nada muda (' + r2.length + ' linhas, so "em dia" + cache)');

    // ── 5. empresa nova ──
    const r3 = linhas(pg.sql("select tabela || ' | ' || resultado from provisionar_empresa('_lirio')"));
    ok(r3.filter((l) => /criada \(copia de/.test(l)).length === 9, '⚠️ empresa nova: 9 tabelas criadas');
    for (const b of COM_ID) ok(donoDa(pg, b + '_lirio') === 'public.' + b + '_lirio_id_seq', '  ' + b + '_lirio nasce com sequencia propria');
    const fks = linhas(pg.sql("select conname || ' -> ' || confrelid::regclass from pg_constraint where conrelid = 'public.devolucao_tags_lirio'::regclass and contype = 'f' order by 1"));
    ok(fks.join(',') === 'devolucao_tags_lirio_devolucao_id_fkey -> devolucoes_lirio,devolucao_tags_lirio_tag_id_fkey -> tags_lirio', '  FKs apontam pras tabelas DELA (' + fks.join(', ') + ')');
    ok(pg.sql("select bool_and(relrowsecurity) from pg_class where relname like '%\\_lirio' and relkind = 'r'") === 't', '  RLS ligado nas 9');
    const nova = pg.sql('begin; drop table devolucoes_amb cascade; insert into devolucoes_lirio (marketplace) values (\'z\'); select id from devolucoes_lirio; rollback;', { semErro: true });
    ok(nova.ok && nova.saida.trim() === '1', '⚠️ empresa nova independe da AMB: com a AMB apagada grava, comecando no id 1 (' + (nova.ok ? nova.saida.trim() : nova.erro.trim()) + ')');

    // ── 6. travas ──
    const inval = pg.sql("select * from provisionar_empresa('girassol; drop table x')", { semErro: true });
    ok(!inval.ok && /sufixo invalido/.test(inval.erro), '  sufixo fora do formato e recusado');
    const reserv = pg.sql("select * from provisionar_empresa('_amb')", { semErro: true });
    ok(!reserv.ok && /sufixo reservado/.test(reserv.erro), '  sufixo da AMB e recusado');
    ok(pg.sql("select count(*) from information_schema.columns where table_schema='public' and table_name='devolucoes' and column_name='id' and data_type='uuid'") === '1', '  a GOOD (sem sufixo, uuid) nao entra no provisionador');
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    if (pg) pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
