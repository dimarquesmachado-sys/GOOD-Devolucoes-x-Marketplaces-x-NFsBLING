# Coluna `itens_devolvidos` — o que REALMENTE voltou

## O problema

Até a v4.77, a triagem gravava sempre `nf.itens[0].sku` e a quantidade
**somada** de todos os itens da nota. Numa nota com vários produtos, isso
descreve o **pedido**, não a devolução.

**Caso real** (GOOD, NF 076466, cliente Antônio): dois SKUs na mesma nota —
`KJDDE-693-8` e `KJDDE-693-6`, 2 unidades cada. Ficava gravado
`KJDDE-693-8, qtd 4`, seja qual for o item que o estoquista triou.

Isso contamina qualquer consumidor do dado: o card de estornadas não
consegue casar por item, e qualquer conta de devolução por produto sai
errada.

## O conserto

O estoquista **já bipa cada item**, e `bipagemEstado.itensEsperados[].bipados`
guarda o que ele conferiu de cada um. A partir da v4.77:

- `produto_sku` passa a ser o SKU do **primeiro item bipado**, não o primeiro
  da nota
- `produto_qtd` soma só o que foi **bipado**, não a nota inteira
- `itens_devolvidos` (novo) traz a lista completa: `[{ sku, titulo, qtd }]`

Quando a bipagem é pulada ou forçada, nada disso existe — aí cai no
comportamento antigo, que é o que dá para afirmar sem o dado.

## SQL

A coluna é opcional: sem ela, o resto continua gravando normalmente
(o Supabase ignora campo desconhecido? **não** — ele rejeita a linha).
Então rode antes de subir:

```sql
ALTER TABLE devolucoes      ADD COLUMN IF NOT EXISTS itens_devolvidos jsonb;
ALTER TABLE devolucoes_amb  ADD COLUMN IF NOT EXISTS itens_devolvidos jsonb;
```

## O que NÃO muda

Triagens antigas continuam com o dado do jeito que foi gravado. Não dá para
reconstruir o que voltou naquelas — a informação nunca existiu.
