# 🚀 v3.16.0 — Dashboard de Relatórios + TAGs

## ✅ ARQUIVOS PRA SUBIR (6 arquivos)

| # | Arquivo (no seu PC) | Onde colocar no GitHub |
|---|---|---|
| 1 | `server.js` | substitui o `server.js` da raiz |
| 2 | `admin.html` | substitui `public/admin.html` |
| 3 | `lib/produtos-client.js` | criar arquivo novo `lib/produtos-client.js` |
| 4 | `lib/rotas-relatorios.js` | criar arquivo novo `lib/rotas-relatorios.js` |
| 5 | `public/admin/relatorios.html` | criar pasta `admin` dentro de `public` e arquivo dentro |
| 6 | `public/admin/relatorios.js` | mesmo lugar do anterior |

## 📋 PASSO A PASSO (~10 min)

### Passo 1: Subir os 4 arquivos NOVOS

#### 1a) `lib/produtos-client.js`
- GitHub → **Add file** → **Create new file**
- Nome: `lib/produtos-client.js`  (a barra `/` cria a pasta `lib`)
- Cola o conteúdo do arquivo
- Commit: `v3.16.0: lib/produtos-client.js`

#### 1b) `lib/rotas-relatorios.js`
- GitHub → **Add file** → **Create new file**
- Nome: `lib/rotas-relatorios.js`
- Cola o conteúdo
- Commit: `v3.16.0: lib/rotas-relatorios.js`

#### 1c) `public/admin/relatorios.html`
- GitHub → vai pra pasta `public`
- **Add file** → **Create new file**
- Nome: `admin/relatorios.html`  (cria a pasta `admin` dentro de `public`)
- Cola o conteúdo
- Commit: `v3.16.0: relatorios.html`

#### 1d) `public/admin/relatorios.js`
- Mesma pasta do anterior
- **Add file** → **Create new file**
- Nome: `admin/relatorios.js`
- Cola o conteúdo
- Commit: `v3.16.0: relatorios.js`

### Passo 2: Substituir os 2 arquivos EXISTENTES

#### 2a) `server.js`
- GitHub → clica em `server.js`
- ✏️ Editar (lápis)
- **Ctrl+A** → **Delete** (apaga tudo)
- Cola o `server.js` novo
- Commit: `v3.16.0: server.js (relatorios + funcionario)`

#### 2b) `public/admin.html`
- GitHub → vai pra `public/admin.html`
- ✏️ Editar
- **Ctrl+A** → **Delete**
- Cola o `admin.html` novo
- Commit: `v3.16.0: admin.html (botao relatorios)`

### Passo 3: Aguarda Render redeployar (~1-2 min)

### Passo 4: Testar

#### a) `/health` retorna `version: "3.16.0"`
```
https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/health
```

#### b) Botão "📊 Relatórios" aparece no admin
```
https://good-devolucoes-x-marketplaces-x-nfsbling.onrender.com/admin.html
```

#### c) Clica no botão → abre dashboard

## 🎯 O QUE TÁ NOVO

### Backend (`server.js`)
- ✅ Importa `lib/rotas-relatorios.js`
- ✅ Bump pra v3.16.0
- ✅ Registra rotas novas: `/api/admin/relatorios/devolucoes`, `/api/admin/tags`, etc.
- ✅ Grava `funcionario` em coluna separada quando triagem é feita (pra novos registros)
- ✅ Servir página `/admin/relatorios.html`

### Frontend admin (`admin.html`)
- ✅ Botão "📊 Relatórios" no topo (em verde)
- ✅ Bump pra v3.16.0 no rodapé
- ✅ Tudo o resto **igual** (Gerar NF Devolução, lista, filtros, etc)

### Páginas novas
- ✅ `/admin/relatorios.html` + JS
  - Cards no topo (total, aprovadas, problemas, % problema, valor)
  - Filtros: período, tipo, SKU, funcionário, tag
  - 2 rankings lado a lado: top SKUs devolvidos + top SKUs com problema
  - Tabela detalhada
  - Sistema completo de TAGs (criar, aplicar, filtrar)
  - Export Excel

## 🚨 SE ALGO DER ERRADO

### Sintoma: deploy do Render falhou
- Vai no GitHub → arquivo afetado → **History** → reverte commit
- Geralmente é o `server.js`

### Sintoma: `/admin/relatorios.html` retorna "Cannot GET"
- Confere se você criou os arquivos `relatorios.html` e `relatorios.js` em `public/admin/` (não é em qualquer outro lugar)

### Sintoma: dashboard carrega mas tabela tá vazia
- Filtro padrão é últimos 30 dias
- Muda data início pra 4 meses atrás → "Aplicar filtros"

### Sintoma: erro 401 ao abrir relatório
- Tem que estar logado como admin (`ADMIN_USER` env var)
- Faz login no `/admin.html` antes

## 💡 PRÓXIMA SESSÃO

Depois que usar 2-3 dias, conta o que faltou. Vou implementar:
- Cálculo de prejuízo (qtde × custo Bling)
- Custo de devolução cobrado pelo ML
- Busca textual de produto (autocomplete)

**Frase-gatilho:** *"Bora continuar relatorios v3.17. Testei, falta X."*
