# 🚀 v3.16.1 — Rankings melhorados + Tabela ordenável

## ✅ Apenas 3 ARQUIVOS pra atualizar

São arquivos que **já existem** no GitHub. Você só **substitui** eles.

| # | Arquivo | Onde está no GitHub |
|---|---|---|
| 1 | `lib/rotas-relatorios.js` | `lib/rotas-relatorios.js` |
| 2 | `public/admin/relatorios.html` | `public/admin/relatorios.html` |
| 3 | `public/admin/relatorios.js` | `public/admin/relatorios.js` |

⚠️ **Não precisa mexer no `server.js` nem `admin.html`!**

## 📋 Como subir (3 min)

Pra cada um dos 3 arquivos:

1. GitHub → clica no arquivo
2. ✏️ Editar (lápis)
3. **Ctrl+A** → **Delete** (apaga tudo)
4. Cola o conteúdo do arquivo novo
5. Commit: `v3.16.1: <nome do arquivo>`

Render redeploya automático em ~1-2 min.

## 🎯 O QUE TÁ NOVO

### 1) Ranking SKUs com 3 colunas extras
Agora você vê:

| Pos | SKU | Unid. | **Devoluç.** | **Méd/dev** | **Status** |
|---|---|---|---|---|---|
| 🥇 | LTJ50-CINZA | 20 | **20** | **1** | 🔴 Sistêmico |
| 🥈 | KJBD-AZUL | 15 | **1** | **15** | 🟢 Isolado |
| 🥉 | MN05-VERDE | 12 | **8** | **1.5** | 🟡 Misto |

**Status visual** baseado no número de devoluções distintas:
- 🔴 **Sistêmico** = 6+ devoluções (problema do produto)
- 🟡 **Misto** = 3-5 devoluções (atenção)
- 🟢 **Isolado** = 1-2 devoluções (caso pontual)

Você bate o olho e SABE se é problema do produto ou caso isolado.

### 2) Tabela de devoluções ORDENÁVEL

Clica no cabeçalho de qualquer coluna pra ordenar:
- ↑ ASC (1ª clique)
- ↓ DESC (2ª clique)

Colunas ordenáveis:
- **Data** (mais nova → mais antiga)
- **Tipo** (agrupa aprovado/problema)
- **SKU** (A→Z, Z→A)
- **Qtde** (maior, menor)
- **Valor** (maior, menor)
- **NF** (maior, menor)
- **Comprador** (A→Z, Z→A)
- **Funcionário** (agrupa por nome)

Hover do mouse mostra dica do que cada clique faz.

### 3) Bônus que prometi

✅ **Card novo "SKUs distintos"** — quantos produtos diferentes apareceram  
✅ **Card novo "Total Unidades"** — soma de todas qtdes  
✅ **Linha de TOTAIS** no rodapé da tabela — soma da qtde + valor filtrados  
✅ **Excel melhorado** — exporta com a ordem que você deixou na tela + ranking com colunas novas + 3ª aba "Ranking Problemas"

## 🧪 Como testar

1. `/health` → deve continuar `version: "3.16.0"` (não bumpei pra 3.16.1 — é micro-mudança)
2. Abre `/admin/relatorios.html`
3. **Ctrl+Shift+R** pra recarregar sem cache
4. Vê os rankings com colunas novas
5. Clica num cabeçalho da tabela → ordena
6. Clica de novo → inverte
7. Confere a linha de totais no rodapé

## 🚨 Se der erro

GitHub → arquivo → **History** → reverte commit. Volta pra v3.16.0 anterior.

Os 3 arquivos são independentes — se 1 quebrar, só esse precisa reverter.
