'use strict';
/* ============================================================
 * lib/ids-fiscais-auto.js
 * ------------------------------------------------------------
 * DESCOBRE OS IDS FISCAIS NO BLING DA PRÓPRIA EMPRESA.
 *
 * ⚠️ O PEDIDO DO DONO, 24/09: "descobre aí pegando direto do Bling, senão vai
 * me atrapalhar. tem que ter isso automatizado pra qualquer empresa nova que
 * for entrar."
 *
 * Ele está certo. Até aqui, ligar uma empresa exigia caçar 3 números no
 * painel do Bling com o F12 e colar no Render — e 2 dos 3 a API entrega.
 * Fazer a pessoa caçar o que a máquina sabe é trabalho inventado.
 *
 * 📌 O QUE ESTE MÓDULO RESOLVE SOZINHO
 *
 *   depositoGeral          `GET /depositos`, casando o nome "geral"
 *   naturezasDevolucaoIds  `GET /naturezas-operacoes`, casando o nome
 *
 * ⚠️ E O QUE ELE NÃO RESOLVE, e não adianta insistir: o `idEmpresaControl`.
 * O `GET /empresas` do Bling responde 404 — medido em 18/08 na AMB. Ele vem
 * de `depositos[].idEmpresa`, que só o endpoint INTERNO devolve. Se algum dia
 * a v3 passar a trazer, este módulo aproveita (ver `idEmpresaDoDeposito`).
 *
 * ⚠️ REGRA DA CASA QUE VALE AQUI: ambiguidade NÃO escolhe. Um candidato
 * serve; dois ou mais recusam e listam. `.find()` pegando o primeiro que a
 * API devolver é o que emite nota com a natureza errada.
 * ============================================================ */

const CACHE = new Map();   // chave -> { ts, dados }
const TTL_MS = 30 * 60 * 1000;

const norm = (x) => String(x || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * ⚠️ O nome do depósito "geral" varia por empresa. Aceito o que é claramente
 * o geral e recuso empate — na AMB há mais de um depósito, e pegar o primeiro
 * mandaria a peça recuperada pro lugar errado.
 */
function escolherDepositoGeral(depositos) {
  const lista = Array.isArray(depositos) ? depositos : [];
  const exatos = lista.filter((d) => norm(d.descricao || d.nome) === 'geral');
  if (exatos.length === 1) return { id: String(exatos[0].id), via: 'nome exato "geral"' };
  if (exatos.length > 1) {
    return { id: null, via: 'AMBIGUO', candidatos: exatos.map((d) => `${d.id}: ${d.descricao || d.nome}`) };
  }
  // ⚠️ padrão do Bling: quando só existe UM depósito, ele é o geral.
  if (lista.length === 1) return { id: String(lista[0].id), via: 'unico deposito da conta' };
  return {
    id: null,
    via: 'NAO ACHEI nome "geral"',
    candidatos: lista.slice(0, 8).map((d) => `${d.id}: ${d.descricao || d.nome}`),
  };
}

/**
 * ⚠️ A natureza de DEVOLUÇÃO DE MERCADORIA — ENTRADA.
 *
 * 📌 Excluo "devolução de compra" de propósito: ela existe na lista logo antes
 * da certa (medido na AMB em 18/08) e o `.find()` ingênuo pegaria ela.
 * Emitir com a natureza de compra é nota errada com cara de certa.
 */
function escolherNaturezaDevolucao(naturezas) {
  const lista = Array.isArray(naturezas) ? naturezas : [];
  const candidatas = lista.filter((n) => {
    const d = norm(n.descricao || n.nome);
    if (!d.includes('devolucao')) return false;
    if (d.includes('devolucao de compra')) return false;   // ⚠️ a armadilha
    return d.includes('entrada') || d.includes('mercadoria');
  });
  if (candidatas.length === 1) {
    return { id: String(candidatas[0].id), via: `nome "${candidatas[0].descricao || candidatas[0].nome}"` };
  }
  if (candidatas.length > 1) {
    return {
      id: null, via: 'AMBIGUO',
      candidatos: candidatas.map((n) => `${n.id}: ${n.descricao || n.nome}`),
    };
  }
  return {
    id: null, via: 'NAO ACHEI natureza de devolucao/entrada',
    candidatos: lista.slice(0, 8).map((n) => `${n.id}: ${n.descricao || n.nome}`),
  };
}

/**
 * ⚠️ O `idEmpresaControl` vem de `depositos[].idEmpresa` — SE vier.
 *
 * Em 18/08, na AMB, a v3 não trazia esse campo. Deixo a tentativa aqui porque
 * custa nada e, no dia em que o Bling passar a mandar, uma empresa nova para
 * de precisar do F12 — sem ninguém lembrar de voltar aqui.
 */
function idEmpresaDoDeposito(depositos) {
  const lista = Array.isArray(depositos) ? depositos : [];
  const ids = [...new Set(lista.map((d) => d.idEmpresa).filter(Boolean).map(String))];
  if (ids.length === 1) return { id: ids[0], via: 'depositos[].idEmpresa' };
  if (ids.length > 1) return { id: null, via: 'AMBIGUO', candidatos: ids };
  return { id: null, via: 'a v3 nao devolve idEmpresa no /depositos (medido 18/08)' };
}

/**
 * Descobre o que dá, para UMA empresa.
 *
 * @param {string} chave        a canônica do contrato
 * @param {function} chamarBling  cliente JÁ da empresa certa
 */
async function descobrirIdsFiscais(chave, chamarBling, opcoes = {}) {
  const agora = Date.now();
  const emCache = CACHE.get(chave);
  if (!opcoes.semCache && emCache && (agora - emCache.ts) < TTL_MS) {
    return { ...emCache.dados, doCache: true };
  }
  if (typeof chamarBling !== 'function') {
    return { ok: false, erro: 'sem cliente do Bling desta empresa' };
  }

  const pegar = async (caminho) => {
    const r = await chamarBling(`https://api.bling.com.br/Api/v3${caminho}?limite=100`);
    if (!r || !r.ok) {
      return { erro: `HTTP ${(r && r.status) || '?'}`, itens: [] };
    }
    const d = r.data && (r.data.data || r.data);
    return { itens: Array.isArray(d) ? d : [] };
  };

  const dep = await pegar('/depositos');
  const nat = await pegar('/naturezas-operacoes');

  const dados = {
    ok: true,
    empresa: chave,
    depositoGeral: escolherDepositoGeral(dep.itens),
    naturezasDevolucaoIds: escolherNaturezaDevolucao(nat.itens),
    idEmpresaControl: idEmpresaDoDeposito(dep.itens),
    lidos: { depositos: dep.itens.length, naturezas: nat.itens.length },
    erros: [dep.erro, nat.erro].filter(Boolean),
  };
  CACHE.set(chave, { ts: agora, dados });
  return dados;
}

module.exports = {
  descobrirIdsFiscais,
  escolherDepositoGeral,
  escolherNaturezaDevolucao,
  idEmpresaDoDeposito,
};
