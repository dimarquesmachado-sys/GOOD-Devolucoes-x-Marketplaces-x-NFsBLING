# Estado do multiloja — o que está fechado e o que falta

**Conferido em 22/09/2026**, por varredura no código, não de memória.

> ⚠️ Um documento anterior (`RETOMADA-MULTILOJA.md`, proposto em 17/09) nunca
> entrou na main — a análise ficou só no chat, e cinco dias depois alguém a
> leu como se fosse o estado atual. Os três bloqueadores que ela listava já
> estavam fechados.
>
> **Por isso este arquivo diz COMO MEDIR, não só o que é verdade hoje.**
> Documento que não acompanha o código vira armadilha: quem lê, age.

## Como medir, em vez de confiar nesta página

```
node verifica.js                                   # 107 testes + boot real
node test/duas-empresas-juntas.test.js             # o isolamento, e o que falta
node -e "console.log(require('./lib/empresas').conferirEmpresa('girassol'))"
```

O `duas-empresas-juntas` monta **duas empresas diferentes** no mesmo processo e
prova que sessão, cache, tabela e fila não se cruzam. Ele também **lista** o que
ainda estiver cravado na AMB, em cada forma conhecida.

## O que está fechado no código

As **seis formas de vazamento** que apareceram ao longo do trabalho, todas com
varredura em zero e teste que acusa a volta:

| forma | como se resolve hoje |
|---|---|
| env `AMB_*` | prefixo da ficha (`PREFIXO_ENV`) |
| tabela `*_amb` | sufixo derivado de `tabelas.devolucoes` |
| `config-AMB` fixo | removido dos módulos |
| instância padrão (`require` sem `.criar()`) | só a fábrica; sem cliente, **derruba** |
| rótulo de log `[AMB/...]` | `TAG_EMP`/`_TAG` da ficha |
| link externo (`/amb-checkout-offline`, `/magalu/ir/amb`) | chave da ficha; no front, o link vem do backend |

⚠️ **Cada uma delas foi descoberta depois de alguém declarar "está limpo".**
A quinta e a sexta não apareciam em busca pelas quatro primeiras. Se for
declarar pronto de novo, varra as seis — e procure uma sétima.

Além disso:

- `app-AMB.js` é fábrica: `criar(empresa)` devolve instância própria
- o bootstrap monta **todas** as empresas ativas do contrato
- o **servidor** entrega ao front a rota e a chave de dados da ficha (b513); sem lista fechada de empresas e
  sem cair na raiz da GOOD — a URL so e reserva se o marcador nao for trocado
- a PWA tem `id` e nome por empresa (senão as duas se instalam como um app só)
- o segredo do cookie é por empresa, e **sem ele o boot cai** — de propósito
- a Girassol esta **ATIVA e operando desde 30/09/2026** (64 NFs lancadas e 64 devolucoes emitidas; apps
  proprios em Bling, ML e Shopee; Magalu usa o app compartilhado da GOOD, com token proprio por empresa)

## O que falta, e não é código

### ⚠️ Um CNPJ NOVO não entra só por configuração

A pergunta "amanhã eu ligo outra empresa?" tem duas respostas diferentes.

**A Girassol já foi ligada** (30/09/2026) — a seção "Para ligar a Girassol"
abaixo é o **histórico** desse embarque, não pendência. Use-a como roteiro
para a próxima empresa, com as correções de `docs/EMBARCAR-GIRASSOL.md`.

**Qualquer outro CNPJ, não** — mas há um gerador que faz a parte chata:

```
node scripts/nova-empresa.js <chave> "<Nome da Empresa>"
```

Ele escreve a ficha, o trecho do contrato, o comando do Supabase e a lista de
envs — no formato das empresas que já rodam. Você revisa, cola e abre o PR.

⚠️ **Ele não escreve nos arquivos, não inventa id fiscal e não ativa nada.**
Um teste prova que a ficha gerada é aceita pelo registro de verdade — gerar
texto bonito que o registro recusa não serviria.

A lista de empresas continua sendo **código**, não cadastro:
`contrato-empresas.json` mais a ficha em `lib/empresas.js`, com chave, chave
de dados, rota, prefixos, tabelas, campos fiscais e capacidades. Isso é PR,
revisão e deploy — não uma tela.

📌 Isso é uma **escolha**, não um esquecimento: ficha em código passa pelos
testes de paridade e pela revisão. Mas quem promete "plugar amanhã" precisa
saber que o dia inclui um PR.

### 📌 E há um assistente para a parte manual

```
node scripts/plugar-empresa.js girassol
```

Ele separa o que a máquina resolve do que só você tem:

| quem resolve | o quê |
|---|---|
| **descobre no Bling** | depósito geral, natureza de devolução |
| **gera** | o segredo da sessão (32 bytes) |
| **monta** | o comando do Supabase, com o sufixo certo |
| ⚠️ **só você** | as 6 credenciais, os usuários, e o `ID_EMPRESA_CONTROL` |

⚠️ **O `ID_EMPRESA_CONTROL` não vem por API** — o `GET /empresas` do Bling dá
404. Ele aparece na URL quando você abre a empresa no painel. Está marcado
como `manual` no `lib/empresas.js` para ninguém prometer que descobre.

### Para ligar a Girassol (HISTÓRICO — já feito em 30/09/2026)

> ⚠️ Não execute de novo: `ativa_em.devolucoes` já é `true`. Para uma empresa
> nova, a ficha nasce `false` e só vira `true` depois da sonda verde.

⚠️ **O PR pontual primeiro:** virar `ativa_em.devolucoes` de `false` para
`true` na ficha da Girassol em `contrato-empresas.json`. Sem isso
`empresasAtivasNoDevolucoes()` não devolve a Girassol e `/girassol` não monta
— os itens abaixo podem estar todos prontos e a empresa continua fora do ar
até esse PR entrar e implantar.

**9 envs** `GIRASSOL_*`: as seis de Bling e ML, `GIRASSOL_USERS`,
`GIRASSOL_SESSION_SECRET` e `GIRASSOL_ADMIN_USER`. ⚠️ Sem o `ADMIN_USER`,
todo mundo listado em `GIRASSOL_USERS` vira `estoquista` — e ações que
exigem admin (lançar estoque, gravar a NF de devolução, concluir triagem)
ficam sem ninguém que possa fazer.

⚠️ **O Supabase NÃO precisa de par próprio.** O `conferirEmpresa` aceita o
`SUPABASE_URL`/`SUPABASE_KEY` globais — e é assim que a AMB roda hoje. A
lista que ele imprime mostra `GIRASSOL_SUPABASE_URL (ou SUPABASE_URL)`: o
"ou" importa. Criar um par próprio à toa é trabalho e mais um segredo para
girar.

**3 campos fiscais.** `depositoGeral` e `naturezasDevolucaoIds` vêm do Bling
dela (via `descobrirFicha`). ⚠️ `idEmpresaControl` **não vem por API** —
`GET /empresas` dá 404 nesta conta — é **manual**: defina
`GIRASSOL_ID_EMPRESA_CONTROL` com o valor que a própria Girassol informa. Sem
padrão inventado, de propósito — NF com número errado é pior que NF ausente.

**As 7 tabelas** no Supabase. ⚠️ A rotina `provisionar_empresa` instalada lá
pode ser a **antiga, de 5 tabelas**: cole `sql/provisionar-empresa.sql` no SQL
Editor antes — isso só cria/atualiza a FUNÇÃO, não roda nada sozinho. Depois
**execute a função**: `select * from public.provisionar_empresa('_girassol');`
no mesmo SQL Editor. O `lib/provisionar-empresa.js` confere e avisa se
faltarem, em vez de dizer "ok" e a tela de defeitos quebrar depois.

⚠️ **Manifest: nada a fazer.** Uma versão anterior deste documento pedia um
manifest próprio — está obsoleto. A rota `/manifest-AMB.json` já deriva `id`,
nome e escopo da ficha, antes do estático. As duas PWAs já são apps
diferentes.

### ⚠️ A pasta do checkout NÃO segue a chave da empresa

Uma versão anterior deste documento dizia que a pasta da Girassol **não
existia** no Mover-Pedidos e que o link dela daria 404. **Estava errado.**

Ela existe — com outro nome:

| empresa | pasta lá |
|---|---|
| AMB | `amb-checkout-offline` |
| GOOD | `good-checkout-offline` |
| **Girassol** | **`girassol-backup-offline`** ← foge do padrão |

📌 O erro era montar `/<chave>-checkout-offline` e supor que valia para
todas. Agora a pasta vem da ficha (`pastaCheckout`), e quem foge do padrão
declara.

⚠️ **E eu quase mandei alguém criar uma pasta que já existia.** Supor o
padrão e escrever "não existe" no documento é pior que não ter documento:
gera trabalho errado com aparência de diagnóstico.

📌 Para um CNPJ novo, conferir **lá** qual é a pasta antes de declarar — e o
mesmo para a chave do proxy da Shopee e a rota `/magalu/ir/<empresa>`, que
são **outros dois identificadores** no mesmo serviço.


### Três provas que ninguém pode dar por código

1. ~~A Girassol nunca rodou.~~ **PROVADO em 30/09/2026:** a Girassol opera com credencial, tabela e dado
   reais (64 NFs lancadas pelo "Lancar por NF" e 64 NFs de devolucao emitidas em massa; Bling, ML e Shopee
   com apps PROPRIOS; Magalu com o app compartilhado da GOOD e token proprio).
2. ~~O provisionamento nunca rodou no Supabase real.~~ **PROVADO:** as tabelas `*_girassol` existem em
   producao e ja receberam alteracoes (ex.: `itens_devolvidos`, colunas de estoque do Full, 02/10).
3. **O rollback nunca foi testado** -- continua valendo: nenhuma empresa foi desativada pra ser revertida.

**b513 (03/10):** o navegador nao tem mais lista fechada de empresas (`base-amb.js`): a base e o 1o segmento
da URL, entao uma 4a empresa NAO cai na raiz da GOOD. A ficha de defeitos (`defeitos-ficha.js`) so reconhecia
`/amb` e na Girassol chamava a GOOD -- consertado. Teste: `front-empresa-sem-lista` (roda o codigo de producao
com /loja4).
## Trilha separada: o dono dos tokens

**Não confundir com o multiloja.** O contrato elegeu o Mover-Pedidos como dono
alvo, `lib/token-leitor.js` já implementa as políticas, mas o padrão segue
`sombra` e a AMB ainda renova localmente. O corte é mudança operacional própria,
com sobreposição curta — ML primeiro, Bling por último.

⚠️ Voltar para `local` com refresh antigo pode falhar: o dono já pode tê-lo
consumido.

## O que aprendemos e custou caro

**Fallback para o valor de outra empresa não é compatibilidade — é vazamento
com cara de segurança.** Cinco foram removidos: cada um fazia a empresa nova
cair silenciosamente no dado da AMB quando não declarava o seu.

**Conserto no backend que a tela ignora não conserta nada.** O link do
marketplace foi corrigido no backend e o painel continuava recalculando por
conta própria.

**Varredura que não cobre um arquivo é pior que não varrer** — dá a impressão
de que ele está limpo. Aconteceu com `app-AMB.js` e depois com `/lib` inteiro,
onde havia a natureza fiscal da AMB cravada.

**`node --check` não pega o que mais quebra aqui:** escopo, TDZ, função que
sumiu, parâmetro no lugar errado. Só o boot real pegou esses.
