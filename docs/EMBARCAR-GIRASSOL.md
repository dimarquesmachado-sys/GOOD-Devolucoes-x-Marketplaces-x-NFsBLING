# Embarcar a Girassol no Devoluções — checklist

**Estado em 05/09/2026:** as Fases 1, 2 e 3 estão prontas. O que falta é o
que depende de provisionamento — credenciais e a ficha.

> Este documento é para o dia em que for plugar. Nada aqui precisa ser feito
> agora; o sistema funciona normalmente sem a Girassol.

---

## O que já está pronto (não precisa fazer)

| peça | onde | o que faz |
|---|---|---|
| registro de empresas | `lib/empresas.js` | a ficha de cada CNPJ, com prefixo e tabelas |
| ponte registro→config | `lib/config-da-empresa.js` | monta as credenciais lendo o prefixo dela |
| os 5 módulos | `amb-devolucoes/lib-AMB/` | recebem a empresa (`.criar(cfg)`) |
| criação das tabelas | `sql/provisionar-empresa.sql` | ✅ **instalada no Supabase em 05/09** |

A função de provisionamento foi testada: criou as 5 tabelas com sufixo
`_zz9`, repetiu dizendo "ja existia", e a cópia veio com as **mesmas 40
colunas** da `devolucoes_amb`. O teste foi removido depois.

---

## Passo 1 — credenciais no Render

No serviço **good-devolucoes-x-marketplaces-x-nfsbling**, aba
**Environment**, criar com o prefixo da Girassol.

> O prefixo vai ser decidido junto com a ficha (`GIRA_` é o natural, mas
> qualquer um serve — só precisa ser o mesmo nos dois lugares).

### Bling
```
GIRA_BLING_CLIENT_ID
GIRA_BLING_CLIENT_SECRET
GIRA_BLING_ACCESS_TOKEN
GIRA_BLING_REFRESH_TOKEN
```

### Mercado Livre
```
GIRA_ML_CLIENT_ID
GIRA_ML_CLIENT_SECRET
GIRA_ML_ACCESS_TOKEN
GIRA_ML_REFRESH_TOKEN
GIRA_ML_USER_ID
```

### Magalu
```
GIRA_MAGALU_CLIENT_ID
GIRA_MAGALU_CLIENT_SECRET
GIRA_MAGALU_ACCESS_TOKEN
GIRA_MAGALU_REFRESH_TOKEN
GIRA_MAGALU_TENANT_ID
```

### Shopee
```
GIRA_SHOPEE_LOJA_KEY
```
As outras duas (`SHOPEE_PROXY_URL` e `SHOPEE_PROXY_KEY`) **já existem sem
prefixo** e valem para todas — o serviço da Shopee é um só, multi-loja.

### Supabase
**Nenhuma.** As três empresas dividem o mesmo projeto, separadas por sufixo
de tabela. O `SUPABASE_URL` e `SUPABASE_KEY` globais já atendem.

### Opcionais (têm padrão)
```
GIRA_BLING_PAUSA_MS     (padrão 700)
GIRA_ML_JANELA_DIAS     (padrão 60)
```

---

## Passo 2 — a ficha no registro

Eu escrevo em `lib/empresas.js`. Preciso de você só o prefixo escolhido e a
confirmação do nome que aparece na tela.

⚠️ **O sufixo das tabelas sai daí**, e o provisionamento lê dele — então
`devolucoes_gira` na ficha significa que serão criadas as `*_gira`.

---

## Passo 3 — as tabelas (automático)

Com a ficha no lugar e as credenciais no Render, uma chamada cria as cinco
tabelas copiando a estrutura da AMB.

Se preferir fazer pelo Supabase, é uma linha no SQL Editor:

```sql
-- ⚠️ o sufixo SAI DA FICHA, nao e escolhido aqui. Se a ficha disser
-- `devolucoes_girassol`, o comando e '_girassol'. Confira antes:
--   node -e "console.log(require('./lib/empresas').obterEmpresa('girassol').tabelas)"
select * from public.provisionar_empresa('_girassol');
```

Idempotente: rodar duas vezes não duplica nem apaga nada.

---

## Passo 4 — os ids fiscais (automático)

⚠️ Este é o passo que costumava dar mais trabalho: caçar no DevTools o id
do depósito, da natureza de operação de devolução e do "id empresa control".

`descobrirFicha` (já existe em `lib/empresas.js`) **pergunta ao Bling da
Girassol** e devolve. Só funciona depois do passo 1, porque precisa do token
dela.

---

## O que NÃO está resolvido, e vale saber antes

- **Usuários e login**: a AMB usa `AMB_USERS`. A Girassol vai precisar dos
  próprios — quem bipa, quem é admin.
- **A rota**: ⚠️ **não é uma linha.** Eu escrevi isso antes de medir, e o
  Codex me corrigiu. O `app-AMB.js` hoje monta UMA instância no
  carregamento (`configDaEmpresa('ambtotal')`) e exporta o router pronto —
  montar `/girassol` no `server.js` daria um segundo caminho para o **mesmo
  backend da AMB**, com as tabelas da AMB. Para valer, o `app-AMB` precisa
  virar função que recebe a empresa (o passo 4 da Fase 3 preparou os
  módulos, mas o router em si ainda é singleton). É um PR próprio, e o
  maior que sobrou.
- **As telas**: `public-AMB/` tem os HTMLs da AMB. A Girassol usa os mesmos
  arquivos? Se sim, eles precisam saber de qual empresa são — hoje têm um
  bloco que prefixa `/amb` em toda chamada (b329). É a última amarra
  literal que sobrou, e ainda não medi o tamanho dela.

### Medi a última (05/09), e ela é menor do que parecia

| arquivo | menções a `/amb` |
|---|---:|
| `index-AMB.html` | 4 |
| `painel-AMB.html` | 12 |
| `painel2-AMB.html` | 11 |
| `defeitos-AMB.html` | 0 |

**27 no total**, e a maior parte vem do bloco de compatibilidade do b329 —
aquele que embrulha o `fetch` e prefixa `/amb` em todo caminho `/api/`.

Ou seja: não são 27 lugares para consertar. É **um bloco** que precisa
descobrir a empresa da URL em vez de escrever `/amb` fixo. Trabalho de um
PR pequeno, não a refatoração das telas que eu temia.
