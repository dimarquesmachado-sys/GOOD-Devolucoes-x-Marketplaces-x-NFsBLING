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
