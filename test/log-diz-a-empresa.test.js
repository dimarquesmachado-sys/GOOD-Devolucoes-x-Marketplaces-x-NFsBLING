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

// ── 📌 o que AINDA diz AMB, medido e não esquecido ──────────────────
//
// 5 módulos (magalu, shopee, email, nf-entrada, compat) têm os logs
// espalhados FORA da fábrica. Convertê-los exigiria estado de módulo — que
// é justamente o que o primeiro bloco proíbe. Ficam para quando forem
// refatorados; este contador impede que isso vire invisível.
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
  ok(restantes <= 22,
     `  e o numero nao CRESCEU (${restantes}, teto 22)`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
