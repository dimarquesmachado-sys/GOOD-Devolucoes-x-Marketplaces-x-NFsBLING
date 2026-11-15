'use strict';
/* ============================================================
 * lib/ml-permissoes.js  (b698)
 * ------------------------------------------------------------
 * AS PERMISSOES DO APLICATIVO DO MERCADO LIVRE QUE ESTE SERVICO USA — e como reconhecer que falta uma.
 *
 * ⚠️ O CASO (GOOD, 14/11/2026): o ML negava toda busca de reclamacoes e de anuncio, com o token VIVO. Custou
 * uma tarde, link por link e JSON por JSON, ate a causa: o APLICATIVO de onde vinha o token (o do
 * Mover-Pedidos — o eixo le do dono) estava sem duas permissoes no DevCenter. No dia seguinte, pra conferir a
 * AMB e a Girassol, a mesma romaria — e a de anuncios nem dava pra conferir sem montar a consulta a mao.
 *
 * ✅ A lista do que este servico precisa fica AQUI, com a consulta minima que prova cada uma, e a sonda da
 * empresa (scripts/sonda-empresa.js) pergunta ao ML sozinha. Empresa nova com o app criado sem a permissao
 * reprova na sonda, com o NOME da permissao — antes do primeiro bipe.
 *
 * ⚠️ So entra permissao MEDIDA dos dois lados (negada sem ela, liberada com ela). Uma consulta que nunca
 * vimos o ML negar nao prova nada quando passa, e culparia a permissao errada quando falha.
 * ============================================================ */

/**
 * A resposta do ML e o bloqueio do PolicyAgent (falta de permissao do APLICATIVO)?
 * E a UNICA assinatura conclusiva: `403` com `blocked_by: PolicyAgent` / `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
 * Outro 403 (recurso restrito ao comprador, `/returns` negado por regra) NAO e permissao do app.
 * @param {*} erroDoMl o corpo do erro (objeto ou texto)
 */
function ehBloqueioDePolitica(erroDoMl) {
  const cru = JSON.stringify(erroDoMl || '');
  return /PolicyAgent|PA_UNAUTHORIZED/i.test(cru);
}

/**
 * O que este servico usa, e a leitura minima (1 item) que prova cada permissao.
 * Medido na GOOD em 14/11/2026: as duas consultas davam 403 do PolicyAgent sem a permissao e 200 com ela.
 * `nome` e `acesso` sao os da tela do DevCenter (editar o app > Permissoes).
 */
const PERMISSOES_USADAS = [
  {
    chave: 'reclamacoes',
    nome: 'Comunicações pré e pós-vendas',
    acesso: 'Leitura e escrita',
    pra_que: 'busca de reclamações — o índice de devoluções do ML',
    caminho: (contaId) => `/post-purchase/v1/claims/search?status=opened&players.user_id=${contaId}&players.role=respondent&limit=1`,
  },
  {
    chave: 'anuncios',
    nome: 'Publicação e sincronização',
    acesso: 'Leitura',
    pra_que: 'consulta de anúncio — a linha do tempo do retiro do Full',
    caminho: (contaId) => `/users/${contaId}/items/search?limit=1`,
  },
];

/**
 * Le a resposta de UMA consulta de permissao.
 * "NAO SEI" nao e "NAO": so o 403 do PolicyAgent e `negada`. 401, 429, 5xx, rede e 403 de outra regra sao
 * `nao_sei` — quem chama nao pode culpar a permissao por eles.
 * @param {{ok: boolean, status: number|null, corpo: *}} r
 * @returns {'liberada'|'negada'|'nao_sei'}
 */
function classificarResposta(r) {
  if (r && r.ok === true) return 'liberada';
  if (r && Number(r.status) === 403 && ehBloqueioDePolitica(r.corpo)) return 'negada';
  return 'nao_sei';
}

module.exports = { ehBloqueioDePolitica, PERMISSOES_USADAS, classificarResposta };
