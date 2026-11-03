-- ============================================================
-- REGRAVAR O ROTULO LEGADO DO MERCADO LIVRE — 'mercadolivre' → 'ml'
-- (colar UMA vez no SQL Editor do Supabase do Devolucoes; idempotente)
--
-- POR QUE SO ONDE O PEDIDO PROVA: 'mercadolivre' era tambem o CHUTE
-- antigo para registro sem canal — parte deles e, na verdade, venda de
-- Amazon/Magalu/TikTok, e quem cuida deles na exibicao e o
-- corrigirMarketplaceExibido (lib/marketplace-exibido.js). Regravar as
-- cegas carimbaria esses como ML para sempre. Entao so converte onde o
-- numero do pedido casa com o padrao de ALTA confianca do detector da
-- casa (amb-devolucoes/lib-AMB/marketplace-AMB.js:47): 16 digitos
-- iniciando em 2000. O resto fica como esta, visivel certo na tela.
-- ============================================================
update public.devolucoes
   set marketplace = 'ml'
 where marketplace = 'mercadolivre'
   and order_id ~ '^2000\d{12}$';

update public.devolucoes_amb
   set marketplace = 'ml'
 where marketplace = 'mercadolivre'
   and order_id ~ '^2000\d{12}$';

update public.devolucoes_girassol
   set marketplace = 'ml'
 where marketplace = 'mercadolivre'
   and order_id ~ '^2000\d{12}$';

-- ============================================================
-- CONFERENCIA (roda junto): o que restou por rotulo, em cada tabela.
-- Esperado: a linha 'mercadolivre' some ou encolhe para os registros sem
-- pedido ML comprovado (que a tela ja corrige sozinha).
-- ============================================================
select 'devolucoes' as tabela, marketplace, count(*) as qtd
  from public.devolucoes where marketplace in ('ml','mercadolivre') group by 1, 2
union all
select 'devolucoes_amb', marketplace, count(*)
  from public.devolucoes_amb where marketplace in ('ml','mercadolivre') group by 1, 2
union all
select 'devolucoes_girassol', marketplace, count(*)
  from public.devolucoes_girassol where marketplace in ('ml','mercadolivre') group by 1, 2
 order by 1, 2;
