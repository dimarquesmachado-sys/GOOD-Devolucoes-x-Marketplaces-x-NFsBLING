# Backup e restore do Devoluções — runbook (V-04, b764)

> O que este serviço guarda que não dá pra refazer: as tabelas do Supabase (devoluções, triagens,
> espreita de notas, recados, peças retiradas, de-para de SKU, tags, ciclo de defeitos) e as fotos do
> bucket `fotos-problema`. Tudo o resto (índices do ML/Magalu, caches, tokens) se reconstrói sozinho
> ou se reautoriza.

Projeto Supabase do Devoluções: `sldnshulmhpmyjqrkstq` (as 3 empresas no mesmo projeto, tabelas por
sufixo: sem sufixo = GOOD, `_amb`, `_girassol`). Fotos: bucket `fotos-problema`, pasta por empresa
(`good/…`, `amb/…`, `girassol/…`).

## Objetivos

| | alvo | como se cumpre |
|---|---|---|
| **RPO** (quanto se pode perder) | **1 dia** nas tabelas; **0** nas fotos | backup diário do Supabase (plano) + cópia lógica diária deste runbook; fotos ficam no Storage (replicado pelo Supabase) e **não** são apagadas por nenhum fluxo do sistema |
| **RTO** (quanto tempo pra voltar) | **1 h** pra uma tabela/empresa; **meio dia** pro projeto inteiro | restore lógico por tabela (`scripts/restaurar-tabelas.js`); restore do projeto pelo painel do Supabase |

## Camada 1 — o backup do Supabase (projeto inteiro)

- Plano Pro: backup **diário** automático, guardado 7 dias; PITR (ponto no tempo) é add-on pago.
- Restaurar por lá é **tudo ou nada**: o projeto inteiro volta ao ponto escolhido — as 3 empresas, todas
  as tabelas. Serve pra desastre (projeto corrompido, tabela derrubada por DDL errado), não pra
  "voltar só a triagem X".
- Onde: Supabase → projeto → *Database* → *Backups*. Conferir **uma vez por mês** que o backup do dia
  existe (a data mais recente tem que ser hoje ou ontem).

## Camada 2 — cópia lógica por empresa e tabela (este repo)

### Diária, pelo sistema (b775)

`lib/backup-rotina.js` roda o **mesmo** `scripts/backup-tabelas.js` todo dia às **03:30 (Brasília)** — fora do
horário do galpão — e guarda o resultado no Supabase Storage, bucket **privado** `backups-privados`, pasta
`<carimbo>/<empresa>/<tabela>.jsonl.gz` + `<carimbo>/manifesto.json`. Mantém os **últimos 14 dias** e apaga os mais
velhos. Se o servidor estava fora às 03:30, roda assim que voltar (uma vez por dia, nunca duas).

- **Ver o estado / último resultado** (logado como admin no navegador):
  https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/api/admin/backup
  (também aparece em `/health` → `coordenacao.backup`). `ultimo.ok:false` + `ultimo.erro` = a rodada falhou — uma
  tabela que falha derruba a rodada inteira, nada vai pro Storage, e o dia **não** conta como feito.
- **Rodar agora** (sem Shell): a mesma URL com `?rodar=1`; recarregar sem o `?rodar=1` mostra o resultado.
- Envs (opcionais): `BACKUP_HORA` (`HH:MM`, Brasília), `BACKUP_BUCKET`, `BACKUP_RETER` (dias).
- **O que cobre:** DDL errado, delete errado, tabela derrubada — restore pelo `scripts/restaurar-tabelas.js` a partir
  do dia anterior (baixar a pasta do carimbo no painel do Supabase → Storage → `backups-privados`, descompactar os
  `.gz`). **O que não cobre:** perder o projeto do Supabase inteiro — o bucket mora nele; isso é a camada 1.

### À mão (Shell do Render ou máquina do dono)

`scripts/backup-tabelas.js` lê cada tabela de cada empresa **página a página** (`lib/ler-tudo.js`,
nunca só as 1000 primeiras) e grava um `.jsonl` por tabela + `manifesto.json` (contagens, tempo,
erros). Precisa das mesmas envs do servidor (`<PREFIXO>SUPABASE_URL`/`_KEY` — service key; a GOOD
aceita `SUPABASE_URL`/`SUPABASE_KEY`).

```bash
node scripts/backup-tabelas.js                                  # as 3 empresas
node scripts/backup-tabelas.js --empresas=girassol --saida=/tmp/bk
```

- Tabela que falha **não vira arquivo vazio**: entra no manifesto como erro e o processo termina ≠ 0.
- Cada rodada ganha **pasta própria** (carimbo com segundos; se já existir, `-2`, `-3`…) — nunca mistura
  arquivos de tempos diferentes. `--pagina` vai no máximo a 1000 (teto do PostgREST; acima disso o
  backup sairia truncado em silêncio — o script recusa).
- Credenciais como o servidor resolve: `<PREFIXO>SUPABASE_URL/KEY` e, sem elas, as globais
  `SUPABASE_URL/KEY` (hoje as 3 empresas dividem o projeto).
- As tabelas são as da ficha (`lib/empresas.js` → `tabelas`) + `defeito_pedidos`/`defeito_comentarios`
  do mesmo sufixo. Empresa nova entra sozinha (lê a ficha).
- Onde guardar: fora do Render e fora do Supabase — a pasta `backups/` local da máquina do dono ou um
  Drive. **Não** versionar no Git (tem dado de cliente).
- Ritmo: diário é o alvo; até ter agendamento, rodar à mão **antes de qualquer DDL** (H-03, P2-09) e
  antes do corte da fusão (01/01/2027).

## Restore lógico

`scripts/restaurar-tabelas.js` lê a pasta de UMA empresa do backup, **na ordem das dependências**
(`devolucoes` e `tags` antes de `devolucao_tags`; `defeito_pedidos` antes de `defeito_comentarios` — as FKs
do provisionador rejeitariam o filho antes do pai), e faz **upsert em lotes de 500 pela chave da tabela** (`id` na
maioria; `espreita_notas` por `chave`, `sku_depara` por `sku_antigo`, `devolucao_tags` por `devolucao_id`+`tag_id`): linha que existe é sobrescrita pelo backup, linha que não existe é criada, e o que está no
banco e não no backup **fica** (restaurar não apaga — apagar é decisão humana, antes, no SQL Editor).

```bash
node scripts/restaurar-tabelas.js --pasta=backups/2026-11-18T12-00/girassol --ensaio=1   # só conta, não grava
node scripts/restaurar-tabelas.js --pasta=backups/2026-11-18T12-00/girassol --tabelas=recados_girassol
```

Tabela pedida em `--tabelas=` que **não está no backup** (a rodada falhou nela) é erro, não silêncio.

Ordem pra voltar uma tabela inteira a um ponto no tempo:
1. `--ensaio=1` e conferir as contagens contra o manifesto;
2. no SQL Editor, `delete from <tabela> where …` só do que precisa sair (ou `truncate` se for tudo);
3. restore sem `--ensaio`; conferir `[restaurar] 0 erro(s)`;
4. abrir o painel da empresa e conferir 2–3 registros conhecidos.

## Fotos (Storage)

- Nenhum fluxo do sistema apaga foto; o bucket é público de leitura (o proxy `/api/admin/foto/...`
  confere a dona antes de servir). O Supabase replica o Storage — não há cópia local de rotina.
- Cópia manual, se precisar: painel do Supabase → *Storage* → `fotos-problema` → pasta da empresa →
  download; ou o botão "baixar todas as fotos" da ficha de defeito (P2-11), uma devolução por vez.
- Restore de foto apagada por engano: re-upload na mesma chave (`<empresa>/<arquivo>`); a URL gravada
  em `problema_fotos` volta a resolver.

## Ensaio registrado

- **18/11/2026 (b764)** — ensaio automatizado em `test/backup-restore-ensaio.test.js`, pelo protocolo
  real (supabase-js → PostgREST) contra um banco descartável: backup das 3 empresas (27 tabelas), tabela
  de 7 linhas com página de 3 sai inteira e em ordem, tabela que falha vira erro no manifesto (sem
  arquivo vazio), restore num banco vazio devolve as 7 linhas em 3 lotes sem apagar o que já existia,
  `--ensaio=1` não toca o banco, repetir o restore não duplica, `devolucao_tags` entra depois de `devolucoes`/`tags`
  contra FKs de verdade no banco descartável, tabela pedida sem arquivo é erro, pasta única por rodada,
  página > 1000 recusada, credenciais globais aceitas. Roda na bateria (`node verifica.js`).
- **20/11/2026 (b774) — ensaio contra o PROJETO REAL**, pelo Shell do Render (serviço
  `good-devolucoes-x-marketplaces-x-nfsbling`, `node scripts/backup-tabelas.js --saida=/tmp/bk`): 20 de 27
  tabelas saíram; **7 falharam** com `column X.id does not exist` — `espreita_notas` (a da GOOD), `sku_depara` e
  `devolucao_tags` (as 3 empresas) **não têm coluna `id`**. O ensaio existia exatamente pra isso. Conserto no
  b774: cada tabela ordena/restaura pela **própria chave** (`chaveDaTabela` em `scripts/backup-tabelas.js`:
  `espreita_notas` → `chave`, `sku_depara` → `sku_antigo`, `devolucao_tags` → `devolucao_id`+`tag_id`; o resto
  `id` — as mesmas chaves que o código usa no upsert), e o ensaio automatizado passou a ter tabelas sem `id`.
  Contagens vistas (20/11 14:24 UTC): GOOD `devolucoes` 555, `recados` 11; AMB `devolucoes_amb` 16,
  `recados_amb` 14, `pecas_retiradas_amb` 2, `defeito_pedidos_amb` 3, `defeito_comentarios_amb` 19; Girassol
  `devolucoes_girassol` 141, `recados_girassol` 1. Tempo total ≈ 10 s.
- **Pendente (dono):** repetir o ensaio depois do b774 (tem que sair `0 erro(s)` e 27 tabelas), conferir 2–3
  contagens contra o painel do Supabase e um restore `--ensaio=1`.

## O que ainda falta (decisões do dono)

- ~~Agendar o backup lógico e definir onde a pasta fica~~ — feito no b775 (diário, 03:30, Storage privado, 14 dias).
- Uma cópia **fora** do projeto do Supabase (Drive do dono, outro bucket) — hoje o diário mora no mesmo projeto.
- PITR no Supabase, se o RPO de 1 dia for pouco pra triagem (cada hora de operação = dezenas de
  triagens que não se refazem).
