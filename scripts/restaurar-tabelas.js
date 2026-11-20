#!/usr/bin/env node
'use strict';
// b764 — V-04: RESTAURA UMA TABELA (ou todas de uma empresa) A PARTIR DO BACKUP de scripts/backup-tabelas.js.
//
// Upsert em lotes de 500 pela CHAVE DA TABELA (onConflict: `id` na maioria; ver chaveDaTabela em backup-tabelas.js) — linha que ja existe e sobrescrita pelo backup, linha que
// nao existe e criada; o que existe no banco e NAO esta no backup fica como esta (restaurar nao apaga). Pra voltar
// uma tabela inteira a um ponto no tempo, apague antes (decisao humana, fora deste script).
//
// Uso:  node scripts/restaurar-tabelas.js --pasta=backups/2026-11-18T12-00/girassol [--tabelas=devolucoes_girassol]
//       [--ensaio=1]   (ensaio: le e conta, nao grava nada)
// Exportado pra teste: { restaurar }.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { obterEmpresa } = require('../lib/empresas');
const { credenciaisDaEmpresa, chaveDaTabela } = require('./backup-tabelas');

// ORDEM DE RESTORE: pais antes dos filhos (Codex #622). `devolucao_tags` tem FK pra `devolucoes` e `tags`
// (sql/provisionar-empresa.sql); `defeito_comentarios` aponta pra devolucao. A ordem do readdir nao serve.
// Tabela que nao esta na lista vai depois das conhecidas, em ordem alfabetica.
const ORDEM = ['devolucoes', 'tags', 'espreita_notas', 'recados', 'pecas_retiradas', 'sku_depara', 'defeito_pedidos', 'defeito_comentarios', 'devolucao_tags'];
function ordenar(tabelas) {
  const posicao = (t) => { const i = ORDEM.findIndex((o) => t === o || t.startsWith(o + '_')); return i < 0 ? ORDEM.length : i; };
  return [...tabelas].sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b));
}

async function restaurar({ pasta, tabelas, ensaio = false, lote = 500, criar = createClient, log = console.log } = {}) {
  const chave = path.basename(pasta);
  const ficha = obterEmpresa(chave);
  const cred = credenciaisDaEmpresa(ficha);
  if (!ensaio && !cred) throw new Error('sem SUPABASE_URL/KEY pra ' + chave);
  const sb = ensaio ? null : criar(cred.url, cred.key, { auth: { persistSession: false } });
  const noBackup = fs.readdirSync(pasta).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6));
  const pedidas = (tabelas && tabelas.length) ? tabelas : noBackup;
  const resultado = { empresa: chave, ensaio, tabelas: {}, erros: [] };
  // tabela PEDIDA que nao esta no backup e ERRO, nao silencio (Codex #622): o backup dela pode ter falhado
  for (const t of pedidas) if (!noBackup.includes(t)) { resultado.erros.push({ tabela: t, erro: 'nao ha ' + t + '.jsonl neste backup (a rodada falhou nela? veja o manifesto)', gravadas: 0 }); log(`[restaurar] ${chave}/${t}: NAO ESTA NO BACKUP`); }
  const arquivos = ordenar(pedidas.filter((t) => noBackup.includes(t)));
  for (const tabela of arquivos) {
    const linhas = fs.readFileSync(path.join(pasta, tabela + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let gravadas = 0;
    try {
      if (!ensaio) {
        for (let i = 0; i < linhas.length; i += lote) {
          // b774: pela chave DA tabela (espreita_notas=chave, sku_depara=sku_antigo, devolucao_tags=devolucao_id+tag_id; o resto id)
          const { error } = await sb.from(tabela).upsert(linhas.slice(i, i + lote), { onConflict: chaveDaTabela(tabela).join(',') });
          if (error) throw new Error(error.message || JSON.stringify(error));
          gravadas += Math.min(lote, linhas.length - i);
        }
      }
      resultado.tabelas[tabela] = { no_backup: linhas.length, gravadas };
      log(`[restaurar] ${chave}/${tabela}: ${linhas.length} no backup, ${ensaio ? 'ensaio (nada gravado)' : gravadas + ' gravada(s)'}`);
    } catch (e) {
      resultado.erros.push({ tabela, erro: String(e && e.message || e), gravadas });
      log(`[restaurar] ${chave}/${tabela}: FALHOU apos ${gravadas} — ${String(e && e.message || e)}`);
    }
  }
  return resultado;
}

module.exports = { restaurar, ordenar, ORDEM };

if (require.main === module) {
  const arg = (n, p) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : p; };
  if (!arg('pasta')) { console.error('uso: --pasta=backups/<carimbo>/<empresa> [--tabelas=a,b] [--ensaio=1]'); process.exit(2); }
  restaurar({ pasta: arg('pasta'), tabelas: arg('tabelas', '').split(',').filter(Boolean), ensaio: arg('ensaio', '') === '1' })
    .then((r) => { console.log(`[restaurar] ${r.erros.length} erro(s)`); process.exit(r.erros.length ? 1 : 0); })
    .catch((e) => { console.error('[restaurar] estourou:', e); process.exit(1); });
}
