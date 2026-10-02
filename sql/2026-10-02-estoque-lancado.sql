-- b482-b485 (02/10/2026): o botao "Lancar no estoque" da devolucao do FULL registra no card
-- QUANDO e ONDE lancou — e e esse registro que impede lancar 2x (reserva atomica na rota
-- /api/admin/full-lancar-estoque/:id). Sem as colunas, a rota se RECUSA a lancar (503 com este SQL).
-- ✅ APLICADO EM PRODUCAO pelo dono em 02/10/2026 (Supabase > SQL Editor: "Success. No rows returned.").
-- Empresa nova: o provisionar-empresa.sql cria as tabelas como copia (LIKE) das da AMB, que ja
-- tem as colunas — nao precisa rodar de novo.
alter table if exists public.devolucoes_amb      add column if not exists estoque_lancado_em timestamptz, add column if not exists estoque_deposito text;
alter table if exists public.devolucoes_girassol add column if not exists estoque_lancado_em timestamptz, add column if not exists estoque_deposito text;
alter table if exists public.devolucoes          add column if not exists estoque_lancado_em timestamptz, add column if not exists estoque_deposito text;
