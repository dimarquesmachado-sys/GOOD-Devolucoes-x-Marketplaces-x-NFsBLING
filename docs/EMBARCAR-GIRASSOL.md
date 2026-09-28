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
> - env, tabela, cliente e rota vêm da ficha — nada disso está cravado na AMB
> - a ficha da Girassol **existe** em `lib/empresas.js` (e é testada)
>
> **Prova disso:** `test/duas-empresas-juntas.test.js` monta duas empresas
> diferentes no mesmo processo e verifica que sessão, cache, tabela e fila não
> se cruzam. Se alguém reintroduzir qualquer forma de vazamento, ele acusa e
> nomeia.
>
> ### ⚠️ Isto NÃO é tudo configuração — 2 pontos do FRONT ainda citam a AMB
>
> Apontado pelo Codex em 22/09: mesmo com a fábrica pronta, dois fluxos ainda
> escrevem "AMBTotal" (ou envs `AMB_*`) fixos, sem olhar a empresa logada.
> Ativar a Girassol com eles assim manda o operador para a conta ou os
> pedidos ERRADOS — não é só falta de configuração, precisa de código:
>
> - **Links de pedido no painel** (`app-AMB.js` em `link_marketplace`, e o
>   mesmo em `lib-AMB/identificar-AMB.js`): Shopee e Magalu abrem via
>   `mover-pedidos-aguardando-x-atendido.onrender.com/amb-checkout-offline/...`
>   e `.../magalu/ir/amb` — caminhos fixos da AMB nesse serviço EXTERNO (fora
>   deste repo). Sem um equivalente lá para a Girassol, o clique cai na conta
>   errada ou não acha o pedido.
> - **Telas de conexão** (`/conectar`, `/oauth/iniciar`, `/oauth/callback` em
>   `app-AMB.js`): título, textos de aviso e as mensagens de credencial
>   faltando citam "AMBTotal" e as envs `AMB_BLING_*`/`AMB_ML_*`/
>   `AMB_MAGALU_TENANT_ID` peladas, mesmo quando a instância é da Girassol —
>   quem seguir a tela pode autorizar a conta errada ou nunca achar a env
>   `GIRASSOL_*` que precisa configurar.
>
> **Mantenha `ativa_em.devolucoes: false` para a Girassol até esses dois
> pontos virarem PR** — o resto do checklist (envs, tabelas, ids fiscais) pode
> ser preparado antes, mas a ativação real depende disso.
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
> **3. ~~A PWA precisa de manifest próprio~~ — não precisa mais.** A rota
> `GET /manifest-AMB.json` (em `app-AMB.js`) já serve `id`, `name`,
> `short_name`, `description`, `start_url` e `scope` calculados pela empresa
> da instância (`FICHA_AMB.nome` e a base do router); não existe (nem deve
> ser criado) um arquivo de manifest separado para a Girassol.
>
> ### E a ordem
>
> A empresa só monta quando `ativa_em.devolucoes` virar `true` no
> `contrato-empresas.json`. **Esse é o último passo**, depois das envs, das
> tabelas e dos ids fiscais — não o primeiro.

### 📌 Antes de ativar: rode a sonda

```
node scripts/sonda-empresa.js girassol
```

Ela confere se **funciona**, não se está escrito — que é a diferença que já
mordeu duas vezes aqui (a rotina de tabelas era a antiga; a pasta do checkout
tinha outro nome).

| confere | o quê |
|---|---|
| ficha | envs e campos fiscais, com o comando que resolve |
| política de token | os eixos, e avisa se ninguém está em `remoto` |
| o dono | se ele **entrega** o token de verdade |
| Supabase | se as tabelas respondem (com `limit=0`, sem ler dado) |
| estado | se a empresa ainda está desativada, como deve estar |

⚠️ **Só leitura.** Não emite, não grava, não renova — uma renovação "só para
testar" queimaria o refresh de uso único do dono.

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

> ⚠️ Esta seção falava de um `app-AMB.js` singleton e de um bloco que
> prefixava `/amb` fixo no front. As duas coisas já foram resolvidas (a
> fábrica `criar(empresa)` e o front por URL, ver "O que o código já faz" no
> topo) — apontado pelo Codex em 22/09 porque a versão antiga deste texto
> ainda dizia o contrário e contradizia o restante do documento.
>
> O que falta de verdade é o que está descrito acima, em
> "⚠️ Isto NÃO é tudo configuração": links de pedido Shopee/Magalu e as
> telas de conexão/OAuth ainda citam a AMB.

- **Usuários e login**: a AMB usa `AMB_USERS`. A Girassol vai precisar dos
  próprios — quem bipa, quem é admin.
