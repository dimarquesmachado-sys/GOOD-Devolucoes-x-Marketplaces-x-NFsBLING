// ============================================================
// lib/ml.js
// ------------------------------------------------------------
// Cliente Mercado Livre da GOOD — ADAPTADOR sobre a peca unica (b702).
//
// ⚠️ b702 - A LOGICA NAO MORA MAIS AQUI. Ate o b701 este arquivo tinha 556 linhas e era uma COPIA do cliente da
// fabrica (amb-devolucoes/lib-AMB/ml-AMB.js), divergindo nos dois sentidos: so a GOOD tinha o `ml_403.por_rota` do
// /health (b691), o /ml/setup por tokens e a preventiva que nao tenta em `remoto`; so a fabrica tinha o retry de 429 e
// a regra do 403 por rota ja conhecida sem derrubar o cache (b690). Cada conserto precisava ser feito duas vezes — e
// o b690/b693/b694 provaram que nao era: a GOOD e a fabrica recebiam o mesmo conserto em PRs separados.
//
// Agora a GOOD usa `criar(configDaEmpresa('good'))`, como ja faz com as reclamacoes (ml-returns-AMB, b510) e o indice
// de nomes (nf-nomes-AMB, b563). Este arquivo so PRESERVA A ASSINATURA que o server.js e os testes da GOOD conhecem:
//   chamarML(url, headersExtras)  -> fabrica: chamarML(url, { headers })
//   renovarTokenML()              -> renovarToken()
//   definirTokensML(a, r)         -> definirTokens(a, r)
//   getClientML()                 -> credenciais()
//   hasToken()                    -> temToken()
//   preventivaML                  -> preventiva
// A URL inteira (`https://api.mercadolibre.com/...`) continua aceita: a fabrica aceita caminho relativo OU URL.
//
// 📌 O que mudou de comportamento pra GOOD, de proposito (nivelar por cima):
//   - 429 do ML: espera 2 s e repete uma vez (antes devolvia o erro na hora);
//   - 403 em rota que ja renovou na janela de 10 min: devolve o 403 SEM invalidar o cache do leitor (b690 — na GOOD
//     eram 118 invalidacoes em 5 min numa rota restrita ao comprador). Fora da janela, invalida e repete como antes;
//   - o token renovado e gravado em `GOOD_ML_*` E no nome historico `ML_*` enquanto este existir no Render (b250).
// ============================================================

'use strict';
const { configDaEmpresa } = require('./config-da-empresa');
const { criar } = require('../amb-devolucoes/lib-AMB/ml-AMB');

const ml = criar(configDaEmpresa('good'));

module.exports = {
  diagnostico403: ml.diagnostico403,
  preventivaML: ml.preventiva,
  chamarML: (url, headersExtras) => ml.chamarML(url, headersExtras ? { headers: headersExtras } : {}),
  renovarTokenML: ml.renovarToken,
  buscarNFnoML: ml.buscarNFnoML,
  definirTokensML: ml.definirTokens,
  getClientML: ml.credenciais,
  hasToken: ml.temToken,
  // b702 - a instancia inteira, pra quem precisar do que a fabrica oferece alem da assinatura antiga
  instancia: ml,
};
