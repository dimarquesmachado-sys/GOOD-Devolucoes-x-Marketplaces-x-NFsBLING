-- b713 (15/11/2026) — P1-03 do docs/ROTEIRO-LIQUIDACAO-2026-11.md (auditoria do Codex).
--
-- A entrada no Bling de uma peca RECUPERADA (autorizar no ciclo de defeitos, ou o botao de relancar) passa a ter
-- um MARCADOR DURAVEL antes do efeito externo — o mesmo desenho do FULL (sql/2026-10-02-estoque-lancado.sql):
--   'LANCANDO <marca>'  = reserva: alguem esta lancando agora (ou a chamada ficou sem resposta — INCERTO)
--   'LANCADO <marca>'   = o Bling confirmou e o pedido ja tem estoque_produto_id
--   null                = nada em andamento; pode lancar
-- Sem a coluna, as rotas se RECUSAM a lancar (503 com este SQL): sem rastro duravel nao ha como impedir que uma
-- repeticao, um duplo clique ou uma resposta perdida dobrem o estoque.
--
-- Rodar no Supabase do Devolucoes (projeto sldnshulmhpmyjqrkstq) > SQL Editor. Empresa nova: o
-- provisionar-empresa.sql cria defeito_pedidos_<sufixo> como copia (LIKE) da tabela da AMB — que ja tera a coluna.
alter table if exists public.defeito_pedidos          add column if not exists estoque_operacao text;
alter table if exists public.defeito_pedidos_amb      add column if not exists estoque_operacao text;
alter table if exists public.defeito_pedidos_girassol add column if not exists estoque_operacao text;
notify pgrst, 'reload schema';
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public' and column_name = 'estoque_operacao' and table_name like 'defeito_pedidos%'
 order by table_name;
