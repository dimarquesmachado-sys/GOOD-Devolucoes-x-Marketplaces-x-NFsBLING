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

## A pegadinha dos prefixos — são DOIS, não um

Eu tinha escrito aqui que "a GOOD não tem prefixo". Estava errado, e o Codex pegou no
PR #86. O certo:

| | credenciais | ids fiscais |
|---|---|---|
| **GOOD** | sem prefixo (`BLING_CLIENT_ID`) | **`GOOD_`** (`GOOD_DEPOSITO_GERAL`) |
| **AMB** | `AMB_` | `AMB_` |

Por que importa: com um prefixo só, migrar a produção para o registro leria
`DEPOSITO_GERAL` — que ninguém configurou — jogaria fora o valor real e cairia no
padrão. Ou seja, poderia mirar em **depósito, natureza ou empresa errada** sem avisar.

Sem prefixo só cabe **uma** empresa no ambiente. Toda empresa nova precisa dos dois
prefixos próprios (`GIRASSOL_`, conforme `contrato-empresas.json`).

---

## Fases

### Fase 0 — Registro de empresas ✅ (feito)

`lib/empresas.js` + `test/empresas.test.js`.

Junta num lugar só o que estava espalhado: prefixo de env, prefixo de rota, tabela do
Supabase e os ids fiscais (empresa, depósito, natureza). **Não muda comportamento** —
quem lê, lê os mesmos valores de antes.

O teste prova que os ids do registro **conferem com o que está em produção hoje**
(`lib/bling.js`, `amb-devolucoes/lib-AMB/rotas-admin-AMB.js`, a cópia ÚNICA das rotas de admin desde b545). Se alguém mudar um id num lugar só, o teste
quebra.

Traz também `conferirEmpresa()`, que responde "o que falta para ligar esta empresa?"
sem chutar nada — lista as envs ausentes já com o prefixo certo, pronto para colar no
Render.

### Fase 1 — Quem lê passa a ler do registro

Trocar, um por um, os pontos que hoje leem env solta ou têm id fixo no meio do código
para lerem do registro. Cada troca é um PR pequeno, e a prova é que o valor resolvido
continua idêntico.

Começar por `amb-devolucoes/lib-AMB/rotas-admin-AMB.js` (rotas de admin únicas, b545) e `lib/bling.js`, que são onde os ids fiscais estão
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

**A ficha se levanta sozinha.** `descobrirFicha('girassol', chamarBlingDaGirassol)`
pergunta pro Bling dela e devolve depósito Geral, natureza de devolução, situações e
lojas. Não é para caçar id no DevTools.

O que a API **resolve** (medido pela sonda de ids fiscais em 18/08, rodando no Bling da
AMB — não é suposição):

| Endpoint | O que dá |
|---|---|
| `GET /naturezas-operacoes` | 200, 22 itens. Acha a natureza por nome |
| `GET /depositos` | os depósitos da empresa logada |
| `GET /situacoes` | as situações de pedido |
| `GET /lojas` | os canais de marketplace |

O que a API **não resolve**: `GET /empresas` dá **404, não existe**. O
`idEmpresaControl` é o único campo que precisa de env — e a descoberta avisa isso
explicitamente em vez de deixar passar.

**Por que as situações importam:** elas mudam por empresa. AGUARDANDO é `353459` na
GOOD, `7259` na Girassol e `745122` na AMB. Cravar qualquer uma no código quebra as
outras duas.

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


---

## O que a revisão do PR #86 corrigiu (vale para as próximas fases)

O Codex achou **11 problemas** no registro. Os que mais importam, porque são o tipo de
erro que se repete:

1. **Prefixo duplo** (acima) — eu tinha simplificado o esquema da GOOD e a simplificação
   quebraria a migração.
2. **Mudança de comportamento escondida** — eu tinha posto duas naturezas no padrão da
   AMB onde a produção tem uma só (`15110882041`). Isso passaria a classificar como
   devolução de cliente notas que hoje não são — dentro de um PR que promete não mudar
   nada. Se essa natureza tiver que entrar, entra sozinha e testada.
3. **Assinatura errada do cliente Bling** — eu chamava `chamarBling('GET', caminho)`, mas
   o repo usa `chamarBling(caminho, opcoes)`. A descoberta não acharia nada, em silêncio.
4. **Falha que não levanta exceção** — os clientes deste repo **resolvem** `{ok:false}` em
   vez de lançar. Só `try/catch` não vê: quatro chamadas falhando ainda dariam
   `pronta: true`.
5. **Remédio que não curava** — quando havia ambiguidade, a saída mandava definir uma env
   que nenhuma execução seguinte lia.
6. **Teste frouxo** — `arquivo.includes('4956031259')` continuava verde mesmo se o
   fallback mudasse, porque o id velho segue em comentários e em outras listas. Agora o
   teste **extrai a atribuição** de produção e compara.

A regra que sai daqui: **num PR que promete "não muda comportamento", qualquer valor
padrão diferente do de produção é uma mudança de comportamento** — mesmo que pareça
melhoria.

## Cores e logo (14/10/2026)

A ficha gerada já traz `tema` (cores) e `marca` (logo e ícone). Antes de ativar:

1. ajuste as cores do `tema` para as da empresa;
2. suba o logo/ícone em `amb-devolucoes/public-AMB/marcas/<chave>/` (`icone-192.png` 192×192 e
   `apple-touch-icon.png` 180×180);
3. rode `conferirEmpresa('<chave>')` — ele **avisa** (sem reprovar) se faltar o tema, a marca ou algum arquivo.

Sem isso a empresa funciona, mas a triagem e o painel saem com as cores e o logo da AMB — foi o que a Girassol mostrou
até o b616.

## TikTok (06/11/2026)

A loja TikTok de cada empresa sai do registro (`lib/empresas.js`): é o `chaveDados` da ficha, ou
`lojaTiktok` quando o nome da loja no Mover-Pedidos for outro. Uma 4ª empresa entra sem editar
`lib/tiktok-ponte.js` (b660) — do lado do Mover-Pedidos, o mesmo nome precisa estar em `TIKTOK_LOJAS`
e a loja precisa ser autorizada no `/tiktok/painel` de lá.

## Código de barras no divergente (08/11/2026)

No "produto errado" o estoquista bipa o código de barras da caixa. A GOOD resolve pelo índice dela;
as outras empresas perguntam ao Mover-Pedidos em `GET /<pastaCheckout>/buscar-produto?q=<ean>` (b671,
`lib/produto-por-ean-ponte.js`, mesma `MOVER_PEDIDOS_URL`/`KEY` da ponte do TikTok). Empresa nova:
a `pastaCheckout` da ficha precisa existir como painel no Mover-Pedidos; a sonda confere
("ponte EAN com o Mover-Pedidos") e, sem isso, avisa — a empresa opera, só o código de barras do
divergente cai no SKU.

## Permissões do aplicativo do Mercado Livre (14/11/2026)

O token do ML que o Devoluções usa vem do **dono** (Mover-Pedidos) enquanto o eixo está em `sombra`/`remoto`.
Então quem precisa das permissões é o **aplicativo do Mover-Pedidos** daquela empresa — não só o do Devoluções.
Na GOOD são dois apps de ML (um por serviço), e faltava uma permissão justamente no do Mover-Pedidos.

No DevCenter do ML (logado na conta da empresa), em *editar o app → Permissões*, esta é a configuração do app
do Mover-Pedidos da GOOD **com que tudo funciona** (as demais permissões ficam "Sem acesso"):

| Permissão | Acesso | O que se sabe |
|---|---|---|
| Usuários | Leitura e escrita | já estava assim |
| Comunicações pré e pós-vendas | Leitura e escrita | **medido em 14/11**: sem ela a busca de reclamações (`/post-purchase/v1/claims/search`) dá 403 e o índice de devoluções não monta. Só "Leitura" não foi testado |
| Faturamento de uma venda | Leitura e escrita | exigência do F3 do Mover-Pedidos (NF → ML), que também dava 403 do PolicyAgent sem ela |
| Venda e envios de um produto | Leitura e escrita | já estava assim; pedidos, pacotes e envios respondiam |

**Como falta de permissão aparece:** `403` com `blocked_by: PolicyAgent` e
`code: PA_UNAUTHORIZED_RESULT_FROM_POLICIES`, em **toda** chamada daquela família — até numa busca que não
devolveria nada. O token continua vivo (`/users/me` responde) e o resto do ML funciona. No Devoluções isso vira
`claims_bloqueadas` no índice e o erro "o status inteiro parece bloqueado" — que desde o b695 já aponta a
permissão.

**Mudar a permissão não basta: tem que autorizar de novo.** O token antigo não ganha a permissão sozinho.
No Mover-Pedidos, no navegador daquela empresa e logado no ML com a conta **dela** (autorizar logado em outra
conta grava o token da empresa errada):

1. `https://mover-pedidos-aguardando-x-atendido.onrender.com/<pastaCheckout>/setup-ml?k=<ADMIN_KEY do mover-pedidos>`
   (`/good/setup-ml` e `/amb/setup-ml` respondem "not found" — o caminho que funciona é o do painel);
2. autorizar no ML; se a página final não disser "Token ML obtido", copiar o `code=` da barra de endereço e
   chamar `/<pastaCheckout>/ml-trocar-code?code=<code>&k=<ADMIN_KEY>`.

**Como conferir daqui**, logado como admin: `/api/debug/ml-get?path=` com a busca de reclamações
(`/post-purchase/v1/claims/search?status=opened&players.user_id=<id da conta>&players.role=respondent&limit=1`,
com o `path` codificado) tem que voltar `200`. Depois de um 403, o primeiro clique pode ainda negar: ele só
troca o token guardado; o segundo já usa o novo.
