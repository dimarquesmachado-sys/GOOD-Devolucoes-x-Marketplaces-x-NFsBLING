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

// ── nenhum documento de onboarding usa o prefixo antigo ─────────────
//
// ⚠️ O Codex achou: o teste original só lia EMBARCAR-GIRASSOL.md, mas
// PLUGAR-EMPRESA-NOVA.md tinha o MESMO `GIRA_` obsoleto num outro trecho —
// o teste passava enquanto um segundo caminho de onboarding continuava
// ensinando o prefixo errado.
{
  const DOCS_DE_ONBOARDING = ['EMBARCAR-GIRASSOL.md', 'PLUGAR-EMPRESA-NOVA.md'];
  for (const nome of DOCS_DE_ONBOARDING) {
    const texto = fs.readFileSync(path.join(RAIZ, 'docs', nome), 'utf8');
    ok(!/GIRA_[A-Z]/.test(texto),
       `⚠️ ${nome} nao usa mais \`GIRA_\` (o contrato manda \`GIRASSOL_\`)`);
  }
  ok(/GIRASSOL_/.test(doc), '  EMBARCAR-GIRASSOL.md usa o prefixo certo');

  // e bate com o contrato, não com uma constante que eu escolhi
  const daFicha = ((contrato.empresas || {}).girassol || {}).prefixo_env;
  ok(!!daFicha && doc.includes(daFicha),
     `  ⚠️ conferido CONTRA o contrato (${daFicha}), nao contra texto fixo`);
}

// ── ⚠️ e o doc avisa que a Girassol NÃO pode ser ligada ─────────────
{
  // ⚠️ b382 - O AVISO MUDOU PORQUE O CODIGO MUDOU.
  //
  // O doc ja esteve errado nas DUAS direcoes: primeiro dizia "so faltam
  // credenciais" quando o app era singleton; depois dizia que era singleton,
  // quando ja tinha virado fabrica.
  //
  // 📌 O que este teste guarda agora nao e uma FRASE, e a propriedade que
  // importa: o doc manda RODAR o `conferirEmpresa` em vez de confiar na
  // pagina. Assim ele nao envelhece de novo.
  ok(/conferirEmpresa\('girassol'\)/.test(doc),
     '⚠️ o doc manda RODAR o verificador (em vez de listar de memoria)');
  ok(/nao confie nesta página|não confie nesta página/i.test(doc),
     '  dizendo explicitamente pra nao confiar na pagina');
  ok(!/ainda é um \*\*singleton/.test(doc),
     '  e a afirmacao de que o app e singleton saiu (deixou de ser verdade)');
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
//
// ⚠️ O Codex achou: a versão anterior pulava `integr` que não estivesse em
// `alvo`, tratando TODA ausência como "empresa sem essa capacidade" — inclusive
// quando a integração era suportada e alguém apagou a chave por engano (ex.:
// `good.ml`). Agora a ausência só é aceita quando a `capacidade` associada
// realmente falta na ficha; se a empresa suporta a integração, a chave é
// OBRIGATÓRIA.
{
  const bruto = JSON.stringify(contrato);
  const m = /"dono_eleito"\s*:\s*(\{[^}]*\})/.exec(bruto);
  ok(!!m, 'a eleicao existe no contrato (historico da migracao)');

  // integrações cuja presença depende de uma `capacidade` declarada; as que
  // não aparecem aqui (bling, bling_nfe) valem pra toda empresa do contrato.
  const CAPACIDADE_DA_INTEGRACAO = { ml: 'ml', magalu: 'magalu', tiktok: 'tiktok' };

  if (m) {
    const eleito = JSON.parse(m[1]);
    for (const [chave, ficha] of Object.entries(contrato.empresas || {})) {
      const alvo = ficha.dono_alvo || {};
      const capacidades = ficha.capacidades || [];
      for (const [integr, dono] of Object.entries(eleito)) {
        const capacidadeExigida = CAPACIDADE_DA_INTEGRACAO[integr];
        const suportada = !capacidadeExigida || capacidades.includes(capacidadeExigida);
        if (!suportada) continue;   // empresa realmente nao tem essa capacidade
        ok(integr in alvo,
           `⚠️ ${chave}.${integr}: eleicao diz "${dono}" mas dono_alvo nao tem a chave (empresa suporta a integracao)`);
        if (integr in alvo) {
          ok(alvo[integr] === dono,
             `  ${chave}.${integr}: ficha diz "${alvo[integr]}", eleicao diz "${dono}"`);
        }
      }
    }
  }
}

// ── ⚠️ o documento de estado existe e manda MEDIR ───────────────────
//
// O `RETOMADA-MULTILOJA.md`, proposto em 17/09, nunca entrou na main — a
// análise ficou só no chat, e 5 dias depois foi lida como se fosse o estado
// atual. Os 3 bloqueadores que ela listava já estavam fechados.
//
// 📌 O que este teste guarda não é o CONTEÚDO (que envelhece), e sim que o
// documento existe, que o manual aponta para ele, e que ele manda RODAR os
// comandos em vez de confiar na página.
{
  const doc = path.join(RAIZ, 'docs', 'ESTADO-MULTILOJA.md');
  ok(fs.existsSync(doc), '⚠️ o `docs/ESTADO-MULTILOJA.md` existe');
  if (fs.existsSync(doc)) {
    const txt = fs.readFileSync(doc, 'utf8');
    ok(/conferirEmpresa\('girassol'\)/.test(txt),
       '  e manda RODAR o verificador (nao lista de memoria)');
    ok(/duas-empresas-juntas/.test(txt),
       '  e aponta o teste que mede o isolamento');
  }
  const manual = path.join(RAIZ, 'CLAUDE.md');
  if (fs.existsSync(manual)) {
    ok(/ESTADO-MULTILOJA/.test(fs.readFileSync(manual, 'utf8')),
       '  e o manual aponta pra ele');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
