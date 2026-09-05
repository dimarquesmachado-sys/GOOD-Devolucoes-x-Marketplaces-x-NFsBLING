# Dívida de cópias entre empresas — medida em 04/09/2026

> [stated] "tá tudo em lib? se conectar mais outra empresa, já ta tudo no
> esquema?"

**Não estava.** Medida a similaridade linha a linha entre `lib/X.js` (GOOD)
e `amb-devolucoes/lib-AMB/X-AMB.js` (AMB):

| módulo | GOOD | AMB | iguais | situação |
|---|---:|---:|---:|---|
| `ml-buscas` | 95 | 95 | **100%** | ✅ **unificado** (b238) |
| `ritmo-bling` | 70 | — | — | ✅ nasceu comum (b232) |
| `nf-pessoa` | 430 | 738 | 72% | 🎯 próximo alvo |
| `defeitos-ciclo` | 1186 | 1037 | 71% | 🎯 alvo — o maior ganho em linhas |
| `render-tokens` | 97 | 123 | 46% | pequeno, dá pra unificar |
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
3. **`nf-pessoa`** — 72% iguais, 1.168 linhas
4. `render-tokens` — pequeno, mas 46% já divergiu; conferir o que é real
5. Os de 11-24% (`bling`, `ml`, `magalu`) — só valem depois, e talvez nunca
   por inteiro: a diferença ali é de negócio, não de descuido

## A trava

`test/sem-copia-entre-empresas.test.js` impede **piorar**:
- o que já foi unificado não pode voltar a ter cópia
- módulo novo fora da lista de dívida conhecida acusa

Ao unificar mais um, acrescentar o nome na lista `unificados` do teste.
