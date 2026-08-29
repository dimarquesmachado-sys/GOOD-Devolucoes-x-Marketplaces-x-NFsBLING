# Triagem duplicada — a regra, e por que NÃO há trava no banco

**Decisão do dono, 29/08/2026. Vale para GOOD, AMB e qualquer empresa que
entrar depois.**

## A regra

Um pacote **não deveria** ser triado duas vezes. Mas o sistema **não
impede** — ele avisa forte e deixa o funcionário decidir.

> "esse pedido cai depois pro ADMIN, e lá se eu gerar NF e for duplicada,
> eu vou saber e decido o que faço, se falo com o funcionário, ou se só
> marco como concluído"

O filtro real acontece **na emissão da NF**, não na bancada.

## Por que não trava no banco

Um índice único em `shipment_id` parece a solução óbvia — e foi criado na
GOOD em 29/08, antes desta decisão. Mas ele **quebra o botão "🔄 Triar
mesmo assim"**: o banco recusa a segunda linha, o botão passa a mentir, e
o estoquista fica travado no meio do turno sem saída.

Pior: o caso legítimo existe. Se a primeira triagem foi engano — marcou
"incluir estoque" quando era problema —, hoje se resolve triando de novo.
Com a trava, precisaria chamar o admin para mexer no banco.

**Se o índice da GOOD ainda existir, derrube:**

```sql
DROP INDEX CONCURRENTLY IF EXISTS devolucoes_shipment_id_unico;
```

Conferir se saiu:

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename LIKE 'devolucoes%' AND indexname LIKE '%unico%';
```

## O que protege, então

1. **A pré-trava do bipe.** Antes de liberar os botões, o sistema procura
   triagem anterior por `shipment_id`, `order_id`, `tracking`, `nf_numero`
   e chave da DANFE. Achando, mostra banner **vermelho** com o tipo, quem
   triou e quando — e o botão de re-triar só aparece depois de um segundo
   clique, com outro aviso explicando que vai criar um registro novo.

2. **A gravação rápida** (v4.59). As consultas ao Bling saíram do caminho
   crítico, então a janela entre "verifiquei" e "gravei" caiu de até 20
   segundos para milissegundos. Duplo clique acidental praticamente não
   acontece mais.

3. **O olho do admin** na emissão da NF, que é onde a decisão é tomada.

## O balizador é a NF (e o pack), não o envio

Descoberto em 29/08 com as duas etiquetas físicas na mão:

| | ida (nossa postagem) | volta (o ML deu ao cliente) |
|---|---|---|
| envio | `47501559178` | `47528658744` |
| **pack** | `2000013967364577` | **o mesmo** |
| pedido | `2000017367190752` | o mesmo |
| NF | `002070` | a mesma |

**O envio muda entre ida e volta.** Por isso, quem só olha `shipment_id`
vê duas devoluções onde existe uma — e foi exatamente assim que o mesmo
pacote foi triado duas vezes.

Nas palavras do dono:

> "o balizador tem que ser a NF origem de tudo, pq nunca terão 2 NFs
> iguais pra uma venda"

Então a verificação procura por **todos** os identificadores estáveis:
`nf_numero`, `nf_chave`, `pack_id`, `order_id` — além de `shipment_id` e
`tracking`, que ajudam quando existem.

⚠️ **Armadilha que já nos pegou:** o `pack_id` era **gravado mas não
procurado**. Mandar o identificador não adianta se a consulta não olha
para aquela coluna.

## Onde isso vive no código

- pré-trava (front): `verificarTriagemExistente` / `renderizarTriagemDuplicata`
  em `busca.js` — **um por empresa**, idênticos
- consulta (GOOD): rota `/api/triagem/status/:shipmentId` no `server.js`
- consulta (AMB): rota igual no `app-AMB.js` + `db.triagensDe`, que traduz
  o vocabulário da tabela `_amb` (`criado_em`, `tipo` sempre `'devolucao'`)
  para o formato que o front espera

## Empresa nova

Nada a criar no banco. Só garantir que a rota de status exista naquele
servidor — foi o que faltou na AMB e deixou a pré-trava sem funcionar,
em silêncio, até 29/08.
