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

## ⛔ A AMB NÃO leva índice único — decisão do dono (29/08)

A AMB tem tabela própria (**`devolucoes_amb`**, mesmo projeto Supabase,
sufixo `_amb`), então o índice acima **não a alcança**. Mas ela **não deve
receber um equivalente**.

Motivo, nas palavras do dono:

> "esse pedido cai depois pro ADMIN, e lá se eu gerar NF e for duplicada,
> eu vou saber e decido o que faço, se falo com o funcionário, ou se só
> marco como concluído"

Ou seja: na AMB o filtro real acontece **na emissão da NF**, não na
triagem. O botão "🔄 Triar mesmo assim" existe de propósito — o estoquista
vê o banner vermelho, confirma, e o segundo registro é criado para o admin
decidir depois.

Um índice único quebraria isso: o banco recusaria a segunda linha e o
botão passaria a mentir, travando o estoquista no meio do turno.

**O que protege a AMB, então:**

1. **A pré-trava do bipe** (b165) — avisa antes, em vermelho, e exige
   confirmação. Cobre `shipment_id`, `order_id`, `tracking`, `nf_numero`
   e a chave da DANFE.
2. **A gravação rápida** (v4.59) — sem as consultas ao Bling no caminho, a
   janela de duplo clique caiu de ~20s para milissegundos.
3. **O olho do admin** na hora de gerar a NF.

Se um dia a decisão mudar, os comandos ficam aqui, prontos — mas leia o
parágrafo acima antes de rodar:

```sql
-- NÃO RODAR sem rever a decisão acima.
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
--   devolucoes_amb_shipment_unico ON devolucoes_amb (shipment_id)
--   WHERE shipment_id IS NOT NULL AND shipment_id <> '';
```

⚠️ E se rodar, saiba: existe um pedido real (`2000017367190752`) com
**dois shipments legítimos**, então travar por `order_id` sem condição
impediria um caso válido.

## Se precisar desfazer

```sql
DROP INDEX CONCURRENTLY IF EXISTS devolucoes_shipment_id_unico;
```
