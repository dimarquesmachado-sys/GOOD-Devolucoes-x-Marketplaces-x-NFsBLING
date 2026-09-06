-- ============================================================
-- provisionar-empresa.sql — COLE UMA VEZ no SQL Editor do Supabase
-- ------------------------------------------------------------
-- [stated 05/09] "não tem como criar automático essas tabelas supabase,
-- a partir do momento q for embarcar a empresa nova?"
--
-- Tem. Mas a chave que o sistema usa (service_role) lê e grava LINHAS —
-- ela não cria tabela, porque o PostgREST não expõe DDL. Esta função é a
-- ponte: você cola aqui uma vez, e a partir daí o sistema chama.
--
-- ============================================================
-- POR QUE COPIAR A ESTRUTURA EM VEZ DE ESCREVER À MÃO
--
-- As tabelas da AMB já existem e estão certas. `CREATE TABLE ... (LIKE x
-- INCLUDING ALL)` copia colunas, tipos, defaults, índices e constraints —
-- então a empresa nova nasce IDÊNTICA, sem risco de eu esquecer uma coluna
-- que só aparece meses depois, quando um card vier vazio.
--
-- ============================================================
-- ⚠️ A TRAVA DE SEGURANÇA — leia antes de mudar
--
-- Esta função executa DDL. Se ela aceitasse qualquer nome, um erro no meu
-- código (ou um parâmetro vindo de fora) poderia criar ou apagar coisa que
-- ninguém pediu.
--
-- Por isso ela SÓ aceita sufixo no formato `_[a-z0-9]{2,12}` e SÓ cria as
-- cinco tabelas conhecidas, copiando de moldes fixos escritos aqui dentro.
-- Não recebe nome de tabela, não recebe SQL, e não apaga nada.
-- ============================================================

create or replace function public.provisionar_empresa(sufixo text)
returns table (tabela text, resultado text)
language plpgsql
security definer
set search_path = public
as $$
declare
  moldes constant text[][] := array[
    ['devolucoes',      'devolucoes_amb'],
    ['espreita_notas',  'espreita_notas_amb'],
    ['recados',         'recados_amb'],
    ['pecas_retiradas', 'pecas_retiradas_amb'],
    ['sku_depara',      'sku_depara_amb']
  ];
  i int;
  base text;
  molde text;
  nova text;
begin
  -- ⚠️ TRAVA 1: o sufixo tem forma fixa. Sem isto, `sufixo` viraria
  -- injeção de SQL no `execute` abaixo.
  if sufixo !~ '^_[a-z0-9]{2,12}$' then
    raise exception 'sufixo invalido: use _ seguido de 2 a 12 letras/numeros minusculos (ex: _gira)';
  end if;

  -- ⚠️ TRAVA 2: não sobrescrever a AMB nem a GOOD por acidente
  if sufixo in ('_amb', '_good') then
    raise exception 'sufixo reservado: % ja pertence a uma empresa existente', sufixo;
  end if;

  for i in 1 .. array_length(moldes, 1) loop
    base  := moldes[i][1];
    molde := moldes[i][2];
    nova  := base || sufixo;

    -- o molde precisa existir; se alguem renomear a tabela da AMB, aviso
    -- em vez de criar uma tabela vazia sem estrutura
    if to_regclass('public.' || molde) is null then
      tabela := nova;
      resultado := 'ERRO: molde public.' || molde || ' nao existe';
      return next;
      continue;
    end if;

    if to_regclass('public.' || nova) is not null then
      tabela := nova;
      resultado := 'ja existia (nao mexi)';
      return next;
      continue;
    end if;

    -- INCLUDING ALL: colunas, tipos, defaults, indices, constraints,
    -- comentarios e identidade. A empresa nova nasce igual a AMB.
    execute format('create table public.%I (like public.%I including all)', nova, molde);

    -- RLS ligado e SEM politica, igual as outras: a service_role passa por
    -- cima, e ninguem mais entra — nem com a chave anon publica.
    execute format('alter table public.%I enable row level security', nova);

    tabela := nova;
    resultado := 'criada (copia de ' || molde || ')';
    return next;
  end loop;
end;
$$;

-- Quem pode chamar: apenas a service_role (a chave do servidor).
-- A chave anon, que é pública, não alcança.
revoke all on function public.provisionar_empresa(text) from public, anon, authenticated;
grant execute on function public.provisionar_empresa(text) to service_role;

-- ============================================================
-- COMO TESTAR AGORA, sem criar empresa nenhuma:
--
--   select * from public.provisionar_empresa('_zz9');
--   -- devolve 5 linhas "criada (copia de ...)"
--
--   select * from public.provisionar_empresa('_zz9');
--   -- devolve 5 linhas "ja existia (nao mexi)"  ← é idempotente
--
-- E para limpar o teste (só o teste; a função não apaga nada):
--   drop table public.devolucoes_zz9, public.espreita_notas_zz9,
--              public.recados_zz9, public.pecas_retiradas_zz9,
--              public.sku_depara_zz9;
-- ============================================================
