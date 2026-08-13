# 🚀 v3.17.0 — Devolução Parcial (com fotos como evidência)

## ✅ ARQUIVOS PRA SUBIR (6 arquivos)

| # | Arquivo | Onde substitui no GitHub |
|---|---|---|
| 1 | `server.js` | substitui o `server.js` da raiz |
| 2 | `admin.html` | substitui `public/admin.html` |
| 3 | `public/index.html` | substitui `public/index.html` |
| 4 | `public/js/bipagem.js` | substitui `public/js/bipagem.js` |
| 5 | `public/js/camera.js` | substitui `public/js/camera.js` |
| 6 | `public/js/triagem.js` | substitui `public/js/triagem.js` |

⚠️ **Sobe TODOS de uma vez** (uns dependem dos outros).

## 📋 Como subir (8-10 min)

Pra cada arquivo: GitHub → clica → ✏️ Editar → **Ctrl+A** + **Delete** → cola o novo → Commit.

**Sugestão de ordem:**
1. `public/js/bipagem.js`
2. `public/js/camera.js`
3. `public/js/triagem.js`
4. `public/index.html`
5. `admin.html`
6. `server.js` (último — Render só vai redeployar a partir daqui)

Aguarda Render redeployar (~1-2 min) e testa.

## 🎯 NOVO FLUXO (cliente devolveu menos)

### Como o estoquista usa:

1. **Bipa etiqueta** normalmente
2. Sistema mostra venda + ex: "10 itens esperados"
3. Clica **APROVAR**
4. **Bipa só os 2 que vieram** (contador 2/10)
5. Aparece automaticamente o **botão laranja "⚠️ DEVOLUÇÃO PARCIAL"**
6. Clica nele → modal pergunta:
   - 🔄 **Faltou bipar** (volta pra bipagem)
   - 📦 **Cliente devolveu PARCIAL** (segue)
   - ✖ Cancelar
7. Se PARCIAL → abre câmera, **6 fotos mínimas**:
   - 1 do pacote
   - 1 da etiqueta
   - 4 do(s) produto(s)
8. Após 6 fotos → modal final:
   - "Confirma: voltaram 2 de 10?"
   - Campo de **observação opcional**
   - Botão **✅ Sim, Encerrar**
9. Sistema:
   - Salva como `tipo='aprovado'` mas com `produto_qtd=2` (qtd recebida)
   - Aplica **tag automática "Devolucao Parcial"** (laranja)
   - Salva fotos como evidência
   - **NÃO** dispara email

### Como aparece no admin

- Card fica com **borda laranja** + fundo amarelinho
- Badge **"📦 PARCIAL"** ao lado do nome do produto
- **Bloco de fotos** logo abaixo dos detalhes
- Botão **"📥 Baixar todas"** se você precisar contestar com ML

### Como usar pra contestar golpe

Cliente tentou devolver 2 dizendo que mandou 10? 
1. Vai no admin
2. Acha a devolução parcial (badge laranja)
3. Clica **📥 Baixar todas as fotos**
4. Anexa no chamado do ML como evidência

## 🔍 Onde o botão Parcial aparece/some

- ❌ Não aparece quando bipou 0 (precisa tentar pelo menos 1)
- ✅ Aparece entre 1 bipado e total-1 bipados
- ❌ Some quando completa todos (ex: 10/10) — não faz sentido

## 🧪 Como testar (passo a passo)

### Teste 1 — fluxo completo de parcial
1. `/health` → `version: "3.17.0"` ✅
2. Login no celular
3. Bipa uma etiqueta de uma venda com **2+ itens**
4. Clica APROVAR
5. Bipa **menos** itens que o total (ex: 1 de 3)
6. Vê o botão laranja aparecer ✅
7. Clica → modal de 3 opções abre ✅
8. Clica "Cliente devolveu PARCIAL"
9. Câmera abre, tira 6 fotos
10. Modal final, escreve obs (opcional), clica "Sim Encerrar"
11. Toast verde "Devolucao parcial registrada!" ✅

### Teste 2 — verificar admin
12. Abre `/admin.html`
13. Acha o registro novo
14. Confere badge "📦 PARCIAL" ✅
15. Confere fotos abaixo ✅
16. Clica "Baixar todas" → 6 fotos baixam ✅

### Teste 3 — ranking não infla
17. Abre `/admin/relatorios.html`
18. SKU não aparece como "problema" (porque é tipo='aprovado')
19. Aparece na tabela de devoluções com a tag "Devolucao Parcial"
20. Filtra pela tag → vê todos os parciais

### Teste 4 — fluxo PROBLEMA continua funcionando
21. Bipa outra etiqueta
22. Clica em PROBLEMA (não Aprovar)
23. Câmera abre, 6 fotos
24. Envia
25. Email chega normalmente ✅

## 🔄 Banco de dados

**Não precisa migration!** A tag "Devolucao Parcial" é criada automaticamente na primeira devolução parcial registrada (cor: laranja `#f57c00`).

A coluna `produto_qtd` agora pode ter valor menor que a NF original (sem problema, é o esperado).

## 🚨 Se algo der errado

### Sintoma: botão laranja não aparece
- Verifica se subiu o `bipagem.js` (tem a função `atualizarBotaoParcial()`)
- Verifica se subiu o `index.html` (tem o `<button id="btnDevolucaoParcial">`)
- Recarrega com **Ctrl+Shift+R**

### Sintoma: clica no botão laranja e nada acontece
- Verifica se subiu o `triagem.js` (tem `iniciarFluxoParcial()`)

### Sintoma: tira 6 fotos mas não abre modal final
- Verifica se subiu o `camera.js` (foi modificado pra bifurcar)
- Verifica se subiu o `triagem.js` (tem `abrirConfirmacaoParcial()`)

### Sintoma: backend retorna erro 400 "Devolucao parcial requer 6 fotos"
- Foi enviado payload sem fotos. Verifica console do navegador.

### Reverter
GitHub → arquivo afetado → **History** → Revert do commit. 
**Reverte os 6 ao mesmo tempo** se precisar.

## 📦 Migrations? Tags?

❌ **Nenhuma migration necessária.**

A tag "Devolucao Parcial" (cor `#f57c00`) é criada automaticamente na 1ª devolução parcial. Se quiser pré-criar manualmente no Supabase:

```sql
INSERT INTO tags (nome, cor) VALUES ('Devolucao Parcial', '#f57c00');
```

Mas **não é obrigatório**.

## 💡 Próxima sessão

Quando tiver usado um pouco e quiser melhorar:
- Filtro "só parciais" rápido no admin (botão dedicado)
- Card "Devoluções parciais este mês" no dashboard de relatórios
- Coluna específica nas exportações Excel
- Cálculo de prejuízo em parciais (qtd recebida × custo Bling)

**Frase-gatilho:** *"Bora ajustar v3.17 devolucao parcial. Testei, falta X."*

---

# 📌 REGRAS DO CATÁLOGO (Bling × marketplaces) — anotado em 13/08/2026

Registro pedido pelo Diego depois de caçarmos uma foto que não aparecia.
São fatos do catálogo real da AMBTotal; valem para qualquer código futuro
que precise achar um produto.

## 1. O SKU identifica o produto — mas ele PODE SER RENOMEADO

Regra do Diego: *"não existem 2 SKUs iguais"* — correto, e por isso o SKU
é o caminho de busca. Só que o código do produto **muda no cadastro** ao
longo do tempo, e a venda antiga continua carregando o SKU **da época**.

Caso real (luminária FL-1011 preta, venda ML 2000017882877038, 11/08/2026):

| onde | código |
|---|---|
| item da venda / NF 6335 | `FL-1011-PRETO` |
| cadastro do Bling hoje | `3933398010054` |

Consequência medida na rota da foto:

- `/amb/api/produto/imagem/FL-1011-PRETO` → `imagem: null`,
  *"nao achei nenhum produto com o codigo FL-1011-PRETO no Bling"*
- `/amb/api/produto/imagem/3933398010054` → **foto encontrada**, `via: lista_codigo`

**Não é bug de código nem cadastro errado**: é a defasagem natural entre o
que a venda registrou e o que o cadastro é hoje. Toda devolução anterior a
um rename perde qualquer busca por SKU.

## 2. O ID do produto no Bling NÃO muda com o rename

O item da NF traz o `produto.id` — o vínculo que o próprio Bling gravou na
emissão da nota. É o único identificador estável entre a venda e o cadastro.
Por isso a rota da foto aceita `?produtoId=` e, quando ele vem, vai direto
ao produto sem passar por SKU.

**Regra para código novo:** quando precisar do produto de uma devolução,
prefira o `produto.id` do item da NF; o SKU é a segunda via, não a primeira.

## 3. EAN NÃO identifica produto neste catálogo

Explicação do Diego: peças de reposição de manuseio interno (que não são
vendidas) herdam o EAN do produto-pai — e há produtos com EAN vazio, mas
nunca com SKU vazio.

Medido no mesmo caso: o EAN `7898978766010` da luminária está cadastrado
também em `Kit2Roscas`, `TravaCentralBranca` e `TravaCentralPreta`. Usar
EAN para achar produto traz **a peça errada**, que no galpão vira conferência
errada. O caminho por EAN foi **removido** da rota da foto (b230).

## 4. Os filtros do Bling não são confiáveis sozinhos

Comportamento observado (v3):

- `?codigo=<sku>` às vezes **volta vazio** para um produto que existe, e às
  vezes **ignora o filtro** devolvendo a página padrão de produtos. Nunca
  aceitar o primeiro item de uma lista sem conferir o `codigo` — foi assim
  que a foto de um acessório apareceu no lugar da luminária (b227).
- `?pesquisa=<termo>` também não filtra direito: buscando `FL-1011-PRETO`
  voltaram `GVSC`, `PP3D`, `PSM` — sem relação com o termo. Serve só como
  varredura ampla, sempre com casamento exato de `codigo` depois.
- `?numero=` da NF exige o número **zero-padded em 6 dígitos**: `2447`
  devolve 0 resultados, `002447` devolve as notas (b216).

**Regra para código novo:** todo resultado do Bling é candidato, nunca
resposta. Confira o campo que identifica antes de usar.
