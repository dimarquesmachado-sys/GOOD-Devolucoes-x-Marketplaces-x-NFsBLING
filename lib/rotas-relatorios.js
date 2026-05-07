// ============================================================
// lib/rotas-relatorios.js
// ------------------------------------------------------------
// Rotas do dashboard de relatorios. Use:
//   const registrarRotasRelatorios = require('./lib/rotas-relatorios');
//   registrarRotasRelatorios(app, { supabase, requerAdmin });
//
// Isso mantem o server.js mais limpo - todas as rotas relacionadas
// a relatorios ficam neste arquivo.
// ============================================================

const produtosClient = require('./produtos-client');

function registrarRotasRelatorios(app, { supabase, requerAdmin }) {

  // ============================================================
  // GET /api/admin/relatorios/devolucoes
  // Lista filtrada + agregacoes (rankings)
  // ============================================================
  app.get('/api/admin/relatorios/devolucoes', requerAdmin, async (req, res) => {
    try {
      // Filtros via query params
      const {
        data_inicio,
        data_fim,
        tipo,           // 'aprovado' | 'problema' | 'todos'
        produto_sku,    // SKU exato OU palavra parcial
        funcionario,
        tag_id,         // filtrar por uma tag
        marketplace,    // futuro
      } = req.query;

      // Monta query base
      let query = supabase
        .from('devolucoes')
        .select(`
          id,
          created_at,
          shipment_id,
          order_id,
          pack_id,
          buyer_nome,
          buyer_nickname,
          pedido_bling_numero,
          produto_titulo,
          produto_mlb,
          produto_sku,
          produto_qtd,
          produto_valor_unit,
          nf_numero,
          nf_data_emissao,
          nf_link_danfe,
          tipo,
          status,
          funcionario,
          marketplace,
          problema_descricao,
          devolucao_tags ( tag_id, tags ( id, nome, cor ) )
        `)
        .order('created_at', { ascending: false });

      // Aplica filtros
      if (data_inicio) {
        query = query.gte('created_at', data_inicio);
      }
      if (data_fim) {
        // Adiciona 1 dia pra incluir o dia final inteiro
        const fim = new Date(data_fim);
        fim.setDate(fim.getDate() + 1);
        query = query.lt('created_at', fim.toISOString());
      }
      if (tipo && tipo !== 'todos') {
        query = query.eq('tipo', tipo);
      }
      if (produto_sku) {
        query = query.ilike('produto_sku', `%${produto_sku}%`);
      }
      if (funcionario) {
        query = query.eq('funcionario', funcionario);
      }
      if (marketplace) {
        query = query.eq('marketplace', marketplace);
      }

      const { data: devolucoes, error } = await query;

      if (error) {
        console.error('[relatorios] erro Supabase:', error);
        return res.status(500).json({ ok: false, erro: error.message });
      }

      let listaFinal = devolucoes || [];

      // Filtro de tag (post-query, porque relacao e N:N)
      if (tag_id) {
        listaFinal = listaFinal.filter(d =>
          (d.devolucao_tags || []).some(dt => dt.tag_id === tag_id)
        );
      }

      // Normaliza tags pra ficar mais facil no frontend
      listaFinal = listaFinal.map(d => ({
        ...d,
        tags: (d.devolucao_tags || []).map(dt => dt.tags).filter(Boolean),
        devolucao_tags: undefined,
      }));

      // ============================================================
      // AGREGACOES PRA OS CARDS E RANKINGS
      // ============================================================
      const total = listaFinal.length;
      const totalAprovado = listaFinal.filter(d => d.tipo === 'aprovado').length;
      const totalProblema = listaFinal.filter(d => d.tipo === 'problema').length;

      // Valor total (preco de venda) devolvido
      const valorTotal = listaFinal.reduce((sum, d) => {
        const v = Number(d.produto_valor_unit || 0) * Number(d.produto_qtd || 1);
        return sum + (isFinite(v) ? v : 0);
      }, 0);

      // Ranking SKUs por qtde (top 10)
      const skuMap = new Map();
      for (const d of listaFinal) {
        const sku = d.produto_sku || '(sem SKU)';
        const atual = skuMap.get(sku) || {
          sku,
          titulo: d.produto_titulo,
          qtde_total: 0,
          qtde_aprovado: 0,
          qtde_problema: 0,
          valor_total: 0,
        };
        const q = Number(d.produto_qtd || 1);
        const v = Number(d.produto_valor_unit || 0) * q;
        atual.qtde_total += q;
        atual.valor_total += isFinite(v) ? v : 0;
        if (d.tipo === 'aprovado') atual.qtde_aprovado += q;
        if (d.tipo === 'problema') atual.qtde_problema += q;
        skuMap.set(sku, atual);
      }
      const rankingSKUs = [...skuMap.values()]
        .sort((a, b) => b.qtde_total - a.qtde_total)
        .slice(0, 10);

      const rankingProblemas = [...skuMap.values()]
        .filter(s => s.qtde_problema > 0)
        .sort((a, b) => b.qtde_problema - a.qtde_problema)
        .slice(0, 10);

      // Por funcionario
      const funcionariosMap = new Map();
      for (const d of listaFinal) {
        const f = d.funcionario || '(nao identificado)';
        funcionariosMap.set(f, (funcionariosMap.get(f) || 0) + 1);
      }
      const porFuncionario = [...funcionariosMap.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);

      // Por marketplace
      const marketplacesMap = new Map();
      for (const d of listaFinal) {
        const m = d.marketplace || 'mercadolivre';
        marketplacesMap.set(m, (marketplacesMap.get(m) || 0) + 1);
      }
      const porMarketplace = [...marketplacesMap.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total);

      res.json({
        ok: true,
        cards: {
          total,
          totalAprovado,
          totalProblema,
          valorTotal: Number(valorTotal.toFixed(2)),
          percentualProblema: total > 0 ? Math.round((totalProblema / total) * 100) : 0,
        },
        rankingSKUs,
        rankingProblemas,
        porFuncionario,
        porMarketplace,
        devolucoes: listaFinal,
      });
    } catch (e) {
      console.error('[/api/admin/relatorios/devolucoes] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  // ============================================================
  // GET /api/admin/produtos/buscar?q=globo
  // Proxy pra busca textual de produtos (autocomplete)
  // ============================================================
  app.get('/api/admin/produtos/buscar', requerAdmin, async (req, res) => {
    try {
      const termo = String(req.query.q || '').trim();
      if (termo.length < 2) {
        return res.json({ ok: true, resultados: [] });
      }
      const limite = Math.min(parseInt(req.query.limite, 10) || 20, 50);
      const resultados = await produtosClient.buscarTextual(termo, limite);
      res.json({ ok: true, resultados });
    } catch (e) {
      console.error('[/api/admin/produtos/buscar] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  // ============================================================
  // TAGS - CRUD
  // ============================================================
  app.get('/api/admin/tags', requerAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('tags')
        .select('id, nome, cor, created_at')
        .order('nome', { ascending: true });

      if (error) {
        return res.status(500).json({ ok: false, erro: error.message });
      }
      res.json({ ok: true, tags: data || [] });
    } catch (e) {
      console.error('[/api/admin/tags GET] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  app.post('/api/admin/tags', requerAdmin, async (req, res) => {
    try {
      const { nome, cor } = req.body || {};
      if (!nome || typeof nome !== 'string') {
        return res.status(400).json({ ok: false, erro: 'Nome obrigatorio' });
      }
      const nomeLimpo = nome.trim();
      if (nomeLimpo.length < 2 || nomeLimpo.length > 50) {
        return res.status(400).json({ ok: false, erro: 'Nome deve ter 2-50 caracteres' });
      }

      const corHex = (typeof cor === 'string' && /^#[0-9a-f]{6}$/i.test(cor))
        ? cor
        : '#6c757d';

      const { data, error } = await supabase
        .from('tags')
        .insert([{ nome: nomeLimpo, cor: corHex }])
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ ok: false, erro: 'Ja existe tag com esse nome' });
        }
        return res.status(500).json({ ok: false, erro: error.message });
      }

      res.json({ ok: true, tag: data });
    } catch (e) {
      console.error('[/api/admin/tags POST] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  app.put('/api/admin/tags/:id', requerAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { nome, cor } = req.body || {};
      const update = {};
      if (nome) update.nome = String(nome).trim();
      if (cor && /^#[0-9a-f]{6}$/i.test(cor)) update.cor = cor;

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ ok: false, erro: 'Nada pra atualizar' });
      }

      const { data, error } = await supabase
        .from('tags')
        .update(update)
        .eq('id', id)
        .select()
        .single();

      if (error) return res.status(500).json({ ok: false, erro: error.message });
      res.json({ ok: true, tag: data });
    } catch (e) {
      console.error('[/api/admin/tags PUT] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  app.delete('/api/admin/tags/:id', requerAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      // Cascade vai apagar de devolucao_tags automaticamente
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', id);

      if (error) return res.status(500).json({ ok: false, erro: error.message });
      res.json({ ok: true });
    } catch (e) {
      console.error('[/api/admin/tags DELETE] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });

  // ============================================================
  // Aplicar/remover tags numa devolucao
  // ============================================================
  app.post('/api/admin/devolucao/:id/tags', requerAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { tag_ids } = req.body || {};
      if (!Array.isArray(tag_ids)) {
        return res.status(400).json({ ok: false, erro: 'tag_ids deve ser array' });
      }

      // Apaga as antigas
      await supabase
        .from('devolucao_tags')
        .delete()
        .eq('devolucao_id', id);

      // Insere as novas
      if (tag_ids.length > 0) {
        const rows = tag_ids.map(tag_id => ({
          devolucao_id: id,
          tag_id,
        }));
        const { error } = await supabase
          .from('devolucao_tags')
          .insert(rows);
        if (error) return res.status(500).json({ ok: false, erro: error.message });
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('[/api/admin/devolucao/:id/tags] erro:', e);
      res.status(500).json({ ok: false, erro: e.message });
    }
  });
}

module.exports = registrarRotasRelatorios;
