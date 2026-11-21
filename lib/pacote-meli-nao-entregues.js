'use strict';
/**
 * lib/pacote-meli-nao-entregues.js  (b796, V-13)
 *
 * A LISTA DAS VENDAS DO MERCADO LIVRE QUE NAO FORAM ENTREGUES — pro cartao "pacote MELI" da triagem (as 3 empresas).
 *
 * O caso (AMB, 21/11): a caixa de uma venda NAO ENTREGUE volta com etiqueta sem cliente (remetente "MELI #0"). O codigo
 * de barras dela e o envio DE VOLTA, que o ML nao deixa consultar (404) e NAO liga a venda em campo nenhum — medido
 * pela sonda (lib/sonda-etiqueta-volta.js) em producao. O numero que acha a venda e o "Ref. ID" impresso, que e o
 * envio ORIGINAL. Desde a b789 o estoquista digita esse numero (ou a foto le). A mesma sonda mediu de onde sai a
 * lista: `GET /orders/search?seller=…&shipping.status=not_delivered` devolveu 36 vendas (de 6180), todas canceladas por
 * nao entrega, cada uma com o `shipping.id` — que e o Ref. ID da etiqueta. (A TAG `not_delivered` NAO serve: trouxe 254
 * vendas pagas, a caminho.)
 *
 * Com a lista na tela o estoquista TOCA na venda em vez de digitar 11 numeros, e o numero lido da foto e conferido
 * contra ela (public/js/busca.js e colar-imagem.js). A lista e uma AJUDA: digitar o Ref. ID continua funcionando, com
 * ou sem ela.
 *
 * ⚠️ O que esta peca NAO sabe (a busca de vendas nao devolve): se a caixa ja saiu de volta, onde esta, nem a data em que
 * o ML deu a venda como nao entregue. A linha mostra o que a venda tem: produto, data da venda, pedido e o Ref. ID.
 * ⚠️ Sem dado do comprador: a etiqueta do pacote MELI nao traz cliente, entao a lista nao precisa dele.
 */
const { chavesTriadas } = require('./espreita-ja-triadas');

const POR_PAGINA = 50;
const MAX_PAGINAS = 4;              // 200 vendas, as mais recentes primeiro; o que passar disso e AVISADO (`cortada`)
const TETO_MS = 20000;              // a tela nao espera a lista pra mostrar o cartao, mas o pedido tambem nao fica pendurado
const TEMPO_POR_CONSULTA_MS = 10000;
const VALIDADE_MS = 5 * 60 * 1000;  // a lista do ML fica na memoria; as TRIAGENS sao conferidas a cada pedido
const ESPERA_DEPOIS_DE_FALHA_MS = 20000;

/** numero que veio do ML (numero ou texto so de digitos) → texto; qualquer outra coisa → null */
function digitos(v, min, max) {
  const s = (typeof v === 'number' && Number.isSafeInteger(v)) || typeof v === 'string' ? String(v).trim() : '';
  return s.length >= min && s.length <= max && /^\d+$/.test(s) ? s : null;
}
const cortar = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Uma venda da busca → a linha da lista. Venda sem numero de envio nao tem Ref. ID: nao entra (e contada a parte).
 * `data` e o dia da VENDA (`date_created`), como o ML mandou.
 */
function linhaDaVenda(o) {
  const ref = digitos(o && o.shipping && o.shipping.id, 9, 13);
  const pedido = digitos(o && o.id, 6, 20);
  if (!ref || !pedido) return null;
  const produtos = (Array.isArray(o.order_items) ? o.order_items : []).map((it) => {
    const item = (it && it.item) || {};
    const qtd = Number(it && it.quantity);
    return { titulo: cortar(item.title, 140) || null, sku: cortar(item.seller_sku || item.seller_custom_field, 60) || null, qtd: qtd > 0 ? qtd : 1 };
  }).filter((p) => p.titulo || p.sku);
  const criada = typeof o.date_created === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.date_created) ? o.date_created.slice(0, 10) : null;
  return { ref_id: ref, pedidos: [pedido], pack_id: digitos(o.pack_id, 6, 20), data: criada, produtos };
}

// As mensagens de erro desta peca aparecem NA TELA do estoquista (o cartao as mostra): por isso em portugues, com
// acento, e sem nada do que o ML mandou no corpo do erro — so o status.
const erroDoMl = (r, oQue) => {
  const st = r && r.status != null ? Number(r.status) : null;
  return { ok: false, status: 502, erro: oQue + (st ? ' (o Mercado Livre respondeu HTTP ' + st + ')' : ' (o Mercado Livre não respondeu)') };
};

/**
 * Busca as vendas nao entregues da conta, pagina por pagina (mais recentes primeiro).
 * Um CARRINHO (pack) sai como varias vendas com o MESMO envio: viram UMA linha, com os produtos de todas.
 * Pagina que falha = FALHA da lista inteira — metade da lista, sem dizer, pareceria "a venda nao esta la".
 *
 * @param {object} p
 * @param {(caminho: string) => Promise<{ok:boolean,status?:number,data?:*}>} p.get   GET no ML (o chamarML da casa)
 * @param {() => (string|number|null|Promise<string|number|null>)} [p.vendedor]         id da conta, quando o cliente ja sabe
 * @returns {Promise<{ok:true,itens:object[],total_no_ml:(number|null),cortada:boolean,sem_envio:number}|{ok:false,status:number,erro:string}>}
 */
async function listarNaoEntregues({ get, vendedor, porPagina = POR_PAGINA, maxPaginas = MAX_PAGINAS, tetoMs = TETO_MS, agora = Date.now }) {
  const t0 = agora();
  let conta = null;
  try { conta = digitos(await (typeof vendedor === 'function' ? vendedor() : null), 3, 20); } catch (e) { conta = null; }
  if (!conta) {
    const eu = await get('/users/me');
    if (!eu || !eu.ok) return erroDoMl(eu, 'não consegui saber qual é a conta do Mercado Livre desta empresa');
    conta = digitos(eu.data && eu.data.id, 3, 20);
    if (!conta) return { ok: false, status: 502, erro: 'o Mercado Livre não informou o número da conta desta empresa' };
  }
  const porEnvio = new Map();   // Ref. ID → linha (a ordem de entrada e a do ML: mais recentes primeiro)
  let total = null; let lidas = 0; let semEnvio = 0; let cortada = false;
  for (let pag = 0; ; pag++) {
    const r = await get('/orders/search?seller=' + conta + '&shipping.status=not_delivered&sort=date_desc&limit=' + porPagina + '&offset=' + (pag * porPagina));
    if (!r || !r.ok) return erroDoMl(r, 'a busca das vendas não entregues falhou');
    const res = r.data && Array.isArray(r.data.results) ? r.data.results : null;
    if (!res) return { ok: false, status: 502, erro: 'o Mercado Livre respondeu a busca de vendas num formato que não reconheço (sem a lista de resultados)' };
    const t = Number(r.data.paging && r.data.paging.total);
    if (Number.isFinite(t) && t >= 0) total = t;
    for (const o of res) {
      lidas++;
      const l = linhaDaVenda(o);
      if (!l) { semEnvio++; continue; }
      const ja = porEnvio.get(l.ref_id);
      if (!ja) { porEnvio.set(l.ref_id, l); continue; }
      // a MESMA venda de novo (entrou uma venda nova entre uma pagina e outra, e a lista do ML andou): nao soma duas vezes
      if (ja.pedidos.includes(l.pedidos[0])) continue;
      ja.pedidos.push(l.pedidos[0]);
      ja.produtos = ja.produtos.concat(l.produtos);
    }
    const acabou = res.length < porPagina || (total != null && lidas >= total);
    if (acabou) break;
    // ainda ha vendas no ML: para no limite de paginas ou de tempo, e DIZ que parou
    if (pag + 1 >= maxPaginas || agora() - t0 > tetoMs) { cortada = true; break; }
  }
  return { ok: true, itens: [...porEnvio.values()], total_no_ml: total, cortada, sem_envio: semEnvio };
}

/**
 * Marca em cada linha se a venda JA FOI TRIADA (pelo envio, por um dos pedidos ou pelo pack), com a regra da casa
 * (lib/espreita-ja-triadas). Consulta que falha NAO esconde nada: todas saem como nao triadas, e `conferida` diz.
 */
async function marcarTriadas(itens, { sb, tabela, colunasDoEnvio, triadas = chavesTriadas }) {
  const soltas = [];
  for (const it of itens) for (const p of it.pedidos) soltas.push({ pedido: p, pack_id: it.pack_id, tracking: it.ref_id });
  let r;
  try { r = await triadas(sb, tabela, soltas, colunasDoEnvio ? { colunasDoEnvio } : undefined); } catch (e) { r = { ok: false, achados: new Set(), erro: (e && e.message) || String(e) }; }
  const achados = (r && r.ok && r.achados) || new Set();
  const marcadas = itens.map((it) => Object.assign({}, it, {
    ja_triado: achados.has(it.ref_id) || it.pedidos.some((p) => achados.has(p)) || (!!it.pack_id && achados.has(it.pack_id)),
  }));
  return { itens: marcadas, conferida: !!(r && r.ok) };
}

/**
 * A ROTA (uma instancia por empresa): GET, login de funcionario, sem parametro.
 * A lista do ML fica 5 minutos na memoria e quem chega durante a busca espera a MESMA busca — tres celulares abrindo o
 * cartao juntos custam uma consulta ao ML, nao tres. Depois de uma falha, 20 s sem perguntar de novo (a resposta e a
 * mesma falha): recarregar a tela com o ML fora nao vira rajada. As triagens sao conferidas a CADA pedido — a venda
 * que acabou de ser triada sai da lista sem esperar a memoria vencer.
 *
 * `obterMl`    devolve o cliente do ML DA EMPRESA (`chamarML`, `userId`) — funcao, pra ser lida na hora do pedido.
 * `obterBanco` devolve `{ sb, tabela, colunasDoEnvio? }`: o cliente do Supabase, a tabela de triagens da empresa e,
 *              quando a tabela nao tem as duas colunas de envio da fabrica (`shipment_id` e `tracking`), quais ela tem.
 */
function criarRotaNaoEntregues({ obterMl, obterBanco, agora = Date.now, validadeMs = VALIDADE_MS, esperaDepoisDeFalhaMs = ESPERA_DEPOIS_DE_FALHA_MS,
  listar = listarNaoEntregues, triadas = chavesTriadas }) {
  let boa = null;        // { em, r } — a ultima lista que o ML entregou
  let falha = null;      // { em, r } — a ultima falha
  let buscando = null;   // a busca em andamento (uma por empresa)

  function lista() {
    const t = agora();
    if (boa && t - boa.em < validadeMs) return Promise.resolve(boa);
    if (falha && t - falha.em < esperaDepoisDeFalhaMs) return Promise.resolve(falha);
    if (!buscando) {
      buscando = (async () => {
        let r;
        try {
          let ml = null;
          try { ml = typeof obterMl === 'function' ? obterMl() : null; } catch (e) { ml = null; }
          if (!ml || typeof ml.chamarML !== 'function') r = { ok: false, status: 503, erro: 'o Mercado Livre desta empresa não está ligado' };
          else {
            r = await listar({
              get: (caminho) => ml.chamarML(caminho, { timeout: TEMPO_POR_CONSULTA_MS }),
              vendedor: () => (typeof ml.userId === 'function' ? ml.userId() : null),
              agora,
            });
          }
        } catch (e) {
          r = { ok: false, status: 502, erro: 'a busca das vendas não entregues falhou (erro interno ao consultar o Mercado Livre)' };
        }
        const reg = { em: agora(), r };
        if (r && r.ok) { boa = reg; falha = null; } else falha = reg;
        return reg;
      })();
      const soltar = () => { buscando = null; };
      buscando.then(soltar, soltar);
    }
    return buscando;
  }

  return async function rotaNaoEntregues(req, res) {
    try {
      const reg = await lista();
      const r = reg && reg.r;
      if (!r || !r.ok) return res.status((r && r.status) || 502).json({ ok: false, erro: (r && r.erro) || 'a lista das vendas não entregues não veio' });
      let banco = null;
      try { banco = typeof obterBanco === 'function' ? obterBanco() : null; } catch (e) { banco = null; }
      const m = await marcarTriadas(r.itens, { sb: banco && banco.sb, tabela: banco && banco.tabela, colunasDoEnvio: banco && banco.colunasDoEnvio, triadas });
      return res.status(200).json({
        ok: true,
        itens: m.itens,
        total_no_ml: r.total_no_ml,
        cortada: r.cortada,
        triagem_conferida: m.conferida,
        idade_s: Math.max(0, Math.round((agora() - reg.em) / 1000)),
      });
    } catch (e) {
      if (res && res.headersSent) return undefined;
      return res.status(500).json({ ok: false, erro: 'erro interno ao montar a lista das vendas não entregues' });
    }
  };
}

module.exports = { listarNaoEntregues, linhaDaVenda, marcarTriadas, criarRotaNaoEntregues };
