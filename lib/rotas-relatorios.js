// ============================================================
// lib/rotas-relatorios.js
// ------------------------------------------------------------
// Rotas do dashboard de relatorios. Use:
//   const registrarRotasRelatorios = require('./lib/rotas-relatorios');
//   registrarRotasRelatorios(app, {
//     supabase,            // cliente Supabase DA EMPRESA
//     requerAdmin,         // middleware de admin DA EMPRESA
//     tabelas: { devolucoes, tags, devolucaoTags },   // nomes DA EMPRESA
//     buscarProdutos,      // busca textual da empresa, ou null explicito
//   });
//
// b650 - PECA MULTIEMPRESA. Ate o b649 este modulo era da GOOD: lia
// 'devolucoes', 'tags' e 'devolucao_tags' cravados e buscava produto no
// indice da GOOD. Agora TUDO que e da empresa entra por parametro, pra AMB
// e Girassol ganharem o mesmo relatorio registrando no router delas (que ja
// poe o prefixo /amb e /girassol nas rotas). Sem default silencioso: tabela
// errada aqui e relatorio contando a devolucao de OUTRA empresa.
// ============================================================

const { marcadoExcluido } = require('./defeito-excluido');
const { marketplaceNoRelatorio, filtroMarketplaceRelatorio, ROTULO_ML_RELATORIO } = require('./marketplace-exibido');

function registrarRotasRelatorios(app, deps) {
  const { supabase, requerAdmin, tabelas, buscarProdutos } = deps || {};
  // b652 (Codex #522) - o vocabulario da tabela e DA EMPRESA. GOOD: coluna de
  // data `created_at` e desfecho em `tipo` ('aprovado'/'problema'). AMB e
  // Girassol: `criado_em` e `tipo` sempre 'devolucao', desfecho em `status`
  // (mesma traducao do triagensDe da AMB). Default = GOOD; as outras declaram.
  // Coluna errada nao vira dado de outra empresa: o banco rejeita a consulta.
  const colunaData = (deps && deps.colunaData) || 'created_at';
  const tipoNoStatus = !!(deps && deps.tipoNoStatus);
  if (!/^[a-z_]+$/.test(colunaData)) {
    throw new Error('[rotas-relatorios] colunaData invalida: ' + colunaData);
  }
  // b650 - fail-fast: sem os nomes da empresa o registro DERRUBA, em vez de
  // cair em silencio na tabela da GOOD (o vazamento que o b379 matou).
  // ⚠️ `supabase` NAO e validado aqui de proposito: o boot de teste e o
  // verifica.js sobem o server SEM env (test/identificar-nf-responde.test.js
  // da require(server.js) pelado) — o registro aceita, como sempre aceitou,
  // e a falta aparece no USO da rota (try/catch -> 500), nunca no boot.
  for (const ch of ['devolucoes', 'tags', 'devolucaoTags']) {
    if (!tabelas || typeof tabelas[ch] !== 'string' || !tabelas[ch].trim()) {
      throw new Error('[rotas-relatorios] tabelas.' + ch + ' e obrigatoria - o nome da tabela DA EMPRESA (sem default: tabela errada = relatorio de outra empresa)');
    }
  }
  if (!deps || !('buscarProdutos' in deps)) {
    throw new Error('[rotas-relatorios] buscarProdutos e obrigatorio - a funcao de busca textual DA EMPRESA, ou null explicito quando ela nao tem');
  }
  const t = tabelas;

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
        .from(t.devolucoes)
        .select(`
          id,
          ${colunaData === 'created_at' ? 'created_at' : 'created_at:' + colunaData},
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
          estado_atual,
          funcionario,
          marketplace,
          problema_descricao,
          devolucao_tags:${t.devolucaoTags} ( tag_id, tags:${t.tags} ( id, nome, cor ) )
        `)
        .order(colunaData, { ascending: false })
        // revisao do Codex no #249: este relatorio e de
        // DEVOLUCAO DE VENDA (rankings por SKU, por marketplace, valor
        // vendido). Defeito de estoque e controle INTERNO sem venda por
        // tras (server.js:5141-5188) - sem este filtro ele inflava o
        // total, entrava no ranking de SKU problematico e, por nao ter
        // marketplace, era contado como venda perdida do Mercado Livre
        // (linha ~191 abaixo, onde marketplace ausente cai em
        // 'mercadolivre').
        //
        // b298 (revisao Codex #252) - `tipo: 'defeito_estoque'` NUNCA passou
        // no check da tabela (o PR #252 trocou o insert pra gravar
        // `tipo: 'problema'`, o unico valor aceito), entao este .neq() ja
        // nao exclui nada. O defeito de estoque manual agora se reconhece
        // pelo `shipment_id` sintetico (`DEF-<timestamp>-<aleatorio>`,
        // server.js:5221) - nenhuma devolucao de venda tem esse prefixo.
        .neq('tipo', 'defeito_estoque')
        //
        // b654 (Codex #522): `.not(like)` sozinho tambem rejeita NULL, e a
        // devolucao da AMB/Girassol por pedido Magalu/rastreio/NF grava
        // shipment_id NULL - so o prefixo DEF- pode sair.
        .or('shipment_id.is.null,shipment_id.not.like.DEF-%');

      // Aplica filtros
      if (data_inicio) {
        query = query.gte(colunaData, data_inicio);
      }
      if (data_fim) {
        // Adiciona 1 dia pra incluir o dia final inteiro
        const fim = new Date(data_fim);
        fim.setDate(fim.getDate() + 1);
        query = query.lt(colunaData, fim.toISOString());
      }
      if (tipo && tipo !== 'todos') {
        if (tipoNoStatus && (tipo === 'aprovado' || tipo === 'problema')) {
          // desfecho mora no `status` quando o tipo e 'devolucao' (valor so
          // aprovado/problema no .or: nada do usuario entra cru no filtro)
          query = query.or(`tipo.eq.${tipo},and(tipo.eq.devolucao,status.eq.${tipo})`);
        } else {
          query = query.eq('tipo', tipo);
        }
      }
      if (produto_sku) {
        query = query.ilike('produto_sku', `%${produto_sku}%`);
      }
      if (funcionario) {
        query = query.eq('funcionario', funcionario);
      }
      // b649: o filtro de marketplace NAO vai mais ao banco — ele e aplicado
      // abaixo, DEPOIS da correcao do canal. No banco, triagem antiga de
      // pedido Amazon/Magalu/TikTok esta como 'mercadolivre' e o ML tem dois
      // rotulos ('ml' e 'mercadolivre'): filtrar la devolveria o canal errado.

      const { data: devolucoes, error } = await query;

      if (error) {
        console.error('[relatorios] erro Supabase:', error);
        return res.status(500).json({ ok: false, erro: error.message });
      }

      let listaFinal = devolucoes || [];
      if (tipoNoStatus) {
        // mesma regra do triagensDe da AMB: tipo 'devolucao' => desfecho = status
        listaFinal = listaFinal.map(d => ({
          ...d,
          tipo: d.tipo && d.tipo !== 'devolucao' ? d.tipo : (d.status || 'aprovado'),
        }));
      }

      // b312 (revisao Codex #269, P1) - registro excluido do ciclo de
      // defeitos (lib/defeitos-ciclo.js, /excluir) continuava contando
      // aqui: nenhum dos tres formatos de exclusao (tipo, status ou so a
      // marca no `estado_atual` - ver lib/defeito-excluido.js) era
      // filtrado, entao uma devolucao apagada por erro/duplicidade seguia
      // inflando totalProblema, o percentual de problema, as unidades
      // afetadas e o ranking de SKU problematico.
      listaFinal = listaFinal.filter(d => !marcadoExcluido(d));

      // b649 (31/10): o canal como a LISTA ja mostra desde o b648 — triagem
      // antiga com o padrao 'mercadolivre' e pedido de outro canal (Amazon
      // 702-..., Magalu 15..., TikTok 58...) conta no canal certo, e os dois
      // rotulos do ML ('ml' e 'mercadolivre') viram um so. Sem mexer no
      // banco. Vale para o "por marketplace" e para a planilha exportada.
      listaFinal = listaFinal.map(marketplaceNoRelatorio);
      const alvoMarketplace = filtroMarketplaceRelatorio(marketplace);
      if (alvoMarketplace) {
        listaFinal = listaFinal.filter(d => (d.marketplace || ROTULO_ML_RELATORIO) === alvoMarketplace);
      }

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
      // v3.16.1 - tambem conta numero de devolucoes DISTINTAS (cada bipagem = 1 devolucao)
      // pra distinguir caso isolado (1 cliente devolveu muito) de problema sistemico (varios clientes)
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
          num_devolucoes: 0,           // v3.16.1: cada bipagem (id da devolucoes) = 1 devolucao
          num_devolucoes_aprovado: 0,
          num_devolucoes_problema: 0,
        };
        const q = Number(d.produto_qtd || 1);
        const v = Number(d.produto_valor_unit || 0) * q;
        atual.qtde_total += q;
        atual.valor_total += isFinite(v) ? v : 0;
        atual.num_devolucoes += 1;
        if (d.tipo === 'aprovado') {
          atual.qtde_aprovado += q;
          atual.num_devolucoes_aprovado += 1;
        }
        if (d.tipo === 'problema') {
          atual.qtde_problema += q;
          atual.num_devolucoes_problema += 1;
        }
        skuMap.set(sku, atual);
      }

      // v3.16.1: calcula qtde_media e status (sistemico/misto/isolado) pra cada SKU
      function classificarStatus(numDevolucoes) {
        if (numDevolucoes >= 6) return 'sistemico';   // 🔴 problema do produto
        if (numDevolucoes >= 3) return 'misto';        // 🟡 atencao
        return 'isolado';                              // 🟢 caso pontual
      }
      for (const item of skuMap.values()) {
        item.qtde_media = item.num_devolucoes > 0
          ? Number((item.qtde_total / item.num_devolucoes).toFixed(2))
          : 0;
        item.status = classificarStatus(item.num_devolucoes);
        // Status especifico pra ranking de problemas
        item.status_problema = classificarStatus(item.num_devolucoes_problema);
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
        const m = d.marketplace || ROTULO_ML_RELATORIO;
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
          // v3.16.1 - cards extras
          totalSKUsUnicos: skuMap.size,                                                  // quantos SKUs diferentes
          totalUnidades: [...skuMap.values()].reduce((s, x) => s + x.qtde_total, 0),    // soma de todas qtdes
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
      if (!buscarProdutos) {
        // b650 - empresa sem indice de busca textual declara null: a rota
        // EXPLICA em vez de fingir resultado vazio (padrao semPeca da casa).
        return res.status(501).json({ ok: false, erro: 'busca de produtos indisponivel nesta empresa' });
      }
      const limite = Math.min(parseInt(req.query.limite, 10) || 20, 50);
      const resultados = await buscarProdutos(termo, limite);
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
        .from(t.tags)
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
        .from(t.tags)
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
        .from(t.tags)
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
        .from(t.tags)
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
        .from(t.devolucaoTags)
        .delete()
        .eq('devolucao_id', id);

      // Insere as novas
      if (tag_ids.length > 0) {
        const rows = tag_ids.map(tag_id => ({
          devolucao_id: id,
          tag_id,
        }));
        const { error } = await supabase
          .from(t.devolucaoTags)
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
