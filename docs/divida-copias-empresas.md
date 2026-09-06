# Dívida de cópias entre empresas — medida em 04/09/2026

> [stated] "tá tudo em lib? se conectar mais outra empresa, já ta tudo no
> esquema?"

**Não estava.** Medida a similaridade linha a linha entre `lib/X.js` (GOOD)
e `amb-devolucoes/lib-AMB/X-AMB.js` (AMB):

| módulo | GOOD | AMB | iguais | situação |
|---|---:|---:|---:|---|
| `ml-buscas` | 95 | 95 | **100%** | ✅ **unificado** (b238) |
| `ritmo-bling` | 70 | — | — | ✅ nasceu comum (b232) |
| ~~`nf-pessoa`~~ | 430 | 738 | 72% | ✅ **unificado** (b240) — e consertou 3 bugs da GOOD |
| `defeitos-ciclo` | 1186 | 1037 | 71% | 🎯 alvo — o maior ganho em linhas |
| ~~`render-tokens`~~ | 97 | 123 | 46% | ✅ **unificado** (b241) — a GOOD ganhou a 2ª trava de segurança |
| `magalu` | 458 | 522 | 24% | divergiu muito |
| `nf-nomes` | 229 | 476 | 20% | a AMB tem busca por venda também |
| `ml` / `ml-returns` | 429 | 771 | 15% | contas e fluxos diferentes |
| `bling` | 1204 | 405 | 11% | a GOOD cresceu muito mais |

## O que isso custa hoje

- A AMB importa **2** arquivos da `/lib`; o resto é cópia paralela
- Todo conserto vira **dois** consertos — é a dívida recorrente
  ("a AMB ficou pra trás")
- Plugar um CNPJ novo hoje = copiar ~21 arquivos e renomear por dentro

## Ordem sugerida (do maior ganho ao menor)

1. ~~`ml-buscas`~~ — feito, era cópia byte a byte
2. **`defeitos-ciclo`** — 71% iguais e 2.223 linhas somadas: o maior ganho
3. ~~`nf-pessoa`~~ — feito: a AMB tinha 2 funções e 3 consertos que a GOOD não tinha
4. ~~`render-tokens`~~ — feito: sem função exclusiva, mas a AMB tinha uma trava a mais
5. Os de 11-24% (`bling`, `ml`, `magalu`) — só valem depois, e talvez nunca
   por inteiro: a diferença ali é de negócio, não de descuido

## A trava

`test/sem-copia-entre-empresas.test.js` impede **piorar**:
- o que já foi unificado não pode voltar a ter cópia
- módulo novo fora da lista de dívida conhecida acusa

Ao unificar mais um, acrescentar o nome na lista `unificados` do teste.

---

## Medição final (04/09) — o que NÃO vale unificar

Medi os 5 restantes olhando a **natureza** da divergência, não o tamanho:

| módulo | por que não |
|---|---|
| `nf-nomes` | as 405 linhas extras da AMB são **4 funções que só ela usa** (busca por pedido, por número, por venda da loja). A GOOD não chama nenhuma. E o conserto que importava (ritmo/429, b228) a GOOD **já tem**. Unificar levaria código morto pra ela |
| `defeitos-ciclo` | schema diferente de verdade: a GOOD usa `created_at`, a AMB `criado_em`; e a AMB grava um status que a GOOD recusa por trava fiscal |
| `bling` · `ml` · `magalu` | divergem **nos dois sentidos** — cada lado tem funções que o outro não tem. Diferença de negócio, não descuido. Unificar viraria um módulo cheio de condicionais por empresa, pior que duas cópias honestas |
| `ml-returns` | 15% iguais; a AMB tem enriquecimento de pedido que a GOOD faz noutro lugar. Mesmo caso |

**Conclusão:** a dívida útil acabou. Sobrou ~7.900 linhas duplicadas, mas
são duplicação **de nome**, não de código — dois módulos diferentes que
por acaso se chamam igual.

## O que fazer ao plugar a 3ª empresa

1. Ela herda os 4 já comuns (`ml-buscas`, `ritmo-bling`, `nf-pessoa`, `render-tokens`) sem trabalho
2. Para os demais, **copiar da AMB**: nas 3 unificações de hoje, a versão dela era a mais completa em 2 de 3 casos
3. ⚠️ E a lição das unificações: **conferir os DOIS lados**. Em `render-tokens` eu adotei a versão da AMB e perdi a fila única, que só existia na da GOOD
