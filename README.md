# GOOD Devolucoes - Marketplaces - NFs Bling

Sistema de identificacao e inteligencia de devolucoes para o GOOD Import.

## Fase 1 (atual)

Identifica a venda original a partir do codigo da etiqueta de devolucao do Mercado Livre.

- Aceita `pack_id` (ex: 2000012153272513) ou `shipment_id` (ex: 46862577049)
- Busca em cascata na API do ML
- Mostra produto, comprador, valores, datas e timeline da devolucao
- Renovacao automatica do access token via refresh token

## Variaveis de ambiente

Configurar no Render:

| Variavel | Descricao |
|---|---|
| `ML_CLIENT_ID` | Client ID da app no ML developer |
| `ML_CLIENT_SECRET` | Client Secret da app |
| `ML_ACCESS_TOKEN` | Access token inicial (renovado automaticamente depois) |
| `ML_REFRESH_TOKEN` | Refresh token (vale ~6 meses) |
| `ML_USER_ID` | ID da conta GOOD Import no ML |
| `RENDER_API_KEY` | (opcional) Pra persistir tokens renovados |
| `RENDER_SERVICE_ID` | (opcional) Pra persistir tokens renovados |

## Endpoints

- `GET /` - Pagina principal (interface do estoquista)
- `GET /health` - Health check
- `GET /api/devolucao/identificar/:codigo` - Identifica devolucao
- `POST /api/admin/renovar-token` - Renova token manualmente

## Roadmap

- [x] Fase 1: Identificacao de devolucao via API ML
- [ ] Fase 2: Persistencia em banco + integracao Bling
- [ ] Fase 3: Emissao automatica de NF-e de devolucao
- [ ] Fase 4: Dashboard de inteligencia de devolucoes
- [ ] Fase 5: OCR e leitura via foto da etiqueta
