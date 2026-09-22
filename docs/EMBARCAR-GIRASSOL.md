# Embarcar a Girassol no Devoluções — checklist

> ## ESTADO REAL EM 22/09/2026 — LEIA ANTES DE USAR ESTE CHECKLIST
>
> **O código está pronto. Falta configuração.**
>
> Este aviso já esteve errado duas vezes, nas duas direções: primeiro dizia
> "só faltam credenciais" quando o app ainda era um singleton da AMB; depois
> dizia que o app era singleton, quando já tinha virado fábrica. Documento
> que não acompanha o código é pior que documento nenhum — quem o lê age.
>
> ### O que o código já faz
>
> - `app-AMB.js` é uma **fábrica**: `criar(empresa)` devolve uma instância
>   própria, com suas gavetas, sessões e caches
> - o bootstrap monta **todas as empresas ativas** do `contrato-empresas.json`
> - nada está cravado na AMB — nem env, nem tabela, nem cliente, nem rota,
>   nem no front
> - a ficha da Girassol **existe** em `lib/empresas.js` (e é testada)
>
> **Prova disso:** `test/duas-empresas-juntas.test.js` monta duas empresas
> diferentes no mesmo processo e verifica que sessão, cache, tabela e fila não
> se cruzam. Se alguém reintroduzir qualquer forma de vazamento, ele acusa e
> nomeia.
>
> ### O que falta, e é tudo configuração
>
> Rode isto para ver a lista atualizada — não confie nesta página:
>
> ```
> node -e "console.log(require('./lib/empresas').conferirEmpresa('girassol'))"
> ```
>
> Em 22/09 ele responde: **10 envs** `GIRASSOL_*` (Bling, ML, USERS,
> SESSION_SECRET, Supabase) e **3 campos fiscais** (`idEmpresaControl`,
> `depositoGeral`, `naturezasDevolucaoIds`).
>
> ### ⚠️ Três armadilhas conhecidas
>
> **1. O `GIRASSOL_SESSION_SECRET` derruba o boot, não só avisa.** Em 18/09 o
> deploy da AMB falhou 3× por falta do equivalente dela, e o serviço ficou 7
> versões atrasado sem ninguém notar. Crie essa env junto com as outras.
>
> **2. A rotina `provisionar_empresa` no Supabase pode ser a ANTIGA**, de 5
> tabelas — o ciclo de defeitos precisa de 7. Cole
> `sql/provisionar-empresa.sql` no SQL Editor antes de provisionar. O
> `lib/provisionar-empresa.js` confere e avisa se faltarem, em vez de dizer
> "ok" e a tela quebrar depois.
>
> **3. A PWA precisa de manifest próprio.** O `manifest-AMB.json` é da AMB de
> propósito (nome, descrição, escopo). Sem um para a Girassol, as duas se
> instalam como o MESMO app no celular e uma sobrescreve a outra.
>
> ### E a ordem
>
> A empresa só monta quando `ativa_em.devolucoes` virar `true` no
> `contrato-empresas.json`. **Esse é o último passo**, depois das envs, das
> tabelas e dos ids fiscais — não o primeiro.

### Bling
```
GIRASSOL_BLING_CLIENT_ID
GIRASSOL_BLING_CLIENT_SECRET
GIRASSOL_BLING_ACCESS_TOKEN
GIRASSOL_BLING_REFRESH_TOKEN
```

### Mercado Livre
```
GIRASSOL_ML_CLIENT_ID
GIRASSOL_ML_CLIENT_SECRET
GIRASSOL_ML_ACCESS_TOKEN
GIRASSOL_ML_REFRESH_TOKEN
GIRASSOL_ML_USER_ID
```

### Magalu
```
GIRASSOL_MAGALU_CLIENT_ID
GIRASSOL_MAGALU_CLIENT_SECRET
GIRASSOL_MAGALU_ACCESS_TOKEN
GIRASSOL_MAGALU_REFRESH_TOKEN
GIRASSOL_MAGALU_TENANT_ID
```

### Shopee
```
GIRASSOL_SHOPEE_LOJA_KEY
```
As outras duas (`SHOPEE_PROXY_URL` e `SHOPEE_PROXY_KEY`) **já existem sem
prefixo** e valem para todas — o serviço da Shopee é um só, multi-loja.

### Supabase
**Nenhuma.** As três empresas dividem o mesmo projeto, separadas por sufixo
de tabela. O `SUPABASE_URL` e `SUPABASE_KEY` globais já atendem.

### Opcionais (têm padrão)
```
GIRASSOL_BLING_PAUSA_MS     (padrão 700)
GIRASSOL_ML_JANELA_DIAS     (padrão 60)
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
