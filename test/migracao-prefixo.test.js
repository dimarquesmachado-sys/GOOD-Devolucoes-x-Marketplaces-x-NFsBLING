// Roda com: node test/migracao-prefixo.test.js
//
// [stated 05/09] "na minha visão tinha q arrumar a casa toda logo, não? meu
// medo é lá na frente essa regra ser esquecida, falhar, quebrar alguma
// coisa. se todas empresas estiverem no padrão, pronto."
//
// Ele está certo: regra com exceção é regra que alguém esquece. O alvo é
// TODA empresa usar `<EMPRESA>_ALGO`.
//
// A GOOD nasceu sem prefixo (era a única empresa). A migração é em 3
// tempos, e o passo 1 é este: o código aceita OS DOIS nomes, então nada
// quebra enquanto ele cria as variáveis novas no Render.
//
// ⚠️ ESTE TESTE EXISTE POR UM BUG REAL: minha primeira edição comeu o
// `return` final do `envDaEmpresa`, e a função devolvia `undefined` em todo
// caminho que não fosse o fallback — inclusive para a AMB, que nem tem
// histórico. Só apareceu porque testei em processo limpo, com env de
// verdade. Testar só o caso que eu tinha acabado de escrever teria passado.

const { execFileSync } = require('child_process');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

/** Lê uma env pelo registro, num processo LIMPO (env controlada). */
function ler(empresa, nome, envs, tipo) {
  const codigo = `const r=require(${JSON.stringify(path.join(RAIZ, 'lib', 'empresas.js'))});`
    + `process.stdout.write(String(r.envDaEmpresa(r.obterEmpresa(${JSON.stringify(empresa)}),`
    + `${JSON.stringify(nome)}, '(vazio)'${tipo ? ', ' + JSON.stringify(tipo) : ''})));`;
  return execFileSync(process.execPath, ['-e', codigo],
    { env: { PATH: process.env.PATH, ...envs } }).toString();
}

// ── os 3 tempos da migração, na ordem em que vão acontecer ──────────
{
  ok(ler('good', 'BLING_CLIENT_ID', { BLING_CLIENT_ID: 'antigo' }) === 'antigo',
     'TEMPO 1 (hoje): so a var antiga existe -> acha pelo historico, nada quebra');

  ok(ler('good', 'BLING_CLIENT_ID', { BLING_CLIENT_ID: 'antigo', GOOD_BLING_CLIENT_ID: 'novo' }) === 'novo',
     'TEMPO 2: as duas existem -> a NOVA manda (e o que permite migrar sem pressa)');

  ok(ler('good', 'BLING_CLIENT_ID', { GOOD_BLING_CLIENT_ID: 'novo' }) === 'novo',
     'TEMPO 3: so a nova -> funciona, e o fallback pode sair do codigo');
}

// ── ⚠️ o que o bug do `return` sumido teria quebrado ────────────────
{
  ok(ler('ambtotal', 'BLING_CLIENT_ID', { AMB_BLING_CLIENT_ID: 'amb-ok' }) === 'amb-ok',
     'a AMB (ja no padrao) le normal — nao passa pelo fallback');
  ok(ler('good', 'DEPOSITO_GERAL', { GOOD_DEPOSITO_GERAL: 'dep' }, 'fiscal') === 'dep',
     'o campo FISCAL da GOOD ja era GOOD_ e nao foi tocado');
  ok(ler('good', 'BLING_CLIENT_ID', {}) === '(vazio)',
     'sem nenhuma das duas -> devolve o padrao (nao `undefined`)');
}

// ── ⚠️ a regra que derruba produção se for esquecida ────────────────
//
// O nome aparece em DOIS lugares: quem lê a env e quem GRAVA o token
// renovado de volta no Render. Se mudar um e esquecer o outro, o token é
// salvo num nome que ninguém lê — e a integração cai no próximo restart,
// sem erro aparente.
{
  const fs = require('fs');
  for (const arq of ['lib/bling.js', 'lib/ml.js']) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const lidas = new Set([...src.matchAll(/process\.env\.((?:BLING|ML)_[A-Z_]+)/g)].map((m) => m[1]));
    const gravadas = [...src.matchAll(/key:\s*'((?:BLING|ML)_[A-Z_]+)'/g)].map((m) => m[1]);
    const orfas = gravadas.filter((g) => !lidas.has(g));
    ok(orfas.length === 0,
       arq + ': todo token GRAVADO tem o mesmo nome do que e LIDO'
       + (orfas.length ? ' (ORFAS: ' + orfas.join(', ') + ')' : ''));
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
