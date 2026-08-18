// ============================================================
// MAGALU - OAuth 2.0 (ID Magalu) + chamador da API
// ------------------------------------------------------------
// A Magalu trata DEVOLUCAO como um TICKET de pos-venda (modulo SAC):
//   - o ticket e o protocolo aberto pelo cliente
//   - a "remessa reversa" (return) e o pacote voltando
// Endpoints que interessam (base: https://api.magalu.com):
//   GET /seller/v0/tickets                    -> lista tickets
//   GET /seller/v0/tickets/{id}/returns       -> remessas reversas do ticket
//   GET /seller/v0/tickets/{id}/returns/{rid} -> uma remessa reversa
//
// OAuth (doc oficial):
//   consentimento: https://id.magalu.com/login?client_id=..&redirect_uri=..
//                  &scope=..&response_type=code&choose_tenants=true
//   troca do code: POST https://id.magalu.com/oauth/token  (JSON)
//   refresh:       POST https://id.magalu.com/oauth/token  (form-urlencoded)
//   access_token dura 7200s (2h) -> renovamos sozinhos.
//
// Tokens sao persistidos nas env vars do Render (mesmo padrao do ML).
// ============================================================
const axios = require('axios');

// b271 - renovacao preventiva pela lib unica (empresa como parametro).
// Perder o token do Magalu e o mais caro: reautorizar exige refazer o
// consentimento inteiro no navegador certo.
const { registrarPreventiva } = require('./token-preventiva');

module.exports = ({ atualizarTokensNoRender }) => {
  let ULTIMA_PERSISTENCIA = false;
  let PREVENTIVA = null;
  const ID_BASE = 'https://id.magalu.com';
  const API_BASE = process.env.MAGALU_API_BASE || 'https://api.magalu.com';

  const CLIENT_ID = process.env.MAGALU_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.MAGALU_CLIENT_SECRET || '';
  const REDIRECT_URI = process.env.MAGALU_REDIRECT_URI || '';

  // Escopos necessarios pra ler devolucoes (tickets + remessa reversa).
  // Precisam estar no client (criado via IDM CLI) E consentidos pelo seller.
  const SCOPES = (process.env.MAGALU_SCOPES || [
    'open:tickets-seller:read',
    'open:ticket-returns-seller:read',
    'open:ticket-events-seller:read',
    'open:ticket-messages-seller:read',
    'open:order-order-seller:read',
    'open:order-invoice-seller:read',
    'open:order-delivery-seller:read', // v3.58 - dados de ENTREGA (rastreio)
    'open:order-logistics-seller:read',      // v3.61 - LOGISTICS do pedido
    'open:logistic-seller-shippings:read',   // v3.61 - Shipping Open Api: remessas p/ SELLERS
    'open:logistic-seller-trackings:read',   // v3.61 - tracking p/ sellers
  ].join(' '));

  let ACCESS_TOKEN = process.env.MAGALU_ACCESS_TOKEN || '';
  let REFRESH_TOKEN = process.env.MAGALU_REFRESH_TOKEN || '';

  const cfg = {
    get ativo() { return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI); },
    get autorizado() { return !!REFRESH_TOKEN; },
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    apiBase: API_BASE,
  };

  // URL que o SELLER abre pra consentir (etapa unica, feita pelo Diego)
  function urlConsentimento(state = 'good') {
    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      response_type: 'code',
      choose_tenants: 'true',
      state,
    });
    return `${ID_BASE}/login?${p.toString()}`;
  }

  // Troca o "code" (que chega no callback) por access+refresh token
  async function trocarCodePorTokens(code) {
    const r = await axios.post(`${ID_BASE}/oauth/token`, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: 'authorization_code',
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

    ACCESS_TOKEN = r.data?.access_token || '';
    REFRESH_TOKEN = r.data?.refresh_token || '';
    if (!ACCESS_TOKEN || !REFRESH_TOKEN) throw new Error('resposta sem tokens');

    const gravarAuth = [
      { key: 'MAGALU_ACCESS_TOKEN', value: ACCESS_TOKEN },
      { key: 'MAGALU_REFRESH_TOKEN', value: REFRESH_TOKEN },
    ];
      // b273 (review do Codex) - carimba tambem ao autorizar: sem isto, o
      // batimento seguinte consumiria o refresh recem-emitido
      const carimboAuth = PREVENTIVA && PREVENTIVA.parEnvCarimbo();
      if (carimboAuth) gravarAuth.push(carimboAuth);
      await atualizarTokensNoRender(gravarAuth);
      if (PREVENTIVA) PREVENTIVA.marcarRenovado();
    console.log(`[MAGALU] tokens obtidos e salvos (escopos: ${r.data?.scope || '-'})`);
    return { ok: true, scope: r.data?.scope || null, expires_in: r.data?.expires_in || null };
  }

  // Renova o access_token (dura 2h) usando o refresh_token
  let renovarToken = async function renovarTokenInterno() {
    if (!REFRESH_TOKEN) return false;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
      }).toString();
      const r = await axios.post(`${ID_BASE}/oauth/token`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000,
      });
      ACCESS_TOKEN = r.data?.access_token || ACCESS_TOKEN;
      if (r.data?.refresh_token) REFRESH_TOKEN = r.data.refresh_token;
      // b271 - carimbo no MESMO write; e a renovacao so conta quando GRAVA
      const gravar = [
        { key: 'MAGALU_ACCESS_TOKEN', value: ACCESS_TOKEN },
        { key: 'MAGALU_REFRESH_TOKEN', value: REFRESH_TOKEN },
      ];
      const carimbo = PREVENTIVA && PREVENTIVA.parEnvCarimbo();
      if (carimbo) gravar.push(carimbo);
      const persistiu = await atualizarTokensNoRender(gravar);
      if (!persistiu) console.error('[MAGALU] renovou mas NAO persistiu no Render — o refresh gravado esta consumido');
      if (persistiu && PREVENTIVA) PREVENTIVA.marcarRenovado();
      ULTIMA_PERSISTENCIA = !!persistiu;
      console.log('[MAGALU] access_token renovado');
      return true;
    } catch (e) {
      console.error('[MAGALU] ERRO ao renovar:', e.response?.data || e.message);
      return false;
    }
  };

  // Chamador da API com auto-renovacao em 401 (1 tentativa)
  async function chamarMagalu(caminho, opts = {}) {
    if (!ACCESS_TOKEN && !(await renovarToken())) {
      return { ok: false, status: 401, data: { erro: 'sem token Magalu - autorize primeiro' } };
    }
    const url = caminho.startsWith('http') ? caminho : `${API_BASE}${caminho}`;
    const fazer = () => axios({
      method: opts.method || 'GET',
      url,
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json', ...(opts.headers || {}) },
      data: opts.body || undefined,
      timeout: opts.timeout || 25000,
      validateStatus: () => true,
    });
    let r = await fazer();
    if (r.status === 401) {
      if (await renovarToken()) r = await fazer();
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data };
  }

  // ---- Devolucoes (tickets + remessa reversa) ----
  async function listarTickets(params = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
    const qs = p.toString();
    return chamarMagalu(`/seller/v0/tickets${qs ? '?' + qs : ''}`);
  }

  async function remessasReversasDoTicket(ticketId) {
    return chamarMagalu(`/seller/v0/tickets/${encodeURIComponent(ticketId)}/returns`);
  }

  // ============================================================
  // INDICE DE DEVOLUCOES (v3.56) - "o sistema ja aguardando o pacote"
  // ------------------------------------------------------------
  // A etiqueta da Magalu imprime o PROTOCOLO em texto grande, e ele e
  // exatamente o ticket.protocol da API (confirmado com dado real).
  // Entao indexamos os tickets por tres chaves, todas presentes no fluxo:
  //   protocolo    2026062600477033  (impresso na etiqueta)
  //   reverse_code 4638365891        (a remessa reversa do ticket)
  //   pedido       1546570114717824  (order.code - vira numeroLoja no Bling)
  // Com qualquer uma delas o estoquista identifica a venda na hora.
  //
  // Custo: 1 chamada por pagina de 100 tickets + 1 por ticket ABERTO (pra
  // pegar o reverse_code). Tickets fechados nao tem pacote voltando.
  // ============================================================
  const IDX = { ts: 0, mapa: {}, total: 0, comReversa: 0, duracaoSeg: 0, erro: null };

  const soDigitos = (s) => String(s || '').replace(/\D/g, '');

  // v3.63 - INDICE EM 2 FASES (bipe rapido mesmo com indice frio):
  //   fase 1 (rapida, ~1-2s): lista tickets -> indexa PROTOCOLO e PEDIDO.
  //     O QR/protocolo ja resolve aqui - e marcamos o indice como quente.
  //   fase 2 (background): reverse_code de cada ticket aberto (1 chamada
  //     cada). Completa o mapa sem segurar o estoquista esperando.
  let _fase2Rodando = false;
  async function _fase2ReverseCodes(abertos) {
    if (_fase2Rodando) return;
    _fase2Rodando = true;
    try {
      let comReversa = 0;
      for (let i = 0; i < abertos.length; i += 4) {
        const lote = abertos.slice(i, i + 4);
        await Promise.all(lote.map(async (dev) => {
          try {
            const rr = await remessasReversasDoTicket(dev.ticket_id);
            const res = (rr.ok && rr.data?.results) ? rr.data.results : [];
            const rc = res.find(x => x.reverse_code)?.reverse_code || null;
            if (rc) {
              dev.reverse_code = String(rc);
              IDX.mapa['R:' + dev.reverse_code] = dev;
              comReversa++;
            }
          } catch (e) { /* esse ticket fica sem reverse_code */ }
        }));
        await new Promise(s => setTimeout(s, 220));
      }
      IDX.comReversa = comReversa;
      console.log(`[MAGALU] fase 2: ${comReversa} reverse_codes indexados`);
    } finally { _fase2Rodando = false; }
  }

  async function construirIndiceDevolucoes(opts = {}) {
    const t0 = Date.now();
    const maxPaginas = opts.maxPaginas || 4;   // ate 400 tickets
    const mapa = {};
    let total = 0, comReversa = 0;
    const abertos = [];

    // 1) pagina a lista de tickets
    for (let pg = 0; pg < maxPaginas; pg++) {
      const r = await listarTickets({ _limit: 100, _offset: pg * 100 });
      if (!r.ok) { IDX.erro = `listarTickets HTTP ${r.status}`; break; }
      const lista = r.data?.results || [];
      if (lista.length === 0) break;
      for (const t of lista) {
        total++;
        const itens = (t.order?.delivery?.items || []).map(it => ({
          sku: it.external_sku || it.sku || null,
          titulo: it.description || it.name || null,
          quantidade: it.quantity || 1,
        }));
        const dev = {
          fonte: 'magalu',
          ticket_id: t.id,
          protocolo: String(t.protocol || ''),
          pedido: String(t.order?.code || ''),
          pedido_id: t.order?.id || null,
          tipo: t.type || null,
          motivo: t.reason || null,
          status: t.status || null,
          fechado: !!t.closed,
          criado_em: t.created_at || null,
          reverse_code: null, // preenchido no passo 2
          itens,
        };
        if (dev.protocolo) mapa['P:' + dev.protocolo] = dev;
        if (dev.pedido) mapa['O:' + dev.pedido] = dev;
        // v3.65 - a fase 2 varre TODOS os tickets, fechados incluidos.
        // CONSTATADO na AMB (06/08, raio-X do JSON cru): o Magalu FECHA o
        // ticket com o pacote ainda na rua, e o /tickets/{id}/returns
        // RESPONDE remessa de ticket fechado. O filtro de abertos pulava
        // exatamente os tickets que importam e nenhum reverse_code era
        // indexado. Custo: ~1 chamada por ticket, em lotes de 4.
        abertos.push(dev);
      }
      if (lista.length < 100) break;
      await new Promise(s => setTimeout(s, 250));
    }

    // FASE 1 pronta: protocolo e pedido ja resolvem. Publica o indice JA.
    IDX.ts = Date.now();
    IDX.mapa = mapa;
    IDX.total = total;
    IDX.comReversa = comReversa;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = null;
    console.log(`[MAGALU] fase 1: ${total} tickets (protocolo+pedido) em ${IDX.duracaoSeg}s - ${abertos.length} p/ fase 2 (todos, fechados incluidos - v3.65)`);
    if (opts.reverseEmBackground) {
      setImmediate(() => _fase2ReverseCodes(abertos)); // nao segura o bipe
    } else {
      await _fase2ReverseCodes(abertos); // pre-aquecimento: completa tudo
    }
    return IDX;
  }

  function statusIndice() {
    return {
      quente: IDX.ts > 0,
      idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
      total_tickets: IDX.total,
      com_remessa_reversa: IDX.comReversa,
      chaves_indexadas: Object.keys(IDX.mapa).length,
      duracao_construcao_seg: IDX.duracaoSeg || null,
      erro: IDX.erro,
    };
  }

  // Acha a devolucao por QUALQUER um dos codigos do fluxo Magalu.
  // Reconstroi o indice na hora se estiver frio (rede de seguranca).
  async function acharDevolucao(codigo) {
    const bruto = String(codigo || '').trim();
    const dig = soDigitos(bruto);
    if (!dig) return null;
    if (!IDX.ts || (Date.now() - IDX.ts) > 30 * 60000) {
      // on-demand: so a fase 1 (1-2s); reverse_codes completam em background
      try { await construirIndiceDevolucoes({ reverseEmBackground: true }); } catch (e) { /* segue com o que tiver */ }
    }
    // protocolo (16 digitos, comeca com o ano) | reverse_code | pedido
    return IDX.mapa['P:' + dig] || IDX.mapa['R:' + dig] || IDX.mapa['O:' + dig] || null;
  }

  // Pre-aquecimento: o indice fica pronto ANTES de o estoquista bipar.
  function preAquecer() {
    if (!cfg.ativo || !cfg.autorizado) return;
    construirIndiceDevolucoes().catch(e => console.error('[MAGALU] pre-aquecimento falhou:', e.message));
  }

  PREVENTIVA = registrarPreventiva({
    empresa: 'good', integracao: 'magalu',
    temRefresh: () => !!REFRESH_TOKEN,
    renovar: () => renovarToken(),
    persistiu: () => ULTIMA_PERSISTENCIA,
    carimboEnv: 'MAGALU_RENOVADO_EM',
    diasEnv: 'MAGALU_RENOVAR_DIAS',
  });
  // b272 (review do Codex) - o 401 passa pelo MESMO lock da preventiva
  renovarToken = PREVENTIVA.guardarRenovacao(renovarToken);

  return {
    preventivaMagalu: PREVENTIVA,   // b271
    cfg,
    urlConsentimento,
    trocarCodePorTokens,
    renovarToken,
    chamarMagalu,
    listarTickets,
    remessasReversasDoTicket,
    construirIndiceDevolucoes,
    statusIndice,
    acharDevolucao,
    preAquecer,
  };
};
