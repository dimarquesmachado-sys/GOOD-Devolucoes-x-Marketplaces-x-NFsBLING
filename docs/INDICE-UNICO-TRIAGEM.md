# Índice único na triagem — o que rodar no Supabase

**Status:** o código já trata a recusa do banco (erro `23505` → resposta
"esta devolução já foi triada antes"). Falta criar o índice, que é um
comando SQL manual no Supabase.

## Por que

A checagem de duplicata em JavaScript **consulta e depois insere**. Entre
uma coisa e outra existe uma janela — e em 29/08 ela produziu duas
triagens do mesmo `shipment_id` (`47501559178`, cliente Luciene), com dois
minutos de diferença.

A v4.59 encurtou muito essa janela: as consultas ao Bling saíram do
caminho, então o intervalo entre checar e gravar caiu de até 20 segundos
para milissegundos. **Mas encurtar não é fechar.** Duas requisições
realmente simultâneas ainda passam pelas duas.

O único lugar onde isso não tem como escapar é o banco.

## O comando

Rode no **SQL Editor** do Supabase, uma vez:

```sql
-- 1) Antes de criar o índice, veja se já existe duplicata.
--    Se houver, o CREATE INDEX abaixo falha — e é bom que falhe,
--    porque apagar registro é decisão sua, não do script.
SELECT shipment_id, COUNT(*) AS vezes,
       MIN(created_at) AS primeira, MAX(created_at) AS ultima
  FROM devolucoes
 WHERE shipment_id IS NOT NULL AND shipment_id <> ''
 GROUP BY shipment_id
HAVING COUNT(*) > 1
 ORDER BY vezes DESC;

-- 2) Com a lista limpa, crie o índice.
--    CONCURRENTLY = não trava a tabela enquanto cria.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  devolucoes_shipment_id_unico
  ON devolucoes (shipment_id)
  WHERE shipment_id IS NOT NULL AND shipment_id <> '';
```

O `WHERE` no fim importa: registros sem `shipment_id` (que existem — o
campo é preenchido em cascata com chave da NF ou protocolo Magalu) ficam
de fora da regra, em vez de colidirem entre si.

## Depois de criar

Nada a fazer no código. A rota já responde certo quando o banco recusa.

Para conferir que pegou, tente triar duas vezes o mesmo pacote: a segunda
deve dizer "esta devolução já foi triada antes", como sempre disse — só
que agora sem depender de temporização.

## Se precisar desfazer

```sql
DROP INDEX CONCURRENTLY IF EXISTS devolucoes_shipment_id_unico;
```
