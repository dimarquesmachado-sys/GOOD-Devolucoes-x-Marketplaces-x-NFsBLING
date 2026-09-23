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
- o front descobre a base pela URL (`/amb`, `/girassol`, ou raiz)
- a PWA tem `id` e nome por empresa (senão as duas se instalam como um app só)
- o segredo do cookie é por empresa, e **sem ele o boot cai** — de propósito
- a ficha da Girassol existe e é testada; a empresa segue **inativa** no contrato

## O que falta, e não é código

### Para ligar a Girassol (tudo configuração do dono)

**10 envs** `GIRASSOL_*`: as seis de Bling e ML, `GIRASSOL_USERS`,
`GIRASSOL_SESSION_SECRET`, e o par do Supabase.

**3 campos fiscais**, que vêm do Bling dela: `idEmpresaControl`,
`depositoGeral`, `naturezasDevolucaoIds`. Sem padrão inventado, de propósito —
NF com número errado é pior que NF ausente.

**As 7 tabelas** no Supabase. ⚠️ A rotina `provisionar_empresa` instalada lá
pode ser a **antiga, de 5 tabelas**: cole `sql/provisionar-empresa.sql` no SQL
Editor antes. O `lib/provisionar-empresa.js` confere e avisa se faltarem, em
vez de dizer "ok" e a tela de defeitos quebrar depois.

**Um manifest próprio** da PWA, senão as duas se instalam como o mesmo app.

### Três provas que ninguém pode dar por código

1. **A Girassol nunca rodou.** O teste monta duas empresas com configuração de
   sandbox: prova isolamento, **não** prova que ela funciona com credencial,
   tabela e dado reais.
2. **O provisionamento nunca rodou no Supabase real.**
3. **O rollback nunca foi testado** — ela nunca foi ativada para ser revertida.

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
