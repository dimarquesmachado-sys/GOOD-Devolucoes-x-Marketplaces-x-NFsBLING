'use strict';
// ⚠️ OS AVISOS DE RECUPERAÇÃO TÊM QUE APONTAR PRA EMPRESA CERTA.
//
// Achado pela auditoria do Codex (30/09) ao revisar a Girassol: quando uma
// integração falhava, a mensagem mandava o operador da Girassol para
// `/amb/conectar`, ou pedia a env `AMB_ID_NATUREZA_DEVOLUCAO_ENTRADA`. Quem
// seguisse a orientação consertaria a conta ERRADA — justamente na hora em
// que algo já estava quebrado.
//
// 📌 Não quebra nada em dia normal: só aparece quando falha. Por isso passou.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const raiz = path.join(__dirname, '..');
const semComentarios = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const bling = semComentarios('amb-devolucoes/lib-AMB/bling-AMB.js');
const ml = semComentarios('amb-devolucoes/lib-AMB/ml-AMB.js');
const supabase = semComentarios('amb-devolucoes/lib-AMB/supabase-AMB.js');

ok(!bling.includes('/amb/bling/setup'),
   '⚠️ Bling nao manda a Girassol autorizar na rota da AMB');
ok(/cfg\.PREFIXO_ROTA}\/bling\/setup/.test(bling),
   '  e monta a rota de recuperacao pela empresa da instancia');
ok(!ml.includes('/amb/conectar'),
   '⚠️ ML nao manda a Girassol autorizar na rota da AMB');
ok(/cfg\.PREFIXO_ROTA}\/conectar/.test(ml),
   '  e monta a rota de recuperacao pela empresa da instancia');
ok(!/defina AMB_ID_NATUREZA_DEVOLUCAO_ENTRADA/.test(bling),
   '⚠️ ambiguidade fiscal nao pede a env da AMB para outra empresa');
ok(/cfg\.PREFIXO_ENV}ID_NATUREZA_DEVOLUCAO_ENTRADA/.test(bling),
   '  e pede a env da empresa da instancia');
ok(!supabase.includes("erroInicial = 'AMB_SUPABASE_URL"),
   '⚠️ erro de banco nao atribui a falha sempre a AMB');
ok(/cfg\.PREFIXO_ENV/.test(supabase) && /SUPABASE_URL\/.*SUPABASE_KEY/.test(supabase),
   '  e informa a credencial da empresa E o fallback compartilhado');

console.log('');
console.log(falhas ? `=== ${falhas} FALHA(S)` : '=== TODOS OS CASOS PASSARAM');
process.exit(falhas ? 1 : 0);
