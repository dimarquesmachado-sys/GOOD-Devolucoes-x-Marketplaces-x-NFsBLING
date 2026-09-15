'use strict';
// ⚠️ P1 DA AUDITORIA: duas fontes de verdade para o mesmo dado.
//
// O `lib/empresas.js` dizia `GIRA_`; o `contrato-empresas.json` diz
// `GIRASSOL_`. E como o bloco da Girassol está COMENTADO, ninguém percebeu.
//
// O estrago apareceria no pior momento: ao descomentar para plugar a
// empresa, o código procuraria `GIRA_BLING_CLIENT_ID` enquanto o Render
// teria `GIRASSOL_BLING_CLIENT_ID`. Ela não acharia credencial nenhuma — e o
// erro ("token ausente") não diria que o problema é o NOME da variável.
//
// 📌 Este teste compara os dois arquivos INCLUSIVE no bloco comentado:
// divergência em código morto vira bug vivo no dia que alguém descomenta.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const contrato = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato-empresas.json'), 'utf8'));
const registro = fs.readFileSync(path.join(RAIZ, 'lib', 'empresas.js'), 'utf8');

// os prefixos que o CONTRATO declara, por empresa
const doContrato = {};
for (const [chave, ficha] of Object.entries(contrato.empresas || contrato || {})) {
  if (ficha && typeof ficha === 'object' && ficha.prefixo_env) {
    doContrato[chave] = ficha.prefixo_env;
  }
}
ok(Object.keys(doContrato).length > 0,
   'o contrato declara prefixo_env (' + Object.keys(doContrato).join(', ') + ')');

// ── ⚠️ e o registro usa o MESMO, mesmo em bloco comentado ───────────
for (const [chave, prefixo] of Object.entries(doContrato)) {
  // ⚠️ ANCORA NA DECLARACAO, nao no nome da empresa.
  //
  // Minha 1a versao procurava a 1a ocorrencia de "girassol" no arquivo — e
  // ela esta num COMENTARIO DO TOPO, a 1200 chars do bloco real. Resultado:
  // o teste passava mesmo com o prefixo errado. Falso NEGATIVO, que e pior
  // que nao ter teste.
  //
  // Agora procuro `chave: '<empresa>'` (a declaracao) e leio o prefixo que
  // vem logo depois.
  const mDecl = new RegExp("chave:\\s*'" + chave + "'", 'i').exec(registro);
  if (!mDecl) continue;            // empresa ainda não declarada
  const trecho = registro.slice(mDecl.index, mDecl.index + 400);
  const m = /prefixoEnv:\s*'([A-Z_]+)'/.exec(trecho);
  if (!m) continue;                // sem prefixo declarado ali
  ok(m[1] === prefixo,
     `⚠️ ${chave}: registro usa '${m[1]}' e contrato manda '${prefixo}'`);
}

// ── e o prefixo antigo não sobreviveu em lugar nenhum ───────────────
//
// ⚠️ Uma ocorrência esquecida basta: é a variável que não vai ser
// encontrada no dia do plugue.
{
  const semComent = registro.split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/'GIRA_'/.test(semComent) && !/GIRA_[A-Z]/.test(semComent),
     '⚠️ o prefixo antigo `GIRA_` nao sobrou no codigo ativo');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
