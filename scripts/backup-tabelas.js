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
const { obterEmpresa, listarEmpresas, envDaEmpresa, desligadaNoContrato } = require('../lib/empresas');
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

// b774 — ENSAIO REAL (20/11, Shell do Render): 7 das 27 tabelas falharam com "column X.id does not exist" —
// `espreita_notas` (a da GOOD), `sku_depara` e `devolucao_tags` (as 3) NAO tem coluna `id`. A chave de cada uma e a
// que o proprio codigo usa no upsert (server.js/supabase-AMB `onConflict: 'chave'`, lib/sku-depara `'sku_antigo'`,
// rotas-relatorios: unique em (devolucao_id, tag_id), 23505). O backup ordena por ela; o restore faz o upsert por ela.
const CHAVES = { espreita_notas: ['chave'], sku_depara: ['sku_antigo'], devolucao_tags: ['devolucao_id', 'tag_id'] };
function chaveDaTabela(tabela) {
  const base = Object.keys(CHAVES).find((b) => tabela === b || tabela.startsWith(b + '_'));
  return base ? CHAVES[base].slice() : ['id'];
}

// b801 (V-17, ensaio de CNPJ novo, 22/11) — EMPRESA NOVA ANTES DO PROVISIONAMENTO NAO DERRUBA O BACKUP DAS OUTRAS.
// O embarque poe a ficha no registro PRIMEIRO, desligada (`ativa_em.devolucoes: false`); as tabelas vem depois (DDL, so
// com o OK do dono). Nesse intervalo o backup sem `--empresas` — o DIARIO — lia tambem a empresa nova, as 9 tabelas dela
// davam "tabela nao existe" e a rodada INTEIRA virava falha: medido com o PostgREST 14.5 (o de producao), 9 erros e
// ZERO arquivo enviado da GOOD, da AMB e da Girassol.
// Agora essa empresa e PULADA (fica em `manifesto.puladas`, com o motivo) — e so nesse caso exato:
//   · foi o registro que a trouxe (quem pede `--empresas=<ela>` quer a resposta de verdade);
//   · o contrato diz `devolucoes: false` (empresa LIGADA sem tabela e desastre, nao "nova");
//   · NENHUMA tabela dela existe (faltar so uma parte e provisionamento pela metade: erro).
const TABELA_NAO_EXISTE = 'PGRST205';   // "Could not find the table 'public.x' in the schema cache" (HTTP 404)
const MOTIVO_NOVA = 'desligada no contrato e sem nenhuma tabela no banco (empresa nova, ainda nao provisionada)';

async function rodar({ empresas, saida = 'backups', pagina = 1000, criar = createClient, agora = () => new Date(), log = console.log } = {}) {
  const pedidas = !!(empresas && empresas.length);
  const fichas = (pedidas ? empresas.map(obterEmpresa) : listarEmpresas());
  if (!(pagina >= 1 && pagina <= PAGINA_MAX)) throw new Error('pagina tem que estar entre 1 e ' + PAGINA_MAX + ' (teto do PostgREST): ' + pagina);
  const carimbo = agora().toISOString().slice(0, 19).replace(/:/g, '-');
  const raiz = pastaUnica(saida, carimbo);
  const manifesto = { carimbo, pasta: raiz, inicio: agora().toISOString(), pagina, empresas: {}, erros: [], puladas: [] };
  for (const ficha of fichas) {
    const sb = clienteDaEmpresa(ficha, criar);
    if (!sb) { manifesto.erros.push({ empresa: ficha.chave, erro: 'sem SUPABASE_URL/KEY no env' }); log(`[backup] ${ficha.chave}: sem credenciais, pulada`); continue; }
    const pasta = path.join(raiz, ficha.chave);
    fs.mkdirSync(pasta, { recursive: true });
    manifesto.empresas[ficha.chave] = {};
    const tabelas = tabelasDaEmpresa(ficha);
    const errosDaEmpresa = [];
    for (const tabela of tabelas) {
      const t0 = Date.now();
      try {
        const linhas = await lerTudo(() => chaveDaTabela(tabela).reduce((q, c) => q.order(c, { ascending: true }), sb.from(tabela).select('*')), { tamanho: pagina, maximo: 2000000 });
        const arquivo = path.join(pasta, tabela + '.jsonl');
        fs.writeFileSync(arquivo, linhas.map((l) => JSON.stringify(l)).join('\n') + (linhas.length ? '\n' : ''));
        manifesto.empresas[ficha.chave][tabela] = { linhas: linhas.length, ms: Date.now() - t0 };
        log(`[backup] ${ficha.chave}/${tabela}: ${linhas.length} linha(s) em ${Date.now() - t0}ms`);
      } catch (e) {
        // ⚠️ erro NAO vira arquivo vazio: fica no manifesto e o processo termina != 0
        errosDaEmpresa.push({ empresa: ficha.chave, tabela, erro: String(e && e.message || e), naoExiste: !!(e && e.causa && e.causa.code === TABELA_NAO_EXISTE) });
        log(`[backup] ${ficha.chave}/${tabela}: FALHOU — ${String(e && e.message || e)}`);
      }
    }
    if (!pedidas && desligadaNoContrato(ficha.chave) && errosDaEmpresa.length === tabelas.length && errosDaEmpresa.every((x) => x.naoExiste)) {
      manifesto.puladas.push({ empresa: ficha.chave, motivo: MOTIVO_NOVA });
      delete manifesto.empresas[ficha.chave];
      fs.rmSync(pasta, { recursive: true, force: true });
      log(`[backup] ${ficha.chave}: PULADA — ${MOTIVO_NOVA}`);
    } else {
      for (const x of errosDaEmpresa) manifesto.erros.push({ empresa: x.empresa, tabela: x.tabela, erro: x.erro });
    }
  }
  manifesto.fim = agora().toISOString();
  fs.writeFileSync(path.join(raiz, 'manifesto.json'), JSON.stringify(manifesto, null, 2));
  return { raiz, manifesto };
}

module.exports = { rodar, tabelasDaEmpresa, clienteDaEmpresa, credenciaisDaEmpresa, chaveDaTabela, CHAVES, PAGINA_MAX };

if (require.main === module) {
  const arg = (n, p) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : p; };
  rodar({ empresas: arg('empresas', '').split(',').filter(Boolean), saida: arg('saida', 'backups'), pagina: Number(arg('pagina', 1000)) })
    .then(({ raiz, manifesto }) => { console.log(`[backup] pronto em ${raiz} — ${manifesto.erros.length} erro(s)` + (manifesto.puladas.length ? `, ${manifesto.puladas.length} empresa(s) pulada(s): ${manifesto.puladas.map((p) => p.empresa).join(', ')}` : '')); process.exit(manifesto.erros.length ? 1 : 0); })
    .catch((e) => { console.error('[backup] estourou:', e); process.exit(1); });
}
