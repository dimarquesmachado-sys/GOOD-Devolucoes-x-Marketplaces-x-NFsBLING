# Plugar empresa nova sem sofrer — plano em fases

**Escrito em 27/08/2026.** Motivo: a **Girassol** entra no Devoluções (volume ~15% acima
da GOOD, precisa do sistema inteiro) e mais uma empresa em ~3 meses. Sem prazo apertado.

---

## O problema, com número

Hoje empresa nova = **copiar pasta**. O que isso custa, medido no repo:

| O que | Tamanho |
|---|---|
| `amb-devolucoes/app-AMB.js` | 2.066 linhas, **148 menções literais a "AMB"** |
| `amb-devolucoes/public-AMB/painel-AMB.html` | 3.569 linhas (a da GOOD tem 2.915) |
| `amb-devolucoes/lib-AMB/` | ~17.500 linhas |

E as cópias **já divergiram**:

| arquivo | GOOD | AMB | situação |
|---|---:|---:|---|
| `ml-buscas` | 94 | 94 | **idêntico** |
| `render-tokens` | 96 | 122 | divergiu pouco |
| `ml` | 142 | 254 | divergiu |
| `nf-nomes` | 131 | 466 | AMB foi muito além |
| `bling` | 725 | 404 | GOOD foi muito além |
| `defeitos-ciclo` | 1.043 | 1.036 | divergiu no meio |

Ou seja: unificar **não é apagar uma cópia**. É decidir, caso a caso, qual
comportamento fica. Por isso o plano é incremental.

O custo real já apareceu duas vezes esta semana:
- **25/08** — o mesmo bug consertado nos dois lados no mesmo dia.
- **26/08** — o painel servido antes do login estava nas **duas** empresas,
  por caminhos diferentes; a auditoria externa só tinha visto o da GOOD.

Com 3 empresas isso triplica. Com 4, quadruplica.

---

## A pegadinha dos prefixos (medida, não suposta)

- A **GOOD** nasceu primeiro e ficou **sem prefixo**: `BLING_CLIENT_ID`.
- A **AMB** veio depois e usa prefixo: `AMB_BLING_CLIENT_ID`.

Sem prefixo só cabe **uma** empresa no ambiente. Toda empresa nova precisa de prefixo
próprio (`GIRA_`, etc.) — e é por isso que o registro existe: para a leitura de env
passar por **um lugar só**.

---

## Fases

### Fase 0 — Registro de empresas ✅ (feito)

`lib/empresas.js` + `test/empresas.test.js`.

Junta num lugar só o que estava espalhado: prefixo de env, prefixo de rota, tabela do
Supabase e os ids fiscais (empresa, depósito, natureza). **Não muda comportamento** —
quem lê, lê os mesmos valores de antes.

O teste prova que os ids do registro **conferem com o que está em produção hoje**
(`lib/bling.js`, `lib/rotas-admin-nf.js`). Se alguém mudar um id num lugar só, o teste
quebra.

Traz também `conferirEmpresa()`, que responde "o que falta para ligar esta empresa?"
sem chutar nada — lista as envs ausentes já com o prefixo certo, pronto para colar no
Render.

### Fase 1 — Quem lê passa a ler do registro

Trocar, um por um, os pontos que hoje leem env solta ou têm id fixo no meio do código
para lerem do registro. Cada troca é um PR pequeno, e a prova é que o valor resolvido
continua idêntico.

Começar por `lib/rotas-admin-nf.js` e `lib/bling.js`, que são onde os ids fiscais estão
escritos à mão.

### Fase 2 — Os gêmeos idênticos viram peça única

`ml-buscas` é **byte a byte igual** nos dois lados: apagar a cópia e apontar para a
mesma. Risco quase zero e serve de molde.

Depois os que divergiram pouco (`render-tokens`), sempre comparando antes o que cada
lado ganhou.

### Fase 3 — `app-AMB` vira fábrica

Hoje `app-AMB.js` exporta um router **pronto**, montado com `app.use('/amb', ...)`.
Passa a exportar uma **função que recebe a empresa** e devolve o router.

A prova de que deu certo: montar a AMB com a ficha atual e o comportamento ser
idêntico ao de hoje.

### Fase 4 — Girassol entra como ficha, não como pasta

Preencher a ficha da Girassol (hoje comentada no registro) e montar. Sem pasta nova.

**Antes disso, precisa levantar no Bling da Girassol** — mesma varredura que fizemos na
AMB em 25/08:
- `idEmpresaControl` (id da empresa no Bling)
- depósito Geral e a lista de depósitos válidos (o select da tela de NF de entrada)
- natureza de devolução de entrada e as naturezas que contam como devolução
  (catálogo `/naturezas-operacoes`)

### Fase 5 — O painel

`painel-AMB.html` (3.569 linhas) e `painel-devolucoes.html` (2.915) são cópias
divergentes. Servir o mesmo HTML parametrizado pela empresa. Deixado por último porque
é onde mais divergiu e o risco de quebrar a operação do galpão é maior.

---

## Regras que valem em todas as fases

1. **Uma fase por PR**, com prova de que nada mudou de comportamento.
2. **Nenhum id inventado.** O que não foi medido no Bling fica explicitamente marcado
   como FALTA — foi assim que se descobriu, em 21/08, que a natureza do Magalu Full não
   servia para casar devolução (o contato é a transportadora, não o comprador).
3. **Teste versionado junto**, não no ambiente de quem escreveu. O primeiro teste do
   repo (`test/caminho-pedido.test.js`) só existe porque um bypass passou batido.
4. **A operação não pode parar.** Se uma fase ameaçar o galpão, ela espera.
