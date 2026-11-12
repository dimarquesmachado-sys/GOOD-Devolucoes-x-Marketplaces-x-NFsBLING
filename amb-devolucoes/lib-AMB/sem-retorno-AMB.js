'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/sem-retorno-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F1).
//
// MOVIDO de app-AMB.js em b685, SEM EDICAO: o bloco das VENDAS ESTORNADAS SEM RETORNO do servidor —
//   POST /api/admin/sem-retorno/registrar, GET /api/debug/achar-nf e GET /api/admin/sem-retorno.
// O bloco vivia dentro de criarAppEmpresa (uma funcao de ~4.200 linhas) e usava 10 nomes da closure,
// TODOS `const` e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por
// `deps` com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e
// usado fora dele. A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das
// rotas no router nao muda; o 404 final continua depois).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la
// (bling, CACHES, envAmb...) tem que entrar em DEPS e na chamada em app-AMB.js — senao e ReferenceError
// so na hora da requisicao. A conferencia abaixo faz a falta de um nome estourar no BOOT.

const DEPS = ['CHAVE_DADOS', 'auth', 'erroCodigo', 'confrontar', 'vinculoCache', 'marcadores', 'magaluCancelados', 'db', 'nfp', 'ajudantes'];

module.exports = function registrarSemRetorno(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('sem-retorno-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { CHAVE_DADOS, auth, erroCodigo, confrontar, vinculoCache, marcadores, magaluCancelados, db, nfp, ajudantes } = deps;

// @secao sem-retorno
router.post('/api/admin/sem-retorno/registrar', auth.requerAdmin, async (req, res) => {
  try {
    const sb = db.cliente();
    if (!sb) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    const d = req.body || {};
    const pedido = String(d.pedido || '').trim();
    if (!pedido) return res.status(400).json({ ok: false, erro: 'sem pedido, nao da pra registrar' });

    // JA EXISTE? devolve o id em vez de criar outro — clicar duas vezes
    // criaria duas portas pra emitir a mesma nota.
    const chaveCaso = String(d.chave_caso || '').trim();
    const legados = [d.chave_caso_legado, d.chave_caso_legado2]
      .map((x) => String(x || '').trim()).filter(Boolean);

    const { data: doPedido, error: erroBusca } = await sb
      .from(db.tabelas.devolucoes)
      .select('id, nf_devolucao_id_bling, problema_descricao')
      .eq('order_id', pedido);
    if (erroBusca) return res.status(500).json({ ok: false, erro: erroBusca.message });

    const existente = chaveCaso
      ? (doPedido || []).find((r) => {
        const desc = String(r.problema_descricao || '');
        return desc.includes('[caso:' + chaveCaso + ']')
          || legados.some((l) => desc.includes('[caso:' + l + ']'));
      })
      : (doPedido || [])[0];

    if (existente) {
      return res.json({
        ok: true,
        id: existente.id,
        ja_existia: true,
        nf_ja_emitida: !!existente.nf_devolucao_id_bling,
      });
    }

    const { data, error } = await sb
      .from(db.tabelas.devolucoes)
      .insert({
        // b199.2 (Codex): a AMB filtra a fila pela coluna `status`, nao por
        // `tipo` — com 'pendente' o registro nunca apareceria em
        // "Aprovadas", que e justamente o que o botao promete.
        tipo: 'aprovado',
        status: 'aprovado',
        order_id: pedido,
        produto_titulo: d.produto || null,
        produto_sku: d.sku || null,
        produto_qtd: d.qtd || null,
        nf_numero: d.nf_numero || null,
        nf_chave: d.nf_chave || null,
        nf_id_bling: d.nf_id_bling || null,
        funcionario: 'Sistema (card estornadas)',
        // b199.6 (Codex): GRAVAR o que a fila vai precisar depois.
        //
        // O lote manda o caso pra "Aprovadas", e o rascunho e gerado LA —
        // por um card que so tem o que esta no banco. Sem estes campos:
        //   - a trava de NF duplicada nao roda (precisa de cliente e data)
        //   - o deposito cai em GERAL (o marcador de defeito se perde)
        // Consertei o caminho direto e esqueci que o lote passa pela fila.
        // b199.7 (Codex): SO colunas que a tabela de triagens tem.
        //
        // Eu tinha posto `cliente_nome` e `nf_emitida_em`, que so existem em
        // `devolucoes_capturadas` — o PostgREST rejeitaria a LINHA INTEIRA,
        // e o registro falharia todo, nao so em parte.
        //
        // `buyer_nome` existe (o insert da triagem usa). A DATA nao tem
        // coluna aqui, entao vai na descricao, de onde o card pode ler.
        buyer_nome: d.cliente || null,
        // b210.6 (Codex): a serie escolhida entra no vinculo da NF, pra o
        // card da fila saber que a nota e do Full
        nf_id_bling: d.nf_id_bling || null,
        // o RASTRO: quem olhar depois precisa saber que NAO houve bipagem
        // `[DEFEITO]` na descricao: as filas leem `d.status || d.tipo` pra
        // decidir o deposito, e a palavra "defeito" ali faz `ehProblema`
        // casar. E o unico canal que atravessa sem coluna nova.
        problema_descricao: marcadores.montarDescricao({ ...d, chave_caso: chaveCaso }),
      })
      .select('id')
      .single();

    if (error) return res.status(500).json({ ok: false, erro: error.message });

    // b199.3 (Codex): CORRIDA entre duas abas. Nao ha indice unico pro
    // marcador, entao dois cliques simultaneos passam os dois pelo select
    // acima e criam DOIS registros da mesma devolucao — duas portas pra
    // emitir a mesma nota.
    //
    // Releio depois de inserir: se apareceu outro com o mesmo `[caso:X]` e
    // ele e mais antigo, apago o meu e devolvo o dele.
    if (chaveCaso) {
      try {
        const { data: dobrados } = await sb
          .from(db.tabelas.devolucoes)
          .select('id, problema_descricao')
          .eq('order_id', pedido);
        const mesmos = (dobrados || [])
          .filter((r) => String(r.problema_descricao || '').includes('[caso:' + chaveCaso + ']'))
          .sort((a, b) => Number(a.id) - Number(b.id));
        if (mesmos.length > 1 && String(mesmos[0].id) !== String(data.id)) {
          await sb.from(db.tabelas.devolucoes).delete().eq('id', data.id);
          return res.json({ ok: true, id: mesmos[0].id, ja_existia: true, corrida_resolvida: true });
        }
      } catch (e) { /* na duvida fica o que inseri; o front nao duplica sozinho */ }
    }

    return res.json({ ok: true, id: data.id, ja_existia: false });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 200) });
  }
});

router.get('/api/debug/achar-nf', (req, res, next) => {
  // b203.1 (Codex): aceitar ?k=ADMIN_KEY, que e o que a doc da rota diz —
  // e exigir ADMIN, nao qualquer login. Com `requerLogin` puro, a chave era
  // ignorada e um estoquista logado veria dado de nota fiscal.
  const chave = String(req.query.k || '').trim();
  if (chave && process.env.ADMIN_KEY && chave === process.env.ADMIN_KEY) return next();
  return auth.requerAdmin ? auth.requerAdmin(req, res, next) : auth.requerLogin(req, res, next);
}, async (req, res) => {
  try {
    const pedido = String(req.query.pedido || '').trim();
    if (!pedido) return res.status(400).json({ ok: false, erro: 'passe ?pedido=' });
    const data = String(req.query.data || '').trim() || null;

    // b203.1 (Codex): `buscarNFnoBlingPorOrderId` NAO EXISTE nos ajudantes
    // da AMB — ha ate um comentario no proprio arquivo avisando ("bug
    // latente morto", b172). Eu chamei mesmo assim, aqui e no #124.
    //
    // A AMB tem a `buscarNFBlindada`, que ja faz o filtro direto por
    // numeroLoja na FASE 0 dela — o mesmo caminho que resolveu o caso do
    // TikTok na GOOD.
    // b206 - testa os caminhos na ORDEM do card: numero primeiro.
    //
    // O diagnostico so usava a blindada (que vai por pedido), enquanto o
    // card busca primeiro pelo NUMERO. Testar caminho diferente do real
    // engana quem le a resposta.
    const numeroNF = String(req.query.nf || '').trim();
    const tentativas = [];
    let r = null;

    if (numeroNF) {
      const rn = await ajudantes.buscarNFnoBlingPorNumero(numeroNF, data, { maxPaginas: 2 });
      tentativas.push({ via: 'numero', achou: !!(rn && rn.match),
        detalhe: (rn && rn.via) || null });
      if (rn && rn.match) r = { ok: true, via: (rn.via || 'numero'), nf: rn.match, idNF: rn.match.id };
    }

    if (!r) {
      const rb = await ajudantes.buscarNFBlindada({
        orderId: pedido,
        dataReferencia: data,
        maxPaginasJanela: parseInt(req.query.paginas, 10) || 12,
        maxPaginasFundo: parseInt(req.query.paginas, 10) || 12,
      });
      tentativas.push({ via: 'pedido', achou: !!(rb && rb.ok && (rb.nf || rb.idNF)),
        detalhe: (rb && rb.via) || null });
      r = rb;
    }

    return res.json({
      ok: true,
      empresa: CHAVE_DADOS,
      pedido,
      data_referencia: data,
      // a blindada devolve { ok, via, nf, idNF, trace } — nao { match }
      achou: !!(r && r.ok && (r.nf || r.idNF)),
      via: (r && r.via) || null,
      // b203.3 (Codex): mostrar o ID mesmo sem o detalhe. Corrigi isso no
      // CARD e esqueci aqui — se a blindada acha o id e falha no detalhe,
      // o diagnostico dizia `nf: null` e parecia que nao tinha achado.
      id_achado: (r && (r.idNF || (r.nf && r.nf.id))) || undefined,
      nf: (r && r.nf) ? {
        id: r.nf.id || r.idNF, numero: r.nf.numero,
        numeroPedidoLoja: r.nf.numeroPedidoLoja,
        numeroLoja: r.nf.numeroLoja,
        data: r.nf.dataEmissao || r.nf.data,
        chave: r.nf.chaveAcesso,
      } : null,
      // o `trace` dela conta o que cada FASE tentou — e o diagnostico
      tentativas,   // b206: o que cada caminho fez
      trace: (r && r.trace) || undefined,
      tentado: (r && r.tentado) || undefined,
      // b203.2 (Codex): os `via` REAIS da blindada sao `nfe-numeroLoja`
      // (fase 0, uma chamada), `nfe-janela-orderId` e `nfe-fundo-orderId`.
      // Eu documentei `filtro_direto`, que e o nome que uso na GOOD — o
      // dono leria a resposta procurando um valor que nunca aparece.
      leia: '`via: nfe-numeroLoja` = achou numa chamada so (o melhor caso). '
        + '`nfe-janela-orderId` ou `nfe-fundo-orderId` = precisou varrer. '
        + 'Se `achou:false`, veja `tentado` e `trace`: eles contam o que cada fase fez. '
        + 'Filtro por numeroLoja sem resultado = o pedido esta em outro campo no Bling.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 300) });
  }
});

router.get('/api/admin/sem-retorno', auth.requerLogin, async (req, res) => {
  try {
    const sb = db.cliente();
    if (!sb) return res.status(503).json({ ok: false, erro: 'Supabase nao configurado' });

    const EMPRESA = CHAVE_DADOS;
    const dias = Math.min(730, Math.max(1, parseInt(req.query.dias, 10) || 365));
    const desde = new Date(Date.now() - dias * 864e5).toISOString();
    const AGORA = Date.now();

    // 1) o que a captura guardou (TikTok: reembolso puro concluido)
    const { data: cap, error: erroCap } = await sb
      .from('devolucoes_capturadas')
      .select('*')
      .eq('empresa', EMPRESA)
      .eq('tipo_tiktok', 'REFUND')
      .gte('criado_no_mkt', desde)
      .in('status', ['RETURN_OR_REFUND_REQUEST_COMPLETE', 'REFUND_SUCCESS', 'COMPLETE', 'SUCCESS'])
      .order('criado_no_mkt', { ascending: false })
      .limit(500);
    if (erroCap) return res.status(500).json({ ok: false, erro: erroCap.message });

    const semRetorno = (cap || []).filter((d) =>
      String(d.status || '').toUpperCase().indexOf('CANCEL') === -1);

    // 2) o Magalu, pela ponte com o Mover-Pedidos
    let magaluItens = [];
    let magaluErro = null;
    try {
      const rm = await magaluCancelados.buscar(EMPRESA, {
        de: new Date(AGORA - dias * 864e5).toISOString().slice(0, 10),
        ate: new Date().toISOString().slice(0, 10),
      });
      if (rm.ok) magaluItens = rm.itens;
      else magaluErro = rm.erro;
    } catch (e) {
      // b205 - o erro na tela DIZ se e bug nosso.
      //
      // Foi assim que o Magalu ficou 3 dias sem aparecer na GOOD: um
      // ReferenceError virava "magalu_erro" e parecia falha da ponte deles.
      erroCodigo.registrar(e, 'magalu-cancelados');
      magaluErro = erroCodigo.paraTela(e, 'magalu');
    }

    // 3) quem JA foi triado sai: senao seriam duas portas pra mesma nota,
    //    e duas devolucoes emitidas sem ninguem perceber
    const pedidos = [...new Set(
      semRetorno.map((d) => d.pedido).concat(magaluItens.map((m) => m.pedido)).filter(Boolean)
    )];
    // b199.2 (Codex): separar o registro do CARD (tem `[caso:X]`) da triagem
    // de BIPE. O primeiro derruba so aquele caso; o segundo, o pedido todo —
    // ali o produto voltou de verdade. Sem isso, registrar UM caso sumia com
    // os irmaos do mesmo pedido, e o dono nao teria como voltar neles.
    const jaTriados = new Set();
    const casosRegistrados = new Set();
    for (let i = 0; i < pedidos.length; i += 200) {
      const { data: tri, error: erroTri } = await sb
        .from(db.tabelas.devolucoes)
        .select('order_id, problema_descricao')
        .in('order_id', pedidos.slice(i, i + 200));
      if (erroTri) {
        return res.status(500).json({
          ok: false,
          erro: 'nao consegui conferir quais ja foram triados: ' + erroTri.message
            + ' — listar sem essa checagem mostraria casos ja resolvidos',
        });
      }
      for (const t of (tri || [])) {
        const m = String(t.problema_descricao || '').match(/\[caso:([^\]]+)\]/);
        if (m) casosRegistrados.add(m[1]);
        else jaTriados.add(String(t.order_id));
      }
    }

    const itens = semRetorno.concat(magaluItens)
      .filter((d) => {
        if (casosRegistrados.has(String(d.id))) return false;
        if (d.id_legado && casosRegistrados.has(String(d.id_legado))) return false;
        if (d.id_legado2 && casosRegistrados.has(String(d.id_legado2))) return false;
        // b199.7 (Codex): o TikTok e identificado pela chave da solicitacao,
        // nao pelo `id` — sem isto um caso registrado pelo lote continuava
        // aparecendo, e o dono registraria de novo achando que falhou.
        if (d.chave_marketplace && casosRegistrados.has(String(d.chave_marketplace))) return false;
        return !jaTriados.has(String(d.pedido));
      })
      .map((d) => {
        // (o vinculo da NF no Bling e feito depois, em bloco)
        // o relogio conta da EMISSAO da nota. Data exata (Magalu) manda
        // sobre o mes da chave (TikTok), que manda sobre a devolucao.
        let base = null;
        let baseOrigem = null;
        if (d.nf_emitida_em) {
          const t = new Date(d.nf_emitida_em).getTime();
          if (Number.isFinite(t)) { base = t; baseOrigem = 'data_emissao'; }
        }
        const chave = String(d.nf_chave || '').replace(/\D/g, '');
        if (base == null && chave.length === 44) {
          const aa = parseInt(chave.slice(2, 4), 10);
          const mm = parseInt(chave.slice(4, 6), 10);
          if (aa >= 0 && mm >= 1 && mm <= 12) {
            base = Date.UTC(2000 + aa, mm - 1, 1);   // dia 1: leitura conservadora
            baseOrigem = 'chave_nfe';
          }
        }
        // b195.5 (Codex): o Magalu traz `cancelado_em`, que e MUITO mais
        // perto da emissao que a data da captura. Sem isto, um caso do
        // Magalu sem chave caia em `criado_no_mkt` — que pode ser de hoje,
        // dando prazo de cancelamento que nao existe.
        if (base == null && d.cancelado_em) {
          const t = new Date(d.cancelado_em).getTime();
          if (Number.isFinite(t)) { base = t; baseOrigem = 'evento_magalu'; }
        }
        if (base == null && d.criado_no_mkt) {
          base = new Date(d.criado_no_mkt).getTime();
          baseOrigem = 'devolucao';   // da MAIS prazo que o real
        }
        if (base == null && d.criado_em) {
          base = new Date(d.criado_em).getTime();
          baseOrigem = 'devolucao';
        }

        const diasDesde = base ? Math.floor((AGORA - base) / 864e5) : null;
        // quem ja voltou nao cancela (houve circulacao), e o Magalu nunca
        // cancela (nao temos prova de que a mercadoria nao saiu)
        const jaVoltou = !!d.tem_devolucao_registrada;
        // b195.4 (Codex): a MESMA regra da GOOD. O `nf_sem_saida` E a prova
        // de que o pedido nunca foi despachado, entao ali cancelar e o
        // certo — bloquear faria o dono perder o prazo de 20 dias.
        //
        // Isto e a divida do front aparecendo: a regra vive nos dois
        // servidores em vez de numa peca so, entao consertar num lado
        // deixa o outro para tras. Foi o que aconteceu aqui.
        const semProva = d.marketplace === 'magalu' && d.classe !== 'nf_sem_saida';
        // b195.6 (Codex): CANCELAR exige data CONFIAVEL da nota.
        //
        // `cancelado_em` e `criado_no_mkt` sao datas do EVENTO, nao da
        // emissao. Uma venda de maio cancelada ontem daria "3 dias" e eu
        // ofereceria cancelar uma nota vencida ha meses — o dono tentaria e
        // levaria 501 intempestivo.
        //
        // So a data de emissao (Magalu) e o mes da chave (NF-e) dizem quando
        // a nota saiu. Sem uma das duas, o caminho e a devolucao, que vale
        // em qualquer prazo.
        const dataConfiavel = baseOrigem === 'data_emissao' || baseOrigem === 'chave_nfe';
        const podeCancelar = dataConfiavel && !jaVoltou && !semProva && diasDesde != null && diasDesde <= 20;

        return {
          id: d.id,
          marketplace: d.marketplace,
          pedido: d.pedido,
          nf_numero: d.nf_numero,
          nf_chave: d.nf_chave,
          nf_id_bling: d.nf_id_bling || null,   // b192 - preenchido logo abaixo
          cliente: d.cliente_nome,
          produto: d.produto_titulo,
          sku: d.produto_sku,
          qtd: d.produto_qtd,
          valor: d.valor_refund != null ? d.valor_refund : d.valor,
          valor_rateado: d.valor_rateado || undefined,
          motivo: d.motivo_texto || d.motivo,
          dias_desde: diasDesde,
          prazo_base: baseOrigem,
          // b203.2 (Codex): as datas de ORIGEM vao no item — a busca por
          // pedido as usa pra montar a janela, e sem elas ia sempre null.
          nf_emitida_em: d.nf_emitida_em || undefined,
          cancelado_em: d.cancelado_em || undefined,
          criado_no_mkt: d.criado_no_mkt || undefined,
          acao: podeCancelar ? 'cancelar_nf' : 'nf_devolucao',
          prazo_cancelamento: podeCancelar ? Math.max(0, 20 - diasDesde) : 0,
          classe: d.classe || undefined,
          tem_devolucao_registrada: d.tem_devolucao_registrada || undefined,
          entrada_estoque: d.entrada_estoque,
          prejuizo_integral: d.prejuizo_integral || undefined,
        };
      });

    // b192 - VINCULAR A NF NO BLING, senao o card fica so com o aviso
    // "sem NF vinculada" — sem link e sem serventia. A chave manda: ela
    // carrega a competencia e a serie, e e o que o Magalu entrega.
    const INICIO_BUSCA = Date.now();
    // b192.1 (Codex): entram os que tem CHAVE **ou** so numero — nota com
    // numero e sem chave existe, e ficaria sem link a toa.
    // b192.2 (Codex): cota por marketplace, senao numa fila cheia de TikTok
    // o Magalu nao entraria — e sao os casos de maior valor.
// b204.1 (Codex): o cache roda ANTES de qualquer fila.
    //
    // Eu aplicava depois da fase da CHAVE, entao os casos ja resolvidos
    // eram re-buscados a cada refresh — gastando os 8s dela — e a fase do
    // NUMERO, que vem depois, ja encontrava o orcamento vencido e saia na
    // hora.
    vinculoCache.aplicar(itens, CHAVE_DADOS);

    // ── b221: FASE ZERO — a busca EXATA pela chave ──────────────────────
    //
    // [stated] "existiria alguma forma de eu relacionar o número da chave
    // danfe, que fica dentro da NF?"
    //
    // Testado: `?chaveAcesso=` devolve exatamente a nota, em 1 chamada. Pra
    // todo caso que TEM chave, isso resolve sem ambiguidade de serie, sem
    // candidatas, sem escada. As fases seguintes viram reserva pros que nao
    // tem chave (TikTok capturado sem detalhe).
    {
      let feitasChave = 0;
      for (const item of vinculoCache.fila(itens, CHAVE_DADOS, 25,
          (x) => String(x.nf_chave || '').replace(/\D/g, '').length === 44, 'chave')) {
        if (Date.now() - INICIO_BUSCA > 6000) break;
        if (feitasChave > 0) await new Promise((ok) => setTimeout(ok, 350));
        feitasChave++;
        const idCache = vinculoCache.chaveDe(item, CHAVE_DADOS);
        try {
          // b221.1 (Codex): o prazo CANCELA, nao so abandona. Sem isto a
          // chamada seguia por ate 30s em segundo plano, ainda fazia o
          // detalhe, e disputava o limite do Bling com o proximo item.
          const cancelar = {};
          const r = await Promise.race([
            ajudantes.buscarNFPelaChave(item.nf_chave, { cancelar }),
            new Promise((ok) => setTimeout(() => { cancelar.agora = true; ok(null); }, 4000)),
          ]);
          if (r && r.match && r.match.id) {
            item.nf_id_bling = String(r.match.id);
            // b221.1 (Codex): a chave e a AUTORIDADE. O numero capturado
            // pode estar errado (ja vimos o Magalu mandar numero proprio); o
            // da nota achada pela chave e o certo, e e ele que vai pro
            // registro e pra tela.
            if (r.match.numero) item.nf_numero = String(r.match.numero);
            item.nf_achada_por = 'chave';
            vinculoCache.guardar(item, item.nf_id_bling, 'chave',
              { chave: item.nf_chave, numero: item.nf_numero, serie: item.nf_serie }, CHAVE_DADOS, idCache);
          } else if (r && r.ok !== false && r.via === 'chave-nao-achou') {
            // b221.4 (Codex): respondeu VAZIO — a chave nao esta nesta conta.
            // So este caso esfria 20 min e recebe o motivo. Na rodada
            // anterior o motivo ficou num `if` INALCANCAVEL, dentro do ramo
            // de falha transitoria — o Codex pegou.
            vinculoCache.marcarFalha(item, CHAVE_DADOS, 'chave');
            item.nf_motivo_sem_vinculo = 'nao ha NF com esta chave nesta conta do Bling '
              + '— confira se e da empresa certa, ou se foi cancelada';
          } else if (r && r.ok !== false && r.via === 'chave-nota-morta') {
            // a nota existe mas esta cancelada/denegada: definitivo tambem
            vinculoCache.marcarMorta(item, CHAVE_DADOS, r.situacao);   // 30/10: permanente — e o card sai da lista (resolvido)
            item.nf_cancelada = true;
            item.nf_motivo_sem_vinculo = 'a NF desta chave esta cancelada ou denegada no Bling '
              + '(situacao ' + r.situacao + ')';
          } else {
            // b221.4 (Codex): `chave-ignorada` (a API devolveu notas quaisquer)
            // e falha transitoria (timeout, 429, erro) caem AQUI: nao sei nada
            // sobre a minha nota, entao nao esfrio 20 min — adio 2 e deixo as
            // fases seguintes tentarem.
            vinculoCache.adiarPouco(item, CHAVE_DADOS, 'chave');
          }
        } catch (e) { /* as fases seguintes tentam pelo numero */ }
      }
    }


    // 29/10: o que a abertura nao alcancou pela chave continua em SEGUNDO PLANO (vinculo-nf-cache) — a proxima
    // abertura ja vem vinculada, e o card desta diz 'procurando' em vez de 'nao localizada'
    vinculoCache.completarChaveEmFundo(itens, CHAVE_DADOS, (ch, op) => ajudantes.buscarNFPelaChave(ch, op));

    // b204.3 (Codex): a fase do NUMERO vem PRIMEIRO, como na GOOD.
    //
    // A fase da CHAVE pagina o Bling e podia consumir os 8s inteiros — ate
    // quando nao achava nada. A do numero, que vinha depois com corte em
    // 6s, saia na hora sem fazer UMA chamada sequer.
    //
    // O direto por numero custa 1 chamada e resolve a maioria; a chave fica
    // pro que sobrar, que e onde ela e insubstituivel.
    // b203 - PELA NOTA primeiro, aqui tambem. [stated] "vc tinha q tá
    // pegando nota fiscal. nf sim sempre terá." O pedido pode nao existir
    // (XML do Full importado nao cria pedido no Bling); a nota existe.


    let buscadas = 0;
    for (const item of vinculoCache.fila(itens, CHAVE_DADOS, 25, (x) => x.nf_numero, 'numero')) {
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, CHAVE_DADOS);
      // b204: reserva os ultimos segundos pra fase da CHAVE, que e exata
      if (Date.now() - INICIO_BUSCA > 6000) break;
      // b203.1 (Codex): RITMO. O Bling limita a 3 req/s, e sao ate 25 itens
      // seguidos aqui. Sem pausa, os primeiros levam 429 e o retry de 1,5s
      // de cada um come o orcamento inteiro — os ultimos nem sao tentados.
      if (buscadas > 0) await new Promise((ok) => setTimeout(ok, 350));
      buscadas++;
      try {
        const r = await Promise.race([
          ajudantes.buscarNFnoBlingPorNumero(item.nf_numero,
            item.nf_emitida_em || item.criado_no_mkt || null, { maxPaginas: 2, chave: item.nf_chave }),
          new Promise((ok) => setTimeout(() => ok(null), 4000)),
        ]);
        const achada = (r && r.match) || null;
        // b203.1 (Codex): CONFERIR A CHAVE quando eu tenho as duas.
        //
        // Numero de NF se repete entre SERIES. A busca devolve a mais
        // recente, e sem comparar a chave eu aceitaria a nota de outra serie
        // — e o dono geraria a devolucao contra a venda errada.
        //
        // So aceito de olhos fechados quando nao ha chave pra comparar.
        // b203.2 (Codex): chave AUSENTE nao e chave que bate.
        //
        // A listagem do /nfe pode voltar SEM `chaveAcesso` — esta
        // documentado no proprio repo (b166.4, public/js/busca.js). Minha
        // condicao tratava isso como "conferiu", e eu aceitava a nota mais
        // recente com aquele numero, que pode ser de OUTRA SERIE.
        //
        // Agora: se eu TENHO a chave do item, ela precisa BATER de verdade.
        // Sem chave na resposta, o vinculo nao e confirmado — o caso fica
        // pra fase da chave, que e exata.
        // b208 - ESCADA de desempate, no lugar da comparacao solta.
        //
        // [stated] "tipo uma 2a verificação o nome do cliente? ... ou checar
        // ainda, de qual marketplace tá vindo a venda"
        //
        // chave > serie > marketplace > cliente. Se nada decide e sobra mais
        // de uma viavel, guardo as candidatas pro card mostrar — chutar aqui
        // e gerar devolucao contra a venda errada.
        // b210.5 (Codex): lista INCOMPLETA nao decide sozinha.
        //
        // Quando a varredura erra no meio, ela agora devolve o que juntou —
        // mas com `ok:false`. Escolher a partir dessa lista aceitaria uma
        // candidata unica que so e unica porque a busca parou: a outra podia
        // estar na pagina que falhou. Fica pro proximo refresh.
        // b210.6 (Codex): completa = respondeu E varreu tudo.
        // O teto de paginas devolve `ok:true` (pro legado nao quebrar) mas
        // com `listaCompleta:false` — a lista pode nao ter todas as notas.
        const buscaCompleta = !!(r && r.ok !== false && r.listaCompleta !== false);
        // e o prazo estourado (r nulo) e falha TRANSITORIA: nao adio 20min
        const respondeu = !!r;
        const veredito = confrontar.escolher(item,
          (r && r.candidatas) || (achada ? [achada] : []));
        // b216 (Codex): busca truncada so aceita escolha pela CHAVE.
        //
        // Antes eu deixava passar qualquer `escolhida` que nao fosse
        // `fraca` — mas dois sinais fracos (marketplace + cliente) decidem
        // sem a chave, e numa lista truncada a nota certa pode ser a que
        // ficou na pagina nao lida. So a chave e prova suficiente aqui.
        const decidiuPelaChave = !!(veredito.por && veredito.por.includes('chave'));
        if (!buscaCompleta && !decidiuPelaChave) {
          // b210.6 (Codex): so esfrio quando o Bling RESPONDEU. Prazo
          // estourado ou erro sao transitorios — adiar 20min por causa
          // deles contraria a propria regra que escrevi no b204.6.
          if (respondeu && r.ok !== false) vinculoCache.marcarFalha(item, CHAVE_DADOS, 'numero');
          continue;
        }
        if (veredito.candidatas && veredito.candidatas.length > 1) {
          item.nf_candidatas = veredito.candidatas;
          vinculoCache.marcarFalha(item, CHAVE_DADOS, 'numero');
          continue;   // o dono escolhe; nao chuto
        }
        const escolhida = veredito.escolhida || null;
        const chaveBate = !!escolhida;
        if (escolhida && escolhida.id) {
          item.nf_id_bling = String(escolhida.id);
          if (!item.nf_chave && escolhida.chaveAcesso) item.nf_chave = escolhida.chaveAcesso;
          if (veredito.fraca) item.nf_vinculo_fraco = true;   // b208: unica viavel, sem 2 sinais
          // b209: a SERIE diz se a nota e nossa ou do fulfillment. Nota do
          // Full foi emitida pelo MARKETPLACE — a devolucao contra ela nao e
          // a mesma coisa, e o dono precisa ver isso antes de gerar.
          // b210: cada nota que passa ENSINA o mapa serie->marketplace.
          // [stated] "cada marketplace com operação fullfilment vai ter 1
          // série específica" — entao o sistema aprende os numeros sozinho,
          // em vez de eu ficar pedindo.
          // b210.2 (Codex): a listagem pode vir SEM chave, e ai a serie
          // vinha null e o mapa nunca aprendia. A candidata costuma trazer
          // `serie` direto — uso ela como reserva.
          confrontar.aprender(CHAVE_DADOS,
            confrontar.serieDaChave(escolhida.chaveAcesso)
              || (escolhida.serie != null ? String(escolhida.serie) : null),
            escolhida);
          // b210.4 (Codex): a serie vem da CANDIDATA quando nao ha chave —
          // o mesmo fallback que o `aprender` acima ja usa. Sem isso, o
          // aviso de Full sumia justamente nas notas em que o Bling omite
          // `chaveAcesso`, que sao comuns.
          const serieDela = confrontar.serieDaChave(item.nf_chave)
            || (escolhida && escolhida.serie != null ? String(escolhida.serie) : null);
          if (serieDela) {
            item.nf_serie = serieDela;
            item.nf_canal = confrontar.canalDaSerie(serieDela, CHAVE_DADOS);
            item.nf_do_full = confrontar.ehDoFull(serieDela, CHAVE_DADOS);
          }
          item.nf_achada_por = 'numero';
          // b207: esta fase perdeu a guarda quando reordenei os lacos —
          // sem ela, a busca era refeita a cada refresh.
          vinculoCache.guardar(item, item.nf_id_bling, 'numero',
            { chave: item.nf_chave, numero: item.nf_numero, serie: item.nf_serie }, CHAVE_DADOS, idCache);
          item.nf_achada_por = 'numero';
        } else if (r && r.ok !== false && item.nf_chave) {
          // b207 - DIZER por que nao achou. A busca ja filtra pela serie da
          // chave, entao "nao achou" aqui significa: nao ha nota viva com
          // esse numero NESTA serie. Pode ter sido cancelada, ou nunca ter
          // sido emitida no Bling.
          const ch = String(item.nf_chave).replace(/\D/g, '');
          // b210.1 (Codex): a busca NAO e exaustiva (o filtro direto pode
          // falhar em silencio e a varredura le poucas paginas), entao nao
          // afirmo que a nota nao existe — digo que nao achei.
          item.nf_motivo_sem_vinculo = 'nao achei NF viva com o numero '
            + String(item.nf_numero) + ' na serie ' + ch.slice(22, 25)
            + ' — pode estar cancelada, fora do alcance da busca, ou nao existir '
            + 'no Bling. Confira por la antes de concluir';
          vinculoCache.guardar(item, item.nf_id_bling, 'numero', { chave: item.nf_chave, numero: item.nf_numero, serie: item.nf_serie }, CHAVE_DADOS, idCache);
        }
        // b204.6 (Codex): so adio quando o Bling RESPONDEU e nao achou.
            // Erro (429/500) ou prazo estourado devolvem `r` nulo — isso e
            // ausencia de resposta, nao "nao existe". Adiar por 20 min uma
            // instabilidade de segundos deixaria o dono sem o botao a toa.
            if (!item.nf_id_bling && r && r.ok !== false) {
              vinculoCache.marcarFalha(item, CHAVE_DADOS, 'numero');
            }
      } catch (e) { /* segue pros caminhos abaixo */ }
    }

    const semVinculoAMB = itens.filter((x) => x.nf_chave && !x.nf_id_bling && !x.nf_cancelada);   // Codex #515: nota morta nao se procura
    const filaAMB = semVinculoAMB.filter((x) => x.marketplace === 'magalu').slice(0, 15)
      .concat(semVinculoAMB.filter((x) => x.marketplace !== 'magalu').slice(0, 10));

    for (const item of filaAMB) {
      // b204.4 (Codex): PULAR quem ja foi resolvido. A lista foi montada
      // ANTES da fase do numero, entao pode conter itens que ela ja
      // vinculou — e `resolverIdNFPorChave` PAGINA, gastando o orcamento
      // dos que realmente precisam.
      if (item.nf_id_bling) continue;
      // b204.1: a identidade de ANTES do enriquecimento — o refresh
      // seguinte le a linha crua e procura por ela.
      const idCache = vinculoCache.chaveDe(item, CHAVE_DADOS);
      if (Date.now() - INICIO_BUSCA > 8000) break;   // o painel nao pode travar
      try {
        // a busca PAGINA no Bling e pode passar dos 8s sozinha; o teto do
        // laco so e conferido entre itens. O prazo e o QUE SOBRA do
        // orcamento: perder o vinculo de um card e melhor que travar a tela.
        const sobra = Math.max(500, 8000 - (Date.now() - INICIO_BUSCA));
        const id = await Promise.race([
          nfp.resolverIdNFPorChave(item.nf_numero, item.nf_chave),
          // b203.6 (Codex): SEM flag aqui. Ao remover a declaracao orfa deste
          // laco eu deixei a ATRIBUICAO — ela escreveria numa variavel que
          // nao existe mais, dentro de um setTimeout, onde o try nao pega:
          // o processo podia cair.
          //
          // Este laco chama `resolverIdNFPorChave`, que nao aceita sinal de
          // parada. Sem alguem pra avisar, a flag aqui nao teria uso.
          new Promise((ok) => setTimeout(() => ok(null), Math.min(5000, sobra))),
        ]);
        // b204.2 (Codex): GUARDAR aqui tambem. Eu calculava o `idCache`
        // nesta fase e nao usava — entao a busca por chave, que e a mais
        // CARA (pagina o Bling), era refeita a cada refresh.
        if (id) {
          item.nf_id_bling = String(id);
          item.nf_achada_por = item.nf_achada_por || 'chave';
          vinculoCache.guardar(item, item.nf_id_bling, 'chave',
            { chave: item.nf_chave, numero: item.nf_numero, serie: item.nf_serie }, CHAVE_DADOS, idCache);
        }
      } catch (e) { /* segue sem o link; o numero da NF esta no card */ }
    }

    for (const item of vinculoCache.fila(itens, CHAVE_DADOS, 10, (x) => x.pedido, 'pedido')) {
      const idCache = vinculoCache.chaveDe(item, CHAVE_DADOS);
      // b204.5 (Codex): corte em 8s, nao 12. Esta fase ficava entre a do
      // NUMERO e a da CHAVE e podia comer 14s — depois disso a da chave,
      // com corte em 8s, saia na hora sem tentar nada.
      if (Date.now() - INICIO_BUSCA > 8000) break;

      // a flag e DESTE laco: declaracao, atribuicao e uso no mesmo bloco.
      // Ja errei isso duas vezes — declarei num laco e usei noutro, depois
      // removi a declaracao e deixei a atribuicao orfa (que em strict mode
      // derruba o processo, porque acontece dentro do setTimeout).
      let desistiu = false;

      try {
        // o prazo e o que SOBRA do orcamento da rota, nao um valor fixo
        const prazo = Math.max(2000, Math.min(14000, 26000 - (Date.now() - INICIO_BUSCA)));
        const r = await Promise.race([
          ajudantes.buscarNFBlindada({
            parar: () => desistiu,
            orderId: item.pedido,
            // as datas vem do map acima; sem elas a blindada pula as fases
            // de janela e so tenta o filtro direto
            dataReferencia: item.nf_emitida_em || item.cancelado_em || item.criado_no_mkt || null,
            maxPaginasJanela: 6,
            maxPaginasFundo: 6,
          }),
          new Promise((ok) => setTimeout(() => { desistiu = true; ok(null); }, prazo)),
        ]);

        // ela pode achar o ID e falhar ao buscar o detalhe: { ok:true,
        // idNF, nf:null }. O id sozinho ja serve pro link e pra emissao.
        // b204.8 (Codex): a fase do PEDIDO tambem confere a CHAVE.
        //
        // Agora que ela recebe itens COM chave, aceitar a "mais recente do
        // pedido" sem comparar pegaria outra nota do mesmo pedido — e o
        // vinculo errado iria pro cache, ficando 12h.
        const achada = (r && r.ok && r.nf) || null;
        {
          const ci = String(item.nf_chave || '').replace(/\D/g, '');
          const ca = String(achada && achada.chaveAcesso || '').replace(/\D/g, '');
          if (ci && ca !== ci) {
            vinculoCache.marcarFalha(item, CHAVE_DADOS, 'pedido');
            continue;   // a fase da CHAVE resolve; ela e exata
          }
        }
        const idAchado = (achada && achada.id) || (r && r.ok && r.idNF) || null;
        if (idAchado) {
          item.nf_id_bling = String(idAchado);
          if (achada) {
            if (!item.nf_numero && achada.numero) item.nf_numero = String(achada.numero);
            if (!item.nf_chave && achada.chaveAcesso) item.nf_chave = achada.chaveAcesso;
          }
          item.nf_achada_por = 'pedido';
          vinculoCache.guardar(item, item.nf_id_bling, 'pedido', { chave: item.nf_chave, numero: item.nf_numero, serie: item.nf_serie }, CHAVE_DADOS, idCache);
        }
        // b204.6 (Codex): so adio quando o Bling RESPONDEU e nao achou.
            // Erro (429/500) ou prazo estourado devolvem `r` nulo — isso e
            // ausencia de resposta, nao "nao existe". Adiar por 20 min uma
            // instabilidade de segundos deixaria o dono sem o botao a toa.
            if (!item.nf_id_bling && r && r.ok !== false) {
              vinculoCache.marcarFalha(item, CHAVE_DADOS, 'pedido');
            }
      } catch (e) { /* segue sem a nota; o card continua so informativo */ }
    }

    // b210.1 (Codex): a SERIE e marcada pra TODOS que ganharam vinculo,
    // nao so pelos que a fase do numero resolveu. Item vinculado pelo
    // pedido ou pela chave tambem precisa do aviso de Full — ele muda o
    // tratamento fiscal.
    for (const item of itens) {
      // b216.1 (Codex): recalcular quando a SERIE veio do cache sem o resto.
      //
      // `aplicar()` restaura `nf_serie`, mas nao `nf_canal` nem `nf_do_full`
      // — e o `continue` pulava justamente esses, porque a serie ja estava
      // preenchida. Resultado: o aviso de Full sumia no refresh seguinte,
      // que e quando o cache passa a valer.
      if (!item.nf_id_bling) continue;
      if (item.nf_serie && item.nf_do_full !== undefined) continue;
      const serie = item.nf_serie || confrontar.serieDaChave(item.nf_chave);
      if (!serie) continue;
      item.nf_serie = serie;
      item.nf_canal = confrontar.canalDaSerie(serie, CHAVE_DADOS);
      item.nf_do_full = confrontar.ehDoFull(serie, CHAVE_DADOS);
    }

    // b203.7 (Codex): RECALCULAR a acao depois de enriquecer.
    //
    // A GOOD ja fazia isso desde o b188.1; a AMB nao — mais uma vez ela
    // ficou pra tras.
    //
    // O prazo sai da chave da NF-e. Se a chave so apareceu AGORA (veio do
    // Bling na busca acima), o item foi classificado com a data da
    // devolucao, que nao autoriza cancelamento. Sem recalcular, um caso
    // ainda cancelavel apareceria como "NF DE DEVOLUCAO" e o dono perderia
    // o prazo de 20 dias.
    for (const item of itens) {
      const chave = String(item.nf_chave || '').replace(/\D/g, '');
      // data exata manda sobre a chave, que so da o mes
      if (chave.length !== 44 || item.prazo_base === 'chave_nfe'
          || item.prazo_base === 'data_emissao') continue;
      const aa = parseInt(chave.slice(2, 4), 10);
      const mm = parseInt(chave.slice(4, 6), 10);
      if (!(aa >= 0 && mm >= 1 && mm <= 12)) continue;
      const dias = Math.floor((AGORA - Date.UTC(2000 + aa, mm - 1, 1)) / 864e5);
      item.dias_desde = dias;
      item.prazo_base = 'chave_nfe';
      // as mesmas regras da classificacao original: quem voltou nao cancela,
      // e o Magalu so cancela em `nf_sem_saida`
      const podeAqui = !item.tem_devolucao_registrada
        && (item.marketplace !== 'magalu' || item.classe === 'nf_sem_saida')
        && dias <= 20;
      item.acao = podeAqui ? 'cancelar_nf' : 'nf_devolucao';
      item.prazo_cancelamento = podeAqui ? Math.max(0, 20 - dias) : 0;
    }

    itens.sort((a, b) => {
      if (a.acao !== b.acao) return a.acao === 'cancelar_nf' ? -1 : 1;
      if (a.acao === 'cancelar_nf') return a.prazo_cancelamento - b.prazo_cancelamento;
      return (b.valor || 0) - (a.valor || 0);
    });

    // 30/10: NF de venda CANCELADA/denegada = caso RESOLVIDO (por cancelamento) — sai da lista, como sai quem ganhou
    // NF de devolucao. Antes: 'casos resolvidos por cancelamento reaparecem aqui', com o botao de gerar devolucao
    // contra nota morta (a SEFAZ rejeita).
    let canceladasOcultas = 0;
    for (let i = itens.length - 1; i >= 0; i--) if (itens[i] && itens[i].nf_cancelada) { itens.splice(i, 1); canceladasOcultas++; }
    return res.json({
      ok: true,
      empresa: EMPRESA,
      total: itens.length,
      canceladas_ocultas: canceladasOcultas,
      valor_total: Number(itens.reduce((t, x) => t + (Number(x.valor) || 0), 0).toFixed(2)),
      podem_cancelar: itens.filter((x) => x.acao === 'cancelar_nf').length,
      magalu_erro: magaluErro || undefined,
      por_marketplace: itens.reduce((acc, x) => {
        const m = x.marketplace || 'outro';
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
      itens,
    });
  } catch (e) {
    // b205: se o erro for BUG nosso, a resposta diz isso — nao adianta o
    // dono esperar nem recarregar.
    erroCodigo.registrar(e, 'sem-retorno');
    return res.status(500).json({ ok: false, erro: erroCodigo.paraTela(e, 'sem-retorno') });
  }
});
// @fim-secao
};
module.exports.DEPS = DEPS;
