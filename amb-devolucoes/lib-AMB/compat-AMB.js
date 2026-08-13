// ════════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/compat  (AMB Devol. b133)
//  LEVA 1a do porte GOOD → AMB.
//
//  A tela de bipe da GOOD (index.html + 10 modulos JS) chama 18 endpoints.
//  A maioria a AMB JA TEM, so com outro nome — esses eu aponto no proprio
//  front quando portar os JS (leva 2), pra nao duplicar logica de backend.
//
//  Aqui ficam SO as rotas que a AMB nao tem de jeito nenhum:
//    GET  /api/produtos/buscar?q=          busca produto p/ o modal de defeito
//    GET  /api/produto/ean-por-sku/:sku    EAN unificado (vem em 6 campos no Bling)
//    POST /api/triagem/upload-foto         fotos de evidencia -> Supabase Storage
//    GET  /api/triagem/status/:id          ja foi triado? (por order/tracking/NF)
//  b56 — e os NOMES DE ROTA da GOOD, pra os 10 modulos JS dela entrarem
//  SEM EDICAO (o front so ganha um prefixo /amb):
//    POST /api/triagem/aprovar | problema | divergente | consertado
//    GET  /api/defeitos/por-sku      POST /api/defeitos/adicionar
//    GET  /api/devolucao/identificar/:codigo      GET /health
//    POST /api/recado/:id/ciente
//  Deu certo porque o registrarTriagem da AMB aceita os MESMOS nomes de
//  campo que a GOOD manda (shipment_id, nf_chave, buyer_nome, pack_id...).
//
//  NAO entra aqui a fila de impressao (/api/etiqueta/fila): a AMB nao tem
//  essa rota de verdade — so o nome na lista. E uma frente propria
//  (etiqueta.js + qz-tray), fica pra leva 3.
//
//  Montado pelo app-AMB.js com montar(router, deps).
// ════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const emailAMB = require('./email-AMB');

/**
 * b76 - FOTO DO PRODUTO no "Lançar produto com defeito".
 * A LISTAGEM do Bling nao traz imagem nenhuma — so o DETALHE traz, e em
 * lugares que variam (midia.imagens.externas[].link, internas[], anexos...).
 * Por isso: busca profunda no objeto do detalhe e cache por id, pra a
 * segunda busca do mesmo produto ser instantanea.
 */
const IMG_CACHE = new Map();          // idProduto -> url|null
// b174 - veredito de FORMATO por produto: 'S' simples · 'E' kit/composicao
// · 'V' pai de variacao. So guarda o que foi APURADO (listagem conclusiva
// ou detalhe), nunca um palpite — assim um erro do Bling nao vira verdade.
const FORMATO_CACHE = new Map();      // idProduto -> { fmt, ts }
// b175 (P2 do Codex) - o veredito EXPIRA. Sem isso, produto que virou kit
// depois continuaria passando como simples ate o servico reiniciar.
const FORMATO_TTL_MS = 6 * 60 * 60 * 1000;   // 6h
function FORMATO_CACHE_set(id, fmt) {
  if (id && fmt) FORMATO_CACHE.set(id, { fmt, ts: Date.now() });
}
function FORMATO_CACHE_get(id) {
  const reg = id ? FORMATO_CACHE.get(id) : null;
  if (!reg) return undefined;
  if (Date.now() - reg.ts > FORMATO_TTL_MS) { FORMATO_CACHE.delete(id); return undefined; }
  return reg.fmt;
}
// b175 (P2 do Codex) - ESPACAMENTO GLOBAL das consultas de detalhe. O
// cliente do Bling tem cota de ~3 req/s; com o intervalo preso dentro de
// cada busca, duas buscas simultaneas somavam o dobro do ritmo. Agora o
// intervalo e compartilhado pelo processo inteiro.
// b180 - COMPONENTES DO KIT: o Bling devolve a estrutura com o produto
// SO PELO ID (sem `codigo`), entao o mapeamento antigo — que exigia
// c.produto.codigo — saia VAZIO: a mensagem nao citava a composicao e a
// tela nao tinha o que oferecer pra explodir. Agora: extrator tolerante a
// onde a estrutura vem + resolucao do id -> SKU (com cache por id).
// b181 (review do Codex) - o cache de SKU EXPIRA (6h), igual ao de formato:
// SKU trocado no Bling nao pode ficar sendo oferecido pra sempre.
const SKU_POR_ID = new Map();          // idProduto -> { sku, nome, ts }
const SKU_TTL_MS = 6 * 60 * 60 * 1000;
function skuCacheGet(id) {
  const reg = id ? SKU_POR_ID.get(id) : null;
  if (!reg) return null;
  if (Date.now() - reg.ts > SKU_TTL_MS) { SKU_POR_ID.delete(id); return null; }
  return reg;
}
function skuCacheSet(id, sku, nome, imagem) {
  if (id && sku) SKU_POR_ID.set(id, { sku, nome: nome || '', imagem: imagem || null, ts: Date.now() });
}
// b181 - teto de componentes e PRAZO total da resolucao. Sem prazo, um kit
// de 12 pecas com o Bling lento (30s por chamada) segurava o POST por
// minutos antes de o operador ver qualquer opcao.
// b182 - composicao JA RESOLVIDA por kit (evita refazer as consultas a
// cada busca). Mesmo TTL dos outros vereditos.
const COMPS_POR_KIT = new Map();       // idKit -> { itens, faltando, ts }
function compsCacheGet(id) {
  const reg = id ? COMPS_POR_KIT.get(id) : null;
  if (!reg) return null;
  if (Date.now() - reg.ts > SKU_TTL_MS) { COMPS_POR_KIT.delete(id); return null; }
  return reg;
}
const COMPONENTES_MAX = 12;
const COMPONENTES_PRAZO_MS = 8000;      // no POST (o operador espera)
const PRAZO_KIT_BUSCA_MS = 14000;       // b195 - na busca da tela, mais folga
function extrairComponentes(det) {
  if (!det) return [];
  const lugares = [
    det.estrutura && det.estrutura.componentes,
    det.componentes,
    det.estrutura && det.estrutura.itens,
  ];
  for (const l of lugares) if (Array.isArray(l) && l.length) return l;
  return [];
}
// b183 (review do Codex) - prazo que vale pra requisicao JA EM VOO: o
// chamarBling nao tem timeout proprio, entao uma consulta travada seguraria
// a busca/o POST muito alem do prazo prometido.
async function comPrazo(promessa, ms) {
  let t;
  try {
    return await Promise.race([
      promessa,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('prazo da consulta esgotado')), Math.max(500, ms)); }),
    ]);
  } finally { clearTimeout(t); }
}
const DETALHE_INTERVALO_MS = 350;
let DETALHE_PROXIMO = 0;
// b186 (review do Codex no PR da GOOD) - a espera na FILA conta no prazo
async function esperarVezDetalhe(prazoMs) {
  const agora = Date.now();
  const alvo = Math.max(agora, DETALHE_PROXIMO);
  const espera = alvo - agora;
  if (prazoMs !== undefined && espera > Math.max(0, prazoMs)) return false;
  DETALHE_PROXIMO = alvo + DETALHE_INTERVALO_MS;
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  return true;
}

/**
 * b79 - COPIADO DO CHECKOUT OFFLINE (amb-checkout-offline/produtos.js,
 * funcao primeiraImagem), que ja busca imagem do Bling ha meses.
 * Por que o meu extrator anterior falhava: eu exigia que a URL
 * terminasse em .jpg/.png/etc — e as URLs do Bling nem sempre tem
 * extensao. Alem disso eu nao olhava midia.imagens.imagensURL[].
 */
function primeiraImagem(prod) {
  if (!prod) return null;
  if (prod.imagemURL) return prod.imagemURL;
  const ext = prod.midia && prod.midia.imagens && prod.midia.imagens.externas;
  if (ext && ext[0] && ext[0].link) return ext[0].link;
  const url = prod.midia && prod.midia.imagens && prod.midia.imagens.imagensURL;
  if (url && url[0] && (url[0].link || url[0])) return url[0].link || url[0];
  const int = prod.midia && prod.midia.imagens && prod.midia.imagens.internas;
  if (int && int[0] && int[0].link) return int[0].link;
  return null;
}

/** normaliza pra comparar codigo/EAN sem ruido */
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * b109 - texto sem acento e sem pontuacao, PRESERVANDO os espacos, pra
 * comparar "luminária" com "Luminaria Chao 177cm". O norm() acima cola
 * tudo e serve pra codigo/EAN; este serve pra NOME.
 */
const normTexto = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * O EAN no Bling mora em ate 6 campos diferentes dependendo de como o
 * produto foi cadastrado (licao do projeto Localizacao de Estoque).
 * Le todos e devolve o primeiro que existir.
 */
function eanDoProduto(p) {
  if (!p) return null;
  return p.gtin || p.gtinEmbalagem || p.gtinTributario || p.gtinEan || p.ean ||
         p.codigoBarras || (p.tributacao && (p.tributacao.gtin || p.tributacao.ean)) || null;
}

function montar(router, deps) {
  const { auth, db, bling, cfg, multer } = deps;

  // upload em memoria: a foto vai direto pro Supabase, nao encosta no disco
  // (o servico nao tem disco persistente — ver licao do indice frio).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },   // 12MB por foto
  });

  // b180 - transforma a estrutura crua do Bling em [{sku, quantidade, nome}],
  // consultando o produto do componente quando so veio o id. Teto de 12,
  // cache por id e o mesmo espacamento global das outras consultas.
  // b181 (review do Codex) - devolve TAMBEM o que NAO resolveu. Entregar
  // so as pecas resolvidas como se fossem a composicao inteira faria o
  // estoquista lancar em metade do kit sem saber (falha do Bling num
  // componente, kit com mais de 12 pecas, ou o prazo estourando).
  async function resolverComponentes(comps, limiteExterno) {
    const brutos = Array.isArray(comps) ? comps : [];
    const lista = brutos.filter(Boolean);   // b181 - entrada nula nao derruba a trava
    // b183 (review do Codex no PR da GOOD) - ...mas CONTA como peca que
    // faltou, senao a composicao passaria por completa
    const nulos = brutos.length - lista.length;
    // b184 (review do Codex no PR da GOOD) - prazo REAPROVEITADO quando o
    // chamador ja abriu um (estrutura + pecas somavam ~16s por kit)
    const limite = limiteExterno || (Date.now() + COMPONENTES_PRAZO_MS);
    const alvos = lista.slice(0, COMPONENTES_MAX);
    const truncados = Math.max(0, lista.length - alvos.length);
    const out = [];
    let naoResolvidos = nulos;
    // b195 - guardar o MOTIVO de cada peca que nao entrou: sem isso, o
    // aviso "nao consegui listar N peca(s)" nao diz se foi prazo, erro do
    // Bling ou componente sem codigo — e nao da pra consertar o que se ve.
    const motivos = { nulos: nulos, prazo: 0, fila: 0, erro: 0, sem_sku: 0, truncados: 0, tentou_de_novo: 0 };
    for (const c of alvos) {
      const p = (c && c.produto) || {};
      const id = p.id || c.idProduto || c.produtoId || null;
      let sku = String(p.codigo || p.sku || '').trim();
      let falhouComponente = false;
let imagem = null;   // b200   // b196/v4.80 - motivo DESTE componente
      let nome = String(p.nome || p.descricao || '').trim();
      if (!sku && id) {
        const emCache = skuCacheGet(id);
        if (emCache) { sku = emCache.sku; nome = nome || emCache.nome; imagem = emCache.imagem || null; }
        else if (Date.now() >= limite) { naoResolvidos++; motivos.prazo++; falhouComponente = true; continue; }   // b181/b195
        else {
          try {
            if (!(await esperarVezDetalhe(limite - Date.now()))) { naoResolvidos++; motivos.fila++; falhouComponente = true; continue; }
            const restante = limite - Date.now();
            if (restante <= 0) { naoResolvidos++; motivos.prazo++; falhouComponente = true; continue; }
            // b186 - timeout REAL no axios, nao so o race
            // b195 - UMA SEGUNDA CHANCE dentro do prazo. O `semRetentativa`
            // (que existe pra o POST nao deixar requisicao orfa) fazia
            // QUALQUER tropeco do Bling — um 429 no meio da rajada da
            // propria busca, um timeout curto — virar "peca faltando" na
            // tela, mesmo com prazo de sobra. Foi o caso do kit que veio com
            // 1 peca listada e a outra nao. Agora: pausa curta e tenta mais
            // uma vez, se ainda couber no prazo.
            let d = null;
            let falhouNoBling = false;
            for (let tentativa = 0; tentativa < 2; tentativa++) {
              // b196 (review do Codex) - CADA tentativa reserva sua vaga na
              // fila global: a 2a ia direto ao Bling depois do sleep fixo e
              // podia recriar a rajada de 429 que ela deveria remediar.
              if (tentativa > 0 && !(await esperarVezDetalhe(limite - Date.now()))) { motivos.fila++; break; }
              const sobra = limite - Date.now();
              if (sobra <= 300) { motivos.prazo++; break; }
              const rr = await comPrazo(bling.chamarBling('/produtos/' + id, { timeout: sobra, semRetentativa: true }), sobra);
              d = (rr && rr.ok && rr.data && rr.data.data) || null;
              if (d) { falhouNoBling = false; break; }
              falhouNoBling = true;   // resposta !ok NAO lanca excecao
              // b197 (review do Codex) - so re-tenta o que PODE dar certo sem
              // mudar nada: 429/5xx/rede. Em 401 o semRetentativa impede a
              // renovacao do token (a 2a tentativa usaria o mesmo token morto) e
              // 404 e deterministico — re-tentar so gastava prazo do kit.
              const st = (rr && rr.status) || 0;
              if (st === 401 || st === 403 || st === 404) break;
              motivos.tentou_de_novo++;
              if (limite - Date.now() <= 900) break;
              await new Promise(r2 => setTimeout(r2, 600));
            }
            if (falhouNoBling) { motivos.erro++; falhouComponente = true; }   // b196 - erro do Bling, nao "sem codigo"
            if (d) {
              sku = String(d.codigo || d.sku || '').trim();
              nome = nome || String(d.nome || d.descricao || '').trim();
              // b200 (pedido do Diego) - a PECA leva a propria foto: sem ela
              // o front caia na imagem do KIT e parecia que ele tinha
              // selecionado o kit inteiro em vez da lampada.
              imagem = primeiraImagem(d) || null;
              skuCacheSet(id, sku, nome, imagem);
            }
          } catch (e) {
            // b197/v4.81 (review do Codex) - a falha LANCADA (prazo do comPrazo)
            // tambem marca ESTE componente: sem a flag ele era contado duas
            // vezes (erro + sem_sku) e o diagnostico ficava mentiroso.
            motivos.erro++;
            falhouComponente = true;
          }
        }
      }
      const q = Number(c && (c.quantidade || c.qtd)) || 1;
      if (sku) out.push({ sku, quantidade: q, nome, imagem: imagem || null });
      else {
        naoResolvidos++;
        // b196/v4.80 (review do Codex) - a classificacao e DESTE componente:
        // antes eu olhava contadores agregados, entao o erro de um componente
        // anterior impedia o proximo de ser contado como "sem codigo".
        if (!falhouComponente) motivos.sem_sku++;
      }
    }
    motivos.truncados = truncados;
    const faltando = naoResolvidos + truncados;
    if (faltando) {
      console.log('[KIT] composicao incompleta: ' + faltando + ' peca(s) fora — ' + JSON.stringify(motivos));
    }
    return { itens: out, faltando, motivos };
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/produtos/buscar?q=  — usado pelo modal "Lançar produto com
  // defeito": o estoquista digita nome, SKU ou EAN e escolhe na lista.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/produtos/buscar', auth.requerLogin, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, produtos: [] });

    const alvo = norm(q);
    const vistos = new Set();
    const out = [];
    const push = (p) => {
      const sku = String(p.codigo || p.sku || '').trim();
      if (!sku || vistos.has(sku)) return;
      // ═══════════════════════════════════════════════════════════════
      // b133 - SO PRODUTO SIMPLES pro estoquista. Kit, composicao,
      // variacao e servico nao existem na prateleira: ele nao consegue
      // por um "kit" numa caixa de defeito, e lancar defeito num pai de
      // variacao bagunca o estoque. No Bling: formato 'S' = simples,
      // 'V' = com variacoes, 'E' = com composicao; tipo 'S' = servico.
      // ═══════════════════════════════════════════════════════════════
      // b174 - a LISTAGEM do Bling nem sempre traz o campo `formato`
      // (quando falta, o codigo antigo assumia 'S' e o KIT passava batido,
      // sem o marcador - foi o caso do 9W3KE27-5W3kE14). Agora: se a
      // listagem nao for conclusiva, o veredito fica PENDENTE e sai do
      // detalhe la embaixo, na mesma chamada que ja busca a foto.
      const fmtBruto = String(p.formato || '').toUpperCase();
      const compLista = (p.estrutura && Array.isArray(p.estrutura.componentes))
        ? p.estrutura.componentes.length : 0;
      const idP = p.id || null;
      // b176 (P2 da 2a review do Codex) - TTL NAO DESLIZA. Antes, ler o
      // cache reescrevia o carimbo de hora: produto buscado ao menos uma
      // vez a cada 6h nunca expirava, e um que virasse kit depois ficaria
      // eternamente como simples. Agora so EVIDENCIA NOVA (o campo da
      // listagem ou a estrutura) renova o prazo; leitura de cache nao.
      const fmtFresco = (compLista > 0) ? 'E' : fmtBruto;
      let fmt = fmtFresco || FORMATO_CACHE_get(idP) || '';
      if (fmtFresco) FORMATO_CACHE_set(idP, fmtFresco);  // so evidencia nova renova
      const ehKitBusca = (fmt === 'E');
      if (fmt && fmt !== 'S' && !ehKitBusca) return;     // 'V' e cia continuam fora
      // b167 - o KIT aparece na busca MARCADO, porque a gravacao oferece a
      // EXPLOSAO em N unidades do produto simples (b166); escondido, a
      // explosao ficava sem caminho. Servico e filho de variacao, fora.
      if (String(p.tipo || 'P').toUpperCase() === 'S') return;   // servico
      if (p.produtoPai && p.produtoPai.id) return;               // filho de variacao
      vistos.add(sku);
      out.push({
        sku,
        ehKit: ehKitBusca,
        _fmt: fmt || null,          // b174 - null = ainda a apurar no detalhe
        nomeBase: p.nome || p.descricao || '',
        nome: (ehKitBusca ? '📦 KIT · ' : '') + (p.nome || p.descricao || ''),
        ean: eanDoProduto(p) || '',
        id: p.id || null,
        imagem: (p.imagemURL || (p.midia && p.midia.imagens && p.midia.imagens[0] &&
                 p.midia.imagens[0].link)) || null,
      });
    };

    try {
      // Se parece codigo de barras, pergunta ao Bling pelos filtros dedicados.
      // A LISTAGEM do Bling nao devolve gtin, entao busca por EAN so funciona
      // com filtro no proprio Bling (ou olhando o detalhe de cada candidato).
      const pareceEan = /^\d{8,14}$/.test(q);
      if (pareceEan) {
        for (const filtro of ['gtin', 'codigo']) {
          const r = await bling.chamarBling(`/produtos?${filtro}=${encodeURIComponent(q)}&limite=10`);
          if (r.ok) {
            for (const p of ((r.data && r.data.data) || [])) {
              // o Bling as vezes IGNORA o filtro e devolve a listagem padrao —
              // so aceita quem realmente casa com o termo
              if (norm(eanDoProduto(p)).includes(alvo) || norm(p.codigo).includes(alvo)) push(p);
            }
          }
          if (out.length) break;
          await new Promise(r2 => setTimeout(r2, 200));
        }
        // ultimo recurso: confere o DETALHE dos candidatos por codigo
        if (!out.length) {
          const rC = await bling.chamarBling(`/produtos?codigo=${encodeURIComponent(q)}&limite=5`);
          for (const p of ((rC.ok && rC.data && rC.data.data) || [])) {
            if (!p.id) continue;
            await esperarVezDetalhe();
            const rD = await bling.chamarBling(`/produtos/${p.id}`);
            const det = (rD.ok && rD.data && rD.data.data) || {};
            // b175 (P2 do Codex) - este detalhe ja esta na mao: semeia os
            // caches aqui pra o loop la embaixo nao pedir a MESMA coisa de
            // novo (era uma chamada a toa e um lugar do teto de 12).
            if (det && det.id) {
              const compE = (det.estrutura && Array.isArray(det.estrutura.componentes))
                ? det.estrutura.componentes.length : 0;
              FORMATO_CACHE_set(det.id, compE > 0 ? 'E' : (String(det.formato || 'S').toUpperCase()));
              const urlE = primeiraImagem(det);
              if (urlE) IMG_CACHE.set(det.id, urlE);
            }
            if (norm(eanDoProduto(det)).includes(alvo)) push({ ...p, gtin: eanDoProduto(det) });
            await new Promise(r2 => setTimeout(r2, 150));
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // b98 - O CODIGO VEM PRIMEIRO, SEMPRE.
      // Antes ia direto no ?pesquisa= do Bling, que casa pelo NOME. Ao
      // procurar FL-1011-BRANCO-2LAMPS ele trazia os ACESSORIOS (Kit 2
      // Roscas, Bracadeira "da Luminaria FL-1011") e NAO o produto certo,
      // porque o nome dele nao contem "BRANCO-2LAMPS". Pior: a busca por
      // ?codigo= so rodava se o nome nao achasse nada — e como achava,
      // nunca rodava.
      // Agora: procura pelo CODIGO primeiro (o exato lidera a lista) e
      // depois COMPLEMENTA pelo nome, sem descartar nada.
      // ═══════════════════════════════════════════════════════════════
      if (!out.length) {
        const rS = await bling.chamarBling(`/produtos?codigo=${encodeURIComponent(q)}&limite=10`);
        for (const p of ((rS.ok && rS.data && rS.data.data) || [])) {
          // o Bling as vezes ignora o filtro e devolve a listagem padrao
          if (norm(p.codigo).includes(alvo)) push(p);
        }
      }
      // b99 - ACHOU O CODIGO EXATO? ENTAO ACABOU.
      // Antes eu complementava pelo nome tambem quando vinham poucos
      // resultados (`|| out.length < 5`). Como a busca por codigo devolve
      // UM item — o certo —, essa condicao disparava sempre e colava na
      // lista todos os acessorios que tem "FL-1011" no NOME. Se o SKU
      // exato foi encontrado, ele e a resposta; nao ha o que completar.
      const achouExato = out.some(p => norm(p.sku) === alvo);
      if (!achouExato) {
        // ═══════════════════════════════════════════════════════════════
        // b109 - O BLING AS VEZES IGNORA O FILTRO e devolve o catalogo
        // geral. Foi o que aconteceu ao buscar "luminaria": voltaram
        // carrinho de ferramentas, cavalete, macaco... nada a ver.
        // Antes eu aceitava tudo que viesse. Agora CONFIRMO aqui: so
        // entra quem tem o termo no NOME ou no CODIGO, ignorando acento.
        // Com varias palavras, TODAS precisam aparecer ("luminaria mesa"
        // nao traz toda luminaria da loja).
        // ═══════════════════════════════════════════════════════════════
        const palavras = normTexto(q).split(' ').filter(w => w.length >= 2);
        const casa = (p) => {
          if (!palavras.length) return true;
          const nome = normTexto(p.nome || p.descricao || '');
          const cod = norm(p.codigo || p.sku || '');
          return palavras.every(w => nome.includes(w) || cod.includes(norm(w)));
        };
        const rN = await bling.chamarBling(`/produtos?pesquisa=${encodeURIComponent(q)}&limite=50`);
        let entraram = 0;
        for (const p of ((rN.ok && rN.data && rN.data.data) || [])) {
          if (!casa(p)) continue;
          push(p);
          // b177 - coleta ate 30: o corte final em 20 acontece DEPOIS de
          // tirar os pais de variacao, entao a folga aqui garante a lista
          // cheia de produtos simples mesmo quando varios 'V' sao descartados
          if (++entraram >= 30) break;
        }
      }
      // quem casa EXATO com o que foi digitado sobe pro topo
      out.sort((a, b) => {
        const ea = norm(a.sku) === alvo ? 0 : (norm(a.sku).includes(alvo) ? 1 : 2);
        const eb = norm(b.sku) === alvo ? 0 : (norm(b.sku).includes(alvo) ? 1 : 2);
        return ea - eb;
      });

      // b76/b174 - completa com a FOTO e, de quebra, APURA O FORMATO: o
      // detalhe ja e baixado aqui, e e ele que diz com certeza se o
      // produto e kit. Teto de 12 consultas (era 6 so pra foto), uma de
      // cada vez, com cache por id — quem ja tem veredito nao consulta.
      // b177 (P2 da 3a review) - O CORTE EM 20 VEM DEPOIS DO FILTRO.
      // Antes eu cortava primeiro e so entao descartava pai de variacao:
      // com muitos candidatos, os 'V' ocupavam vagas e produtos simples
      // validos, que ja estavam em `out`, nunca chegavam na tela.
      const candidatos = out;   // b178 - todos os coletados concorrem; o corte em 20 e no fim
      let buscados = 0;
      // b177 (P2 da 3a review) - ids cujo DETALHE ja veio nesta requisicao.
      // Produto sem foto nao alimenta o IMG_CACHE (de proposito: falha nao
      // vira cache), e a passada da foto pedia o MESMO produto de novo,
      // gastando duas chamadas e duas vagas do limitador por item.
      const jaBaixado = new Set();
      // b175 (P1 do Codex) - O FORMATO VEM PRIMEIRO, a foto e opcional.
      // Antes, a mesma fila servia aos dois e uma busca com muitos
      // resultados gastava o teto em fotos, deixando itens SEM veredito
      // (um pai de variacao podia ser escolhido sem ninguem barrar).
      const buscarDetalhe = async (item) => {
        await esperarVezDetalhe();
        const rD = await bling.chamarBling(`/produtos/${item.id}`);
        jaBaixado.add(item.id);                 // b177 - nao pedir de novo
        const det = (rD.ok && rD.data && rD.data.data) || null;
        if (det) {
          const comp = (det.estrutura && Array.isArray(det.estrutura.componentes))
            ? det.estrutura.componentes.length : 0;
          const fmtDet = comp > 0 ? 'E' : String(det.formato || 'S').toUpperCase();
          item._fmt = fmtDet;
          if (fmtDet === 'E') item._compsCru = extrairComponentes(det);   // b182
          FORMATO_CACHE_set(item.id, fmtDet);     // so o APURADO vira cache
        }
        const url = primeiraImagem(det);
        if (url) IMG_CACHE.set(item.id, url);     // so sucesso
        if (!item.imagem) item.imagem = url;
      };
      // 1a passada: veredito de formato (o que protege o estoque)
      for (const item of candidatos) {
        if (!item.id) continue;
        if (!item._fmt) {
          const doCache = FORMATO_CACHE_get(item.id);
          if (doCache) { item._fmt = doCache; }
        }
        if (item._fmt || buscados >= 12) continue;
        try { await buscarDetalhe(item); } catch (e) { /* falha nao vira veredito */ }
        buscados++;
      }
      // b174/b177 - com o veredito na mao: pai de variacao sai, kit ganha o
      // marcador, e SO ENTAO o corte em 20 acontece (assim um 'V' nao rouba
      // a vaga de um produto simples valido que estava logo atras na fila).
      const filtrados = [];
      for (const item of candidatos) {
        if (item._fmt === 'V') continue;
        if (item._fmt === 'E') {
          item.ehKit = true;
          if (String(item.nome || '').indexOf('📦 KIT · ') !== 0) {
            item.nome = '📦 KIT · ' + (item.nomeBase || item.nome || '');
          }
        }
        filtrados.push(item);
      }
      const finais = filtrados.slice(0, 20);
      // b196 (review do Codex) - a resolucao de composicao virou FUNCAO
      // porque agora ela roda DUAS vezes: antes das fotos (caso comum) e
      // DEPOIS delas, para o kit que so se revelou 'E' durante a passada de
      // fotos (cache de formato dizia 'S' porque o produto virou kit agora).
      // Sem a segunda passagem, esse kit chegava na tela como card travado,
      // sem peca nenhuma pra clicar.
      // b197 (review do Codex) - o teto de 3 kits e o prazo do laco sao do
      // PEDIDO, nao de cada passagem: com contador novo na 2a chamada uma
      // busca podia resolver 6 kits e gastar dois orcamentos inteiros.
      let kitsResolvidosPedido = 0;
      const prazoLacoPedido = Date.now() + PRAZO_KIT_BUSCA_MS * 2;
      const resolverComposicaoDosKits = async (itens) => {
        // b195 (bug real do Diego: kit veio com 1 peca listada e a outra
        // faltando) - a COMPOSICAO passou pra ANTES DAS FOTOS. A fila global
        // de 350ms por consulta ja chegava congestionada na fase do kit: o
        // prazo se gastava ESPERANDO VAGA e a 2a peca ficava sem resolver.
        // Foto e enfeite; a composicao e o que ele precisa pra clicar.
        // b182 (pedido do Diego: "no proprio card ja destrinchar") - os kits
        // que vao pra tela levam a COMPOSICAO junto, pra o estoquista escolher
        // a peca ali mesmo: sem popup e sem precisar preencher e salvar antes.
        // b197 - compartilhados entre as duas passagens (ver acima)
        // b195 - na BUSCA o prazo e mais folgado que no POST: aqui ninguem
        // esta esperando pra gravar, e cortar cedo demais foi o que deixou o
        // kit com peca faltando. No POST /adicionar segue COMPONENTES_PRAZO_MS.
        const prazoLaco = prazoLacoPedido;
        for (const item of itens) {
          if (item._fmt !== 'E' || !item.id) continue;
          if (kitsResolvidosPedido >= 3) break;          // kit e excecao na busca; teto barato
          if (Date.now() >= prazoLaco) break;      // b184 - tempo do laco esgotado
          const doCache = compsCacheGet(item.id);
          if (doCache) {
            item.componentes = doCache.itens;
            item.componentes_faltando = doCache.faltando;
            kitsResolvidosPedido++;
            continue;
          }
          const prazoKit = Math.min(Date.now() + PRAZO_KIT_BUSCA_MS, prazoLaco);   // b184/b195
          let estruturaFalhou = false;   // b196
          let cru = item._compsCru;
          if (!cru) {
            try {
              // b187 - a vaga NEM E RESERVADA se nascer depois do prazo
              if (!(await esperarVezDetalhe(prazoKit - Date.now()))) throw new Error('fila alem do prazo do kit');
              // b185 (review do Codex) - a espera na FILA tambem conta no prazo
              const restanteKit = prazoKit - Date.now();
              if (restanteKit <= 0) throw new Error('prazo do kit esgotado na fila');
              // b187 - timeout real + sem retentativa orfa (o 429/401 do
              // chamarBling dormia 1,5s e disparava outra requisicao depois
              // que este laco ja tinha desistido)
              const rK = await comPrazo(
                bling.chamarBling('/produtos/' + item.id, { timeout: restanteKit, semRetentativa: true }),
                restanteKit);
              // b197 (review do Codex) - este detalhe ja veio: aproveita a IMAGEM e
              // marca o id como baixado, senao a passada de fotos pedia o MESMO
              // produto de novo (uma requisicao a toa por kit, justo na hora em
              // que a gente esta tentando aliviar a fila).
              try {
                const detK = (rK && rK.ok && rK.data && rK.data.data) || null;
                if (detK) {
                  jaBaixado.add(item.id);
                  const urlK = primeiraImagem(detK);
                  if (urlK) { IMG_CACHE.set(item.id, urlK); if (!item.imagem) item.imagem = urlK; }
                }
              } catch (e) { /* imagem e opcional */ }
              // b197 (review do Codex) - resposta {ok:false} (429, rede, timeout)
              // NAO lanca: sem isto o log dizia "Bling devolveu sem componentes"
              // quando na verdade a CONSULTA falhou — diagnostico errado.
              if (!rK || !rK.ok) estruturaFalhou = true;
              const dK = (rK && rK.ok && rK.data && rK.data.data) || null;
              cru = extrairComponentes(dK);
            } catch (e) { cru = null; estruturaFalhou = true; }   // b196
          }
          if (!cru || !cru.length) {
        // b196 (review do Codex) - a falha ao buscar a ESTRUTURA do kit
        // ficava MUDA: sem componentes, sem motivo, sem log — justamente uma
        // das causas plausiveis do kit que apareceu sem peca. Agora ela se
        // declara igual as outras, e a tela mostra o aviso.
        item.componentes = [];
        item.componentes_faltando = 1;
        item.componentes_motivo = { estrutura_falhou: estruturaFalhou ? 1 : 0, estrutura_vazia: estruturaFalhou ? 0 : 1 };
        console.log('[KIT] nao consegui a estrutura do kit ' + item.id + ' — '
          + (estruturaFalhou ? 'consulta falhou/prazo' : 'Bling devolveu sem componentes'));
        kitsResolvidosPedido++;
        continue;
      }
      if (cru && cru.length) {
            const rC = await resolverComponentes(cru, prazoKit);
            item.componentes = rC.itens;
            item.componentes_faltando = rC.faltando;
            item.componentes_motivo = rC.motivos;   // b195 - diagnostico na resposta
            // b183 - so a composicao COMPLETA vira cache de 6h (parcial presa
            // no cache faria o "tente de novo em instantes" virar mentira)
            if (rC.faltando === 0) COMPS_POR_KIT.set(item.id, { itens: rC.itens, faltando: 0, ts: Date.now() });
          }
          kitsResolvidosPedido++;
        }

      };
      await resolverComposicaoDosKits(finais);
      // 2a passada: foto — so nos que VAO PRA TELA, e pulando quem ja teve
      // o detalhe baixado agora ha pouco (b177: ja sabemos que nao tem foto)
      for (const item of finais) {
        if (!item.id || item.imagem || jaBaixado.has(item.id)) continue;
        if (IMG_CACHE.has(item.id)) { item.imagem = IMG_CACHE.get(item.id); continue; }
        if (buscados >= 12) break;
        try { await buscarDetalhe(item); } catch (e) { /* sem foto e ok */ }
        buscados++;
      }
      // b196 - kits que so se revelaram na passada de fotos entram agora
      // b198 (review do Codex) - `!i.componentes` nao pegava quem ficou com
      // lista VAZIA (estrutura que falhou na 1a passagem): esse kit perdia a
      // segunda chance e ia pra tela como card travado.
      await resolverComposicaoDosKits(finais.filter(i => i._fmt === 'E' && !(i.componentes && i.componentes.length)));
      // b178 (review do Codex) - a passada da foto tambem APURA formato: um
      // item que entrou sem veredito pode se revelar 'V' (ou kit) ali. Sem
      // este segundo filtro, o pai de variacao recem-descoberto seguiria na
      // lista — o filtro de cima ja tinha passado por ele.
      const entregues = [];
      for (const item of finais) {
        if (item._fmt === 'V') continue;
        if (item._fmt === 'E') {
          item.ehKit = true;
          if (String(item.nome || '').indexOf('📦 KIT · ') !== 0) {
            item.nome = '📦 KIT · ' + (item.nomeBase || item.nome || '');
          }
        } else if (item._fmt === 'S' && item.ehKit) {
          // b179 (review do Codex) - deixou de ser kit no Bling: tira o
          // rotulo, senao o produto seguiria marcado 📦 (e a gravacao
          // ofereceria uma explosao que nao existe mais)
          item.ehKit = false;
          item.nome = item.nomeBase || String(item.nome || '').replace('📦 KIT · ', '');
        }
        delete item._fmt; delete item.nomeBase; delete item._compsCru;
        entregues.push(item);
      }
      res.json({ ok: true, produtos: entregues, termo: q });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/produto/imagem/:chave   (b78)
  // A tela pede a foto pelo SKU (que e o que ela tem do item da NF) ou
  // pelo id do produto. Resolve o id quando vier SKU, busca o detalhe e
  // extrai a imagem. Cache por chave: bipar o mesmo produto de novo nao
  // consulta o Bling.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/produto/imagem/:chave', auth.requerLogin, async (req, res) => {
    const chave = String(req.params.chave || '').trim();
    if (!chave) return res.status(400).json({ ok: false, erro: 'informe o sku ou o id' });
    if (IMG_CACHE.has(chave)) {
      return res.json({ ok: true, chave, imagem: IMG_CACHE.get(chave), cache: true });
    }
    try {
      // mesmo caminho do checkout offline: lista por codigo (que ja pode
      // trazer imagemURL) e, se precisar, abre o detalhe do produto
      // ═══════════════════════════════════════════════════════════════
      // b111 - NUMERO NAO E ID. Eu assumia que chave so de digitos era o
      // id do produto no Bling — mas tem SKU numerico (ex: o
      // 3933398010054 da luminaria preta). Resultado: pedia
      // /produtos/3933398010054, nao achava, e a foto vinha vazia.
      // Agora tenta sempre pelo CODIGO primeiro (serve pros dois casos),
      // depois pelo EAN, e so por ultimo trata como id.
      // ═══════════════════════════════════════════════════════════════
      let id = null;
      let url = null;
      let via = null;   // b227 - por onde a foto veio (ou por que nao veio)
      let eanApontaPara = null;   // b228 - de quem e o EAN, quando nao e do SKU
      let nomeCandidatos = null;  // b228 - o que a busca por nome trouxe

      const rL = await bling.chamarBling(`/produtos?codigo=${encodeURIComponent(chave)}&limite=3`);
      // b227 (review do Codex — e a causa mais provavel da foto errada que o
      // Diego viu): o `|| lista[0]` era um FALLBACK CEGO. Quando o Bling
      // ignora o filtro ?codigo= e devolve a pagina padrao, esse primeiro
      // item — um produto qualquer — virava o "achado", com id e foto, e
      // ainda ia pro IMG_CACHE sob o SKU pedido. Mesmo padrao que ja mordeu
      // na b98 (busca) e na b160 (entrada de estoque): fallback frouxo
      // devolve com confianca o produto errado.
      const porCodigo = ((rL.ok && rL.data && rL.data.data) || [])
        .find(p => String(p.codigo || '').trim().toUpperCase() === chave.toUpperCase()) || null;
      if (porCodigo) { url = primeiraImagem(porCodigo); id = porCodigo.id || null; via = 'lista_codigo'; }

      if (!id && /^\d{12,14}$/.test(chave)) {
        // b227 - aqui a CHAVE PEDIDA e o proprio EAN, entao o produto que o
        // gtin devolve E o produto pedido: nao ha o que validar contra.
        // (Diferente do ?ean= da tela, que e um dado auxiliar.)
        const rE = await bling.chamarBling(`/produtos?gtin=${encodeURIComponent(chave)}&limite=1`);
        const porEan = (rE.ok && rE.data && rE.data.data && rE.data.data[0]) || null;
        if (porEan) { url = url || primeiraImagem(porEan); id = porEan.id || null; via = 'gtin_da_chave'; }
      }

      if (!id && /^\d{6,}$/.test(chave)) id = chave;   // ai sim: e um id

      // b225 (o Diego mediu: FL-1011-PRETO devolvia imagem null, e "todo
      // produto anunciado tem foto no Bling") - o erro era meu: quando o
      // ?codigo= volta VAZIO (o Bling as vezes ignora o filtro — mesmo
      // padrao da b98), `id` ficava null, SKU com letras nunca vira id, e a
      // rota desistia SEM NUNCA ABRIR O DETALHE, que e onde a imagem mora.
      // Agora ha mais dois caminhos antes de desistir: o EAN que a propria
      // tela ja conhece, e a busca por nome.

      const ean = String(req.query.ean || '').replace(/\D/g, '');
      if (!id && ean.length >= 12) {
        // b226 (o Diego viu foto de OUTRO produto no card) - eu aceitava
        // QUALQUER item que o gtin devolvesse. EAN repetido/errado no
        // cadastro, ou o Bling ignorando o filtro, trazia outro produto e a
        // foto dele ia pra tela como se fosse a da devolucao. Agora o
        // codigo tem que BATER com o SKU pedido; senao, nao serve.
        const rE2 = await bling.chamarBling(`/produtos?gtin=${encodeURIComponent(ean)}&limite=5`);
        const cands = (rE2.ok && rE2.data && rE2.data.data) || [];
        const p2 = cands.find(p => String(p.codigo || '').trim().toUpperCase() === chave.toUpperCase()) || null;
        if (p2) { url = url || primeiraImagem(p2); id = p2.id || null; via = 'ean_da_tela'; }
        else if (cands.length) {
          via = 'ean_descartado_sku_diferente';
          // b228 - DIZER EM QUAL produto o EAN caiu. Sem isso o Diego sabe
          // que ha divergencia, mas nao onde consertar no Bling.
          eanApontaPara = cands.slice(0, 3).map(p => ({
            id: p.id || null, codigo: p.codigo || null, nome: p.nome || null,
          }));
        }
      }
      if (!id) {
        const rP = await bling.chamarBling(`/produtos?pesquisa=${encodeURIComponent(chave)}&limite=5`);
        const lista = (rP.ok && rP.data && rP.data.data) || [];
        const alvo = lista.find(p => String(p.codigo || '').trim().toUpperCase() === chave.toUpperCase()) || null;
        if (alvo) { url = url || primeiraImagem(alvo); id = alvo.id || null; via = 'pesquisa_nome'; }
        // b228 - se a busca por nome trouxe produtos mas nenhum com este
        // codigo, mostrar os codigos que vieram: e assim que se descobre que
        // o SKU do anuncio nao e o codigo do Bling (ex: FL-1011-PRETO x FL1011P)
        else if (lista.length) nomeCandidatos = lista.slice(0, 5).map(p => p.codigo || p.nome || null);
      }
      if (!url && id) {
        const rD = await bling.chamarBling(`/produtos/${id}`);
        url = primeiraImagem((rD.ok && rD.data && rD.data.data) || null);
        if (url) via = (via || '') + '+detalhe';
      }
      // so cacheia SUCESSO — nunca fixa uma falha (licao do produtoDetalhe
      // do checkout: um 429 passageiro deixaria o produto sem foto pra sempre)
      if (url) IMG_CACHE.set(chave, url);
      // b225 - dizer POR ONDE achou (ou por que nao achou), como a GOOD ja
      // fazia: "imagem: null" sozinho nao distinguia produto sem foto de
      // SKU nao encontrado.
      res.json({
        ok: true, chave, imagem: url, via,
        ean_aponta_para: eanApontaPara,     // b228
        codigos_parecidos: nomeCandidatos,  // b228
        motivo: url ? null
          : (id ? 'produto encontrado, mas sem foto no cadastro'
            : (via === 'ean_descartado_sku_diferente'
                ? 'o EAN desta venda esta cadastrado em OUTRO produto no Bling — nao usei a foto dele'
                : 'nao achei esse SKU no Bling (nem por codigo, nem por EAN, nem por nome)')),
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/produto/ean-por-sku/:sku
  // A listagem do Bling NAO traz o gtin — so o detalhe do produto traz.
  // Por isso: acha pelo codigo, depois abre o detalhe pra pegar o EAN.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/produto/ean-por-sku/:sku', auth.requerLogin, async (req, res) => {
    const sku = String(req.params.sku || '').trim();
    if (!sku) return res.status(400).json({ ok: false, erro: 'sku obrigatorio' });
    try {
      const r = await bling.buscarProdutoPorSku(sku);
      if (!r.ok) return res.status(200).json({ ok: false, erro: r.erro || 'falha no Bling' });
      const exato = r.exato;
      if (!exato) return res.json({ ok: true, encontrado: false, sku });

      let ean = eanDoProduto(exato);
      let det = null;
      if (!ean && exato.id) {
        const rD = await bling.chamarBling(`/produtos/${exato.id}`);
        det = (rD.ok && rD.data && rD.data.data) || null;
        ean = eanDoProduto(det);
      }
      res.json({
        ok: true, encontrado: true, sku,
        produto: {
          id: exato.id, nome: exato.nome || (det && det.nome) || null,
          codigo: exato.codigo, gtin: ean || null,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/triagem/upload-foto  (multipart, campo "foto")
  // As fotos sao a PROVA pra contestar com o marketplace — vao pro Storage
  // do Supabase, nao pro disco (o servico nao tem disco persistente).
  // Bucket: env AMB_FOTOS_BUCKET (padrao "fotos-problema").
  // ─────────────────────────────────────────────────────────────────────
  router.post('/api/triagem/upload-foto', auth.requerLogin, upload.single('foto'), async (req, res) => {
    const cliente = db.conectar();
    if (!cliente) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
    if (!req.file) return res.status(400).json({ ok: false, erro: 'Foto nao enviada' });

    const bucket = process.env.AMB_FOTOS_BUCKET || 'fotos-problema';
    const ext = String(req.file.originalname || 'foto.jpg').split('.').pop().toLowerCase();
    const nome = `amb/${req.usuario}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

    try {
      const { error } = await cliente.storage.from(bucket).upload(nome, req.file.buffer, {
        contentType: req.file.mimetype || 'image/jpeg',
        upsert: false,
      });
      if (error) {
        console.error('[AMB/FOTO] erro:', error.message);
        return res.status(500).json({ ok: false, erro: error.message, bucket });
      }
      const { data: pub } = cliente.storage.from(bucket).getPublicUrl(nome);
      console.log(`[AMB/FOTO] ${req.usuario}: ${nome} (${(req.file.size / 1024).toFixed(0)}KB)`);
      res.json({ ok: true, url: pub.publicUrl, filename: nome });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/triagem/status/:id  — esse pacote ja foi triado?
  // O mesmo pacote pode ter sido gravado por identificadores diferentes
  // (order_id num bipe, tracking noutro, numero da NF noutro), entao
  // procura pelos tres de uma vez. ?tambem= aceita um 2o identificador.
  //
  // b151 - AVISO DE "JA TRIADO" CONSERTADO. A tela (busca.js da GOOD)
  // le d.registros[] com tipo / status / created_at / problema_descricao
  // — e esta rota devolvia {triado, registro} (singular, nomes da AMB).
  // registros vinha sempre vazio e o aviso de duplicata NUNCA aparecia:
  // bipar um pacote ja triado abria a triagem de novo como se fosse
  // novo. Agora: acha via jaTriado, carrega o registro COMPLETO via
  // obterTriagem e traduz pro formato da GOOD — na AMB o "tipo" mora no
  // campo status (aprovado/problema/divergente; concluido ao concluir),
  // a data e criado_em e quem triou esta na coluna funcionario (a GOOD
  // extrai da descricao por regex, entao anexamos "[Reportado por X]"
  // NA RESPOSTA quando a descricao nao traz o padrao — o banco nao muda).
  // ─────────────────────────────────────────────────────────────────────
  const TIPOS_TRIAGEM = ['aprovado', 'problema', 'divergente'];
  function registroParaGood(reg) {
    if (!reg) return null;
    const tipo = reg.tipo || (TIPOS_TRIAGEM.includes(reg.status) ? reg.status : '');
    let desc = String(reg.problema_descricao || '');
    const temPadrao = /Aprovado por\s+\w+|\[Reportado por\s+\w+\]|\[DIVERGENTE por\s+\w+\]/i.test(desc);
    if (!temPadrao && reg.funcionario) desc = (desc + ' [Reportado por ' + reg.funcionario + ']').trim();
    return Object.assign({}, reg, {
      tipo,
      created_at: reg.created_at || reg.criado_em || null,
      problema_descricao: desc,
    });
  }

  router.get('/api/triagem/status/:id', auth.requerLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, erro: 'identificador obrigatorio', registros: [] });
    const tambem = String(req.query.tambem || '').trim();

    try {
      let r = await db.jaTriado({ orderId: id, tracking: id, nfNumero: id });
      if ((!r.ok || !r.triado) && tambem && tambem !== id) {
        const r2 = await db.jaTriado({ orderId: tambem, tracking: tambem, nfNumero: tambem });
        if (r2.ok && r2.triado) r = r2;
      }
      if (!r.ok) return res.json({ ok: false, erro: r.erro || '', registros: [] });

      let reg = r.registro || null;
      if (reg && reg.id) {
        const full = await db.obterTriagem(reg.id);   // select * — traz tipo/descricao
        if (full.ok && full.registro) reg = full.registro;
      }
      res.json({
        ok: true,
        triado: !!reg,                       // formato antigo preservado
        registro: reg,
        registros: reg ? [registroParaGood(reg)] : [],   // o que a tela le
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e), registros: [] });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // b56 - NOMES DE ROTA DA GOOD
  // Os modulos JS da GOOD chamam estes caminhos. Como o payload dela usa
  // os mesmos campos que o registrarTriagem da AMB aceita, aqui e so
  // encaminhar com o status certo — nada de traduzir campo a campo.
  // ═══════════════════════════════════════════════════════════════════
  const corpo = (req) => (req.body && req.body.dados) || req.body || {};

  /**
   * b66 - A tela manda MAIS campos do que o registrarTriagem da AMB
   * grava (produto_valor_unit, nf_link_danfe, buyer_id, buyer_nickname,
   * produto_mlb, magalu_protocolo, marketplace, tracking). Sem eles o
   * card do painel fica sem valor, sem link da DANFE e sem o link do
   * pedido no marketplace.
   * Aqui completamos o registro DEPOIS do insert. Se alguma coluna nao
   * existir na tabela, o update inteiro falha — entao neste caso tenta
   * campo a campo e salva o que der. Nunca derruba a triagem: o
   * registro principal ja foi gravado.
   */
  // b113 - problema_fotos entra aqui: o registrarTriagem da AMB NAO aceita
  // essa coluna, entao as 6 fotos da triagem eram enviadas, subiam pro
  // Storage e sumiam na hora de gravar a linha. Era por isso que a ficha
  // dizia "FOTOS DA TRIAGEM (0)".
  const EXTRAS = ['produto_valor_unit', 'nf_link_danfe', 'buyer_id', 'buyer_nickname',
                  'produto_mlb', 'magalu_protocolo', 'marketplace', 'tracking',
                  'problema_fotos'];
  async function completarRegistro(r, d) {
    // a tela manda as fotos com nomes diferentes conforme o fluxo
    if (!d.problema_fotos) {
      const alt = d.fotos || d.fotos_parcial || d.problemaFotos;
      if (Array.isArray(alt) && alt.length) d = Object.assign({}, d, { problema_fotos: alt });
    }
    const id = r && r.registro && r.registro.id;
    if (!id) return r;
    const campos = {};
    for (const k of EXTRAS) if (d[k] != null && d[k] !== '') campos[k] = d[k];
    if (!Object.keys(campos).length) return r;
    try {
      const u = await db.atualizarTriagem(id, campos);
      if (u.ok) return { ...r, registro: u.registro };
      // alguma coluna nao existe: salva uma a uma o que a tabela aceitar
      let ultimo = r;
      for (const [k, v] of Object.entries(campos)) {
        try {
          const u2 = await db.atualizarTriagem(id, { [k]: v });
          if (u2.ok) ultimo = { ...ultimo, registro: u2.registro };
        } catch (e) { /* coluna inexistente: ignora esse campo */ }
      }
      return ultimo;
    } catch (e) { return r; }
  }


  /** Triagem OK: o que voltou confere com a NF. */
  router.post('/api/triagem/aprovar', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    const r = await db.registrarTriagem({ ...d, status: 'aprovado', funcionario: req.usuario });
    res.json(r.ok ? await completarRegistro(r, d) : r);
  });

  /** Produto com problema: avisa por e-mail e responde se ha outras
   *  unidades do mesmo SKU em defeito (a tela usa pro alerta de
   *  canibalizacao) — mesmo comportamento do /api/triagem/registrar. */
  router.post('/api/triagem/problema', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    let r = await db.registrarTriagem({ ...d, status: 'problema', funcionario: req.usuario });
    if (!r.ok) return res.json(r);
    r = await completarRegistro(r, d);
    try { emailAMB.avisarProblema({ ...d, funcionario: req.usuario }); } catch (e) {}
    let canibalizacao = null;
    if (d.produto_sku) {
      const outras = await db.defeitosDoSku(d.produto_sku);
      if (outras.ok && outras.unidades && outras.unidades.length > 1) {
        canibalizacao = { outras_unidades: outras.unidades.length - 1, unidades: outras.unidades };
      }
    }
    res.json({ ...r, canibalizacao });
  });

  /** Veio produto DIFERENTE do que a NF diz. */
  router.post('/api/triagem/divergente', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    const r = await db.registrarTriagem({ ...d, status: 'divergente', funcionario: req.usuario });
    res.json(r.ok ? await completarRegistro(r, d) : r);
  });

  /** Chegou com defeito mas o estoquista CONSERTOU: entra como aprovado,
   *  com o registro do conserto na descricao. Se usou peca de outra
   *  unidade em defeito, marca a retirada (canibalizacao). */
  router.post('/api/triagem/consertado', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    const problema = String(d.descricao || d.problema_descricao || '').trim();
    if (!problema) return res.status(400).json({ ok: false, erro: 'descreva o que estava com defeito' });
    const peca = String(d.peca || '').trim();
    const doador = d.doador_id ? Number(d.doador_id) : null;
    const texto = `CONSERTADO por ${req.usuario}: ${problema}` +
      (peca ? ` | peca usada: ${peca}` : '') +
      (doador ? ` | retirada do defeito #${doador}` : '');

    const r = await db.registrarTriagem({
      ...d, status: 'aprovado', funcionario: req.usuario, problema_descricao: texto,
    });
    if (!r.ok) return res.json(r);
    if (doador) {
      try {
        await db.registrarPecaRetirada({ defeitoId: doador, peca: peca || problema,
          usadaEm: d.shipment_id || d.nf_chave || null, quem: req.usuario });
      } catch (e) { /* o conserto ja foi gravado; a retirada e complemento */ }
    }
    res.json({ ...r, consertado: true });
  });

  /** Ha outras unidades do mesmo SKU guardadas em defeito? */
  router.get('/api/defeitos/por-sku', auth.requerLogin, async (req, res) => {
    res.json(await db.defeitosDoSku(req.query.sku));
  });

  /** Lancar produto com defeito no estoque (o "+ Lançar produto com
   *  defeito" da tela). Valida o SKU no Bling antes de gravar. */
  router.post('/api/defeitos/adicionar', auth.requerLogin, async (req, res) => {
    // ═══════════════════════════════════════════════════════════════════
    // b110 - A TELA MANDA OUTROS NOMES. Ela envia {defeito, qtd} e eu lia
    // {descricao, quantidade}: a descricao do defeito virava NULL e a
    // quantidade voltava pra 1, sempre. Por isso o card do estoque de
    // defeitos aparecia sem o problema escrito. Aceito os dois nomes.
    // ═══════════════════════════════════════════════════════════════════
    const b = corpo(req);
    const sku = b.sku;
    const localizacao = b.localizacao;
    const descricao = b.descricao || b.defeito || null;
    const quantidade = b.quantidade || b.qtd || 1;
    if (!sku || !localizacao) {
      return res.status(400).json({ ok: false, erro: 'informe ao menos sku e localizacao' });
    }
    const prod = await bling.buscarProdutoPorSku(String(sku));
    const exato = prod.ok ? prod.exato : null;

    // b137 - MESMA TRAVA DE KIT DA GOOD. O filtro da busca e conveniencia;
    // aqui e o ponto que nao depende do estoquista reparar na tela.
    if (exato && exato.id) {
      try {
        const rDet = await bling.chamarBling('/produtos/' + exato.id);
        const det = (rDet.ok && rDet.data && rDet.data.data) || null;
        const comps = extrairComponentes(det);   // b180 - tolerante ao formato
        const fmtDet = String((det && det.formato) || '').toUpperCase();
        if (det && det.id) FORMATO_CACHE_set(det.id, comps.length > 0 ? 'E' : (fmtDet || 'S'));
        // b175 (P1 da review do Codex no PR #2) - a busca resolve o formato
        // de ate 12 candidatos; o que passar disso chega aqui SEM veredito.
        // Entao a trava — que ja baixa o detalhe e nao depende do
        // estoquista reparar na tela — passa a barrar tambem o PAI DE
        // VARIACAO ('V'), que antes so era filtrado na busca: lancar
        // defeito nele bagunca o estoque de todos os filhos.
        if (fmtDet === 'V') {
          return res.status(400).json({
            ok: false,
            erro: '"' + (exato.codigo || sku) + '" e um produto PAI de variacoes, nao uma peca.'
              + ' Escolha a variacao exata (cor/tamanho) que esta com defeito — e ela que'
              + ' existe na prateleira e no estoque.',
            variacao_pai: true,
          });
        }
        const ehKit = comps.length > 0 || fmtDet === 'E';
        if (ehKit) {
          // b166/b180 - componentes ESTRUTURADOS (resolvendo id -> SKU),
          // pra tela oferecer a explosao em N unidades do produto simples
          const resolucao = await resolverComponentes(comps);
          const componentesDet = resolucao.itens;
          const sugestoes = componentesDet.map(c => c.quantidade + 'x ' + c.sku);
          return res.status(400).json({
            ok: false,
            erro: '"' + (exato.codigo || sku) + '" e um KIT, nao um produto simples.'
              + (sugestoes.length ? ' Ele e composto por ' + sugestoes.join(' + ') + '.' : '')
              + ' Lance o defeito no produto simples - e ele que existe na prateleira,'
              + ' no estoque e na nota fiscal.',
            kit: true, componentes: sugestoes,
            kit_sku: exato.codigo || sku,
            componentes_det: componentesDet,
            // b181 - a tela precisa saber que a composicao veio INCOMPLETA
            composicao_completa: resolucao.faltando === 0,
            componentes_faltando: resolucao.faltando,
          });
        }
      } catch (e) { /* Bling fora do ar nao pode travar o galpao */ }
    }
    // b113 - FOTOS TAMBEM NO LANCAMENTO. Antes so a triagem do pacote
    // gerava foto, e a peca lancada a mao ficava sem prova nenhuma do
    // estado dela. Elas vao pra mesma coluna (problema_fotos), entao a
    // ficha mostra as duas origens no mesmo carrossel.
    const fotos = Array.isArray(b.fotos) ? b.fotos.filter(Boolean) : [];
    let r = await db.registrarTriagem({
      tipo: 'defeito_estoque', status: 'concluido',
      produto_sku: exato ? exato.codigo : sku,
      produto_titulo: exato ? exato.nome : null,
      problema_descricao: descricao || null,
      localizacao, defeito_qtd: Number(quantidade || 1),
      funcionario: req.usuario,
    });
    // as fotos vao num segundo passo, pelo mesmo caminho da triagem
    if (r.ok && fotos.length) r = await completarRegistro(r, { problema_fotos: fotos });
    // b114 - devolve o que FICOU GRAVADO. A tela mostra isso na hora, entao
    // se a descricao nao entrar da pra ver no ato, e nao dias depois ao
    // abrir a ficha.
    // b122 - devolve tambem o produto e o NUMERO da peca: e o que a
    // etiqueta 10x15 imprime. Sem isso ela saia com "SKU: -".
    if (r.ok && r.registro) {
      r.peca_id = r.registro.id;
      r.sku = r.registro.produto_sku;
      r.nome = r.registro.produto_titulo;
      r.ean = exato ? (exato.gtin || exato.ean || null) : null;
      r.gravado = {
        defeito: r.registro.problema_descricao || null,
        quantidade: r.registro.defeito_qtd,
        fotos: Array.isArray(r.registro.problema_fotos) ? r.registro.problema_fotos.length : 0,
      };
    }
    res.json({ ...r, sku_validado_no_bling: !!exato });
  });

  // b71 - o atalho 307 pra /api/triagem/identificar SAIU daqui.
  // A rota /api/devolucao/identificar agora e a da GOOD de verdade
  // (lib-AMB/identificar-AMB.js), que devolve o formato que a tela le:
  // data.order, data.nf, data.metodo, data.eh_devolucao.

  /** O estoquista leu o recado. */
  router.post('/api/recado/:id/ciente', auth.requerLogin, async (req, res) => {
    res.json(await db.marcarCiente(req.params.id, req.usuario));
  });

  /**
   * A tela chama /health no boot e mostra `server v{version}` no topo.
   * O meu devolvia so {ok, modulo} — sem o campo `version` a tela
   * escrevia "server v?". Agora responde o que ela le.
   * A versao vem por injecao quando o app passar (deps.versao); enquanto
   * nao passar, usa a constante abaixo — se voce ver um numero velho no
   * topo da tela, e esta linha que precisa subir junto.
   */
  const VERSAO_MODULO = (deps && deps.versao) || 'AMB b68';
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'amb-devolucoes',
      version: VERSAO_MODULO,
      integrations: {
        bling: !!(bling.temToken && bling.temToken()),
        supabase: !!(db.ligado && db.ligado()),
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // b62 - ROTAS /api/admin/* QUE O PAINEL DA GOOD CHAMA
  // A b61 trouxe as 13 do modulo rotas-admin-nf. Estas outras moram no
  // server.js da GOOD e a AMB ja tem o equivalente com OUTRO NOME —
  // entao aqui e so traduzir nome e formato.
  // ═══════════════════════════════════════════════════════════════════

  /** As 3 filas de uma vez, no formato que o painel espera. */
  router.get('/api/admin/devolucoes', auth.requerLogin, async (req, res) => {
    try {
      const [apr, prob, div] = await Promise.all([
        db.listarFila({ status: 'aprovado' }),
        db.listarFila({ status: 'problema' }),
        db.listarFila({ status: 'divergente' }),
      ]);
      const lista = (r) => (r && r.ok && Array.isArray(r.registros)) ? r.registros : [];
      const aprovadas = lista(apr), problemas = lista(prob), divergentes = lista(div);
      res.json({
        ok: true, aprovadas, problemas, divergentes,
        total: aprovadas.length + problemas.length + divergentes.length,
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  /** Recados: mesma coisa, so o nome muda (singular na GOOD). */
  router.get('/api/admin/recados', auth.requerLogin, async (req, res) => {
    res.json(await db.listarRecados({ resolvidos: req.query.resolvidos === '1' }));
  });

  // b219 - EDITAR um recado (texto e/ou identificador). Só admin: o aviso
  // trava a triagem, entao quem muda o texto muda a instrucao do galpao.
  router.put('/api/admin/recado/:id', auth.requerLogin, async (req, res) => {
    const s = auth.validarSessao(auth.tokenDaRequisicao(req), 'admin');
    if (!s) return res.status(403).json({ ok: false, erro: 'so o admin edita recados' });
    const b = corpo(req);
    const r = await db.editarRecado(req.params.id, {
      identificador: b.identificador || b.chave || null,
      texto: b.texto || null,
    });
    res.status(r.ok ? 200 : 400).json(r);
  });

  router.post('/api/admin/recado', auth.requerLogin, async (req, res) => {
    const b = corpo(req);
    const identificador = b.identificador || b.chave || b.pedido || b.tracking || null;
    const texto = b.texto || b.recado || null;
    if (!identificador || !texto) {
      return res.status(400).json({ ok: false, erro: 'informe identificador e texto' });
    }
    res.json(await db.criarRecado({ identificador, texto, criadoPor: req.usuario }));
  });

  router.post('/api/admin/recado/:id/remover', auth.requerLogin, async (req, res) => {
    res.json(await db.resolverRecado(req.params.id));
  });

  /** A espreita e a mesma - o painel so a chama por outro caminho. */
  router.get('/api/admin/espreita', auth.requerLogin, (req, res) => {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(307, '/amb/api/espreita' + qs);
  });

  router.post('/api/admin/espreita/nota', auth.requerLogin, (req, res) => {
    res.redirect(307, '/amb/api/espreita/nota');
  });

  return router;
}

module.exports = { montar, eanDoProduto, norm };
