'use strict';
// A ESPREITA DA AMB/GIRASSOL MONTA SOZINHA (como na GOOD): o miolo da rota
// virou funcao, a rota so a chama, e um relogio (90s apos o boot, depois a
// cada 3 min) a mantem quente — a captura persistente (1x/hora) e o indice
// de nomes deixam de depender de alguem abrir a tela. Dono, 01/10: o /status
// da Girassol mostrava captura.ultima = null depois de 8 horas no ar.

const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const sem = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const iF = sem.indexOf('async function montarEspreitaAMB() {');
const iR = sem.indexOf("router.get('/api/espreita', auth.requerLogin, async (req, res) => {");
ok(iF > 0, '⚠️ o miolo da espreita e uma funcao (montarEspreitaAMB)');
ok(iR > iF, '  a rota vem depois da funcao');
const rota = sem.slice(iR, sem.indexOf('});', iR) + 3);
ok(/res\.json\(await montarEspreitaAMB\(\)\);/.test(rota) && rota.split('\n').length <= 4, '  a rota so chama a funcao (res.json(await montarEspreitaAMB()))');
// dentro da funcao: nenhum req./res. (ela roda sem request, pelo relogio)
const funcao = sem.slice(iF, iR);
ok(!/\b(req|res)\.\w+/.test(funcao), '⚠️ a funcao nao usa req nem res (roda pelo relogio, sem request)');
ok(/capturarDevolucoesEmpresa\(emTransito\);/.test(funcao), '  a captura persistente (1x/hora) esta dentro — o relogio a dispara');
ok(/nfNomes\.construirIndice\(\)/.test(funcao), '  e o indice de nomes monta se estiver frio — tambem sem bipe');
ok(/CACHES\.espreita = \{/.test(funcao), '  grava CACHES.espreita (o que /api/admin/orfaos le via espreitaMontada)');
// o relogio
ok(/setTimeout\(\(\) => preAquecerEspreitaAMB\('boot'\), 90 \* 1000\)\.unref\(\);/.test(sem), '⚠️ relogio: 90s apos o boot (com .unref — nao segura o processo nos testes)');
ok(/setInterval\(\(\) => preAquecerEspreitaAMB\('relogio'\), 3 \* 60 \* 1000\)\.unref\(\);/.test(sem), '  e a cada 3 min (como a GOOD)');
ok(/if \(ESP_AMB_MONTANDO\) return ESP_AMB_MONTANDO;/.test(sem), '  guarda global: nao sobrepoe montagens (Regra 4.3)');
ok(/\.finally\(\(\) => \{ ESP_AMB_MONTANDO = null; \}\)/.test(sem), '  e solta a guarda mesmo quando falha');
// Regra 12: o rotulo de log existe
ok(/\[\$\{TAG_APP\}\/ESPREITA\]/.test(sem) && /^const TAG_APP = /m.test(sem), '  log com TAG_APP (que existe) — nao TAG_EMP (que nao existe no app-AMB; errei isso no #389 e na 1a versao daqui)');
ok(!/TAG_EMP/.test(src), '  nenhum TAG_EMP no app-AMB');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
