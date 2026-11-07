# Fusão GOOD → Girassol (01/01/2027) — migrar o hospedeiro

Plano pedido pelo dono em 06/11/2026: *"tem q bolar algo de migrar esse hospedeiro pra
Girassol. O ideal era se cada um tivesse seu próprio ambiente Magalu, sem um depender de
outro."* A partir de 01/01/2027 a GOOD Import vira Magazine Girassol; os marketplaces
encerram as contas da GOOD e tudo que estiver **registrado na conta dela** morre junto.

## O que é "o hospedeiro", e por que ele migra

O Devoluções é UM serviço no Render. O `server.js` é o código da GOOD e, de quebra,
hospeda a AMB e a Girassol pela fábrica (`lib/montagem-empresas.js`). Sinais de que o
serviço é "da GOOD": as envs **sem prefixo** (`BLING_*`, `ML_*`, `MAGALU_*`, `USERS`,
`ADMIN_USER`, `SHOPEE_LOJA_KEY`) são dela; a raiz `/` serve a tela dela; o nome do
serviço e da URL carregam `good-devolucoes`.

Migrar o hospedeiro **não** é levar a Girassol pra raiz do `server.js` — esse código
fala o modelo de dados da GOOD (`tipo/status/created_at`) e vai ser aposentado. É:

1. a GOOD sumir trocando uma env, sem deploy (**feito: b659 / PR #527**);
2. a raiz deixar de ser "a tela da GOOD" e apontar pra empresa que ficou
   (`DEVOLUCOES_RAIZ=/girassol`, no mesmo PR);
3. depois da fusão, o código da GOOD sair do `server.js`, que vira um **boot fino**:
   montagem das empresas + rotas do serviço. A Girassol continua instância em
   `/girassol` — os atalhos do galpão não mudam.

## O que morre com a conta da GOOD (medido no código, 06/11/2026)

| onde | o quê | ação |
|---|---|---|
| Mover-Pedidos, `magalu-oauth/index.js` | UM client Magalu pras 3 (`MAGALU_CLIENT_ID/SECRET/CLIENT_UUID`, criado na conta da GOOD) | client PRÓPRIO por empresa (ver bloco abaixo) — é o "Magalu cairia" |
| Shopee, serviço `ambtotal-shopee-nf-sync-x-bling` | app de parceiro (Open Platform) usado pelas 3 lojas | **conferir em qual conta foi criado**; se GOOD: recriar na Girassol e reautorizar Girassol e AMB |
| Devoluções | Bling, ML, Magalu e Shopee da GOOD (envs sem prefixo) | morrem com ela; ninguém mais depende (Girassol e AMB têm app próprio em tudo, Magalu próprio desde 30/09 e 04/10) |
| Mover-Pedidos | módulo `good-checkout-offline`, loja `good` no TikTok (`TIKTOK_LOJAS`) e no proxy da Shopee | desligar o módulo; tirar `good` das listas |
| TikTok | app `6jj99q5hog1do` é do Partner Center da **Girassol** | nada — só a loja da GOOD some |
| Supabase, Render, `ADMIN_KEY`, e-mail | do serviço, não da GOOD | nada |

Bloco pra colar na conversa do Mover-Pedidos (client Magalu próprio por empresa):

```
Magalu — client PRÓPRIO por empresa no Mover-Pedidos (antes de 01/01/2027: a fusão GOOD→Girassol
encerra a conta Magalu da GOOD, dona do MAGALU_CLIENT_ID compartilhado que o magalu-oauth usa pras 3).
1. Criar 2 clients pelo `idm` (NordVPN BR, igual 30/09 e 04/10): um logado na conta Magalu da Girassol,
   outro na da AMB. Clients SEPARADOS dos do Devoluções (refresh rotativo: dois serviços no mesmo client
   brigam). Nomes sugeridos: MoverPedidosGirassol e MoverPedidosAMB.
2. Envs no Render do mover-pedidos-aguardando-x-atendido: GIRASSOL_MAGALU_CLIENT_ID/SECRET/CLIENT_UUID e
   AMB_MAGALU_CLIENT_ID/SECRET/CLIENT_UUID.
3. Código: magalu-oauth/index.js lê o client POR EMPRESA (prefixo da ficha), com fallback no compartilhado
   só enquanto a env nova não existir; reconsentir cada empresa pelo /magalu/conectar.
4. Contrato: apps_por_servico.magalu.mover-pedidos vira "proprio" nas duas — PR gêmeo, Devoluções primeiro.
5. Depois do corte: apagar MAGALU_CLIENT_ID/SECRET/CLIENT_UUID do Render do mover-pedidos.
```

## Antes de 01/01/2027

- [ ] Mover-Pedidos com client Magalu próprio na Girassol e na AMB (bloco acima).
- [ ] Conta do app de parceiro da Shopee conferida (e recriada, se for da GOOD).
- [ ] `GIRASSOL_USERS` no Render do Devoluções com os estoquistas da GOOD que passam a
      bipar em `/girassol/` (login expira à meia-noite nas 3, já vale).
- [ ] PR #527 mergeado (não muda nada enquanto a env não existe — pode ir antes).
- [ ] Decidir o histórico da GOOD (tabelas sem sufixo: `devolucoes`, `espreita_notas`,
      `recados`, `pecas_retiradas`, `sku_depara`, `tags`, `devolucao_tags`): ficam no
      Supabase; pra consultar depois, basta tirar `DEVOLUCOES_DESATIVAR_GOOD` por um
      dia — o painel abre, mas sem Bling/ML dela não emite nem busca NF. Se quiser
      arquivo, exportar CSV antes.
- [ ] Mover-Pedidos: desligar o módulo da GOOD, tirar `good` de `TIKTOK_LOJAS` e do proxy
      da Shopee.
- [ ] Capacidade: a cota do Bling da Girassol (3/s por conta) passa a receber o volume da
      GOOD. O porteiro central já regula; olhar `pausas429` em `/girassol/status` nas
      primeiras semanas.

## Dia 1 — Render, serviço `good-devolucoes-x-marketplaces-x-nfsbling`, aba Environment

```
DEVOLUCOES_DESATIVAR_GOOD=1
DEVOLUCOES_RAIZ=/girassol
```

Conferir: `/health` → `coordenacao.montagem_empresas` com `good: desativada_por_env`;
`/` redireciona pra `/girassol/`; `/amb/` e `/girassol/` respondem. A partir daí nenhuma
rotina da GOOD roda e os tokens dela não são renovados (b659).

## Depois (jan/2027) — aposentar o código da GOOD, PR a PR

Cada fatia remove um bloco do `server.js` e deixa um teste provando que nada das outras
empresas mudou (`test/duas-empresas-juntas`, `rotas-do-painel-respondem`, `freio-da-hospedeira`):

1. Rotas e telas da raiz da GOOD (bipe, painel único adaptado no boot, admin/relatórios da
   raiz) → saem; a raiz vira redirect fixo pra `DEVOLUCOES_RAIZ`.
2. Instâncias das libs da GOOD no topo do `server.js` (Magalu sem prefixo, `mlReturns`,
   `nfNomes`, `nfEntradaGood`, espreita, Shopee sem prefixo) e os 16 agendamentos
   (`agendaGood`) → saem.
3. Envs sem prefixo apagadas no Render; a ficha `good` sai de `lib/empresas.js` e do
   `contrato-empresas.json` (PR gêmeo no Mover-Pedidos).
4. Fica o que é do SERVIÇO: `/health`, `/api/keepalive`, ponte do checkout
   (`/api/interno/*`, `/api/admin/eventos-checkout`), sonda (`/api/admin/sonda-empresa`),
   política/termos, montagem, drenagem, porteiro.
5. Tabelas sem sufixo da GOOD: renomear com `_good` ou exportar — só com OK do dono.
6. Opcional: renomear o serviço no Render (muda a URL pra TODO mundo — atalhos e PWA do
   galpão precisam ser reinstalados; combinar data).

Métrica de pronto: `server.js` de ~9.200 pra ~1.000 linhas; uma 4ª empresa entra só pela
fábrica (`docs/PLUGAR-EMPRESA-NOVA.md`), e nenhuma empresa é "a raiz".
