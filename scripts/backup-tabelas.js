#!/usr/bin/env node
'use strict';
// b764 — V-04 (auditoria do Codex, 15/11): BACKUP DAS TABELAS DO DEVOLUCOES, POR EMPRESA, PELO POSTGREST.
//
// O Supabase guarda backup diario do projeto inteiro (plano Pro, 7 dias) — mas restaurar por la e TUDO OU NADA e
// leva o projeto inteiro de volta no tempo. Este script tira uma copia LOGICA, por empresa e por tabela, em JSON
// (uma linha por registro), que da pra restaurar uma tabela so, uma empresa so, ou um pedaco (scripts/restaurar-
// tabelas.js). Le pagina a pagina (lib/ler-tudo.js), nunca so as 1000 primeiras.
//
// Uso:  node scripts/backup-tabelas.js [--empresas=good,ambtotal,girassol] [--saida=backups] [--pagina=1000]  (pagina <= 1000)
// Envs: as mesmas do servidor (<PREFIXO>SUPABASE_URL / <PREFIXO>SUPABASE_KEY por empresa; a GOOD aceita o nome
//       historico SUPABASE_URL/SUPABASE_KEY). Precisa da service key (anon nao le com RLS).
// Saida: <saida>/<AAAA-MM-DDTHH-MM-SS>[-n]/<chave>/<tabela>.jsonl + manifesto.json (pasta unica por rodada).
// Exportado pra teste: { rodar, tabelasDaEmpresa }.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { obterEmpresa, listarEmpresas, envDaEmpresa } = require('../lib/empresas');
const { lerTudo } = require('../lib/ler-tudo');

// As tabelas de uma empresa: as da ficha + as do ciclo de defeitos (mesmo sufixo da `devolucoes`).
function tabelasDaEmpresa(ficha) {
  const sufixo = ficha.tabelas.devolucoes.slice('devolucoes'.length);
  const lista = Object.values(ficha.tabelas).concat(['defeito_pedidos' + sufixo, 'defeito_comentarios' + sufixo]);
  return [...new Set(lista)];
}

// Credenciais como o SERVIDOR resolve (lib/config-da-empresa.js): `<PREFIXO>SUPABASE_URL/KEY`, e se nao houver, as
// globais SUPABASE_URL/KEY — hoje as empresas dividem o mesmo projeto, separadas por sufixo de tabela (Codex #622).
function credenciaisDaEmpresa(ficha) {
  const url = envDaEmpresa(ficha, 'SUPABASE_URL') || process.env.SUPABASE_URL || '';
  const key = envDaEmpresa(ficha, 'SUPABASE_KEY') || process.env.SUPABASE_KEY || '';
  return (url && key) ? { url, key } : null;
}
function clienteDaEmpresa(ficha, criar = createClient) {
  const cred = credenciaisDaEmpresa(ficha);
  return cred ? criar(cred.url, cred.key, { auth: { persistSession: false } }) : null;
}
// O PostgREST corta toda resposta em 1000 linhas (max-rows); pagina maior que isso faria o lerTudo achar que a
// pagina cortada era a ultima e o backup sairia TRUNCADO em silencio (Codex #622). Teto fixo.
const PAGINA_MAX = 1000;
// Pasta UNICA por rodada: duas rodadas no mesmo minuto nao podem misturar arquivos de tempos diferentes (Codex #622)
function pastaUnica(saida, carimbo) {
  let raiz = path.join(saida, carimbo);
  for (let n = 2; fs.existsSync(raiz); n++) raiz = path.join(saida, carimbo + '-' + n);
  fs.mkdirSync(raiz, { recursive: true });
  return raiz;
}

async function rodar({ empresas, saida = 'backups', pagina = 1000, criar = createClient, agora = () => new Date(), log = console.log } = {}) {
  const fichas = (empresas && empresas.length ? empresas.map(obterEmpresa) : listarEmpresas());
  if (!(pagina >= 1 && pagina <= PAGINA_MAX)) throw new Error('pagina tem que estar entre 1 e ' + PAGINA_MAX + ' (teto do PostgREST): ' + pagina);
  const carimbo = agora().toISOString().slice(0, 19).replace(/:/g, '-');
  const raiz = pastaUnica(saida, carimbo);
  const manifesto = { carimbo, pasta: raiz, inicio: agora().toISOString(), pagina, empresas: {}, erros: [] };
  for (const ficha of fichas) {
    const sb = clienteDaEmpresa(ficha, criar);
    if (!sb) { manifesto.erros.push({ empresa: ficha.chave, erro: 'sem SUPABASE_URL/KEY no env' }); log(`[backup] ${ficha.chave}: sem credenciais, pulada`); continue; }
    const pasta = path.join(raiz, ficha.chave);
    fs.mkdirSync(pasta, { recursive: true });
    manifesto.empresas[ficha.chave] = {};
    for (const tabela of tabelasDaEmpresa(ficha)) {
      const t0 = Date.now();
      try {
        const linhas = await lerTudo(() => sb.from(tabela).select('*').order('id', { ascending: true }), { tamanho: pagina, maximo: 2000000 });
        const arquivo = path.join(pasta, tabela + '.jsonl');
        fs.writeFileSync(arquivo, linhas.map((l) => JSON.stringify(l)).join('\n') + (linhas.length ? '\n' : ''));
        manifesto.empresas[ficha.chave][tabela] = { linhas: linhas.length, ms: Date.now() - t0 };
        log(`[backup] ${ficha.chave}/${tabela}: ${linhas.length} linha(s) em ${Date.now() - t0}ms`);
      } catch (e) {
        // ⚠️ erro NAO vira arquivo vazio: fica no manifesto e o processo termina != 0
        manifesto.erros.push({ empresa: ficha.chave, tabela, erro: String(e && e.message || e) });
        log(`[backup] ${ficha.chave}/${tabela}: FALHOU — ${String(e && e.message || e)}`);
      }
    }
  }
  manifesto.fim = agora().toISOString();
  fs.writeFileSync(path.join(raiz, 'manifesto.json'), JSON.stringify(manifesto, null, 2));
  return { raiz, manifesto };
}

module.exports = { rodar, tabelasDaEmpresa, clienteDaEmpresa, credenciaisDaEmpresa, PAGINA_MAX };

if (require.main === module) {
  const arg = (n, p) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : p; };
  rodar({ empresas: arg('empresas', '').split(',').filter(Boolean), saida: arg('saida', 'backups'), pagina: Number(arg('pagina', 1000)) })
    .then(({ raiz, manifesto }) => { console.log(`[backup] pronto em ${raiz} — ${manifesto.erros.length} erro(s)`); process.exit(manifesto.erros.length ? 1 : 0); })
    .catch((e) => { console.error('[backup] estourou:', e); process.exit(1); });
}
