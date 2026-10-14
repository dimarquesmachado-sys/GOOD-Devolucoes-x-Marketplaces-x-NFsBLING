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

## Atualização — 14/10/2026 (o que mudou desde a medição de 04/09)

| peça | situação hoje |
|---|---|
| `magalu` | ✅ **peça única** (#461/#462, 07/10) — `amb-devolucoes/lib-AMB/magalu-AMB.js` serve as 3 |
| índice de nomes das NFs | ✅ **peça única** — `amb-devolucoes/lib-AMB/nf-nomes-AMB.js` |
| painel de devoluções | ✅ **peça única** — `painel-AMB.html`; a GOOD recebe o mesmo montado pra ela (`lib/painel-unico.js`, #487) |
| logo e ícone por empresa | ✅ **peça multiloja** — `lib/marca-empresa.js` + `marca` na ficha (#490/#492) |
| ficha de defeitos (tela) | ✅ **peça única nas três empresas** — `js-AMB/defeitos-ficha.js` (#493/#495) |
| porteiro da cota do Bling | ✅ por conta (`lib/ritmo-porteiro.js` → `criarPorteiro({ conta })`) |
| `defeitos-ciclo` (servidor) | ✅ **peça única nas três empresas** — `lib/defeitos-ciclo.js`; diferenças de schema declaradas em `defeitos` na ficha |
| `ml` / `ml-returns` · `bling` | ⏸ duas cópias por decisão — a GOOD tem dono de token próprio e as duas divergem nos dois sentidos |

**Para um CNPJ novo nada disso trava:** ele entra pela fábrica (`amb-devolucoes/`), a mesma da Girassol e da AMB —
`node scripts/nova-empresa.js <chave> "<Nome>"` gera a ficha (agora já com `tema`, `marca` e modelo de `defeitos`), o contrato e a lista de
envs; `conferirEmpresa('<chave>')` diz o que falta (e, desde 14/10, **avisa** se a empresa vai sair com as cores ou o
logo da AMB).

O ciclo comum recebe da instância seu banco, autenticação, Bling e depósito Geral. A ficha define tabelas,
coluna de data, condição de ativos e formato de exclusão/restauração. Comentários e pedidos usam o sufixo
da tabela de devoluções registrada. A trava fiscal de ativos da GOOD continua no modelo dela.

As contagens sem busca textual usam o banco, incluindo pedidos antigos em lotes de até 150 IDs; a busca
textual mantém o orçamento limitado anterior. Os testes executam o servidor comum nas três empresas,
montam a fábrica real para Girassol/AMBTotal e impedem recriar `defeitos-ciclo-AMB.js`.
