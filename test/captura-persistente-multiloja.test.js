'use strict';
// ⚠️ A CAPTURA PERSISTENTE VALE PRA AMB E GIRASSOL, NÃO SÓ PRA GOOD.
//
// Achado da auditoria do Codex (01/10): a GOOD grava o "à espreita" em
// `devolucoes_capturadas` 1x/hora — o dado está no banco quando o pacote
// chega, mesmo que o servidor reinicie ou o marketplace suma com a devolução.
// A AMB e a Girassol só LIAM essa tabela; nunca gravaram. "Portar tudo,
// sempre" — ficou pra trás aqui.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
const semCom = app.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

ok(/require\('\.\.\/lib\/devolucoes-capturadas'\)/.test(semCom),
   '⚠️ a fabrica da AMB/Girassol usa a MESMA lib de captura da GOOD');
ok(/function capturarDevolucoesEmpresa\(/.test(semCom),
   '  e tem a funcao de captura');
ok(/devCapturadas\.traduzir\(d, CHAVE_DADOS\)/.test(semCom),
   '⚠️ traduz com a chave DA EMPRESA (nao "good" cravado)');
ok(/devCapturadas\.guardar\(sb, /.test(semCom),
   '  e grava no Supabase da instancia');
ok(/CAPTURA_INTERVALO_MS = 60 \* 60 \* 1000/.test(semCom),
   '  com o mesmo limite da GOOD: 1x/hora');
ok(/tiktokPonte\.sondaDevolucoes\(CHAVE_DADOS/.test(semCom),
   '  e inclui o TikTok pela ponte, como a GOOD');
ok(/capturarDevolucoesEmpresa\(emTransito\)/.test(semCom),
   '⚠️ e e CHAMADA na rota que monta o agregado (nao e codigo morto)');

// ⚠️ Regra 12: os nomes que a funcao usa EXISTEM no escopo. Na 1a versao usei
// `TAG_EMP` e `tiktokDev`, que nao existem no app-AMB — ReferenceError justo
// no caminho da captura. node --check nao pega; o boot real so pega se a rota
// for chamada. Trava aqui.
const iFn = semCom.indexOf('function capturarDevolucoesEmpresa(');
const fn = semCom.slice(iFn, semCom.indexOf("router.get('/api/espreita'", iFn));
for (const nome of ['TAG_APP', 'tiktokDevCaptura', 'tiktokPonte', 'devCapturadas', 'CHAVE_DADOS', 'db']) {
  const usa = new RegExp('\\b' + nome + '\\b').test(fn);
  const declarado = new RegExp('(const|let|var)\\s+' + nome + '\\b').test(semCom) || nome === 'db';
  ok(!usa || declarado, `  nome usado na captura EXISTE no escopo: ${nome}`);
}
ok(!/\bTAG_EMP\b/.test(fn) && !/\btiktokDev\b(?!Captura)/.test(fn),
   '⚠️ e NAO usa os nomes fantasma da 1a versao (TAG_EMP, tiktokDev)');

// e o /status expoe o estado
ok(/captura: \(typeof CAPTURA !== 'undefined'\) \? CAPTURA\.estado/.test(semCom),
   '  e o /status mostra a ultima gravacao (pra conferir em producao)');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
