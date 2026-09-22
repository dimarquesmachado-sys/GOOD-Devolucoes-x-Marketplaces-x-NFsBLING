'use strict';
// ⚠️ O LOG PRECISA DIZER DE QUAL EMPRESA É.
//
// O Render junta o log das duas no MESMO lugar — é um serviço só, com as
// empresas montadas em rotas diferentes. Com `[AMB/...]` fixo, um erro da
// Girassol apareceria como AMB e mandaria caçar no app errado.
//
// Isso não é estética: em 18/09 um deploy travado custou horas justamente
// porque o número na tela apontava para o lugar errado.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'amb-devolucoes', 'lib-AMB');

// ── ⚠️ a etiqueta NUNCA pode vir de estado do módulo ────────────────
//
// Eu tentei resolver com `let _tagEmpresa` no escopo do módulo, alimentado
// pela fábrica. Parecia funcionar — e a SEGUNDA empresa sobrescrevia a
// etiqueta da primeira: os logs da AMB passariam a dizer GIRASSOL.
//
// 📌 É o mesmo estado compartilhado que este trabalho inteiro existe para
// eliminar, reintroduzido pela porta dos fundos.
{
  const suspeitos = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const semCom = src.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    // `let`/`var` no escopo do módulo que guarda a etiqueta
    if (/^(let|var)\s+_?tag\w*/mi.test(semCom)) suspeitos.push(f);
  }
  ok(suspeitos.length === 0,
     '⚠️ nenhuma etiqueta guardada em estado do modulo'
     + (suspeitos.length ? ` (${suspeitos.join(', ')})` : ''));
}

// ── nos módulos que já recebem a ficha, a etiqueta sai dela ─────────
{
  const CONVERTIDOS = ['bling-AMB.js', 'ml-AMB.js', 'ml-returns-AMB.js',
    'nf-nomes-AMB.js', 'supabase-AMB.js'];
  // ⚠️ os outros 6 usam `_TAG` (const na fábrica) em vez de `TAG_EMP` —
  // nomes diferentes porque as fábricas têm assinaturas diferentes.
  for (const f of CONVERTIDOS) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const semCom = src.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/const TAG_EMP = String\(\(cfg && cfg\.PREFIXO_ENV\)/.test(semCom),
       `  ${f}: a etiqueta sai da ficha (const na fabrica)`);
    ok(!/\[AMB\//.test(semCom), `  ${f}: e nao sobrou \`[AMB/\` cravado`);
  }
}

// ── ⚠️ e a mensagem cita a env DA EMPRESA ───────────────────────────
//
// Dizia "AMB_BLING_CLIENT_ID ausente" para todas. A Girassol seria mandada
// conferir uma variável que não é a dela.
{
  const src = fs.readFileSync(path.join(DIR, 'bling-AMB.js'), 'utf8');
  const semCom = src.split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/AMB_BLING_CLIENT_ID/.test(semCom),
     '⚠️ a mensagem nao cita `AMB_BLING_CLIENT_ID` fixo');
  ok(/\$\{TAG_EMP\}_BLING_CLIENT_ID/.test(semCom),
     '  cita a env do prefixo da empresa');
}

// ── ✅ zero: nenhum log diz AMB fixo ────────────────────────────────
//
// ⚠️ A premissa que me travou no b396 estava ERRADA: eu achei que os logs
// dos 6 módulos restantes estavam FORA da fábrica, e por isso usei estado
// de módulo (que vazava entre empresas). Fui medir a profundidade de chaves
// e os 22 estavam DENTRO — dava para usar `const` local o tempo todo.
//
// 📌 O contador fica em 0 e vira trava: qualquer `[AMB/` novo reprova.
{
  let restantes = 0;
  const quais = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const semCom = src.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    const n = (semCom.match(/\[AMB\//g) || []).length;
    if (n) { restantes += n; quais.push(`${f}:${n}`); }
  }
  console.log(`    📌 ainda dizem [AMB/] fixo: ${restantes} em ${quais.length} modulo(s)`);
  for (const q of quais) console.log('       ' + q);
  ok(restantes === 0,
     `  ⚠️ nenhum log com \`[AMB/\` fixo (${restantes})`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
