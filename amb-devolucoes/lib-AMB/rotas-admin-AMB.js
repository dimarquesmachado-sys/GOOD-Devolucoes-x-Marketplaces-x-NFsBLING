// ============================================================
// lib/rotas-admin-nf.js (v3.44)
// ------------------------------------------------------------
// Rotas administrativas de NF/devolucao (foto, itens, full-*,
// lancar-por-nf, buscar-nf, resolver-id-nf, preparar-devolucao,
// registrar, concluir, delete + debug/resgate-nf). Extraidas do
// server.js LITERAL - logica identica a producao.
//
// Uso:
//   const registrarRotasAdminNF = require('./lib/rotas-admin-nf');
//   registrarRotasAdminNF(app, {
//     supabase, requerAdmin, adminOk, sleep,
//     chamarBling, chamarML, buscarNFnoML,
//     buscarNFePorId, buscarNFBlindada,
//     resolverIdNFPorChave, mapItensNF,
//   });
// ============================================================

module.exports = function registrarRotasAdminNF(app, deps) {
  const {
    supabase, requerAdmin, adminOk, sleep,
    chamarBling, chamarML, buscarNFnoML,
    buscarNFePorId, buscarNFBlindada,
    resolverIdNFPorChave, mapItensNF,
    tabelaDevolucoes,
    buscarNFsPorNumero,   // b212 - usada pelo raio-x da busca por numero
    buscarNfDevolucaoBling,   // b255
    nomesBatemNf,   // b316
    listarDepositos,   // b276 - lista VIVA de depositos desta empresa
  } = deps;

  // ═══════════════════════════════════════════════════════════════════
  // b144 - O NOME DA TABELA VEM DE FORA.
  // Este modulo nasceu como copia do lib/rotas-admin-nf.js da GOOD e
  // ficou com from(TAB) em 15 lugares - a tabela DA GOOD. Na
  // AMB a tabela e devolucoes_amb, entao TODA acao do painel batia numa
  // tabela que nao existe aqui e voltava "Registro nao encontrado" -
  // por isso o "Achar devolucao no Bling" nunca chegava nem a consultar
  // o Bling.
  // ═══════════════════════════════════════════════════════════════════
  const TAB = tabelaDevolucoes || 'devolucoes';

app.get('/api/admin/foto/*', requerAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).send('Supabase nao configurado');
    const arquivo = String(req.params[0] || '')
      .replace(/\\/g, '/')
      .replace(/\.\./g, '')
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9._/-]/g, '');
    if (!arquivo) return res.status(400).send('arquivo invalido');

    let buf = null;
    let tipo = null;
    let erroDownload = null;

    try {
      const { data, error } = await supabase.storage.from('fotos-problema').download(arquivo);
      if (!error && data) {
        buf = Buffer.from(await data.arrayBuffer());
        tipo = data.type || null;
      } else {
        erroDownload = error ? error.message : 'resposta vazia';
      }
    } catch (e) {
      erroDownload = e.message || String(e);
    }

    if (!buf) {
      const urlPub = `${SUPABASE_URL}/storage/v1/object/public/fotos-problema/` +
        arquivo.split('/').map(encodeURIComponent).join('/');
      const r2 = await fetch(urlPub);
      if (r2.ok) {
        buf = Buffer.from(await r2.arrayBuffer());
        tipo = r2.headers.get('content-type');
      } else {
        console.error('[FOTO]', arquivo, '| download:', erroDownload, '| publico: HTTP', r2.status);
        return res.status(404).send(`foto nao encontrada (download: ${erroDownload || '-'} | publico: HTTP ${r2.status})`);
      }
    }

    res.set('Content-Type', tipo || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(buf);
  } catch (e) {
    return res.status(500).send('erro: ' + (e.message || String(e)));
  }
});

// ============================================================
// v3.31 - RETROFIT: grava os itens da NF num card antigo (e o
// nf_id_bling, se faltava e a chave permitir descobrir).
app.post('/api/admin/carregar-itens/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('id, nf_id_bling, nf_numero, nf_chave, nf_itens')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (Array.isArray(reg.nf_itens) && reg.nf_itens.length > 0) {
      return res.json({ ok: true, ja_tinha: true, qtd: reg.nf_itens.length });
    }

    let idBling = reg.nf_id_bling ? String(reg.nf_id_bling) : null;
    let idDescoberto = false;
    if (!idBling && reg.nf_chave && reg.nf_numero) {
      idBling = await resolverIdNFPorChave(reg.nf_numero, reg.nf_chave);
      idDescoberto = !!idBling;
    }
    if (!idBling) {
      return res.status(404).json({ ok: false, erro: 'Card sem nf_id_bling e sem chave utilizavel pra localizar a NF' });
    }

    await sleep(400);
    const rFull = await buscarNFePorId(idBling);
    const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling (id ' + idBling + ')' });

    const itens = mapItensNF(nf) || [];
    const upd = { nf_itens: itens };
    if (idDescoberto) upd.nf_id_bling = idBling; // brinde: card ganha o link Bling
    const { error: errUpd } = await supabase.from(TAB).update(upd).eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Falhou ao gravar: ' + errUpd.message });

    return res.json({ ok: true, qtd: itens.length, id_descoberto: idDescoberto });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// b171 - RETROFIT AUTOMATICO MANSO dos itens da NF.
// Pedido do Diego: "fazer sempre, sem precisar acessar o painel,
// pra quando eu abrir ja entregar repescado". A rotina grava
// nf_itens nos cards ABERTOS que ainda nao tem, pra o painel nem
// precisar buscar no Bling na hora.
// SEGURANCA (licao do incidente do "salvando infinito"):
//   - 1 chamada leve por card (GET /nfe/{id}), teto de 15 por rodada
//   - pausa de 3s entre cards; roda no boot (+4min) e a cada 6h
//   - DUAS falhas seguidas = desiste da rodada inteira (limite/Bling fora)
//   - trava anti-reentrancia
// ============================================================
let RETRO_ITENS_RODANDO = false;
async function retrofitItensPendentes() {
  if (RETRO_ITENS_RODANDO || !supabase) return;
  RETRO_ITENS_RODANDO = true;
  try {
    const corte = new Date(Date.now() - 60 * 864e5).toISOString();
    const { data } = await supabase.from(TAB)
      .select('id, nf_id_bling, nf_numero, nf_chave, nf_itens, status, criado_em')
      .in('status', ['aprovado', 'problema', 'divergente'])
      .gte('criado_em', corte)
      .order('criado_em', { ascending: false })
      .limit(60);
    const pendentes = (data || [])
      .filter(r => (!Array.isArray(r.nf_itens) || r.nf_itens.length === 0)
                && (r.nf_id_bling || (r.nf_chave && r.nf_numero)))
      .slice(0, 15);
    if (!pendentes.length) return;
    let feitos = 0, falhasSeguidas = 0;
    for (const reg of pendentes) {
      try {
        let idBling = reg.nf_id_bling ? String(reg.nf_id_bling) : null;
        let idDescoberto = false;
        if (!idBling) {
          idBling = await resolverIdNFPorChave(reg.nf_numero, reg.nf_chave);
          idDescoberto = !!idBling;
        }
        if (!idBling) continue;
        const rFull = await buscarNFePorId(idBling);
        const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
        if (!nf) {
          falhasSeguidas++;
          if (falhasSeguidas >= 2) { console.log('[RETRO-ITENS] 2 falhas seguidas - desisto da rodada'); break; }
          continue;
        }
        falhasSeguidas = 0;
        const upd = { nf_itens: mapItensNF(nf) || [] };
        if (idDescoberto) upd.nf_id_bling = idBling;
        await supabase.from(TAB).update(upd).eq('id', reg.id);
        feitos++;
      } catch (e) {
        falhasSeguidas++;
        if (falhasSeguidas >= 2) { console.log('[RETRO-ITENS] 2 falhas seguidas - desisto da rodada'); break; }
      }
      await sleep(3000);
    }
    if (feitos) console.log(`[RETRO-ITENS] itens gravados em ${feitos} card(s) - o painel abre pronto`);
  } catch (e) {
    console.log('[RETRO-ITENS] rodada abortada:', e.message || e);
  } finally {
    RETRO_ITENS_RODANDO = false;
  }
}
setTimeout(retrofitItensPendentes, 4 * 60 * 1000);        // depois do pre-aquecimento
setInterval(retrofitItensPendentes, 6 * 60 * 60 * 1000);  // e a cada 6 horas

// ============================================================
// v3.29 - Itens completos de uma NF (pro expansor "▼ itens da NF")
app.get('/api/admin/nf-itens/:idBling', requerAdmin, async (req, res) => {
  try {
    const r = await buscarNFePorId(String(req.params.idBling).trim());
    const nf = (r.ok && r.data?.data) ? r.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    const itens = Array.isArray(nf.itens) ? nf.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
    })) : [];
    return res.json({ ok: true, numero: nf.numero, serie: nf.serie, itens });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.26 - INTELIGÊNCIA FULL
// ============================================================
// (1) full-vincular: acha no Bling a NF de ENTRADA série 2 que o
//     ML emitiu pra devolução (janela da venda, match valor/nome,
//     confirma série na NF completa) e vincula ao card.
// (2) full-lancar-estoque: lança o estoque de entrada da devolução
//     vinculada, via API OFICIAL, no depósito GERAL (caso "voltou
//     pra matriz e está ok pra revenda").
// b276 (regra dele, 18/08: "id depositos sao diferentes... precisa sempre
// pegar isso") - ESTE ID ERA DA GOOD, dentro de uma rota da AMB. Sumiu:
// o deposito agora e validado contra a lista VIVA desta empresa
// (GET /depositos do Bling autenticado com as credenciais dela).

// ═══════════════════════════════════════════════════════════════════
// b143 - SONDA: mostra a NF de entrada CRUA, como o Bling devolve.
// Casar por NOME e ruim (cliente que compra 2x, homonimo, cadastro
// fiscal diferente do nome do ML). O certo e casar por algo UNICO -
// a chave da NF de venda referenciada na devolucao, ou o numero do
// pedido. Mas cada emissor preenche isso num campo diferente, e eu
// nao quero adivinhar: esta rota mostra o objeto inteiro pra a gente
// ver QUAL campo carrega o vinculo, e implementar em cima do dado.
//
//   /amb/api/admin/sonda-nf-entrada/26444189130
// ═══════════════════════════════════════════════════════════════════
app.get('/api/admin/sonda-nf-entrada/:id', requerAdmin, async (req, res) => {
  try {
    const r = await buscarNFePorId(req.params.id);
    const nf = (r.ok && r.data?.data) ? r.data.data : null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada', bruto: r.data || null });
    res.json({
      ok: true,
      resumo: {
        numero: nf.numero, serie: nf.serie, tipo: nf.tipo,
        chave: nf.chaveAcesso,
        data: nf.dataEmissao,
        valor: nf.valorNota,
        contato: nf.contato ? { nome: nf.contato.nome, documento: nf.contato.numeroDocumento } : null,
        numero_loja: nf.numeroLoja || null,
        observacoes: nf.observacoes || null,
        notas_referenciadas: nf.notasReferenciadas || nf.notaReferenciada || null,
      },
      campos_no_topo: Object.keys(nf),
      nf_completa: nf,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

app.post('/api/admin/full-vincular/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB).select('*').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Confere que e FULL (serie 2 da NF de venda)
    const chaveV = String(reg.nf_chave || '').replace(/\D/g, '');
    const ehFull = String(reg.nf_serie || '').trim() === '2' ||
      (chaveV.length === 44 && chaveV.substr(22, 3) === '002');
    if (!ehFull) return res.status(400).json({ ok: false, erro: 'Este card nao e FULL (serie 2) - use o Gerar NF Devolucao normal' });

    const f = (dt) => dt.toISOString().slice(0, 10);
    const base = reg.nf_data_emissao ? new Date(reg.nf_data_emissao) : (reg.created_at ? new Date(reg.created_at) : new Date(Date.now() - 60 * 864e5));
    const ini = f(new Date(base.getTime() - 5 * 864e5));   // b141 - 5 dias de folga
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    // b141 - casar por PEDACOS do nome. O nome do card vem do ML e o da NF
    // vem do cadastro fiscal - quase nunca sao identicos ("Monica Rosrigues"
    // no card, "Monica Maria Rodrigues" na nota). O includes() da string
    // inteira falhava sempre nesses casos.
    const pedacos = nomeBusca.split(/\s+/).filter(w => w.length >= 4);
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    // Varre notas de ENTRADA na janela e junta candidatas por valor/nome
    let varridas = 0;                      // b141 - pro diagnostico
    const candidatos = [];
    for (let pg = 1; pg <= 5; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        varridas++;
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        // basta UM pedaco do nome bater (o sobrenome, normalmente)
        const bateNome = pedacos.length > 0 && pedacos.some(w => nomeNF.includes(w));
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));

    // ═══════════════════════════════════════════════════════════════════
    // b143 - CASAR POR EVIDENCIA, NAO POR NOME.
    // A sonda mostrou que a NF de entrada do ML nao traz numeroPedidoLoja,
    // observacoes nem notasReferenciadas: o vinculo com a venda nao esta
    // em campo nenhum da API. Mas traz os ITENS (com o codigo do produto)
    // e o link do XML - e e no XML que mora a <refNFe>, a chave da nota de
    // VENDA que esta sendo devolvida.
    //
    // Pontos (nome vale pouco de proposito: cliente compra duas vezes,
    // existe homonimo, e o cadastro fiscal quase nunca bate com o ML):
    //   +6  o XML referencia a chave da NOSSA NF de venda   <- prova cabal
    //   +3  algum item tem o MESMO SKU do card
    //   +2  o valor da nota bate
    //   +1  um pedaco do nome bate
    // Exige 3: SKU sozinho basta, ou valor+nome. So nome (1) nao passa.
    // ═══════════════════════════════════════════════════════════════════
    const chaveVenda = String(reg.nf_chave || '').replace(/\D/g, '');
    const skuCard = String(reg.produto_sku || '').trim().toUpperCase();

    async function pontuar(nf) {
      let pts = 0; const porque = [];
      if (skuCard && Array.isArray(nf.itens) &&
          nf.itens.some(it => String(it.codigo || '').trim().toUpperCase() === skuCard)) {
        pts += 3; porque.push('mesmo SKU');
      }
      if (valorEsperado > 0 && Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05) {
        pts += 2; porque.push('mesmo valor');
      }
      const nomeNF2 = String(nf.contato?.nome || '').toLowerCase();
      if (pedacos.length && pedacos.some(w => nomeNF2.includes(w))) { pts += 1; porque.push('nome parecido'); }
      if (chaveVenda.length === 44 && nf.xml) {
        try {
          const rx = await fetch(nf.xml);
          if (rx.ok) {
            const txt = await rx.text();
            if (txt.replace(/\D/g, '').includes(chaveVenda)) { pts += 6; porque.push('XML referencia a NF de venda'); }
          }
        } catch (e) { /* sem o XML, decide pelos outros sinais */ }
      }
      return { pts, porque };
    }

    // Confirma a serie 2 na NF completa (a lista pode nao trazer serie)
    let melhor = null;
    for (const cand of candidatos.slice(0, 6)) {
      await sleep(400);
      const rFull = await buscarNFePorId(cand.id);
      const nfc = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nfc) continue;
      const chaveD = String(nfc.chaveAcesso || '').replace(/\D/g, '');
      const serieOk = String(nfc.serie || '').trim() === '2' ||
        (chaveD.length === 44 && chaveD.substr(22, 3) === '002');
      if (!serieOk) continue;
      const p = await pontuar(nfc);
      if (!melhor || p.pts > melhor.pts) melhor = { nf: nfc, ...p };
      if (p.pts >= 9) break;                 // chave + SKU: nao ha o que melhorar
    }

    if (melhor && melhor.pts >= 3) {
      const nf = melhor.nf;

      const { error: errUpd } = await supabase
        .from(TAB)
        .update({
          nf_devolucao_id_bling: String(nf.id),
          nf_devolucao_numero: String(nf.numero || ''),
        })
        .eq('id', req.params.id);
      if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

      console.log(`[FULL-VINCULAR] ${req.params.id}: entrada serie 2 nº ${nf.numero} (id ${nf.id})`);
      return res.json({
        ok: true,
        nf_devolucao_numero: String(nf.numero || ''),
        nf_devolucao_id_bling: String(nf.id),
        casou_por: melhor.porque,          // b143 - por que essa e nao outra
        pontos: melhor.pts,
      });
    }

    return res.status(404).json({
      ok: false,
      erro: `Nenhuma NF de entrada serie 2 correspondente na janela ${ini}..${fim} (${candidatos.length} candidata(s) testada(s)). Se ainda nao importou o XML no Bling, use o selo 🏬 pra baixar.`,
      // b141 - DIZ O QUE FEZ. Antes so avisava que nao achou, e nao dava pra
      // saber se a janela estava curta, se o nome nao bateu, se o valor nao
      // bateu, ou se o Bling nem devolveu notas de entrada.
      diag: {
        janela: { de: ini, ate: fim },
        notas_de_entrada_varridas: varridas,
        candidatas: candidatos.length,
        melhor_pontuacao: (typeof melhor !== 'undefined' && melhor) ? { pontos: melhor.pts, sinais: melhor.porque, nf: melhor.nf?.numero } : null,
        procurei_por: {
          nome_do_card: reg.buyer_nome || null,
          pedacos_do_nome: pedacos,
          valor_esperado: valorEsperado || null,
        },
        dica: varridas === 0
          ? 'O Bling nao devolveu NENHUMA nota de entrada nessa janela - confira o periodo e o acesso do token'
          : (candidatos.length === 0
              ? 'Varri as notas mas nenhuma bateu por nome nem por valor - confira o valor do card e o nome na nota'
              : 'Havia candidatas, mas nenhuma era serie 2'),
      },
    });
  } catch (e) {
    console.error('[FULL-VINCULAR] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

app.post('/api/admin/full-lancar-estoque/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB).select('id, nf_devolucao_id_bling, nf_devolucao_numero').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (!reg.nf_devolucao_id_bling) {
      return res.status(400).json({ ok: false, erro: 'Card sem devolucao vinculada - use o 🔗 Achar devolucao primeiro' });
    }

    // b276 - a whitelist antiga era de depositos DA GOOD: na AMB, qualquer
    // escolha do painel era rejeitada e caia no "padrao" — que tambem era da
    // GOOD. Ou seja, o lancamento ia pra um deposito INEXISTENTE nesta
    // empresa. Agora a lista vem do proprio Bling desta empresa.
    const pedidoDep = String(req.body?.idDeposito || '').trim();
    let deposito = null;
    let listaDeps = [];
    if (typeof listarDepositos === 'function') {
      try {
        const r = await listarDepositos(false);
        listaDeps = (r && r.depositos) || [];
      } catch (e) { listaDeps = []; }
    }
    if (listaDeps.length) {
      // b278 (review do Codex) - o painel esconde os depositos de FULL, mas o
      // SERVIDOR aceitava qualquer id que existisse no Bling: uma pagina
      // antiga ou requisicao adulterada lancaria devolucao dentro de um
      // fulfillment de marketplace. A regra de negocio vale aqui tambem.
      const ehFull = (d) => /full/i.test(String(d.descricao || ''));
      const utilizaveis = listaDeps.filter((d) => !ehFull(d));
      const valido = utilizaveis.some((d) => String(d.id) === pedidoDep);
      const geral = (utilizaveis.find((d) => d.padrao)
        || utilizaveis.find((d) => /geral/i.test(String(d.descricao || ''))) || {}).id || null;
      // b281 - se o admin ESCOLHEU um deposito e ele nao serve (nao existe
      // nesta empresa, ou e um Full), cair no Geral em silencio lanca a peca
      // num lugar que ninguem pediu — e o card fecha como se tivesse dado
      // certo. Recusa com o motivo escrito; o Geral so vale quando NADA foi
      // escolhido.
      if (pedidoDep && !valido) {
        const ehFullPedido = listaDeps.some((d) => String(d.id) === pedidoDep && ehFull(d));
        return res.status(400).json({
          ok: false,
          erro: ehFullPedido
            ? 'esse é um depósito de FULL do marketplace — devolução que chega na matriz não entra nele'
            : 'o depósito escolhido não existe nesta empresa — recarregue a página e escolha de novo',
        });
      }
      deposito = pedidoDep || geral;
    }
    if (!deposito) {
      // b277 (review do Codex) - SEM LISTA, NAO LANCA. Eu deixava passar o
      // id que o painel mandasse quando o GET de depositos falhava, mas o
      // GET falhar nao significa que o POST vai falhar: uma pagina antiga
      // (ou requisicao adulterada) poderia lancar num deposito que o painel
      // esconde de proposito — um Full, por exemplo. Esta rota MEXE EM
      // ESTOQUE; sem conseguir validar, recusar e a resposta certa.
      const motivo = listaDeps.length
        ? 'o deposito escolhido nao existe nesta empresa e nao achei o Geral dela'
        : 'nao consegui a lista de depositos desta empresa agora — sem ela nao lanço estoque';
      return res.status(503).json({ ok: false, erro: motivo + ' — tente de novo em instantes' });
    }

    const url = `https://api.bling.com.br/Api/v3/nfe/${reg.nf_devolucao_id_bling}/lancar-estoque/${deposito}`;
    const r = await chamarBling(url, { method: 'POST', data: {} });
    if (!r.ok) {
      const detalhe = r.error?.error?.description || r.error?.error?.message || JSON.stringify(r.error || {}).slice(0, 180);
      return res.status(502).json({ ok: false, erro: `Bling recusou (HTTP ${r.status}): ${detalhe}` });
    }

    console.log(`[FULL-ESTOQUE] ${req.params.id}: estoque lancado (NF dev ${reg.nf_devolucao_numero}, deposito ${deposito})`);
    return res.json({ ok: true, nf_devolucao_numero: reg.nf_devolucao_numero, deposito });
  } catch (e) {
    console.error('[FULL-ESTOQUE] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.25 - LANÇAR POR NF: cria cards em "Aprovadas" a partir do
// número da NF de venda (série 1). Porta lateral pra devoluções
// que não passaram pela bipagem — depois a esteira 🏭 emite tudo.
// Guardas: pula série 2 (FULL), pula número já lançado.
// ============================================================
app.post('/api/admin/lancar-por-nf', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const brutos = Array.isArray(req.body?.numeros) ? req.body.numeros : [];
  const numeros = [...new Set(brutos.map(n => String(n).replace(/\D/g, '')).filter(n => n.length >= 3))].slice(0, 15);
  if (numeros.length === 0) return res.status(400).json({ ok: false, erro: 'Nenhum numero de NF valido informado' });

  const resultados = [];
  let criados = 0;

  for (const num of numeros) {
    try {
      // 1) Ja existe card com essa NF?
      const candidatos = [...new Set([num, num.padStart(6, '0'), num.replace(/^0+/, '')])];
      const { data: jaTem } = await supabase
        .from(TAB)
        .select('id, status')
        .in('nf_numero', candidatos)
        .limit(1);
      if (jaTem && jaTem.length > 0) {
        resultados.push({ numero: num, ok: false, motivo: `ja existe card (${jaTem[0].status})` });
        continue;
      }

      // 2) Busca a NF no Bling (varredura por numero, tipo=1)
      const rBusca = await buscarNFnoBlingPorNumero(num, null, { maxPaginas: 30 });
      if (!rBusca.ok || !rBusca.match?.id) {
        resultados.push({ numero: num, ok: false, motivo: `NF nao achada no Bling (${rBusca.totalScanned || 0} varridas)` });
        continue;
      }
      await sleep(400);
      const rFull = await buscarNFePorId(rBusca.match.id);
      const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nf) {
        resultados.push({ numero: num, ok: false, motivo: 'falha ao ler NF completa' });
        continue;
      }

      // 3) Guarda FULL: serie 2 = devolucao emitida pelo proprio ML
      const serie = nf.serie != null ? String(nf.serie).trim() : null;
      const chave = nf.chaveAcesso ? String(nf.chaveAcesso).replace(/\D/g, '') : '';
      if (serie === '2' || (chave.length === 44 && chave.substr(22, 3) === '002')) {
        resultados.push({ numero: num, ok: false, motivo: 'serie 2 (FULL) - devolucao e emitida pelo ML, nao lancar aqui' });
        continue;
      }

      // 4) Monta o card com os dados da propria NF
      const itens = Array.isArray(nf.itens) ? nf.itens : [];
      const it0 = itens[0] || {};
      const titulo = (it0.descricao || 'Produto da NF ' + num) + (itens.length > 1 ? ` (+${itens.length - 1} itens)` : '');

      const { data: novo, error: errIns } = await supabase
        .from(TAB)
        .insert([{
          shipment_id: 'manual-nf-' + num,
          order_id: nf.numeroPedidoLoja ? String(nf.numeroPedidoLoja) : null,
          pack_id: null,
          buyer_id: null,
          buyer_nome: nf.contato?.nome || null,
          buyer_nickname: null,
          pedido_bling_numero: null,
          produto_titulo: titulo,
          produto_mlb: null,
          produto_sku: it0.codigo || null,
          produto_qtd: it0.quantidade || null,
          produto_valor_unit: it0.valor || null,
          nf_numero: String(nf.numero),
          nf_serie: serie,
          nf_chave: nf.chaveAcesso || null,
          nf_valor: nf.valorNota || null,
          nf_data_emissao: nf.dataEmissao || null,
          nf_id_bling: String(nf.id),
          nf_link_danfe: nf.linkDanfe || (nf.chaveAcesso ? 'https://meudanfe.com.br/consulta/' + nf.chaveAcesso : null),
          nf_itens: mapItensNF(nf),
          tipo: 'aprovado',
          status: 'pendente',
          funcionario: req.usuario,
          problema_descricao: `[LANCAMENTO MANUAL por ${req.usuario}] card criado pelo nº da NF`,
        }])
        .select('id')
        .single();

      if (errIns) {
        resultados.push({ numero: num, ok: false, motivo: 'erro ao gravar: ' + errIns.message });
        continue;
      }
      criados++;
      resultados.push({ numero: num, ok: true, id: novo.id, cliente: nf.contato?.nome || null, valor: nf.valorNota || null });
      console.log(`[LANCAR-NF] card criado: NF ${nf.numero} (${nf.contato?.nome || '?'}) id=${novo.id}`);
    } catch (e) {
      resultados.push({ numero: num, ok: false, motivo: e.message || 'erro' });
    }
    await sleep(400);
  }

  return res.json({ ok: true, criados, resultados });
});

// ============================================================
// v3.20.1 - VINCULAR DEVOLUCAO JA EXISTENTE no Bling
// ============================================================
// Quando a NF de devolucao foi criada mas o resultado se perdeu
// (timeout do painel), o card fica "orfao". Esta rota procura a
// NF de ENTRADA (tipo=0) com a natureza de devolucao da GOOD na
// janela recente, casa por nome do comprador OU valor, e grava.
app.post('/api/admin/vincular-devolucao-existente/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const NATUREZA_DEVOLUCAO_GOOD = '5776118802';
  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (reg.nf_devolucao_id_bling) {
      return res.json({ ok: true, ja_tinha: true, nf_devolucao_numero: reg.nf_devolucao_numero });
    }

    // Janela: da criacao do registro (menos 1 dia) ate amanha
    const f = (d) => d.toISOString().slice(0, 10);
    const iniData = reg.created_at ? new Date(new Date(reg.created_at).getTime() - 864e5) : new Date(Date.now() - 30 * 864e5);
    const ini = f(iniData);
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    // b141 - casar por PEDACOS do nome. O nome do card vem do ML e o da NF
    // vem do cadastro fiscal - quase nunca sao identicos ("Monica Rosrigues"
    // no card, "Monica Maria Rodrigues" na nota). O includes() da string
    // inteira falhava sempre nesses casos.
    const pedacos = nomeBusca.split(/\s+/).filter(w => w.length >= 4);
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    let varridas = 0;                      // b141 - pro diagnostico
    const candidatos = [];
    for (let pg = 1; pg <= 4; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        if (String(nf.naturezaOperacao?.id || '') !== NATUREZA_DEVOLUCAO_GOOD) continue;
        varridas++;
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        // basta UM pedaco do nome bater (o sobrenome, normalmente)
        const bateNome = pedacos.length > 0 && pedacos.some(w => nomeNF.includes(w));
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }

    if (candidatos.length === 0) {
      return res.status(404).json({ ok: false, erro: 'Nenhuma NF de devolucao correspondente achada no Bling (janela ' + ini + '..' + fim + ')' });
    }

    // Mais recente primeiro
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));
    const nf = candidatos[0];

    const { error: errUpd } = await supabase
      .from(TAB)
      .update({
        nf_devolucao_id_bling: String(nf.id),
        nf_devolucao_numero: String(nf.numero || ''),
      })
      .eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

    console.log(`[VINCULAR-DEV] ${req.params.id}: NF devolucao ${nf.numero} (id ${nf.id}) vinculada (${candidatos.length} candidata(s))`);
    return res.json({ ok: true, nf_devolucao_numero: String(nf.numero || ''), nf_devolucao_id_bling: String(nf.id), candidatas: candidatos.length });
  } catch (e) {
    console.error('[VINCULAR-DEV] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.19.2 - RAIO-X do resgate de NF (dry-run, abre no navegador)
// b212 - RAIO-X DA BUSCA POR NUMERO DE NF. O Diego buscou a NF 2447 e a
// tela respondeu "nao localizada", mas a MESMA nota aparece quando ele
// busca pelo pack id do ML. A funcao ja aceita um `trace`; esta rota
// simplesmente expoe esse passo a passo, pra a causa aparecer em vez de
// eu adivinhar (filtro ?numero= nao honrado? serie? janela de datas?).
// GET /api/debug/nf-numero/:numero?k=ADMIN_KEY[&serie=1]
app.get('/api/debug/nf-numero/:numero', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const trace = [];
  try {
    if (typeof buscarNFsPorNumero !== 'function') {
      return res.status(500).json({ ok: false, erro: 'buscarNFsPorNumero nao foi injetada nas deps' });
    }
    const achadas = await buscarNFsPorNumero(
      req.params.numero,
      req.query.serie || null,
      { trace, mesesAtras: Number(req.query.meses) || 18 },
    );
    res.json({ ok: true, numero: req.params.numero, achadas, passos: trace });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e), passos: trace });
  }
});

// b243 - RAIO-X DOS ITENS DA NF. A foto deveria vir pelo `produto.id` do
// item (vinculo estavel, imune a rename do SKU), mas a chamada da tela sai
// SEM `?produtoId=` — ou seja, o campo nao esta chegando. Em vez de adivinhar
// o nome do campo, esta rota mostra as CHAVES cruas que o Bling devolve em
// cada item, e o que ha dentro de `produto` quando existe.
// GET /api/debug/itens-nf/:idNF?k=ADMIN_KEY
app.get('/api/debug/itens-nf/:idNF', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  try {
    const r = await chamarBling(`/nfe/${encodeURIComponent(req.params.idNF)}`);
    const nf = (r.ok && r.data && r.data.data) || null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'NF nao encontrada', status: r.status || null });
    const itens = Array.isArray(nf.itens) ? nf.itens : [];
    res.json({
      ok: true,
      nf: { id: nf.id, numero: nf.numero, serie: nf.serie },
      qtd_itens: itens.length,
      itens: itens.map(it => ({
        campos_do_item: Object.keys(it),
        codigo: it.codigo || null,
        descricao: it.descricao || null,
        tem_produto: !!it.produto,
        produto: it.produto ? { campos: Object.keys(it.produto), id: it.produto.id || null } : null,
        produtoId_solto: it.produtoId || null,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b247 - SONDA: EXISTE NF DE DEVOLUCAO NO ML? (pedido do Diego, 14/08)
//
// Regra de negocio: devolucao Full do ML (serie 2) JA TEM a NF de devolucao
// emitida pelo proprio ML — o app nao deve gerar outra, senao ficam DUAS
// notas para a mesma volta. Mas o Full pode falhar e nao gerar; entao antes
// de decidir e preciso CONSTATAR (principio que ele prega: nao inferir pelo
// status, constatar pelo dado).
//
// Hoje ele confere a mao em vendedores.mercadolivre.com.br/emissor/vendas/
// {order_id}/faturas. Esta sonda testa os endpoints candidatos da API e
// mostra qual responde e o que traz — em vez de eu adivinhar o caminho.
// GET /api/debug/nf-ml/:orderId?k=ADMIN_KEY[&pack=PACK_ID][&shipment=SHIP_ID]
app.get('/api/debug/nf-ml/:orderId', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const oid = String(req.params.orderId || '').replace(/\D/g, '');
  const pack = String(req.query.pack || '').replace(/\D/g, '');
  const ship = String(req.query.shipment || '').replace(/\D/g, '');
  // b250 (review do Codex) - se o /users/me falhar, o caminho que depende do
  // id do vendedor some da lista SEM AVISO, e o retorno pareceria dizer que
  // aquele endpoint nao serve. Agora a falha e reportada.
  let uid = '';
  let erroUid = null;
  try {
    const me = await chamarML('/users/me');
    uid = String((me.ok && me.data && me.data.id) || '');
    if (!uid) erroUid = { status: me.status || null, motivo: 'nao consegui o id do vendedor' };
  } catch (e) { erroUid = { motivo: String(e.message || e).slice(0, 200) }; }

  // b253 - o dado do Diego fechou a primeira metade: a tela do ML mostra
  // DUAS notas na venda 2000017624047456 ("Nota de devolucao no 5364" e
  // "NF-e de venda no 5161"), e /users/{uid}/invoices/orders/{oid} devolveu
  // SO A 5161. Ou seja, aquele caminho entrega apenas a nota de VENDA.
  // Estes candidatos procuram a de DEVOLUCAO — e o `?bruto=1` mostra a
  // resposta inteira (sem os blocos com dado pessoal) quando for preciso
  // enxergar um campo que o resumo nao previu.
  const alvos = [
    uid ? `/users/${uid}/invoices/orders/${oid}` : null,
    uid ? `/users/${uid}/invoices/orders/${oid}?document_type=return` : null,
    uid ? `/users/${uid}/invoices/orders/${oid}/returns` : null,
    uid ? `/users/${uid}/invoices/returns/orders/${oid}` : null,
    uid ? `/users/${uid}/invoices?order_id=${oid}` : null,
    pack ? (uid ? `/users/${uid}/invoices/packs/${pack}` : null) : null,
    `/orders/${oid}/returns`,
    ship ? `/shipments/${ship}/invoice_data?siteId=MLB` : null,
  ].filter(Boolean);

  // b248 (review do Codex) - a sonda existe pra responder UMA pergunta:
  // "ha NF de devolucao?". Cortar o JSON em 600 caracteres podia mostrar so
  // a nota de VENDA e sugerir que nao ha devolucao — exatamente o erro que
  // a rota deveria evitar. Entao: resumir CADA documento (poucos campos), em
  // vez de truncar o payload. E nada de dado do comprador: `billing_info`
  // traz CPF, nome, telefone e endereco, e diagnostico e feito pra ser
  // copiado e colado por ai.
  // b249 (review do Codex) - inclui os nomes que o /invoice_data usa de fato
  // (invoice_id, invoice_key, cfop, invoice_type...), senao o resumo daquele
  // endpoint cairia no ramo generico e perderia justamente o que interessa.
  const CAMPOS_NF = ['type', 'document_type', 'invoice_type', 'kind', 'operation_type', 'cfop',
    'number', 'invoice_number', 'invoice_id', 'id', 'serie', 'series', 'invoice_series',
    'key', 'access_key', 'authorization_key', 'invoice_key', 'nfe_key',
    'status', 'state', 'date', 'date_created', 'invoice_date', 'creation_date', 'total_amount'];
  // b252 - o endpoint certo apareceu: /users/{uid}/invoices/orders/{oid}
  // responde 200 com a nota (invoice_number, invoice_series, status). Falta
  // saber se e a de VENDA ou a de DEVOLUCAO — e a distincao que decide se o
  // app pode parar de oferecer "gerar NF". Os campos que provavelmente
  // carregam isso (`attributes`, `fiscal_data`, `transaction_status`) nao
  // estavam no resumo. Entram agora, SEM `issuer`/`recipient`/`payments`,
  // que trazem CPF, nome e endereco.
  const SENSIVEIS = new Set(['issuer', 'recipient', 'payments', 'buyer', 'seller',
    'custom_issuer_address', 'billing_info', 'shipping', 'receiver_address']);
  const soEscalares = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 2) return null;
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      if (SENSIVEIS.has(k)) continue;
      if (v == null) continue;
      if (typeof v === 'object') { const dentro = soEscalares(v, prof + 1); if (dentro) r[k] = dentro; }
      else if (String(v).length <= 60) r[k] = v;
    }
    return Object.keys(r).length ? r : null;
  };
  const resumirDoc = (d) => {
    if (!d || typeof d !== 'object') return null;
    const out = {};
    for (const k of CAMPOS_NF) if (d[k] !== undefined && d[k] !== null) out[k] = d[k];
    // b252 - os blocos que podem dizer o TIPO da nota, ja peneirados
    for (const k of ['attributes', 'fiscal_data', 'transaction_status', 'items_quantity', 'pack_id', 'amount']) {
      if (d[k] === undefined || d[k] === null) continue;
      out[k] = (typeof d[k] === 'object') ? soEscalares(d[k], 0) : d[k];
    }
    if (Array.isArray(d.items) && d.items.length) {
      out.itens = d.items.slice(0, 5).map(it => soEscalares(it, 1));
    }
    return Object.keys(out).length ? out : { campos: Object.keys(d).slice(0, 20) };
  };
  const acharDocs = (d) => {
    if (!d || typeof d !== 'object') return [];
    if (Array.isArray(d)) return d;
    for (const k of ['results', 'invoices', 'documents', 'fiscal_documents', 'data', 'billing_info']) {
      if (Array.isArray(d[k])) return d[k];
      if (d[k] && typeof d[k] === 'object') return [d[k]];
    }
    // b249 - so tratar o objeto do topo como documento se ele PARECER um:
    // devolver qualquer resposta como "documento" faria a sonda relatar
    // documentos onde nao ha nenhum.
    const pareceNF = CAMPOS_NF.some(k => d[k] !== undefined && d[k] !== null);
    return pareceNF ? [d] : [];
  };

  // b249 - teto de tempo: 6 chamadas sequenciais ao ML sem limite podiam
  // segurar a requisicao ate o timeout do Render. Passou de 25s, encerra e
  // devolve o que ja apurou, dizendo que faltou.
  const LIMITE_MS = Date.now() + 25000;
  const passos = [];
  for (const caminho of alvos) {
    if (Date.now() > LIMITE_MS) { passos.push({ caminho, pulado: 'prazo da sonda estourou' }); continue; }
    try {
      // b251 (review do Codex) - o teto de 25s so era checado ANTES de cada
      // chamada: uma unica requisicao lenta ao ML podia furar o prazo inteiro
      // e a rota morrer no timeout do Render sem devolver nada. Agora a
      // propria chamada corre contra o prazo que resta.
      const restante = Math.max(1000, LIMITE_MS - Date.now());
      const r = await Promise.race([
        chamarML(caminho),
        new Promise(ok => setTimeout(() => ok({ ok: false, status: null, error: 'prazo da sonda estourou nesta chamada' }), restante)),
      ]);
      const d = r.data;
      // b249 - resumir TODOS (o resumo ja e pequeno); cortar em 10 podia
      // deixar a NF de devolucao de fora quando ha muitos documentos
      const achados = r.ok ? acharDocs(d) : [];
      // b253 - com ?bruto=1, a resposta inteira peneirada (sem issuer,
      // recipient, payments): serve pra achar o campo que marca "devolucao"
      // quando o resumo nao o previu.
      const bruto = (String(req.query.bruto || '') === '1' && r.ok) ? soEscalares(d, 0) : null;
      const docs = achados.map(resumirDoc).filter(Boolean);
      passos.push({
        caminho,
        status: r.status || (r.ok ? 200 : null),
        ok: !!r.ok,
        campos: d && typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0, 25) : null,
        qtd_documentos: r.ok ? docs.length : null,
        qtd_bruta: r.ok ? achados.length : null,   // b249 - confere se algum resumo caiu
        bruto,   // b253 - so quando ?bruto=1
        documentos: r.ok ? docs : null,
        // b248 - o corpo do ERRO distingue "endpoint nao existe" de "existe,
        // mas falta permissao/parametro" — mas so a mensagem, sem dado nenhum
        // b250 (review do Codex) - o erro do ML nem sempre e objeto: quando
        // vem string, ler `.message` dava null e a sonda perdia a unica pista
        // que distingue "endpoint nao existe" de "falta permissao".
        erro_ml: !r.ok && r.error ? (
          typeof r.error === 'string'
            ? { message: r.error.slice(0, 300) }
            : {
                message: (r.error.message || r.error.error || null),
                status: r.error.status || null,
                cause: Array.isArray(r.error.cause) ? r.error.cause.slice(0, 3) : null,
              }
        ) : null,
      });
    } catch (e) {
      passos.push({ caminho, erro: String(e.message || e) });
    }
    await sleep(250);
  }
  res.json({
    ok: true, order_id: oid, user_id: uid || null,
    erro_user_id: erroUid,   // b250 - por que o caminho por vendedor nao foi tentado
    passos,
  });
});

// b254 - RAIO-X DA NOTA DE ENTRADA (devolucao) NO BLING.
//
// A API do ML nao expoe a NF de devolucao (as 6 variantes da sonda deram
// 404/405/400 e o `?document_type=return` e ignorado). Mas ela ENTRA no
// Bling — e o Diego mostrou a tela de notas de ENTRADA trazendo um bloco
// "Chave de acesso | Numero | Serie" com a chave da NF de VENDA (5161).
// Se isso for o campo de NOTAS REFERENCIADAS, o casamento e EXATO: a
// devolucao aponta pra venda, sem depender de nome nem de data.
// Esta rota mostra os campos crus da nota de entrada pra confirmar.
// GET /api/debug/nf-entrada/:idNF?k=ADMIN_KEY
app.get('/api/debug/nf-entrada/:idNF', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  try {
    const r = await chamarBling(`/nfe/${encodeURIComponent(req.params.idNF)}`);
    const nf = (r.ok && r.data && r.data.data) || null;
    if (!nf) return res.status(404).json({ ok: false, erro: 'nao achei essa NF', status: r.status || null });
    // procura qualquer campo que pareca "nota referenciada", sem depender do
    // nome exato (o Bling varia entre versoes)
    const refs = {};
    for (const [k, v] of Object.entries(nf)) {
      if (!/refer|vincul|origem|documento/i.test(k)) continue;
      refs[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    }
    res.json({
      ok: true,
      campos_do_topo: Object.keys(nf),
      resumo: {
        id: nf.id, tipo: nf.tipo, numero: nf.numero, serie: nf.serie,
        situacao: nf.situacao, dataEmissao: nf.dataEmissao,
        chaveAcesso: nf.chaveAcesso || null,
        naturezaOperacao: nf.naturezaOperacao || null,
        contato_nome: nf.contato && nf.contato.nome ? nf.contato.nome : null,
        numeroPedidoLoja: nf.numeroPedidoLoja || null,
      },
      campos_de_referencia: Object.keys(refs).length ? refs : null,
      // as observacoes costumam citar a nota de origem por extenso
      observacoes: String(nf.observacoes || nf.informacoesAdicionais || '').slice(0, 800) || null,
      itens: Array.isArray(nf.itens) ? nf.itens.map(it => ({
        codigo: it.codigo || null, descricao: (it.descricao || '').slice(0, 80),
        quantidade: it.quantidade || null, gtin: it.gtin || null,
      })) : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// b256 - o PAINEL pergunta antes de oferecer "gerar NF": ja existe nota de
// devolucao pra esta volta? Cobre os DOIS casos que o Diego citou: a NF que
// o Full do ML emite sozinho e a entrada que outro admin ja lancou. Achou ->
// a tela mostra a nota e esconde o gerar, deixando so incluir estoque.
app.get('/api/admin/nf-devolucao', requerAdmin, async (req, res) => {
  if (typeof buscarNfDevolucaoBling !== 'function') {
    return res.status(500).json({ ok: false, erro: 'busca nao injetada nas deps' });
  }
  const r = await buscarNfDevolucaoBling({
    cliente: req.query.cliente || null,
    sku: req.query.sku || null,
    desde: req.query.desde || null,
    ate: req.query.ate || null,
  });
  // b308 (review do Codex) - O CASO DAS DUAS COMPRAS. Se o cliente comprou o
  // mesmo SKU duas vezes e devolveu SO uma, a nota existente satisfaz
  // "cliente + sku" nos DOIS cards e o card errado perderia os botoes. O
  // Bling nao diz a qual venda a nota pertence — mas NOS sabemos: se ela ja
  // esta vinculada a OUTRA devolucao aqui no banco, nao e a desta volta.
  try {
    if (r && r.ok && r.achou && r.nf && r.nf.id && supabase) {
      const idDesta = String(req.query.devolucaoId || '').trim();
      const { data: usos, error: erroUsos } = await supabase
        .from(TAB)
        .select('id')
        .eq('nf_devolucao_id_bling', String(r.nf.id))
        .limit(5);
      // b309 (review do Codex) - o cliente do Supabase resolve com
      // { data: null, error } em vez de lancar, entao o try/catch NAO pegava:
      // uma falha passageira de banco viraria "nao ha vinculo" e a checagem
      // que existe justo pra desambiguar diria o contrario do que devia.
      // Erro aqui = INDETERMINADO, nao "esta livre".
      if (erroUsos) {
        return res.json({
          ok: false,
          motivo: 'nao consegui conferir no banco se esta nota ja esta vinculada a outra devolucao — confira no Bling antes de gerar',
        });
      }
      const outros = (usos || []).filter(u => String(u.id) !== idDesta);
      if (outros.length) {
        return res.json({
          ok: true, achou: false,
          motivo: 'essa nota de entrada JA esta vinculada a outra devolucao aqui no sistema — nao e a desta volta',
          candidatos: [{ id: r.nf.id, numero: r.nf.numero, serie: r.nf.serie, data: r.nf.dataEmissao || null, cliente: r.nf.cliente }],
        });
      }
      // b311 (review do Codex, apontamento em aberto) - VINCULO VAZIO NAO E
      // PROVA. A nota pode ser orfa (importada, ou sobrou de um registro que
      // falhou) e ainda assim pertencer a OUTRA venda. Ela so desambigua
      // quando ha uma unica compra deste cliente+SKU na janela: com duas
      // compras e uma volta so, a mesma nota serve aos dois cards e o card
      // errado perderia os botoes. Entao, havendo mais de uma devolucao
      // NOSSA do mesmo cliente+SKU, o desfecho e INDETERMINADO.
      const cliBusca = String(req.query.cliente || '').trim();
      const skuBusca = String(req.query.sku || '').trim();
      if (cliBusca && skuBusca) {
        // b313 (review do Codex) - a conferencia de "irmas" tem que usar a
        // MESMA regra de igualdade do casamento la no Bling. Com nome exato e
        // SKU sensivel a caixa, dois cards do mesmo cliente gravados como
        // "MONICA RODRIGUES" e "MONICA MARIA RODRIGUES" (ou SKU com caixa
        // diferente) nao se enxergariam, e a mesma nota solta seria aceita
        // nos DOIS — exatamente o que esta trava existe pra impedir. Entao
        // trago os candidatos por SKU normalizado e comparo o nome aqui,
        // com a mesma funcao de partes estaveis usada no matcher.
        // b316 (review do Codex) - usar o MESMO comparador do casamento, nao
        // uma copia parecida. A minha versao mantinha pontuacao e particulas
        // de uma letra; a oficial troca pontuacao por espaco e descarta
        // tokens de 1 letra. Com "MARIA D'AVILA" e "MARIA D AVILA" a nota
        // casava no Bling e os dois cards NAO se enxergavam aqui.
        const normSku = (x) => String(x || '').toLowerCase().normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
        const skuNorm = normSku(skuBusca);
        const TETO_IRMAS = 500;
        const { data: irmasBrutas, error: erroIrmas } = await supabase
          .from(TAB)
          .select('id, buyer_nome, produto_sku')
          .ilike('produto_sku', '%' + skuBusca + '%')
          .limit(TETO_IRMAS);
        if (!erroIrmas && (irmasBrutas || []).length >= TETO_IRMAS) {
          return res.json({
            ok: false,
            motivo: 'ha registros demais deste SKU pra eu conferir se este cliente tem outra compra igual — confira no Bling antes de gerar',
          });
        }
        const comparaNome = (typeof nomesBatemNf === 'function')
          ? nomesBatemNf
          : (x, y) => normSku(x) === normSku(y);   // sem o oficial, exige igualdade
        const irmas = (irmasBrutas || []).filter((u) => (
          normSku(u.produto_sku) === skuNorm && comparaNome(u.buyer_nome, cliBusca)
        ));

        if (erroIrmas) {
          return res.json({
            ok: false,
            motivo: 'nao consegui conferir no banco se ha mais de uma compra deste cliente com este SKU — confira no Bling antes de gerar',
          });
        }
        const outrasCompras = (irmas || []).filter(u => String(u.id) !== idDesta);
        if (outrasCompras.length) {
          return res.json({
            ok: false,
            motivo: 'este cliente tem mais de uma devolucao deste mesmo SKU aqui, e a nota achada nao esta vinculada a nenhuma — nao da pra dizer a qual volta ela pertence. Confira no Bling antes de gerar',
          });
        }
      }
    }
  } catch (e) {
    // b310 (review do Codex) - se a consulta LANCAR (rede caida, cliente
    // quebrado), cair fora do try devolvia a resposta original como se o
    // vinculo tivesse sido conferido. Mesma regra do erro no objeto: nao
    // conseguir olhar e INDETERMINADO.
    return res.json({
      ok: false,
      motivo: 'nao consegui conferir no banco se esta nota ja esta vinculada a outra devolucao — confira no Bling antes de gerar',
    });
  }

  res.json(r);
});

// b255 - EXISTE NF DE DEVOLUCAO NO BLING PRA ESTA VOLTA?
// A API do ML nao entrega essa nota; o Bling sim (ela e importada la).
// Casamento por natureza de devolucao + cliente + SKU, dentro da janela que
// comeca na emissao da NF de venda.
// GET /api/debug/nf-devolucao?k=&cliente=&sku=&desde=AAAA-MM-DD
app.get('/api/debug/nf-devolucao', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  if (typeof buscarNfDevolucaoBling !== 'function') {
    return res.status(500).json({ ok: false, erro: 'busca nao injetada nas deps' });
  }
  const r = await buscarNfDevolucaoBling({
    cliente: req.query.cliente || null,
    sku: req.query.sku || null,
    desde: req.query.desde || null,
    ate: req.query.ate || null,
  });
  res.json(r);
});

// b282 (regra dele: "se tem alguma forma de API pegar isso, otimo. senao vai
// na unha manual mesmo") - os DOIS ids fiscais que sobraram no painel
// (idEmpresaControl e idNaturezaOperacao) foram capturados na TELA do Bling
// com o F12, nao pela API. Antes de decidir como tirar do codigo, precisamos
// saber o que a API v3 entrega: esta sonda mostra as naturezas de operacao e
// os campos crus de um deposito (o comentario do painel diz que o
// idEmpresaControl saiu de `depositos[].idEmpresa` do endpoint interno).
// GET /api/debug/ids-fiscais?k=ADMIN_KEY
app.get('/api/debug/ids-fiscais', async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ ok: false, erro: 'so admin' });
  const out = {};
  const tentar = async (caminho) => {
    try {
      const r = await chamarBling(caminho);
      const d = (r.data && r.data.data) || null;
      return {
        status: r.status || (r.ok ? 200 : null),
        ok: !!r.ok,
        qtd: Array.isArray(d) ? d.length : (d ? 1 : 0),
        // so o que interessa: id, descricao e os campos que possam trazer empresa
        amostra: Array.isArray(d)
          ? d.slice(0, 12).map((x) => ({
              id: x.id, descricao: x.descricao || x.nome || null,
              padrao: x.padrao != null ? x.padrao : undefined,
              tipo: x.tipo != null ? x.tipo : undefined,
              idEmpresa: x.idEmpresa || (x.empresa && x.empresa.id) || undefined,
            }))
          : (d ? { campos: Object.keys(d).slice(0, 25) } : null),
        erro_ml: !r.ok ? String((r.error && (r.error.message || r.error.error)) || r.error || '').slice(0, 200) : null,
      };
    } catch (e) { return { erro: String(e.message || e).slice(0, 160) }; }
  };
  out['/naturezas-operacoes'] = await tentar('/naturezas-operacoes?limite=100');
  await sleep(350);
  out['/depositos (campos crus)'] = await tentar('/depositos?limite=3');
  await sleep(350);
  out['/empresas'] = await tentar('/empresas');
  res.json({
    ok: true,
    procurando: 'idEmpresaControl e idNaturezaOperacao ("Devolucao de Mercadoria - Entrada") desta empresa',
    hoje_no_codigo: { idEmpresaControl: '14901993834', idNaturezaOperacao: '15110128838' },
    resultado: out,
  });
});

// GET /api/debug/resgate-nf/:orderId
// Roda o MESMO fluxo do resgate mas NAO grava nada - mostra cada
// passo (ML invoice, pack, blindada com trace) pra diagnostico.
// ============================================================
app.get('/api/debug/resgate-nf/:orderId', async (req, res) => {
  if (!adminOk(req)) return res.status(404).send('Not found'); // protegido: exige ?k=ADMIN_KEY
  const orderIdParam = String(req.params.orderId || '').trim();
  const saida = { orderId: orderIdParam };
  try {
    // Registro no Supabase (se existir)
    let reg = null;
    if (supabase) {
      const { data } = await supabase
        .from(TAB)
        .select('id, order_id, pack_id, nf_numero, nf_id_bling, created_at')
        .eq('order_id', orderIdParam)
        .order('created_at', { ascending: false })
        .limit(1);
      reg = data && data[0] ? data[0] : null;
    }
    saida.registro = reg;

    // Order no ML
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${orderIdParam}`);
    if (rOrder.ok) order = rOrder.data;
    saida.order_ml = order ? {
      date_created: order.date_created,
      pack_id: order.pack_id || null,
      shipping_id: order.shipping?.id || null,
      tags: order.tags || [],
      fulfillment: (order.tags || []).some(t => String(t).includes('fulfillment')) || order.shipping?.logistic_type === 'fulfillment',
    } : { erro: rOrder.status || 'sem resposta' };

    // ML invoice_data (shipment da venda)
    const shipVenda = order?.shipping?.id || null;
    if (shipVenda) {
      const rNF = await buscarNFnoML(shipVenda);
      saida.ml_invoice_venda = {
        shipment: shipVenda, ok: rNF.ok, status: rNF.status,
        invoice_number: rNF.data?.invoice_number || null,
        invoice_serie: rNF.data?.invoice_serie || null,
        tem_fiscal_key: !!rNF.data?.fiscal_key,
      };
    } else saida.ml_invoice_venda = { erro: 'order sem shipping.id' };

    // ML invoice_data (shipment do PACK)
    const packId = reg?.pack_id || order?.pack_id || null;
    if (packId) {
      const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
      const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
      if (shipPack && String(shipPack) !== String(shipVenda || '')) {
        const rNF2 = await buscarNFnoML(shipPack);
        saida.ml_invoice_pack = {
          shipment: shipPack, ok: rNF2.ok, status: rNF2.status,
          invoice_number: rNF2.data?.invoice_number || null,
          tem_fiscal_key: !!rNF2.data?.fiscal_key,
        };
      } else saida.ml_invoice_pack = { shipment: shipPack, igual_ao_da_venda: true };
    }

    // Blindada (dry-run)
    const rBlind = await buscarNFBlindada({
      orderIds: [orderIdParam, packId],
      numeroNF: saida.ml_invoice_venda?.invoice_number || null,
      serieNF: saida.ml_invoice_venda?.invoice_serie || null,
      dataReferencia: order?.date_created || reg?.created_at || null,
    });
    saida.blindada = {
      ok: rBlind.ok,
      via: rBlind.via || null,
      nf_numero: rBlind.nf?.numero || null,
      nf_serie: rBlind.nf?.serie || null,
      nf_id_bling: rBlind.idNF || null,
      numeroPedidoLoja_na_nf: rBlind.nf?.numeroPedidoLoja || null,
      tentado: rBlind.tentado || null,
      trace: rBlind.trace || null,
    };

    return res.json(saida);
  } catch (e) {
    saida.erro = e.message || String(e);
    return res.status(500).json(saida);
  }
});

// ============================================================
// v3.19 - RESGATE DE NF pra registros gravados sem NF ("NF: -")
// ============================================================
// Fluxo: le o registro -> busca a order no ML (data + shipment da
// venda) -> tenta invoice_data do ML -> se falhar, busca BLINDADA
// no Bling (janela de datas) -> grava nf_* no registro.
app.post('/api/admin/buscar-nf/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  const devId = req.params.id;

  try {
    const { data: reg, error: errReg } = await supabase
      .from(TAB)
      .select('*')
      .eq('id', devId)
      .single();
    if (errReg || !reg) {
      return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    }
    if (reg.nf_numero) {
      return res.json({ ok: true, ja_tinha: true, nf_numero: reg.nf_numero });
    }
    if (!reg.order_id) {
      return res.status(400).json({ ok: false, erro: 'Registro sem order_id - nao da pra localizar a NF automaticamente' });
    }

    // 1) Order no ML: da a data da venda e o shipment ORIGINAL
    let order = null;
    const rOrder = await chamarML(`https://api.mercadolibre.com/orders/${reg.order_id}`);
    if (rOrder.ok) order = rOrder.data;

    // 2) Tenta invoice_data do ML (rapido, ja traz chave/serie)
    let nfInfo = null; // { numero, serie, chave, valor, dataEmissao, idBling, linkDanfe }
    let via = null;

    async function tentarInvoiceML(sid) {
      if (!sid) return false;
      const rNFML = await buscarNFnoML(sid);
      if (rNFML.ok && rNFML.data?.fiscal_key) {
        nfInfo = {
          numero: String(rNFML.data.invoice_number || ''),
          serie: rNFML.data.invoice_serie != null ? String(rNFML.data.invoice_serie) : null,
          chave: rNFML.data.fiscal_key,
          valor: rNFML.data.invoice_amount || null,
          dataEmissao: rNFML.data.invoice_date || null,
          idBling: null,
          linkDanfe: `https://meudanfe.com.br/consulta/${rNFML.data.fiscal_key}`,
        };
        via = 'ml_invoice';
        return true;
      }
      return false;
    }

    const shipVenda = order?.shipping?.id || null;
    let achouML = await tentarInvoiceML(shipVenda);

    // v3.19.1: venda de CARRINHO - a NF pode estar no shipment do PACK
    if (!achouML) {
      const packId = reg.pack_id || order?.pack_id || null;
      if (packId) {
        const rPack = await chamarML(`https://api.mercadolibre.com/packs/${packId}`);
        const shipPack = rPack.ok ? rPack.data?.shipment?.id : null;
        if (shipPack && String(shipPack) !== String(shipVenda || '')) {
          achouML = await tentarInvoiceML(shipPack);
          if (achouML) via = 'ml_invoice_pack';
        }
      }
    }

    // 3) BLINDADA no Bling (janela de datas da venda) - acha o id Bling
    //    Roda mesmo se o ML deu a NF, pra vincular o nf_id_bling (necessario
    //    pro botao Gerar NF Devolucao usar o caminho rapido).
    const dataRef = order?.date_created || reg.created_at || null;
    const rBlind = await buscarNFBlindada({
      orderIds: [reg.order_id, reg.pack_id || order?.pack_id || null],
      numeroNF: nfInfo?.numero || null,
      serieNF: nfInfo?.serie || null,
      dataReferencia: dataRef,
    });
    if (rBlind.ok && rBlind.nf) {
      const nf = rBlind.nf;
      nfInfo = {
        numero: String(nf.numero || nfInfo?.numero || ''),
        serie: nf.serie != null ? String(nf.serie) : (nfInfo?.serie || null),
        chave: nf.chaveAcesso || nfInfo?.chave || null,
        valor: nf.valorNota || nfInfo?.valor || null,
        dataEmissao: nf.dataEmissao || nfInfo?.dataEmissao || null,
        idBling: nf.id ? String(nf.id) : null,
        linkDanfe: nf.linkDanfe || nfInfo?.linkDanfe || (nf.chaveAcesso ? `https://meudanfe.com.br/consulta/${nf.chaveAcesso}` : null),
      };
      via = via ? via + '+' + rBlind.via : rBlind.via;
    }

    if (!nfInfo || !nfInfo.numero) {
      const detalhe = (rBlind.tentado || []).join(' | ') || 'sem detalhes';
      return res.status(404).json({
        ok: false,
        erro: 'NF nao localizada no ML nem no Bling. Tentado: ' + detalhe,
        tentado: rBlind.tentado || [],
      });
    }

    // 4) Grava no registro
    const nfItensResgate = (rBlind.ok && rBlind.nf) ? mapItensNF(rBlind.nf) : null;
    const { error: errUpd } = await supabase
      .from(TAB)
      .update({
        nf_numero: nfInfo.numero,
        nf_serie: nfInfo.serie,
        nf_chave: nfInfo.chave,
        nf_valor: nfInfo.valor,
        nf_data_emissao: nfInfo.dataEmissao,
        nf_id_bling: nfInfo.idBling,
        nf_link_danfe: nfInfo.linkDanfe,
        nf_itens: nfItensResgate,
      })
      .eq('id', devId);
    if (errUpd) {
      return res.status(500).json({ ok: false, erro: 'Achei a NF mas falhou ao gravar: ' + errUpd.message });
    }

    console.log(`[RESGATE-NF] ${devId}: NF ${nfInfo.numero}${nfInfo.serie ? '/s' + nfInfo.serie : ''} via ${via}`);
    return res.json({ ok: true, via, nf_numero: nfInfo.numero, nf_serie: nfInfo.serie, nf_id_bling: nfInfo.idBling });
  } catch (e) {
    console.error('[RESGATE-NF] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// Usado quando a devolucao tem nf_numero mas NAO tem nf_id_bling salvo.
// O botao "Gerar NF Devolucao" chama isto pra descobrir o ID interno
// que o endpoint obter-dados-devolucao precisa.
app.get('/api/admin/resolver-id-nf', requerAdmin, async (req, res) => {
  const numero = String(req.query.numero || '').trim();
  const idParam = String(req.query.id || '').trim();
  const chave = String(req.query.chave || '').replace(/\D/g, '');
  const data = req.query.data || null;
  if (!numero && !idParam) {
    return res.status(400).json({ ok: false, erro: 'numero ou id da NF obrigatorio' });
  }

  try {
    let idBling = idParam;
    let numeroNF = numero;
    let idLoja = null;

    // v3.31.1 - FASE JANELA: a chave de acesso diz o MES de emissao;
    // o helper faz busca binaria pelo DIA (rapida em qualquer volume)
    // com plano B varrendo o mes inteiro.
    if (!idBling && chave.length === 44 && numero) {
      const achado = await resolverIdNFPorChave(numero, chave);
      if (achado) {
        idBling = achado;
        console.log(`[resolver-id-nf] achou pela chave: id=${idBling}`);
      }
    }

    // Se nao veio o id interno, descobre pelo numero (varre /nfe)
    if (!idBling) {
      const r = await buscarNFnoBlingPorNumero(numero, data, { maxPaginas: 50 });
      if (!r.ok) {
        return res.status(502).json({ ok: false, erro: 'Erro ao consultar o Bling ao buscar a NF' });
      }
      if (!r.match) {
        return res.status(404).json({
          ok: false,
          erro: `NF ${numero} nao encontrada nas ultimas ${r.totalScanned || 0} NFs do Bling`,
        });
      }
      idBling = String(r.match.id);
      numeroNF = r.match.numero;
      if (r.match.loja && r.match.loja.id != null) idLoja = String(r.match.loja.id);
    }

    // Garante o idLoja: busca a NF individual (GET /nfe/{id}), que traz "loja".
    // Esse idLoja e o ULTIMO segmento do obter-dados-devolucao - a extensao precisa dele.
    if (!idLoja && idBling) {
      const rNF = await buscarNFePorId(idBling);
      const nf = rNF.ok ? rNF.data?.data : null;
      if (nf) {
        if (nf.loja && nf.loja.id != null) idLoja = String(nf.loja.id);
        if (!numeroNF && nf.numero) numeroNF = nf.numero;
      }
    }

    return res.json({
      ok: true,
      idBling: String(idBling),
      numero: numeroNF || null,
      idLoja: idLoja || null,
    });
  } catch (e) {
    console.error('[resolver-id-nf] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// ============================================================
// v3.15.0 (Fase 3B) - Preparar dados pra gerar NF Devolucao no Bling
// ============================================================
// Frontend (admin.html) chama esse endpoint pra obter os dados completos
// (produtos com idBling + contato com idMunicipio etc) que sao necessarios
// pra montar o XML xajax do salvarNotaDevolucao.
// Usa a API v3 oficial do Bling (escopo NF Leitura ja tem).
app.get('/api/admin/preparar-devolucao/:idBling', requerAdmin, async (req, res) => {
  const idBling = String(req.params.idBling || '').trim();
  if (!idBling || !/^\d+$/.test(idBling)) {
    return res.status(400).json({ ok: false, erro: 'idBling invalido' });
  }

  try {
    // Busca a NF completa via API v3 oficial
    const url = `https://api.bling.com.br/Api/v3/nfe/${idBling}`;
    const r = await chamarBling(url);

    if (!r.ok) {
      return res.status(r.status || 500).json({
        ok: false,
        erro: `Bling API v3 retornou ${r.status || 'erro'}: ${(r.error?.error?.description || JSON.stringify(r.error || {})).slice(0, 200)}`,
      });
    }

    const nf = r.data?.data;
    if (!nf) {
      return res.status(404).json({ ok: false, erro: 'NF nao encontrada no Bling' });
    }

    // Extrai itens. API v3 NF nao retorna idProduto direto.
    // Buscamos cada produto pelo SKU pra pegar o idBling (necessario pro XML xajax).
    const itensNF = Array.isArray(nf.itens) ? nf.itens : [];
    if (itensNF.length === 0) {
      return res.status(400).json({ ok: false, erro: 'NF sem itens' });
    }

    const produtos = [];
    for (const it of itensNF) {
      const sku = it.codigo;
      if (!sku) {
        return res.status(400).json({ ok: false, erro: `Item da NF sem SKU: ${JSON.stringify(it).slice(0, 200)}` });
      }
      const rProd = await buscarProdutoBlingPorSku(sku);
      if (!rProd.ok || !rProd.produto) {
        return res.status(400).json({ ok: false, erro: `Produto nao encontrado no Bling para SKU ${sku}` });
      }
      produtos.push({
        idBling: String(rProd.produto.id),
        sku,
        descricao: it.descricao,
        quantidade: Number(it.quantidade) || 1,
        valor: Number(it.valor) || 0,
      });
    }

    // Extrai contato (vem completo na NF v3)
    const contato = nf.contato || {};
    const endereco = contato.endereco || {};

    // BUG 1 FIX: Detecta tipo F/J pelo numero de digitos do CPF/CNPJ
    // (a API v3 nem sempre retorna tipoPessoa direito)
    const docDigitos = String(contato.numeroDocumento || '').replace(/\D/g, '');
    const tipoDetectado = detectarTipoPessoa(docDigitos);
    const tipoFinal = tipoDetectado || (contato.tipoPessoa === 'J' ? 'J' : 'F');

    // BUG 1 FIX: Formata CPF/CNPJ no padrao Bling
    const cnpjFormatado = formatarCpfCnpj(docDigitos);

    // BUG 2 FIX: Se idMunicipio nao veio, busca via IBGE pelo nome+UF
    // Fallback: se IBGE falhar, busca pelo CEP (BrasilAPI)
    let idMunicipioFinal = String(endereco.codigoMunicipio || '').trim();
    if (!idMunicipioFinal && endereco.municipio && endereco.uf) {
      console.log('[preparar-devolucao] Buscando idMunicipio via IBGE:', endereco.municipio, endereco.uf);
      idMunicipioFinal = (await buscarIdMunicipioIBGE(endereco.municipio, endereco.uf)) || '';
    }
    if (!idMunicipioFinal && endereco.cep) {
      console.log('[preparar-devolucao] Fallback - Buscando idMunicipio pelo CEP:', endereco.cep);
      idMunicipioFinal = (await buscarIdMunicipioPorCep(endereco.cep)) || '';
    }

    const contatoOut = {
      id: String(contato.id || ''),
      nome: contato.nome || '',
      tipo: tipoFinal,
      cnpj: cnpjFormatado,
      ie: contato.ie || '',
      indIEDest: String(contato.indicadorIE || '9'),
      rg: contato.rg || '',
      nomePais: '',
      idPais: '',
      cep: endereco.cep || '',
      cidade: endereco.municipio || '',
      idMunicipio: idMunicipioFinal,
      uf: endereco.uf || '',
      endereco: endereco.endereco || '',
      enderecoNro: endereco.numero || '',
      bairro: endereco.bairro || '',
      complemento: endereco.complemento || '',
      email: contato.email || '',
      fone: contato.telefone || '',
      celular: '',
      dataNascimento: '',
    };

    if (!contatoOut.id) {
      return res.status(400).json({ ok: false, erro: 'NF sem ID de contato' });
    }
    if (!contatoOut.idMunicipio) {
      console.warn('[preparar-devolucao] AVISO: contato sem idMunicipio - Bling pode rejeitar');
    }

    return res.json({
      ok: true,
      idNFOriginal: idBling,
      numeroNF: nf.numero,
      produtos,
      contato: contatoOut,
    });

  } catch (e) {
    console.error('[preparar-devolucao] erro:', e);
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

// v3.15.0: Registra no Supabase que a NF de devolucao foi gerada
// pra evitar duplicatas e mostrar link direto no admin
app.put('/api/admin/registrar-devolucao-gerada/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }

  const id = String(req.params.id || '').trim();
  const { nf_devolucao_id_bling, nf_devolucao_numero } = req.body || {};

  if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });
  if (!nf_devolucao_id_bling) return res.status(400).json({ ok: false, erro: 'nf_devolucao_id_bling obrigatorio' });

  try {
    const { error } = await supabase
      .from(TAB)
      .update({
        nf_devolucao_id_bling: String(nf_devolucao_id_bling),
        nf_devolucao_numero: String(nf_devolucao_numero || ''),
        nf_devolucao_gerada_em: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
});

// API: marcar como concluido
app.put('/api/admin/concluir/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from(TAB)
      .update({
        status: 'concluido',
        data_concluido: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ ok: false, erro: error.message });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// API: deletar (caso tenha sido criado por engano)
app.delete('/api/admin/devolucao/:id', requerAdmin, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  }
  try {
    const { error } = await supabase
      .from(TAB)
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

};
