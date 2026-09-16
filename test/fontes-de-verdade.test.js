'use strict';
// ⚠️ AS FONTES DE VERDADE NÃO PODEM DIVERGIR.
//
// Análise do Codex (16/09), confirmada no código. Três divergências, e as
// duas primeiras armariam a pior cilada no dia de plugar a Girassol:
//
//   1. `docs/EMBARCAR-GIRASSOL.md` dizia `GIRA_`; o contrato diz `GIRASSOL_`
//   2. o mesmo doc dizia "as fases estão prontas, só faltam credenciais" —
//      e `app-AMB.js` ainda é um SINGLETON da AMB
//   3. o contrato tinha DUAS VERDADES sobre o dono dos tokens: cada empresa
//      com `dono_alvo: null` ("a eleger") e o bloco de eleição já decidido
//
// ⚠️ Quem seguisse a parte antiga do doc criaria variáveis com prefixo
// errado, concluiria que só faltam credenciais, e montaria `/girassol` sobre
// o backend da AMB — que PARECE funcionar.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(RAIZ, 'docs', 'EMBARCAR-GIRASSOL.md'), 'utf8');
const contrato = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato-empresas.json'), 'utf8'));

// ── o documento usa o prefixo do contrato ───────────────────────────
{
  ok(!/GIRA_[A-Z]/.test(doc),
     '⚠️ o doc nao usa mais `GIRA_` (o contrato manda `GIRASSOL_`)');
  ok(/GIRASSOL_/.test(doc), '  e usa o prefixo certo');

  // e bate com o contrato, não com uma constante que eu escolhi
  const daFicha = ((contrato.empresas || {}).girassol || {}).prefixo_env;
  ok(!!daFicha && doc.includes(daFicha),
     `  ⚠️ conferido CONTRA o contrato (${daFicha}), nao contra texto fixo`);
}

// ── ⚠️ e o doc avisa que a Girassol NÃO pode ser ligada ─────────────
{
  ok(/NÃO pode ser ligada hoje/.test(doc),
     '⚠️ o doc avisa, no topo, que a Girassol nao pode ser ligada');
  ok(/singleton/i.test(doc),
     '  dizendo o motivo real (o app-AMB ainda e singleton)');
  ok(!/as Fases 1, 2 e 3 estão prontas\. O que falta/.test(doc),
     '  ⚠️ e a frase "so faltam credenciais" saiu');
}

// ── e o contrato responde o dono por empresa ────────────────────────
//
// ⚠️ Antes, quem lia `empresa.dono_alvo.ml` concluía "não decidido" e quem
// lia `passo_2_eleicao.dono_eleito.ml` concluía "mover-pedidos". Num arquivo
// criado para impedir divergência, isso é o pior defeito.
{
  const empresas = contrato.empresas || {};
  ok(Object.keys(empresas).length >= 3, 'o contrato tem as 3 empresas');

  for (const [chave, ficha] of Object.entries(empresas)) {
    const alvo = ficha.dono_alvo || {};
    const reais = Object.entries(alvo).filter(([k]) => !k.startsWith('_'));
    ok(reais.length > 0, `  ${chave}: dono_alvo tem integracoes`);
    const nulos = reais.filter(([, v]) => v === null || v === undefined);
    ok(nulos.length === 0,
       `⚠️ ${chave}: nenhum dono_alvo nulo`
       + (nulos.length ? ` (achei: ${nulos.map(([k]) => k).join(', ')})` : ''));
  }
}

// ── ⚠️ e bate com a eleição, em vez de contradizê-la ────────────────
{
  const bruto = JSON.stringify(contrato);
  const m = /"dono_eleito"\s*:\s*(\{[^}]*\})/.exec(bruto);
  ok(!!m, 'a eleicao existe no contrato (historico da migracao)');
  if (m) {
    const eleito = JSON.parse(m[1]);
    for (const [chave, ficha] of Object.entries(contrato.empresas || {})) {
      const alvo = ficha.dono_alvo || {};
      for (const [integr, dono] of Object.entries(eleito)) {
        if (!(integr in alvo)) continue;   // empresa sem essa capacidade
        ok(alvo[integr] === dono,
           `  ${chave}.${integr}: ficha diz "${alvo[integr]}", eleicao diz "${dono}"`);
      }
    }
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
