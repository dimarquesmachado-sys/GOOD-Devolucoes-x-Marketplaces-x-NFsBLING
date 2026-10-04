'use strict';
// b525 — auditoria (Codex, 04/10): a sonda confere a CONTA do token do ML, a captura recente e os canais.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const s = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'), 'utf8');
ok(/return \{ aceito: true, conta \};/.test(s) && /token de OUTRA conta/.test(s) && /ML_USER_ID/.test(s), '⚠️ token do ML aceito de OUTRA conta reprova (compara com <PREFIXO>ML_USER_ID)');
ok(/registrar\('captura recente'/.test(s) && /order\('visto_por_ultimo'/.test(s) && /horas > 6/.test(s), '⚠️ captura sem gravar ha mais de 6 h reprova (coluna real: visto_por_ultimo)');
ok(/registrar\('canais \(Magalu, Shopee, TikTok\)'/.test(s) && /NAO APLICAVEL/.test(s) && /NAO VERIFICADO/.test(s) && /FALHOU/.test(s), '⚠️ canais com os 4 estados (confirmado / falhou / nao aplicavel / nao verificado)');
ok(/ponte\.lojaDaEmpresa\(/.test(s), '  TikTok pela funcao real da ponte (lojaDaEmpresa)');
const { CHECAGENS } = require(path.join(__dirname, '..', 'scripts', 'sonda-empresa.js'));
ok(Array.isArray(CHECAGENS) && CHECAGENS.some((c) => c.nome === 'captura recente') && CHECAGENS.some((c) => /canais/.test(c.nome)), '  as checagens novas estao registradas (o modulo carrega)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
