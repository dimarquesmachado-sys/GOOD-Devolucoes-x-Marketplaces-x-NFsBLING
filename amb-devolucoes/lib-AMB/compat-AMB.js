// ════════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/compat  (AMB Devol. b110)
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
      vistos.add(sku);
      out.push({
        sku,
        nome: p.nome || p.descricao || '',
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
            const rD = await bling.chamarBling(`/produtos/${p.id}`);
            const det = (rD.ok && rD.data && rD.data.data) || {};
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
          if (++entraram >= 20) break;
        }
      }
      // quem casa EXATO com o que foi digitado sobe pro topo
      out.sort((a, b) => {
        const ea = norm(a.sku) === alvo ? 0 : (norm(a.sku).includes(alvo) ? 1 : 2);
        const eb = norm(b.sku) === alvo ? 0 : (norm(b.sku).includes(alvo) ? 1 : 2);
        return ea - eb;
      });

      // b76 - completa com a FOTO (so os primeiros, um de cada vez):
      // e uma chamada por produto, entao limito a 6 e cacheio por id.
      const comFoto = out.slice(0, 20);
      let buscados = 0;
      for (const item of comFoto) {
        if (item.imagem || !item.id || buscados >= 6) continue;
        if (IMG_CACHE.has(item.id)) { item.imagem = IMG_CACHE.get(item.id); continue; }
        try {
          const rD = await bling.chamarBling(`/produtos/${item.id}`);
          const det = (rD.ok && rD.data && rD.data.data) || null;
          const url = primeiraImagem(det);
          if (url) IMG_CACHE.set(item.id, url);   // so sucesso
          item.imagem = url;
        } catch (e) { /* falha nao vira cache */ }
        buscados++;
        await new Promise(r2 => setTimeout(r2, 180));
      }
      res.json({ ok: true, produtos: comFoto, termo: q });
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
      let id = /^\d{6,}$/.test(chave) ? chave : null;
      let url = null;
      if (!id) {
        const rL = await bling.chamarBling(`/produtos?codigo=${encodeURIComponent(chave)}&limite=1`);
        const item = (rL.ok && rL.data && rL.data.data && rL.data.data[0]) || null;
        if (item) { url = primeiraImagem(item); id = item.id || null; }
      }
      if (!url && id) {
        const rD = await bling.chamarBling(`/produtos/${id}`);
        url = primeiraImagem((rD.ok && rD.data && rD.data.data) || null);
      }
      // so cacheia SUCESSO — nunca fixa uma falha (licao do produtoDetalhe
      // do checkout: um 429 passageiro deixaria o produto sem foto pra sempre)
      if (url) IMG_CACHE.set(chave, url);
      res.json({ ok: true, chave, imagem: url });
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
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/triagem/status/:id', auth.requerLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, erro: 'identificador obrigatorio' });
    const tambem = String(req.query.tambem || '').trim();

    try {
      let r = await db.jaTriado({ orderId: id, tracking: id, nfNumero: id });
      if ((!r.ok || !r.triado) && tambem && tambem !== id) {
        const r2 = await db.jaTriado({ orderId: tambem, tracking: tambem, nfNumero: tambem });
        if (r2.ok && r2.triado) r = r2;
      }
      res.json(r);
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
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
  const EXTRAS = ['produto_valor_unit', 'nf_link_danfe', 'buyer_id', 'buyer_nickname',
                  'produto_mlb', 'magalu_protocolo', 'marketplace', 'tracking'];
  async function completarRegistro(r, d) {
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
    const r = await db.registrarTriagem({
      tipo: 'defeito_estoque', status: 'concluido',
      produto_sku: exato ? exato.codigo : sku,
      produto_titulo: exato ? exato.nome : null,
      problema_descricao: descricao || null,
      localizacao, defeito_qtd: Number(quantidade || 1),
      funcionario: req.usuario,
    });
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
