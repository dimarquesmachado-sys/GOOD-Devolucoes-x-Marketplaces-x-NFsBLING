# Manual de trabalho do Claude neste repositório

> **Mexendo no multiloja?** Leia
> [`docs/ESTADO-MULTILOJA.md`](docs/ESTADO-MULTILOJA.md) — ele diz o que está
> fechado, o que falta e, principalmente, **como medir** em vez de confiar na
> página. Os checklists mais antigos têm trechos que já não descrevem o código.

Este arquivo é a memória operacional do projeto. Leia-o **antes de editar qualquer
arquivo**, inclusive em pedidos aparentemente pequenos. O objetivo principal é fazer
ajustes pequenos, corretos e fáceis de revisar — sem transformar uma correção pontual
em uma reforma.

## 1. Regra de ouro: resolva exatamente o pedido

1. Reescreva mentalmente o problema em uma frase e identifique o comportamento esperado.
2. Localize o fluxo existente antes de propor código. Pesquise nomes de rota, IDs do DOM,
   funções, campos do payload e testes relacionados com `rg`.
3. Faça a **menor alteração completa** que resolve a causa. Não aproveite para renomear,
   formatar, extrair módulos, modernizar sintaxe ou corrigir problemas vizinhos.
4. Preserve o que o usuário não pediu para mudar: textos, layout, ordem, respostas HTTP,
   formatos de payload, fallbacks, compatibilidade e comportamento da outra empresa.
5. Se houver duas interpretações, investigue primeiro o código, os testes, os documentos e
   o contexto que o usuário já forneceu. Adote a interpretação mais conservadora quando a
   decisão for reversível e não mudar contrato ou dados. Pergunte somente quando a escolha
   continuar ambígua e uma resposta errada puder causar perda de dados, mudança de contrato
   ou retrabalho relevante; faça uma pergunta objetiva, não uma lista de possibilidades.
6. Nunca diga que algo funciona apenas porque o código "parece certo". Rode a verificação.

### Pare e confira o escopo

Antes de encerrar, responda:

- Cada arquivo alterado é indispensável para o pedido?
- Cada trecho modificado tem relação direta com a causa?
- O diff contém formatação ou melhorias não solicitadas?
- Algum fallback ou fluxo antigo sumiu sem o usuário pedir?

Se a resposta indicar escopo extra, reverta esse trecho. Uma tarefa pequena deve produzir
um diff pequeno. Se a correção começar a se espalhar, pare e explique a dependência antes
de continuar.

## 2. Processo obrigatório para cada ajuste

### Antes de codificar

```bash
git status --short --branch
rg -n "termo_do_problema|funcaoRelacionada|idRelacionado" . \
  -g '!node_modules/**' -g '!.git/**'
```

- Leia a função inteira e seus chamadores, não apenas as linhas do sintoma.
- Procure teste existente para o mesmo fluxo em `test/`.
- Leia os documentos relacionados em `docs/` quando a mudança envolver regra de negócio,
  banco, empresas, triagem, NF ou marketplace.
- Confira `git diff` antes de escrever para não sobrescrever trabalho já presente.
- Não edite `node_modules`, credenciais, `.env` ou artefatos gerados.

### Enquanto codifica

- Mude uma causa por vez.
- Reutilize helpers e padrões existentes; não crie uma segunda implementação do mesmo fluxo.
- Em correção de bug, adicione ou ajuste um teste que falharia antes da correção.
- Não esconda erro real com `catch` genérico, valor vazio ou fallback silencioso.
- Não altere contratos entre front e back pela metade. Se um campo mudar, rastreie produtor,
  consumidor, persistência e teste.
- Não invente nomes de funções/exportações. Confirme a definição e o `require` com `rg`.
- Não coloque `try/catch` ao redor de imports.

### Depois de codificar

1. Revise somente sua alteração com `git diff --check` e `git diff -- <arquivos>`.
2. Rode primeiro o teste diretamente relacionado para obter retorno rápido.
3. Rode obrigatoriamente a bateria completa:

   ```bash
   node verifica.js
   ```

4. Se um teste falhar, corrija a causa. Não enfraqueça, remova ou burle um teste para obter
   verde, salvo quando o requisito mudou explicitamente e o teste antigo ficou inválido.
5. Confira `git status --short` e garanta que somente arquivos intencionais entrarão.
6. Relate com honestidade o que foi testado e qualquer limitação. Não use "resolvido" se a
   verificação estiver vermelha.

## 3. Mapa do projeto

| Área | Local | Cuidados |
|---|---|---|
| Backend principal (GOOD) | `server.js` e `lib/` | CommonJS, Express, integrações e rotinas de fundo |
| Frontend GOOD | `public/` e `public/js/` | HTML/JS sem etapa de build; IDs e funções globais são contratos |
| Aplicação AMB | `amb-devolucoes/` | Tem diferenças reais de negócio; não presuma paridade |
| Módulos AMB legados | `amb-devolucoes/lib-AMB/` | Algumas cópias divergiram intencionalmente |
| Módulos compartilhados | `lib/` | Veja os chamadores GOOD e AMB antes de alterar |
| Regras e decisões | `docs/` | Decisões registradas prevalecem sobre soluções "óbvias" |
| Testes | `test/*.test.js` | Executados diretamente com Node, sem framework central |
| Verificação completa | `verifica.js` | Comando obrigatório antes de entregar |
| Banco/provisionamento | `sql/` | Não assuma que uma coluna ou índice já existe em produção |

O `README.md` contém histórico e instruções operacionais acumuladas. Ele é útil para
contexto, mas confirme o estado atual no código e nos documentos específicos.

## 4. GOOD, AMB e código compartilhado

Este é um ponto frequente de regressão.

- **Nunca copie automaticamente uma correção da GOOD para a AMB, ou vice-versa.** Primeiro
  confirme se o fluxo, configuração e regra de negócio são equivalentes.
- **Nunca deixe uma empresa para trás por distração.** Ao mudar um módulo compartilhado,
  localize todos os imports e rode testes das duas empresas.
- Não crie nova duplicação. Antes de adicionar helper a uma pasta específica, procure uma
  implementação comum em `lib/`.
- Não faça unificação/refatoração junto com correção pontual. A dívida e as diferenças estão
  documentadas em `docs/PLUGAR-EMPRESA-NOVA.md` e `docs/divida-copias-empresas.md`.
- Configuração de empresa deve seguir `contrato-empresas.json`, `lib/empresas.js` e
  `lib/config-da-empresa.js`; não espalhe novos valores literais ou novas env vars sem
  verificar esse contrato.

## 5. Contratos que costumam quebrar

### Frontend

- HTML, JavaScript externo e handlers inline dependem de IDs e nomes globais. Ao renomear
  ou mover algo, pesquise todas as referências.
- Uma mudança visual precisa preservar o fluxo no celular e os estados intermediários.
- Não duplique lógica entre arquivos para "garantir"; encontre qual arquivo é a fonte real.
- Quando houver alteração visual perceptível, abra a aplicação e registre uma captura para
  validar o resultado, além dos testes automatizados.

### Backend e integrações

- Rotas são contratos. Preserve status HTTP, nomes dos campos e semântica dos erros, exceto
  quando o pedido exigir mudança.
- Mercado Livre, Bling, Shopee, Magalu e TikTok têm fallbacks e ritmos próprios. Não remova
  uma etapa que parece redundante sem encontrar por que ela existe.
- Todo símbolo usado em `server.js` deve estar definido/importado. Um `ReferenceError`
  dentro de `try/catch` pode parecer erro do marketplace.
- Rotinas de fundo precisam respeitar drenagem, limites e coordenação; não crie novo timer
  sem estudar os módulos de ritmo e drenagem.
- Nunca registre tokens, senhas, chaves, cookies ou payloads sensíveis. Rotas admin devem
  manter a proteção existente.

### Banco de dados

- Não suponha que o Supabase ignora campo inexistente: uma coluna ausente pode rejeitar a
  gravação inteira.
- Mudanças de schema precisam de SQL explícito, compatibilidade durante implantação e
  instrução de ordem de deploy quando aplicável.
- Triagem duplicada **é permitida com aviso**. Não recrie índice único nem transforme o
  aviso em bloqueio; leia `docs/TRIAGEM-DUPLICADA.md`.

### Catálogo e nota fiscal

- Prefira o `produto.id` gravado no item da NF para localizar produto no Bling.
- SKU é a segunda via e pode ter sido renomeado.
- EAN não identifica produto de forma única neste catálogo e pode apontar para peça errada.
- Nunca aceite cegamente o primeiro item retornado por filtro do Bling; valide o código.
- Para saber o que realmente voltou, respeite `itens_devolvidos` e a bipagem; não confunda
  itens da NF inteira com itens recebidos. Leia `docs/ITENS-DEVOLVIDOS.md`.

## 6. Como escrever uma correção segura

Para bugs, prefira esta sequência:

1. Reproduza em um teste pequeno usando o padrão dos testes atuais.
2. Confirme que o teste falha pelo motivo esperado, não por erro de montagem.
3. Corrija a causa com o menor diff possível.
4. Rode o teste novo e testes próximos.
5. Rode `node verifica.js`.
6. Leia o diff como revisor, procurando efeitos colaterais e mudanças acidentais.

Um teste bom verifica comportamento observável e impede a regressão específica. Evite testes
que apenas procuram uma frase solta no fonte quando é possível executar a função. Quando o
código legado impedir execução direta, siga o padrão mais próximo já usado no repositório.

### ⚠️ Nunca recorte por janela fixa de caracteres

Em 13/09 isto derrubou **doze** testes diferentes num só dia: o teste fazia
`SRV.slice(i, i + 4000)` para achar um trecho, o código cresceu, e o alvo saiu da janela.
O vermelho não era bug — era o teste. E vermelho falso ensina a ignorar o vermelho.

⚠️ **E contar `{` e `}` NÃO é a alternativa segura** — apontamento do Codex, e ele está
certo: strings, templates, regex e comentários também contêm chaves. Provei com
`const s = "tem { aqui"` — o contador não acha o fim e o recorte sai vazio. Os testes que
escrevi contando chaves passam **por sorte**, não por desenho.

Prefira **testar comportamento executando o código**. Se um teste legado precisar
inspecionar fonte, delimite com **dois marcadores estáveis e exclusivos**, e falhe
explicitamente se algum não existir:

```js
const inicio = SRV.indexOf("app.get('/health'");
const fim = SRV.indexOf("app.get('/api/keepalive'", inicio);
ok(inicio >= 0 && fim > inicio, 'marcadores da rota existem e estao na ordem esperada');
const bloco = SRV.slice(inicio, fim);
```

O helper `test/_recorte.js` faz isso — use-o em vez de repetir o padrão.

### ⚠️ Nunca ancore em valor que o conserto vai mudar

Ancorar em `tipo: 'defeito_estoque'` para achar um insert quebrou o teste inteiro quando o
valor mudou. Ancore em algo estável e exclusivo daquele trecho.

## 7. O que não fazer

- Não reescrever arquivo inteiro para trocar poucas linhas.
- Não misturar bugfix, refatoração, melhoria visual e limpeza no mesmo ajuste.
- Não remover comentário histórico sem entender qual armadilha ele documenta.
- Não declarar uma API "instável" ou "com bug" sem evidência do retorno real.
- Não criar fallback que converte falha em sucesso vazio.
- Não alterar simultaneamente GOOD e AMB por busca/substituição cega.
- Não mudar schema apenas no código, nem apenas no SQL, sem planejar compatibilidade.
- Não testar somente sintaxe quando a mudança afeta comportamento.
- Não fazer commit com arquivos não relacionados ou dependências locais.
- Não continuar empilhando correções num PR cujo pedido original já foi resolvido.

## 8. Comunicação com o usuário

O usuário quer ganhar tempo, não acompanhar tentativa e erro. Portanto:

- Explique primeiro **o que estava errado**, em linguagem simples e específica.
- Diga quais poucos arquivos precisam mudar e por quê.
- Separe fatos confirmados de hipóteses. Não apresente suposição como diagnóstico.
- Se precisar de dado externo (log, payload, estado do Render/Supabase), peça exatamente o
  dado necessário e explique como obtê-lo; não faça várias alterações no escuro.
- Ao terminar, resuma a mudança, cite os testes executados e avise qualquer passo manual de
  banco/deploy. Não entregue uma lista de possibilidades quando já há uma causa confirmada.

### ⚠️ Em qual tela ele está?

Antes de investigar qualquer coisa de front, confirme **qual página**. Em 13/09 cinco
rodadas foram gastas investigando a tela de Triagem enquanto o dono estava no Painel Admin —
e a URL estava no primeiro print o tempo todo.

### ⚠️ Peça o dado em vez de adivinhar valor de lista fechada

Três rodadas seguidas foram gastas tentando adivinhar qual valor a coluna `tipo`/`status`
aceitava, um por vez. Ler um valor no código **não** prova que o banco aceita gravá-lo.
Ou peça a definição do check, ou use um caminho que não dependa dela (campo de texto livre).

## 9. Checklist final curto

- [ ] Entendi e preservei o comportamento pedido.
- [ ] Pesquisei todas as referências relevantes.
- [ ] O diff contém somente o necessário.
- [ ] Criei/ajustei teste de regressão quando houve bug.
- [ ] Rodei `git diff --check`.
- [ ] Rodei `node verifica.js` e ficou verde.
- [ ] Conferi que nenhum segredo ou arquivo acidental entrou.
- [ ] Expliquei claramente o que mudou e qualquer ação manual.

Se qualquer item não puder ser cumprido, não esconda: informe a limitação antes de afirmar
que o trabalho terminou.
