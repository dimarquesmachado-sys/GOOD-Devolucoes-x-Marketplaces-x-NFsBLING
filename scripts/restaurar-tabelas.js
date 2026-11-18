#!/usr/bin/env node
'use strict';
// b764 — V-04: RESTAURA UMA TABELA (ou todas de uma empresa) A PARTIR DO BACKUP de scripts/backup-tabelas.js.
//
// Upsert em lotes de 500 pela chave `id` (onConflict) — linha que ja existe e sobrescrita pelo backup, linha que
// nao existe e criada; o que existe no banco e NAO esta no backup fica como esta (restaurar nao apaga). Pra voltar
// uma tabela inteira a um ponto no tempo, apague antes (decisao humana, fora deste script).
//
// Uso:  node scripts/restaurar-tabelas.js --pasta=backups/2026-11-18T12-00/girassol [--tabelas=devolucoes_girassol]
//       [--ensaio=1]   (ensaio: le e conta, nao grava nada)
// Exportado pra teste: { restaurar }.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { obterEmpresa, envDaEmpresa } = require('../lib/empresas');

async function restaurar({ pasta, tabelas, ensaio = false, lote = 500, criar = createClient, log = console.log } = {}) {
  const chave = path.basename(pasta);
  const ficha = obterEmpresa(chave);
  const url = envDaEmpresa(ficha, 'SUPABASE_URL'); const key = envDaEmpresa(ficha, 'SUPABASE_KEY');
  if (!ensaio && (!url || !key)) throw new Error('sem SUPABASE_URL/KEY pra ' + chave);
  const sb = ensaio ? null : criar(url, key, { auth: { persistSession: false } });
  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6))
    .filter((t) => !tabelas || !tabelas.length || tabelas.includes(t));
  const resultado = { empresa: chave, ensaio, tabelas: {}, erros: [] };
  for (const tabela of arquivos) {
    const linhas = fs.readFileSync(path.join(pasta, tabela + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let gravadas = 0;
    try {
      if (!ensaio) {
        for (let i = 0; i < linhas.length; i += lote) {
          const { error } = await sb.from(tabela).upsert(linhas.slice(i, i + lote), { onConflict: 'id' });
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

module.exports = { restaurar };

if (require.main === module) {
  const arg = (n, p) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : p; };
  if (!arg('pasta')) { console.error('uso: --pasta=backups/<carimbo>/<empresa> [--tabelas=a,b] [--ensaio=1]'); process.exit(2); }
  restaurar({ pasta: arg('pasta'), tabelas: arg('tabelas', '').split(',').filter(Boolean), ensaio: arg('ensaio', '') === '1' })
    .then((r) => { console.log(`[restaurar] ${r.erros.length} erro(s)`); process.exit(r.erros.length ? 1 : 0); })
    .catch((e) => { console.error('[restaurar] estourou:', e); process.exit(1); });
}
