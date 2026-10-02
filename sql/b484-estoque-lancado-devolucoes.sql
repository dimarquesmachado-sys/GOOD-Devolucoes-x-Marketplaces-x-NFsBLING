-- b484 - "Lançar no estoque" da devolução do FULL (GOOD).
-- ⚠️ ORDEM DE DEPLOY: rode ESTE SQL no Supabase da GOOD ANTES (ou junto) de publicar o código.
-- Sem as colunas a rota POST /api/admin/full-lancar-estoque/:id responde 503 (de propósito:
-- sem rastro durável um 2º clique dobraria o estoque). Idempotente — pode rodar mais de uma vez.
-- Para a AMB use o mesmo comando em public.devolucoes_amb.
alter table public.devolucoes
  add column if not exists estoque_lancado_em timestamptz,
  add column if not exists estoque_deposito text;
