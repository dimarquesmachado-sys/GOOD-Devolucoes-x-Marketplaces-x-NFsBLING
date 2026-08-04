// ════════════════════════════════════════════════════════════════════════
//  amb-devolucoes · lib/defeitos-ciclo  (AMB Devol. b114)
//  ------------------------------------------------------------------
//  O CICLO DA PECA COM DEFEITO, do jeito que o Diego descreveu:
//
//   1. chega quebrada  -> ja existe: vira linha em devolucoes_amb com
//      tipo='defeito_estoque' (ou status='problema'), com SKU, localizacao,
//      laudo e AS 6 FOTOS da triagem (coluna problema_fotos, na MESMA linha)
//   2. ao longo do tempo -> COMENTARIOS ("tirei a cupula", "sem lampada")
//   3. canibalizacao     -> PECAS RETIRADAS (ja existia a tabela; aqui a
//      gente passa a exigir DE ONDE saiu cada peca)
//   4. o estoquista PEDE (montei uma boa / quero descartar)
//   5. o admin AUTORIZA e lanca no estoque, ou autoriza o descarte
//   6. o estoquista VE o resultado na tela dele e executa
//
//  Regra dura combinada: no pedido 'recuperado' e OBRIGATORIO informar os
//  doadores (de qual defeito saiu qual peca). E as duas sucatas CONTINUAM
//  existindo - nenhuma some quando vira uma boa.
// ════════════════════════════════════════════════════════════════════════

'use strict';

module.exports = function registrarCicloDefeitos(router, deps) {
  const { auth, db, bling } = deps;

  // as tabelas novas ficam aqui, nao no supabase-AMB, pra este modulo ser
  // autocontido (o supabase-AMB nao precisa mudar)
  const T_COM = 'defeito_comentarios_amb';
  const T_PED = 'defeito_pedidos_amb';

  const cli = () => db.conectar();
  const corpo = (req) => (req.body && req.body.dados) || req.body || {};

  function erroSemBanco(res) {
    return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });
  }

  /** Normaliza a lista de fotos: a coluna as vezes vem string JSON. */
  function fotosDe(reg) {
    const f = reg && reg.problema_fotos;
    if (!f) return [];
    if (Array.isArray(f)) return f.filter(Boolean);
    if (typeof f === 'string') {
      try { const j = JSON.parse(f); return Array.isArray(j) ? j.filter(Boolean) : [f]; }
      catch (e) { return [f]; }
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/defeitos/lista?q=
  // A rota /api/defeitos que ja existia devolve os defeitos AGRUPADOS por
  // local+SKU (campo `grupos`) e SEM id — serve pra "o que tem na
  // prateleira X", mas nao pra abrir a ficha de uma peca. Esta aqui
  // devolve as LINHAS, com id.
  // Busca por SKU, localizacao, produto ou NF; e se o termo for um EAN
  // (12 a 14 digitos), resolve o EAN no Bling pra achar o SKU e busca
  // por ele — que e como o Diego procura na pratica.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/defeitos/lista', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    const q = String(req.query.q || '').trim();

    async function buscar(termo) {
      let sel = dbc.from(db.tabelas.devolucoes)
        .select('id, produto_sku, produto_titulo, localizacao, defeito_qtd, produto_qtd, problema_descricao, problema_fotos, tipo, status, funcionario, nf_numero, criado_em')
        .or('tipo.eq.defeito_estoque,status.eq.problema')
        .order('criado_em', { ascending: false })
        .limit(300);
      const r = await sel;
      if (r.error) throw new Error(r.error.message);
      let linhas = r.data || [];
      if (termo) {
        const b = termo.toLowerCase();
        linhas = linhas.filter(x =>
          String(x.produto_sku || '').toLowerCase().includes(b) ||
          String(x.localizacao || '').toLowerCase().includes(b) ||
          String(x.produto_titulo || '').toLowerCase().includes(b) ||
          String(x.nf_numero || '').toLowerCase().includes(b));
      }
      return linhas;
    }

    try {
      let linhas = await buscar(q);
      let viaEan = null;

      // nada achado e o termo parece EAN: resolve no Bling e tenta pelo SKU
      if (!linhas.length && /^\d{12,14}$/.test(q) && bling && bling.chamarBling) {
        try {
          const rB = await bling.chamarBling(`/produtos?gtin=${encodeURIComponent(q)}&limite=3`);
          const prod = (rB.ok && rB.data && rB.data.data && rB.data.data[0]) || null;
          if (prod && prod.codigo) {
            viaEan = { ean: q, sku: prod.codigo, nome: prod.nome || null };
            linhas = await buscar(String(prod.codigo).toLowerCase());
          }
        } catch (e) { /* segue sem o de-para */ }
      }

      res.json({
        ok: true,
        via_ean: viaEan,
        itens: linhas.map(x => ({
          id: x.id,
          sku: x.produto_sku,
          titulo: x.produto_titulo,
          localizacao: x.localizacao,
          quantidade: x.defeito_qtd || x.produto_qtd || 1,
          laudo: x.problema_descricao,
          nf_numero: x.nf_numero,
          quem: x.funcionario,
          criado_em: x.criado_em,
          tem_fotos: fotosDe(x).length,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/defeitos/ficha/:id
  // Tudo de uma peca numa chamada so: dados, FOTOS, historico (comentarios),
  // pecas retiradas e os pedidos que ela ja teve. E o que a tela abre no
  // card, sem tirar ninguem da triagem.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/defeitos/ficha/:id', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    const id = String(req.params.id || '').trim();
    try {
      const rItem = await dbc.from(db.tabelas.devolucoes)
        .select('*').eq('id', id).limit(1);
      if (rItem.error) throw new Error(rItem.error.message);
      const item = (rItem.data || [])[0];
      if (!item) return res.status(404).json({ ok: false, erro: 'peca nao encontrada' });

      const [rCom, rPec, rPed] = await Promise.all([
        dbc.from(T_COM).select('*').eq('defeito_id', id).order('criado_em', { ascending: true }),
        dbc.from(db.tabelas.pecasRetiradas).select('*').eq('defeito_id', id).order('criado_em', { ascending: true }),
        dbc.from(T_PED).select('*').eq('defeito_id', id).order('criado_em', { ascending: false }),
      ]);

      res.json({
        ok: true,
        item: {
          id: item.id,
          sku: item.produto_sku,
          titulo: item.produto_titulo,
          localizacao: item.localizacao,
          quantidade: item.defeito_qtd || item.produto_qtd || 1,
          laudo: item.problema_descricao,
          nf_numero: item.nf_numero,
          quem: item.funcionario,
          criado_em: item.criado_em,
          status: item.status,
        },
        fotos: fotosDe(item),
        comentarios: rCom.data || [],
        pecas_retiradas: rPec.data || [],
        pedidos: rPed.data || [],
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/defeitos/:id/comentario     { texto }
  // O historico da peca. Nao edita o que ja foi escrito: acrescenta - assim
  // fica o rastro de quem mexeu e quando, que e o ponto do Diego.
  // ─────────────────────────────────────────────────────────────────────
  router.post('/api/defeitos/:id/comentario', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    const texto = String(corpo(req).texto || '').trim();
    if (texto.length < 2) return res.status(400).json({ ok: false, erro: 'escreva o comentario' });
    try {
      const r = await dbc.from(T_COM).insert([{
        defeito_id: req.params.id, texto, quem: req.usuario,
      }]).select().limit(1);
      if (r.error) throw new Error(r.error.message);
      res.json({ ok: true, comentario: (r.data || [])[0] || null });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // b114 - CORRIGIR O QUE JA FOI ESCRITO
  // Ate agora so dava pra ACRESCENTAR no historico. Se o defeito foi
  // digitado errado na entrada, ficava errado pra sempre. Estas duas
  // rotas deixam corrigir — e o historico registra que houve correcao,
  // pra ninguem achar que o texto sempre foi aquele.
  // ─────────────────────────────────────────────────────────────────────
  router.put('/api/defeitos/:id/laudo', auth.requerLogin, async (req, res) => {
    const texto = String(corpo(req).texto || '').trim();
    if (texto.length < 3) return res.status(400).json({ ok: false, erro: 'escreva a descricao do defeito' });
    const r = await db.atualizarTriagem(req.params.id, { problema_descricao: texto });
    if (!r.ok) return res.status(500).json(r);
    try {
      await cli().from(T_COM).insert([{
        defeito_id: req.params.id,
        texto: 'Corrigiu a descricao do defeito para: ' + texto,
        quem: req.usuario,
      }]);
    } catch (e) { /* a correcao principal ja foi */ }
    res.json(r);
  });

  router.put('/api/defeitos/comentario/:cid', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    const texto = String(corpo(req).texto || '').trim();
    if (texto.length < 2) return res.status(400).json({ ok: false, erro: 'escreva o comentario' });
    try {
      const r = await dbc.from(T_COM)
        .update({ texto: texto + '  (editado por ' + req.usuario + ')' })
        .eq('id', req.params.cid).select().limit(1);
      if (r.error) throw new Error(r.error.message);
      res.json({ ok: true, comentario: (r.data || [])[0] || null });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/defeitos/:id/peca-retirada  { peca, usada_em }
  // Registra o que saiu desta peca (e, se ja souber, pra onde foi).
  // ─────────────────────────────────────────────────────────────────────
  router.post('/api/defeitos/:id/peca-retirada', auth.requerLogin, async (req, res) => {
    const b = corpo(req);
    const peca = String(b.peca || '').trim();
    if (!peca) return res.status(400).json({ ok: false, erro: 'diga qual peca foi retirada' });
    const r = await db.registrarPecaRetirada({
      defeitoId: req.params.id, peca, usadaEm: b.usada_em || null, quem: req.usuario,
    });
    if (!r.ok) return res.status(500).json(r);
    // o historico registra junto, pra quem ler a ficha entender sem cruzar tabela
    try {
      await cli().from(T_COM).insert([{
        defeito_id: req.params.id,
        texto: 'Retirou a peca: ' + peca + (b.usada_em ? ' (usada em ' + b.usada_em + ')' : ''),
        quem: req.usuario,
      }]);
    } catch (e) { /* o registro principal ja foi */ }
    res.json(r);
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/defeitos/pedido
  //   { tipo:'recuperado'|'descarte', defeito_id, sku, titulo, localizacao,
  //     quantidade, observacao, doadores:[{defeito_id, peca}] }
  //
  // REGRA DURA: em 'recuperado' os DOADORES sao obrigatorios, cada um com a
  // peca informada. E o que amarra de onde saiu o que. Ao criar o pedido, a
  // retirada ja fica registrada em cada doador - senao a informacao se
  // perderia esperando o admin.
  // ─────────────────────────────────────────────────────────────────────
  router.post('/api/defeitos/pedido', auth.requerLogin, async (req, res) => {
    const b = corpo(req);
    const tipo = b.tipo === 'descarte' ? 'descarte' : 'recuperado';
    const doadores = Array.isArray(b.doadores) ? b.doadores : [];
    // a REGRA vem antes do banco: assim o estoquista recebe o aviso certo
    // ("diga de onde tirou") em vez de um erro de infraestrutura.

    if (tipo === 'recuperado') {
      if (!doadores.length) {
        return res.status(400).json({
          ok: false,
          erro: 'informe de quais pecas com defeito voce tirou as partes',
        });
      }
      const semPeca = doadores.filter(d => !d || !String(d.peca || '').trim());
      if (semPeca.length) {
        return res.status(400).json({
          ok: false,
          erro: 'diga o que foi retirado de cada peca (ex: cupula, base, lampada)',
        });
      }
    }

    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    try {
      const r = await dbc.from(T_PED).insert([{
        tipo,
        defeito_id: b.defeito_id || null,
        sku: b.sku || null,
        titulo: b.titulo || null,
        localizacao: b.localizacao || null,
        quantidade: Number(b.quantidade) > 0 ? Number(b.quantidade) : 1,
        observacao: b.observacao || null,
        doadores,
        quem_pediu: req.usuario,
        status: 'pendente',
      }]).select().limit(1);
      if (r.error) throw new Error(r.error.message);
      const pedido = (r.data || [])[0] || null;

      // registra a retirada em cada doador, agora, com o pedido como destino
      for (const d of doadores) {
        try {
          await db.registrarPecaRetirada({
            defeitoId: d.defeito_id,
            peca: String(d.peca || '').trim(),
            usadaEm: 'pedido #' + (pedido ? pedido.id : '?') + (b.sku ? ' (' + b.sku + ')' : ''),
            quem: req.usuario,
          });
          await dbc.from(T_COM).insert([{
            defeito_id: d.defeito_id,
            texto: 'Peca retirada para montar uma boa: ' + String(d.peca || '').trim(),
            quem: req.usuario,
          }]);
        } catch (e) { /* um doador nao pode derrubar o pedido */ }
      }

      res.json({ ok: true, pedido });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/defeitos/pedidos?status=pendente
  // A fila do galpao. O estoquista tambem le (pra ver o que foi autorizado),
  // por isso nao exige admin - so DECIDIR exige.
  // ─────────────────────────────────────────────────────────────────────
  router.get('/api/defeitos/pedidos', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    try {
      let q = dbc.from(T_PED).select('*').order('criado_em', { ascending: false }).limit(200);
      const st = String(req.query.status || '').trim();
      if (st) q = q.eq('status', st);
      const r = await q;
      if (r.error) throw new Error(r.error.message);
      const lista = r.data || [];
      res.json({
        ok: true,
        pedidos: lista,
        pendentes: lista.filter(p => p.status === 'pendente').length,
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/defeitos/pedido/:id/decidir   { acao, obs, sku, quantidade }
  //   acao: 'autorizar' | 'recusar' | 'concluir'
  // So ADMIN decide. 'concluir' e o estoquista dizendo que executou (jogou
  // fora / guardou a boa) - por isso aceita login comum nessa acao.
  // ─────────────────────────────────────────────────────────────────────
  router.post('/api/defeitos/pedido/:id/decidir', auth.requerLogin, async (req, res) => {
    const dbc = cli();
    if (!dbc) return erroSemBanco(res);
    const b = corpo(req);
    const acao = String(b.acao || '').trim();
    if (!['autorizar', 'recusar', 'concluir'].includes(acao)) {
      return res.status(400).json({ ok: false, erro: 'acao invalida' });
    }
    // autorizar/recusar e decisao do dono: exige admin
    if (acao !== 'concluir') {
      const s = auth.validarSessao(auth.tokenDaRequisicao(req), 'admin');
      if (!s) return res.status(403).json({ ok: false, erro: 'so o admin autoriza ou recusa' });
    }
    try {
      const campos = {
        status: acao === 'autorizar' ? 'autorizado'
              : acao === 'recusar' ? 'recusado' : 'concluido',
        quem_decidiu: req.usuario,
        decidido_em: new Date().toISOString(),
      };
      if (b.obs) campos.obs_admin = String(b.obs);
      if (acao === 'autorizar' && b.sku) {
        campos.estoque_sku = String(b.sku);
        campos.estoque_qtd = Number(b.quantidade) > 0 ? Number(b.quantidade) : 1;
        campos.estoque_em = new Date().toISOString();
      }
      const r = await dbc.from(T_PED).update(campos).eq('id', req.params.id).select().limit(1);
      if (r.error) throw new Error(r.error.message);
      const pedido = (r.data || [])[0] || null;

      // deixa o rastro na ficha da peca
      if (pedido && pedido.defeito_id) {
        try {
          await dbc.from(T_COM).insert([{
            defeito_id: pedido.defeito_id,
            texto: 'Pedido #' + pedido.id + ' (' + pedido.tipo + ') -> ' + campos.status
              + (campos.estoque_qtd ? ' - lancado ' + campos.estoque_qtd + ' no estoque' : ''),
            quem: req.usuario,
          }]);
        } catch (e) { /* nao impede a decisao */ }
      }
      res.json({ ok: true, pedido });
    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });
};
