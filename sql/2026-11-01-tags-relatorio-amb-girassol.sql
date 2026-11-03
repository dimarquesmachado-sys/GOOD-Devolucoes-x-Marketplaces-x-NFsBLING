-- ============================================================
-- 2026-11-01-tags-relatorio-amb-girassol.sql
-- COLE UMA VEZ no SQL Editor do Supabase (projeto do Devolucoes)
-- ------------------------------------------------------------
-- b651 — o RELATORIO de devolucoes chegou na AMB e na Girassol (antes so a
-- GOOD tinha). O relatorio usa tags, e tags vivem em DUAS tabelas por
-- empresa: `tags_X` (nome, cor) e `devolucao_tags_X` (vinculo N:N com as
-- devolucoes). A GOOD ja tem as dela ('tags' e 'devolucao_tags'); este
-- script cria as da AMB e as da Girassol ESPELHANDO as da GOOD:
--
--   `LIKE ... INCLUDING ALL` copia colunas, tipos, defaults, indices e
--   constraints locais (o unique do nome, que da o erro "ja existe tag"),
--   entao as novas nascem identicas sem ninguem redigitar coluna.
--
-- ⚠️ O QUE O LIKE NAO COPIA: foreign key. E o relatorio DEPENDE delas —
-- o PostgREST so monta o embed devolucao_tags -> tags (e -> devolucoes)
-- enxergando a FK no catalogo. Por isso elas sao criadas explicitamente
-- abaixo, com os mesmos nomes padronizados que o provisionador de empresa
-- nova usa (sql/provisionar-empresa.sql, versao b651).
--
-- E idempotente: rodar de novo nao mexe no que ja existe.
-- ============================================================

do $$
declare
  sufixo text;
  par text[];
  nova text;
begin
  -- os moldes da GOOD precisam existir; sem eles, parar AVISANDO
  if to_regclass('public.tags') is null or to_regclass('public.devolucao_tags') is null then
    raise exception 'moldes da GOOD (public.tags / public.devolucao_tags) nao encontrados — nada foi criado';
  end if;

  foreach sufixo in array array['_amb', '_girassol'] loop
    foreach par slice 1 in array array[['tags'], ['devolucao_tags']] loop
      nova := par[1] || sufixo;
      if to_regclass('public.' || nova) is not null then
        raise notice '% ja existia (nao mexi)', nova;
      else
        execute format('create table public.%I (like public.%I including all)', nova, par[1]);
        -- RLS ligado e SEM politica, igual as demais tabelas por empresa:
        -- a service_role (chave do servidor) passa; a anon publica nao entra.
        execute format('alter table public.%I enable row level security', nova);
        raise notice '% criada (copia de %)', nova, par[1];
      end if;
    end loop;

    -- as FOREIGN KEYS do embed (ver cabecalho). on delete cascade:
    --   - apagar uma TAG some com os vinculos dela (o codigo do relatorio
    --     ja conta com isso: "Cascade vai apagar de devolucao_tags");
    --   - apagar uma DEVOLUCAO some com os vinculos dela (vinculo sem a
    --     devolucao nao significa nada).
    if not exists (select 1 from pg_constraint
                   where conname = 'devolucao_tags' || sufixo || '_tag_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (tag_id) references public.%I (id) on delete cascade',
        'devolucao_tags' || sufixo, 'devolucao_tags' || sufixo || '_tag_id_fkey', 'tags' || sufixo);
      raise notice 'FK % -> % criada', 'devolucao_tags' || sufixo || '.tag_id', 'tags' || sufixo;
    end if;
    if not exists (select 1 from pg_constraint
                   where conname = 'devolucao_tags' || sufixo || '_devolucao_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (devolucao_id) references public.%I (id) on delete cascade',
        'devolucao_tags' || sufixo, 'devolucao_tags' || sufixo || '_devolucao_id_fkey', 'devolucoes' || sufixo);
      raise notice 'FK % -> % criada', 'devolucao_tags' || sufixo || '.devolucao_id', 'devolucoes' || sufixo;
    end if;
  end loop;
end
$$;

-- ============================================================
-- COMO CONFERIR (mesmo editor, depois de rodar):
--
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('tags_amb','devolucao_tags_amb',
--                         'tags_girassol','devolucao_tags_girassol')
--    order by table_name;
--   -- deve devolver as 4 linhas
--
-- Depois disso, o relatorio da AMB e o da Girassol passam a responder:
--   https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/amb/admin/relatorios.html
--   https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/girassol/admin/relatorios.html
-- (logado como admin da empresa, no navegador dela)
-- ============================================================
