# tools/ — scripts de console, para operações pontuais

Scripts que **não** rodam no servidor. São colados no console do
navegador para trabalhos de mutirão que não valem uma tela própria.

Estão versionados por um motivo específico: eles dependem de
contratos que vivem em **outro repo** (a extensão Toolbox, em
`Mover-Pedidos-Aguardando-x-Atendido`). Enquanto viviam soltos em
arquivos baixados, quem mexia na extensão não tinha como descobrir
que a dependência existia — não aparecia em busca nenhuma.

| script | onde cola | para quê |
|---|---|---|
| `nf-devolucao-lote-amb.js` | painel da AMB (`/amb/painel`) | emite NF de entrada (devolução) em lote, para notas de venda duplicadas que a SEFAZ não deixa mais cancelar |
| `cancelar-lote-bling.js` | Bling, tela de notas fiscais | cancela NF-e em lote |

## O que aprendemos usando estes dois (25-28/08/2026)

**Prazo da SEFAZ-SP:** cancelamento vale até 20 dias / 480h da
emissão. Dentro de 24h retorna cStat 135; entre 24h e 20 dias,
155 (homologado fora de prazo); depois disso, 501 intempestivo, e
não há código que contorne — só resta a NF de devolução. O 690 é
NF-e com CT-e autorizado: só cancela se a transportadora cancelar
antes.

**Processar da mais NOVA para a mais VELHA.** Assim a parada
automática em 2 falhas seguidas trabalha a favor: cancela tudo que
ainda tem prazo e para sozinha no limite.

**A natureza de operação/CFOP das entradas é decisão do contador**,
não do script. Por isso o fluxo tem o passo do rascunho: gera UMA
nota, sem transmitir, para conferir itens, valor e natureza no
Bling antes de soltar o lote.

⚠️ Antes de mexer na extensão, leia o cabeçalho de
`nf-devolucao-lote-amb.js`: ele documenta as duas coisas que, se
mudarem na Toolbox, quebram este script em silêncio.

## Como o rascunho funciona (importante)

`devol.rascunho()` gera **uma** nota de entrada **sem transmitir**. Ela é
para você abrir no Bling, **editar e validar à mão** — não é um
"pré-visualizar" que o script emite depois.

Por isso, desde a revisão de 28/08, a NF que virou rascunho **sai da fila
do `devol.emitir()`**. Antes ela continuava lá: o `emitir()` tentava criar
outra devolução da mesma venda, a proteção anti-duplicata do Bling
recusava (corretamente — ele não deixa duas devoluções para a mesma NF de
saída), e essa recusa contava como **falha**. Com duas seguidas, o lote
parava sozinho no meio.

Hoje, "esta NF já possui devolução" aparece como **PULADA** e não derruba
o lote.

## Códigos de erro da Bridge (Toolbox v2.1.0)

Desde o PR #239 do Mover-Pedidos, a extensão devolve um **código estável**
junto do erro, e não só texto:

| código | o que o script faz |
|---|---|
| `JA_EXISTE` | pula a nota, **não** conta como falha |
| `TIMEOUT` | **para** o lote — indeterminado, confira no Bling |
| `RASCUNHO_CRIADO` | a NF existe, só a emissão falhou: **não re-emitir**; o id vem junto |
| `FALHA` | conta para o limite de 2 falhas seguidas |

O script classifica **pelo código primeiro** e só cai no texto da mensagem
quando ele não vem — o que acontece na Bridge antiga, ainda instalada até a
migração dos navegadores. Assim os dois mundos funcionam.

Se os **valores** desses códigos mudarem, avise: o texto sozinho já não basta.

## Travas que existem por um motivo

- **Timeout para o lote.** O timeout da extensão é *indeterminado*: a
  operação pode terminar depois e emitir a nota assim mesmo. O script
  para e manda você conferir no Bling antes de repetir — em vez de seguir
  e arriscar sobrepor operações fiscais.
- **NF achada só pelo número exige confirmação.** A busca por número não
  filtra série, e o mesmo número existe em séries diferentes. Se a fila
  não trouxer o id do Bling, o `emitir()` recusa até você conferir e
  passar `conferiSerie:true`.
- **No cancelamento, a lista é congelada** no momento em que você
  confirma, e uma conferência nova não pode rodar durante o lote. Sem
  isso, conferir outro lote no meio da execução faria o laço cancelar as
  notas do lote novo, que ninguém confirmou.
- **Toda conferência apaga o lote anterior.** Antes, se a segunda
  conferência falhasse na leitura, a lista da primeira continuava de pé — e
  um `cancelar()` seguinte ofereceria as notas erradas.
- **A varredura vai até o fim do período** antes de dizer que um número é
  único, justamente porque a listagem não vem ordenada e a série repetida
  pode estar na página seguinte.
