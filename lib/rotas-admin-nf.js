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
  } = deps;

  // ══════════════════════════════════════════════════════════════════
  // GET /api/produto/imagem/:id   (v4.31 - foto no "Lancar produto com
  // defeito")
  // A LISTAGEM de produtos do Bling nao devolve imagem; so o DETALHE
  // traz, e em lugares que variam (midia.imagens.externas[].link,
  // internas[], imagemURL...). A tela pede a foto so dos resultados que
  // aparecem, e o cache abaixo evita repetir a chamada.
  // Entrou AQUI, e nao no server.js, porque este modulo ja recebe o
  // chamarBling — assim o server.js (4.6k linhas) nao precisa ser mexido.
  // ══════════════════════════════════════════════════════════════════
  const IMG_CACHE = new Map();      // idProduto -> url|null

  // v4.32 - COPIADO DO CHECKOUT OFFLINE (produtos.js/primeiraImagem), que
  // ja busca imagem do Bling ha meses. O extrator anterior exigia que a
  // URL terminasse em .jpg/.png — e as do Bling nem sempre tem extensao;
  // e nao olhava midia.imagens.imagensURL[].
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

  app.get('/api/produto/imagem/:id', async (req, res) => {
    // trava leve: precisa estar logado (admin OU estoquista). So devolve
    // a URL de uma foto de produto - o mesmo dado que a busca ja mostra.
    const logado = adminOk(req) || !!(req.cookies && req.cookies.sessao);
    if (!logado) return res.status(401).json({ ok: false, erro: 'faca login' });

    const chave = String(req.params.id || '').trim();
    if (!chave) return res.status(400).json({ ok: false, erro: 'informe o sku ou o id' });
    if (IMG_CACHE.has(chave)) return res.json({ ok: true, id: chave, imagem: IMG_CACHE.get(chave), cache: true });

    try {
      // v4.31 - a tela do resultado pede pelo SKU (e o que ela tem do item
      // da NF); o modal de defeito pede pelo id. Aceita os dois.
      // mesmo caminho do checkout offline: lista por codigo (que ja pode
      // trazer imagemURL) e, se precisar, abre o detalhe do produto
      // v4.50 - NUMERO NAO E ID. Existe SKU so de digitos (ex: 3933398010054);
      // assumindo que numero = id, a rota pedia /produtos/<sku>, nao achava e a
      // foto vinha vazia. Tenta pelo CODIGO primeiro, depois EAN, e so entao id.
      // ═══════════════════════════════════════════════════════════════
      // v4.52 - MESMO CAMINHO DO CHECKOUT OFFLINE, que funciona:
      //   1. lista por codigo (a lista ja costuma trazer imagemURL)
      //   2. se nao veio, busca o DETALHE do produto pelo id
      //   3. ainda nada? tenta por EAN e por nome
      // E devolve o MOTIVO quando nao acha - sem isso, "imagem: null"
      // pode ser produto inexistente, falta de escopo no token do Bling
      // ou produto sem foto, e nao da pra saber qual.
      // ═══════════════════════════════════════════════════════════════
      let id = null;
      let url = null;
      let via = null;
      let motivo = null;

      const listar = async (filtro) => {
        const r = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?${filtro}&limite=3`);
        if (!r.ok) { motivo = motivo || ('bling recusou a listagem (' + (r.status || '?') + ')'); return []; }
        return (r.data && r.data.data) || [];
      };

      // 1) pelo codigo
      const porCodigo = await listar(`codigo=${encodeURIComponent(chave)}`);
      let prod = porCodigo.find(p => String(p.codigo || '').toUpperCase() === chave.toUpperCase())
        || porCodigo[0] || null;
      if (prod) { url = primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_codigo'; }

      // 2) EAN, quando o termo tem cara de codigo de barras
      if (!prod && /^\d{8,14}$/.test(chave)) {
        const porEan = await listar(`gtin=${encodeURIComponent(chave)}`);
        prod = porEan[0] || null;
        if (prod) { url = url || primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_ean'; }
      }

      // 3) pelo nome - o SKU da triagem as vezes nao e o codigo do Bling
      if (!prod) {
        const porNome = await listar(`pesquisa=${encodeURIComponent(chave)}`);
        prod = porNome[0] || null;
        if (prod) { url = url || primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_nome'; }
      }

      if (!prod && !id && /^\d{6,}$/.test(chave)) id = chave;   // era um id mesmo

      // 4) o DETALHE, que e onde a foto quase sempre esta
      if (!url && id) {
        const rD = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(id)}`);
        if (!rD.ok) {
          motivo = 'o Bling recusou o detalhe do produto (' + (rD.status || '?')
            + ') - se for 401/403, e falta do escopo Produtos no token';
        } else {
          url = primeiraImagem((rD.data && rD.data.data) || null);
          if (url) via = 'detalhe';
          else motivo = motivo || 'produto encontrado, mas sem foto cadastrada no Bling';
        }
      }
      if (!prod && !url) motivo = motivo || 'nenhum produto com esse codigo, EAN ou nome no Bling desta empresa';

      // so cacheia SUCESSO - falha passageira nao pode fixar o vazio
      if (url) IMG_CACHE.set(chave, url);
      res.json({ ok: true, id: chave, imagem: url, via, motivo, produto_id: id || null });

    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

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
      .from('devolucoes')
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
    const { error: errUpd } = await supabase.from('devolucoes').update(upd).eq('id', req.params.id);
    if (errUpd) return res.status(500).json({ ok: false, erro: 'Falhou ao gravar: ' + errUpd.message });

    return res.json({ ok: true, qtd: itens.length, id_descoberto: idDescoberto });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || 'erro interno' });
  }
});

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
const DEPOSITO_GERAL_GOOD = '4956031259';

app.post('/api/admin/full-vincular/:id', requerAdmin, async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, erro: 'Supabase nao configurado' });
  try {
    const { data: reg, error: errReg } = await supabase
      .from('devolucoes').select('*').eq('id', req.params.id).single();
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
    const ini = f(new Date(base.getTime() - 864e5));
    const fim = f(new Date(Date.now() + 864e5));

    const nomeBusca = String(reg.buyer_nome || '').trim().toLowerCase();
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

    // Varre notas de ENTRADA na janela e junta candidatas por valor/nome
    const candidatos = [];
    for (let pg = 1; pg <= 5; pg++) {
      if (pg > 1) await sleep(400);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=0&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      for (const nf of lista) {
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        const bateNome = nomeBusca && nomeNF.includes(nomeBusca);
        const bateValor = valorEsperado > 0 && nf.valorNota != null &&
          Math.abs(Number(nf.valorNota) - valorEsperado) < 0.05;
        if (bateNome || bateValor) candidatos.push(nf);
      }
      if (lista.length < 100) break;
    }
    candidatos.sort((a, b) => new Date(b.dataEmissao || 0) - new Date(a.dataEmissao || 0));

    // Confirma a serie 2 na NF completa (a lista pode nao trazer serie)
    for (const cand of candidatos.slice(0, 3)) {
      await sleep(400);
      const rFull = await buscarNFePorId(cand.id);
      const nf = (rFull.ok && rFull.data?.data) ? rFull.data.data : null;
      if (!nf) continue;
      const chaveD = String(nf.chaveAcesso || '').replace(/\D/g, '');
      const serieOk = String(nf.serie || '').trim() === '2' ||
        (chaveD.length === 44 && chaveD.substr(22, 3) === '002');
      if (!serieOk) continue;

      const { error: errUpd } = await supabase
        .from('devolucoes')
        .update({
          nf_devolucao_id_bling: String(nf.id),
          nf_devolucao_numero: String(nf.numero || ''),
        })
        .eq('id', req.params.id);
      if (errUpd) return res.status(500).json({ ok: false, erro: 'Achei a NF ' + nf.numero + ' mas falhou ao gravar: ' + errUpd.message });

      console.log(`[FULL-VINCULAR] ${req.params.id}: entrada serie 2 nº ${nf.numero} (id ${nf.id})`);
      return res.json({ ok: true, nf_devolucao_numero: String(nf.numero || ''), nf_devolucao_id_bling: String(nf.id) });
    }

    return res.status(404).json({
      ok: false,
      erro: `Nenhuma NF de entrada serie 2 correspondente na janela ${ini}..${fim} (${candidatos.length} candidata(s) testada(s)). Se ainda nao importou o XML no Bling, use o selo 🏬 pra baixar.`,
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
      .from('devolucoes').select('id, nf_devolucao_id_bling, nf_devolucao_numero').eq('id', req.params.id).single();
    if (errReg || !reg) return res.status(404).json({ ok: false, erro: 'Registro nao encontrado' });
    if (!reg.nf_devolucao_id_bling) {
      return res.status(400).json({ ok: false, erro: 'Card sem devolucao vinculada - use o 🔗 Achar devolucao primeiro' });
    }

    // v3.28: deposito escolhido no painel (whitelist), padrao Geral
    const DEPOSITOS_VALIDOS = new Set(['4956031259', '14888156920', '14888947655', '9596855161']);
    const pedidoDep = String(req.body?.idDeposito || '').trim();
    const deposito = DEPOSITOS_VALIDOS.has(pedidoDep) ? pedidoDep : DEPOSITO_GERAL_GOOD;

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
        .from('devolucoes')
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
        .from('devolucoes')
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
      .from('devolucoes')
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
    const valorEsperado = (Number(reg.produto_valor_unit) || 0) * (Number(reg.produto_qtd) || 1);

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
        const nomeNF = String(nf.contato?.nome || '').toLowerCase();
        const bateNome = nomeBusca && nomeNF.includes(nomeBusca);
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
      .from('devolucoes')
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
        .from('devolucoes')
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
      .from('devolucoes')
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
      .from('devolucoes')
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
      .from('devolucoes')
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
      .from('devolucoes')
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
      .from('devolucoes')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

};
