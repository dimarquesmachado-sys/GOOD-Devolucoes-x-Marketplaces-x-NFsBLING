# Devoluções capturadas — a tabela e o cron noturno

**Ideia do dono (29/08):** varrer os marketplaces de madrugada e **guardar**
o que vier. Como a devolução leva mais de um dia para chegar ao galpão, o
dado já está aqui quando o pacote bate na bancada.

> "tinha q ter um cron a meia noite pra pegar esses dados previamente, até
> pq a devolução sempre demora mais q 1 dia pra chegar até nós"

## O problema que isso resolve

Hoje **nada persiste**. O espreita já varre ML, Shopee e Magalu, mas
remonta tudo do zero a cada 3 minutos e vive só em memória — reiniciou,
perdeu. Consequências que já custaram caro:

1. **Devolução some.** Quando o marketplace para de devolvê-la — saiu da
   janela, mudou de status, a rota quebrou — ela desaparece como se nunca
   tivesse existido. Foi o que aconteceu em 29/08 com a Shopee.
2. **A bancada espera.** Bipar consulta o marketplace na hora. Com o dado
   local, a resposta é imediata.
3. **Não dá para olhar para trás.** "Quantas devoluções por motivo no
   trimestre" é uma pergunta que hoje não tem resposta.

## Decisões tomadas

| | |
|---|---|
| o que guardar | **retrato inteiro** — identificadores, cliente, produto, status, motivo, valores, datas **e o JSON cru** |
| janela | **180 dias** |
| custo | ~3,5 KB por devolução → **~25 MB/ano** no pior cenário (600/mês). O plano free do Supabase dá 500 MB |

O JSON cru é ~70% do peso. Se um dia apertar, apagar o cru dos registros
antigos derruba para menos de 1 KB por linha — mas isso é conversa para
daqui a anos.

## O SQL

Roda no projeto **`sldnshulmhpmyjqrkstq`** (o `good-devolucoes`).

```sql
CREATE TABLE IF NOT EXISTS devolucoes_capturadas (
  id               bigserial PRIMARY KEY,

  -- de quem e de onde
  empresa          text NOT NULL,          -- 'good' | 'amb' | 'girassol'
  marketplace      text NOT NULL,          -- 'ml' | 'shopee' | 'magalu' | 'tiktok'

  -- identificadores: e por estes que o bipe procura
  chave_marketplace text NOT NULL,         -- o id da devolucao NO marketplace
  pedido            text,                  -- order_id / order_sn / pedido
  pack              text,                  -- amarra ida e volta (ML)
  shipment          text,
  rastreio          text,                  -- inclusive o da reversa
  nf_numero         text,
  nf_chave          text,

  -- o retrato
  cliente_nome     text,
  produto_sku      text,
  produto_titulo   text,
  produto_qtd      integer,
  status           text,                   -- como o marketplace chama
  tipo_tiktok      text,                   -- REFUND | RETURN_AND_REFUND (só TikTok)
  motivo           text,
  motivo_texto     text,                   -- o que o cliente escreveu
  valor_refund     numeric(12,2),
  criado_no_mkt    timestamptz,            -- quando a devolucao nasceu la
  atualizado_no_mkt timestamptz,

  -- o cru, pra nao perder nada que ainda nao mapeamos
  cru              jsonb,

  -- controle nosso
  capturado_em     timestamptz NOT NULL DEFAULT now(),
  visto_por_ultimo timestamptz NOT NULL DEFAULT now()
);

-- uma linha por devolucao de cada marketplace/empresa.
-- O cron faz upsert por esta chave: re-capturar ATUALIZA, nao duplica.
CREATE UNIQUE INDEX IF NOT EXISTS devolucoes_capturadas_unica
  ON devolucoes_capturadas (empresa, marketplace, chave_marketplace);

-- os caminhos que o bipe usa. Parciais: so indexam quem tem o campo.
CREATE INDEX IF NOT EXISTS devcap_pedido   ON devolucoes_capturadas (pedido)   WHERE pedido   IS NOT NULL;
CREATE INDEX IF NOT EXISTS devcap_pack     ON devolucoes_capturadas (pack)     WHERE pack     IS NOT NULL;
CREATE INDEX IF NOT EXISTS devcap_shipment ON devolucoes_capturadas (shipment) WHERE shipment IS NOT NULL;
CREATE INDEX IF NOT EXISTS devcap_rastreio ON devolucoes_capturadas (rastreio) WHERE rastreio IS NOT NULL;
CREATE INDEX IF NOT EXISTS devcap_nf       ON devolucoes_capturadas (nf_numero) WHERE nf_numero IS NOT NULL;

-- pra listar o recente por empresa
CREATE INDEX IF NOT EXISTS devcap_recentes
  ON devolucoes_capturadas (empresa, criado_no_mkt DESC);

-- o painel de estornadas sem retorno filtra por empresa + tipo + data
CREATE INDEX IF NOT EXISTS devcap_sem_retorno
  ON devolucoes_capturadas (empresa, tipo_tiktok, criado_no_mkt DESC)
  WHERE tipo_tiktok IS NOT NULL;
```

## ⚠️ Se a tabela JÁ existe (criada antes de 30/08)

A coluna `tipo_tiktok` e o índice acima vieram depois. Rode:

```sql
ALTER TABLE devolucoes_capturadas ADD COLUMN IF NOT EXISTS tipo_tiktok text;

CREATE INDEX IF NOT EXISTS devcap_sem_retorno
  ON devolucoes_capturadas (empresa, tipo_tiktok, criado_no_mkt DESC)
  WHERE tipo_tiktok IS NOT NULL;
```

Sem a coluna, o painel de **estornadas sem retorno** fica vazio — é por ela
que ele separa reembolso puro de devolução com retorno.

### Por que uma tabela só, e não uma por empresa

As de triagem são separadas (`devolucoes` e `devolucoes_amb`) porque são
**dados fiscais** de CNPJs diferentes. Esta é **espelho do marketplace** —
não gera nota, não vira imposto. Uma tabela com coluna `empresa` evita
criar mais duas a cada empresa nova, que é justamente a dívida que encarece
a Girassol.

### Por que `upsert` e não `insert`

O cron roda toda noite e a mesma devolução aparece em várias madrugadas até
ser resolvida. O upsert atualiza o status e o `visto_por_ultimo`, mantendo
uma linha só. E o `visto_por_ultimo` conta uma história útil: quando ele
para de avançar, o marketplace deixou de listar aquela devolução — mas ela
continua aqui.

## O que ainda NÃO está feito

Este documento é o esquema. Falta:

1. o módulo que traduz cada marketplace para este formato
2. o cron noturno chamando os quatro
3. o bipe consultando aqui **antes** de ir ao marketplace

O TikTok entra quando o Mover-Pedidos expuser as rotas de devolução
(`/tiktok/devolucoes-cru` e `/tiktok/devolucoes-coletar`), que hoje não
existem — a coluna `marketplace` já o prevê.
