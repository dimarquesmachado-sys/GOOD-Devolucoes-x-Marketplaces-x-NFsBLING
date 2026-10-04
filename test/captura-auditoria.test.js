'use strict';
// b518 — auditoria operacional (Codex, 04/10): os 3 furos da captura persistente, conferidos no codigo.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const amb = fs.readFileSync(path.join(R, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const good = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
const i = amb.indexOf('function capturarDevolucoesEmpresa('); const cap = amb.slice(i, amb.indexOf('\n}\n', i));
ok(/r\.cru\.devolucoes/.test(cap) && !/Array\.isArray\(r\.devolucoes\)/.test(cap), '⚠️ AMB/Girassol le o TikTok no contrato REAL da ponte (r.cru.devolucoes), como a GOOD');
ok(/if \(!r \|\| !r\.ok\) \{ erroTikTok = /.test(cap), '⚠️ AMB/Girassol: ponte com ok:false vira tiktok_erro (nao lista vazia silenciosa)');
ok(/CAPTURA\.falhou \? \(5 \* 60 \* 1000\)/.test(cap) && /CAPTURA\.falhou = !\(r && r\.ok\)/.test(cap) && /CAPTURA\.falhou = true;/.test(cap), '⚠️ AMB/Girassol: falha de gravacao tenta de novo em 5 min (nao trava 1 h)');
ok(/CAPTURA_FALHOU \? 5 \* 60 \* 1000 : CAPTURA_INTERVALO_MS/.test(good) && /CAPTURA_FALHOU = !r\.ok;/.test(good) && /CAPTURA_FALHOU = true;/.test(good), '⚠️ GOOD: a mesma janela por gravacao bem-sucedida');
const { traduzir } = require(path.join(R, 'lib', 'devolucoes-capturadas.js'));
const l = typeof traduzir === 'function' ? traduzir({ marketplace: 'ml', pedido: '200001', nf_venda: '001234', tracking: 'X1' }, 'girassol') : null;
ok(l && String(l.nf_numero || '') === '001234', '⚠️ a NF enriquecida da AMB/Girassol (nf_venda) vai pra coluna pesquisavel (' + (l && l.nf_numero) + ')');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
