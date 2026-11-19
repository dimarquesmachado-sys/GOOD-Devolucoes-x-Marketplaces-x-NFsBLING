'use strict';
// b764 — V-04 (auditoria do Codex, 15/11): ENSAIO DE BACKUP E RESTORE, PELO PROTOCOLO REAL, NAS 3 EMPRESAS.
//
// scripts/backup-tabelas.js le cada tabela de cada empresa pagina a pagina (supabase-js de verdade contra o PostgREST
// falso) e grava um .jsonl por tabela + manifesto; scripts/restaurar-tabelas.js le os .jsonl e faz upsert em lotes.
// O que fica provado:
//   - o backup cobre TODAS as tabelas da empresa (ficha + defeito_pedidos/defeito_comentarios do mesmo sufixo) e so as
//     dela (a GOOD nao le a tabela da Girassol);
//   - tabela com mais linhas que a pagina sai inteira (paginacao), na ordem por id;
//   - tabela que falha NAO vira arquivo vazio: entra no manifesto como erro e o processo sinaliza;
//   - o restore num banco VAZIO devolve as mesmas linhas, em lotes, e o ensaio (--ensaio=1) nao grava nada;
//   - restore nao apaga o que existe no banco e nao esta no backup.
// Roda com: node test/backup-restore-ensaio.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { subirPostgrest } = require('./_postgrest-falso');
const { rodar, tabelasDaEmpresa } = require('../scripts/backup-tabelas');
const { restaurar } = require('../scripts/restaurar-tabelas');
const { obterEmpresa } = require('../lib/empresas');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const CHAVES = ['good', 'ambtotal', 'girassol'];

(async () => {
  const pg = await subirPostgrest();
  for (const k of CHAVES) {
    const f = obterEmpresa(k);
    process.env[f.prefixoEnv + 'SUPABASE_URL'] = pg.url; process.env[f.prefixoEnv + 'SUPABASE_KEY'] = 'k-' + k;
    for (const t of tabelasDaEmpresa(f)) pg.tabela(t);
    // devolucoes com 7 linhas (pagina de 3 → 3 paginas); recados com 2; o resto vazio
    for (let i = 1; i <= 7; i++) pg.tabela(f.tabelas.devolucoes).push({ id: i, sku: 'SKU-' + k + '-' + i, status: 'concluido', estado_atual: null });
    pg.tabela(f.tabelas.recados).push({ id: 1, texto: 'recado ' + k }, { id: 2, texto: 'outro ' + k });
    // tags + devolucao_tags (FKs pra tags e devolucoes): e o que prova a ordem do restore
    pg.tabela(f.tabelas.tags).push({ id: 1, nome: 'frete' }, { id: 2, nome: 'avaria' });
    pg.tabela(f.tabelas.devolucaoTags).push({ id: 1, devolucao_id: 3, tag_id: 1 }, { id: 2, devolucao_id: 7, tag_id: 2 });
  }
  process.env.SUPABASE_URL = pg.url; process.env.SUPABASE_KEY = 'k-good';
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const silencio = () => {};

  // ── backup ──
  const { raiz, manifesto } = await rodar({ saida, pagina: 3, log: silencio, agora: () => new Date('2026-11-18T12:00:00Z') });
  ok(manifesto.erros.length === 0, '  backup sem erro (' + JSON.stringify(manifesto.erros) + ')');
  // Codex #622: duas rodadas no mesmo segundo NAO dividem pasta
  const segunda = await rodar({ empresas: ['good'], saida, pagina: 3, log: silencio, agora: () => new Date('2026-11-18T12:00:00Z') });
  ok(segunda.raiz !== raiz && fs.existsSync(path.join(segunda.raiz, 'manifesto.json')) && fs.existsSync(path.join(raiz, 'manifesto.json')), '⚠️ rodada no mesmo carimbo ganha pasta propria (' + path.basename(segunda.raiz) + ')');
  // Codex #622: pagina acima do teto do PostgREST e recusada (senao o backup sairia truncado em silencio)
  let estourou = null; try { await rodar({ empresas: ['good'], saida, pagina: 2000, log: silencio }); } catch (e) { estourou = e.message; }
  ok(/1000/.test(String(estourou)), '⚠️ --pagina=2000 e recusado na hora (' + String(estourou).slice(0, 60) + ')');
  // Codex #622: so as globais SUPABASE_URL/KEY no env (como o servidor aceita) tambem servem
  const guardadas = {}; for (const k of CHAVES) { const f = obterEmpresa(k); for (const n of ['SUPABASE_URL', 'SUPABASE_KEY']) { guardadas[f.prefixoEnv + n] = process.env[f.prefixoEnv + n]; delete process.env[f.prefixoEnv + n]; } }
  const soGlobal = await rodar({ saida, pagina: 3, log: silencio, agora: () => new Date('2026-11-18T12:30:00Z') });
  ok(soGlobal.manifesto.erros.length === 0 && Object.keys(soGlobal.manifesto.empresas).length === 3, '⚠️ so com SUPABASE_URL/KEY globais as 3 empresas entram (' + Object.keys(soGlobal.manifesto.empresas).join(',') + ')');
  Object.assign(process.env, guardadas);
  for (const k of CHAVES) {
    const f = obterEmpresa(k);
    const esperadas = tabelasDaEmpresa(f);
    const arquivos = fs.readdirSync(path.join(raiz, k)).filter((x) => x.endsWith('.jsonl')).map((x) => x.slice(0, -6)).sort();
    ok(JSON.stringify(arquivos) === JSON.stringify([...esperadas].sort()), '⚠️ ' + k + ': um .jsonl por tabela da empresa (' + arquivos.length + ' = ' + esperadas.length + ')');
    const dev = fs.readFileSync(path.join(raiz, k, f.tabelas.devolucoes + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    ok(dev.length === 7 && dev.map((d) => d.id).join(',') === '1,2,3,4,5,6,7', '⚠️ ' + k + ': 7 linhas com pagina de 3 — paginou e manteve a ordem (' + dev.map((d) => d.id).join(',') + ')');
    ok(dev.every((d) => d.sku.includes('-' + k + '-')), '  ' + k + ': so linhas da propria empresa');
    ok(manifesto.empresas[k][f.tabelas.devolucoes].linhas === 7, '  manifesto conta 7');
  }
  // cada empresa so LEU as suas tabelas (o log do falso registra tabela por requisicao)
  const lidas = [...new Set(pg.pedidos.filter((p) => p.metodo === 'GET').map((p) => p.tabela))];
  const todas = CHAVES.flatMap((k) => tabelasDaEmpresa(obterEmpresa(k)));
  ok(lidas.length === todas.length && lidas.every((t) => todas.includes(t)), '  o backup leu exatamente as ' + todas.length + ' tabelas das 3 empresas (' + lidas.length + ')');

  // ── falha de uma tabela nao vira arquivo vazio ──
  pg.ganchos.interceptar = ({ metodo, tabela }) => (metodo === 'GET' && tabela === 'recados_amb' ? { status: 500, corpo: { message: 'statement timeout' } } : null);
  const r2 = await rodar({ empresas: ['ambtotal'], saida, log: silencio, agora: () => new Date('2026-11-18T13:00:00Z') });
  pg.ganchos.interceptar = null;
  ok(r2.manifesto.erros.length === 1 && r2.manifesto.erros[0].tabela === 'recados_amb', '⚠️ tabela que falhou entra no manifesto como ERRO (' + JSON.stringify(r2.manifesto.erros) + ')');
  ok(!fs.existsSync(path.join(r2.raiz, 'ambtotal', 'recados_amb.jsonl')), '  e NAO deixa um recados_amb.jsonl vazio fingindo backup');
  ok(fs.existsSync(path.join(r2.raiz, 'ambtotal', 'devolucoes_amb.jsonl')), '  as outras tabelas da rodada saem normalmente');

  // ── restore num banco vazio, COM as FKs do provisionador (devolucao_tags -> tags, devolucoes) ──
  const pg2 = await subirPostgrest({ fks: { devolucao_tags_girassol: { tag_id: 'tags_girassol', devolucao_id: 'devolucoes_girassol' } } });
  for (const k of CHAVES) { const f = obterEmpresa(k); process.env[f.prefixoEnv + 'SUPABASE_URL'] = pg2.url; }
  process.env.SUPABASE_URL = pg2.url;
  pg2.tabela('devolucoes_girassol').push({ id: 99, sku: 'JA-EXISTIA', status: 'problema' });   // o restore nao pode apagar
  const ensaio = await restaurar({ pasta: path.join(raiz, 'girassol'), ensaio: true, log: silencio });
  ok(ensaio.tabelas.devolucoes_girassol.no_backup === 7 && ensaio.tabelas.devolucoes_girassol.gravadas === 0 && pg2.pedidos.length === 0, '  ensaio (--ensaio=1): conta 7 e NAO toca o banco (' + pg2.pedidos.length + ' requisicoes)');
  const real = await restaurar({ pasta: path.join(raiz, 'girassol'), lote: 3, log: silencio });
  ok(real.erros.length === 0 && real.tabelas.devolucoes_girassol.gravadas === 7, '⚠️ restore: 7 gravadas em lotes de 3 (' + JSON.stringify(real.tabelas.devolucoes_girassol) + ')');
  const posts = pg2.pedidos.filter((p) => p.metodo === 'POST' && p.tabela === 'devolucoes_girassol').length;
  ok(posts === 3, '  3 lotes (' + posts + ' POSTs)');
  // Codex #622: pais antes dos filhos — devolucao_tags so depois de devolucoes e tags, e as FKs do falso aceitaram
  const ordemPosts = pg2.pedidos.filter((p) => p.metodo === 'POST').map((p) => p.tabela);
  const iFilho = ordemPosts.indexOf('devolucao_tags_girassol');
  ok(iFilho > ordemPosts.lastIndexOf('devolucoes_girassol') && iFilho > ordemPosts.lastIndexOf('tags_girassol') && real.tabelas.devolucao_tags_girassol.gravadas === 2 && pg2.tabela('devolucao_tags_girassol').length === 2, '⚠️ devolucao_tags restaurada DEPOIS de devolucoes e tags, sem 23503 (' + JSON.stringify(real.tabelas.devolucao_tags_girassol) + ')');
  const dev2 = pg2.tabela('devolucoes_girassol');
  ok(dev2.filter((d) => d.id >= 1 && d.id <= 7).length === 7 && dev2.find((d) => d.id === 99), '⚠️ o banco tem as 7 do backup E a 99 que ja existia (restore nao apaga)');
  ok(dev2.find((d) => d.id === 4).sku === 'SKU-girassol-4', '  conteudo integro apos ida e volta');
  // Codex #622: tabela pedida que nao esta no backup e ERRO, nao silencio
  const faltando = await restaurar({ pasta: path.join(raiz, 'girassol'), tabelas: ['recados_girassol', 'nao_existe_girassol'], ensaio: true, log: silencio });
  ok(faltando.erros.length === 1 && /nao_existe_girassol/.test(faltando.erros[0].erro) && faltando.tabelas.recados_girassol, '⚠️ --tabelas com uma que nao esta no backup: erro nela, as outras seguem (' + faltando.erros[0].erro.slice(0, 50) + ')');
  const soRecados = await restaurar({ pasta: path.join(raiz, 'girassol'), tabelas: ['recados_girassol'], log: silencio });
  ok(Object.keys(soRecados.tabelas).join() === 'recados_girassol' && pg2.tabela('recados_girassol').length === 2, '  --tabelas= restaura so a tabela pedida, e repetir o restore nao duplica (upsert por id: ' + pg2.tabela('recados_girassol').length + ')');

  await pg.parar(); await pg2.parar();
  fs.rmSync(saida, { recursive: true, force: true });
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
