// ════════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/compat  (AMB Devol. b56)
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

/** normaliza pra comparar codigo/EAN sem ruido */
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

      // Busca por NOME/SKU (o pesquisa do Bling cobre os dois)
      if (!out.length) {
        const rN = await bling.chamarBling(`/produtos?pesquisa=${encodeURIComponent(q)}&limite=20`);
        for (const p of ((rN.ok && rN.data && rN.data.data) || [])) push(p);
      }
      if (!out.length) {
        const rS = await bling.chamarBling(`/produtos?codigo=${encodeURIComponent(q)}&limite=10`);
        for (const p of ((rS.ok && rS.data && rS.data.data) || [])) push(p);
      }

      res.json({ ok: true, produtos: out.slice(0, 20), termo: q });
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

  /** Triagem OK: o que voltou confere com a NF. */
  router.post('/api/triagem/aprovar', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    res.json(await db.registrarTriagem({ ...d, status: 'aprovado', funcionario: req.usuario }));
  });

  /** Produto com problema: avisa por e-mail e responde se ha outras
   *  unidades do mesmo SKU em defeito (a tela usa pro alerta de
   *  canibalizacao) — mesmo comportamento do /api/triagem/registrar. */
  router.post('/api/triagem/problema', auth.requerLogin, async (req, res) => {
    const d = corpo(req);
    const r = await db.registrarTriagem({ ...d, status: 'problema', funcionario: req.usuario });
    if (!r.ok) return res.json(r);
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
    res.json(await db.registrarTriagem({ ...d, status: 'divergente', funcionario: req.usuario }));
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
    const { sku, descricao, localizacao, quantidade } = corpo(req);
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

  /** Nome que a GOOD usa pra identificar o pacote bipado. */
  router.get('/api/devolucao/identificar/:codigo', auth.requerLogin, (req, res) => {
    res.redirect(307, '/amb/api/triagem/identificar?codigo=' + encodeURIComponent(req.params.codigo));
  });

  /** O estoquista leu o recado. */
  router.post('/api/recado/:id/ciente', auth.requerLogin, async (req, res) => {
    res.json(await db.marcarCiente(req.params.id, req.usuario));
  });

  /** A tela chama /health no boot pra saber se o servidor respondeu. */
  router.get('/health', (req, res) => res.json({ ok: true, modulo: 'amb-devolucoes' }));

  return router;
}

module.exports = { montar, eanDoProduto, norm };
