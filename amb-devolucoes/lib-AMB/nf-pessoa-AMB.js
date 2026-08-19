// ============================================================
// lib/nf-pessoa.js (v3.43)
// ------------------------------------------------------------
// Helpers de NF (mapItensNF, resolverIdNFPorChave via bissecao),
// pessoa (formatarCpfCnpj, detectarTipoPessoa) e municipio
// (IBGE por nome+UF, fallback por CEP). Extraidos do server.js
// LITERAL para enxugar. Deps injetadas na criacao:
//
//   const nfp = require('./lib/nf-pessoa')({ chamarBling, sleep });
//   const id = await nfp.resolverIdNFPorChave(numero, chave);
// (fetch e global no runtime, nao precisa injetar)
// ============================================================

module.exports = function criarNfPessoa({ chamarBling, sleep }) {

  function mapItensNF(nf) {
    return (nf && Array.isArray(nf.itens)) ? nf.itens.map(it => ({
      titulo: it.descricao || null,
      sku: it.codigo || null,
      quantidade: it.quantidade || null,
      valor: it.valor || null,
      // b238 - o ID do produto no Bling, vinculo gravado na emissao da nota.
      // O SKU da venda pode ter sido RENOMEADO no cadastro (caso real:
      // FL-1011-PRETO virou 3933398010054), e ai nenhuma busca por codigo
      // acha o produto; o id nao muda. Ver README, "Regras do catalogo".
      produto_id: (it.produto && (it.produto.id || it.produto.produtoId)) || it.produtoId || null,
    })) : null;
  }

  // v3.31.1 - acha o ID Bling de uma NF de VENDA usando a chave de acesso.
  // Estrategia: numeros de NF sao SEQUENCIAIS no tempo -> busca binaria
  // pelo DIA dentro do mes da chave (AAMM, pos. 3-6): sonda um dia,
  // compara os numeros, divide o mes ao meio (~5-7 requisicoes, qualquer
  // volume). Plano B: varre o mes inteiro (ate 30 paginas).
  /**
   * v3.51 - Acha a(s) NF(s) no Bling pelo NUMERO (sem a chave).
   *
   * IMPORTANTE - MULTI-SERIE: a GOOD emite em varias series (1=normal,
   * 2=ML FULL, e outras pra Magalu/Amazon FULL). O MESMO numero pode
   * existir em series diferentes! Entao NUNCA escolhemos sozinhos:
   * devolvemos TODAS as NFs que batem, e quem decide e o estoquista.
   *
   * A numeracao e sequencial DENTRO de cada serie (serie 1 na casa dos 75k,
   * serie 2 nos milhares...). Misturar series quebraria a monotonicidade que
   * a bissecao precisa - por isso a busca e POR SERIE, com o probe de dia
   * COMPARTILHADO (uma consulta do dia ja devolve min/max de todas as series).
   *
   * Retorna: [{ id, serie, numero }] - 0, 1 ou N NFs.
   */
  async function buscarNFsPorNumero(numero, serieExplicita = null, opts = {}) {
    const TR = opts.trace || null; // v3.53 - raio-x pro debug (nao muda a logica)
    const log = (passo, dado) => { if (TR) TR.push({ passo, ...dado }); };
    const alvoStr = String(numero || '').replace(/\D/g, '').replace(/^0+/, '');
    const alvoInt = parseInt(alvoStr, 10);
    if (!alvoStr || isNaN(alvoInt)) return [];
    const serieFixa = (serieExplicita != null && String(serieExplicita).trim() !== '')
      ? String(parseInt(serieExplicita, 10)) : null;

    const DIA_MS = 864e5;
    const f = (t) => new Date(t).toISOString().slice(0, 10);
    const numOf = (nf) => parseInt(String(nf.numero || '').replace(/^0+/, ''), 10);
    const serOf = (nf) => (nf.serie == null ? '1' : String(parseInt(nf.serie, 10)));

    // v3.55 - DESCOBERTA (confirmada com dado real): o filtro de data do Bling
    // anexa a HORA ATUAL a data. Ou seja, dataEmissaoInicial=2026-06-20 vira
    // "20/06 as <hora de agora>". Consequencias:
    //   - inicial == final  => intervalo vazio => SEMPRE 0 NFs (era o bug)
    //   - o dia fica cortado ao meio (perde as NFs emitidas antes dessa hora)
    // Solucao: pedir uma janela COM MARGEM (dia-1 .. dia+1), que cobre o dia
    // inteiro qualquer que seja a hora, e filtrar as NFs do dia de verdade
    // pelo campo dataEmissao. A lista vem em ordem DECRESCENTE de data.
    async function pagDia(dia, pg) {
      const t = Date.parse(dia + 'T12:00:00Z');
      const ini = new Date(t - 864e5).toISOString().slice(0, 10);
      const fim = new Date(t + 864e5).toISOString().slice(0, 10);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) return null;
      const lista = r.data?.data || [];
      // guarda se a pagina veio cheia (pra saber se precisa paginar mais)
      lista._cheia = lista.length === 100;
      return lista;
    }
    // NFs de UM dia especifico (pagina a janela ate cobrir o dia inteiro)
    async function nfsDoDia(dia) {
      const out = [];
      // b261 (apontamento do Codex, guardado desde o PR #17) - o teto de 4
      // paginas parava mesmo com a 4a CHEIA: em dia movimentado a NF
      // procurada podia estar na 5a e o dia era dado como coberto. Agora
      // pagina enquanto vier cheia, com teto de 12 (1.200 notas num dia ja
      // e muito acima do normal deles) — e quando para CHEIA, marca
      // `_truncado` pra ninguem afirmar que o dia foi todo olhado.
      const TETO_PAGINAS = 12;
      for (let pg = 1; pg <= TETO_PAGINAS; pg++) {
        const lista = await pagDia(dia, pg);
        if (lista === null) return null;
        if (lista.length === 0) break;
        for (const nf of lista) {
          if (String(nf.dataEmissao || '').slice(0, 10) === dia) out.push(nf);
        }
        if (!lista._cheia) break;
        if (pg === TETO_PAGINAS) {
          out._truncado = true;
          log('pagina-dia', { dia, ERRO: 'teto de ' + TETO_PAGINAS + ' paginas com a ultima CHEIA — dia nao coberto por inteiro' });
          break;
        }
        await sleep(300);
      }
      return out;
    }

    // Probe de um dia: min/max POR SERIE (uma chamada serve todas as series)
    const diasIncompletos = [];   // b261 - dias que ficaram sem cobertura total
    const cache = {};
    async function sondaDia(t) {
      const dia = f(t);
      if (cache[dia]) return cache[dia];
      await sleep(350);
      const lista = await nfsDoDia(dia);
      if (lista === null) { log('sonda-dia', { dia, ERRO: 'chamada ao Bling falhou' }); return (cache[dia] = { erro: true, porSerie: {} }); }
      // b261 - dia truncado nao pode virar "olhei tudo e nao tem"
      if (lista._truncado) diasIncompletos.push(dia);
      const porSerie = {};
      for (const nf of lista) {
        const s = serOf(nf);
        const n = numOf(nf);
        if (isNaN(n)) continue;
        if (!porSerie[s]) porSerie[s] = { min: n, max: n };
        else {
          if (n < porSerie[s].min) porSerie[s].min = n;
          if (n > porSerie[s].max) porSerie[s].max = n;
        }
      }
      const vazio = Object.keys(porSerie).length === 0;
      log('sonda-dia', { dia, qtd: lista.length, series: Object.keys(porSerie).join(',') || '-', porSerie });
      return (cache[dia] = { vazio, porSerie, cheia: lista.length === 100 });
    }

    // ---- 1) FILTRO DIRETO (barato: 1 chamada se o Bling honrar) ----
    // O ?numero= E aplicado pelo Bling (retorna 0, nao 100), mas o numero la
    // vem ZERO-PADDED ("075053"). Entao tentamos as duas formas: crua e com
    // zeros a esquerda (5..9 digitos). Se casar, acabou em 1 chamada.
    // b237 (raio-x com dado real da NF 2447): o Bling guarda o numero
    // ZERO-PADDED em 6 digitos e o filtro dele e exato — ?numero=2447
    // devolveu 0 e ?numero=002447 devolveu as 2 notas. Tentar a forma crua
    // primeiro gastava uma chamada a toa em todo bipe.
    const variantesNum = [...new Set([
      String(alvoInt).padStart(6, '0'),
      String(alvoInt),
      String(alvoInt).padStart(7, '0'),
      String(alvoInt).padStart(9, '0'),
    ])];
    for (const vn of variantesNum) {
      try {
        await sleep(250);
        const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&numero=${encodeURIComponent(vn)}`;
        const r = await chamarBling(url);
        const lista = (r.ok && r.data?.data) ? r.data.data : [];
        const hits = lista.filter(nf => numOf(nf) === alvoInt && (!serieFixa || serOf(nf) === serieFixa));
        log('filtro-numero', { formato: vn, ok: r.ok, status: r.status || null, qtd: lista.length, hits: hits.length });
        if (hits.length > 0) {
          console.log(`[buscarNFsPorNumero] ${alvoStr}: ${hits.length} NF(s) via filtro ?numero=${vn}`);
          return hits.map(nf => ({ id: String(nf.id), serie: serOf(nf), numero: String(nf.numero) }));
        }
      } catch (e) { log('filtro-numero', { formato: vn, ERRO: e.message || String(e) }); }
    }

    // ---- 2) ANCORA: dias recentes revelam as SERIES e seus maximos atuais ----
    // (probes compartilhados: 1 consulta de dia alimenta todas as series)
    const MESES = opts.mesesAtras || 18;
    const HOJE = Math.floor(Date.now() / DIA_MS) * DIA_MS;
    const LIM_ANTIGO = HOJE - MESES * 30 * DIA_MS;
    const topo = {};   // serie -> { t, max }
    for (const back of [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60]) {
      const t = HOJE - back * DIA_MS;
      if (t < LIM_ANTIGO) break;
      const s = await sondaDia(t);
      if (s.erro || s.vazio) continue;
      for (const [serie, mm] of Object.entries(s.porSerie)) {
        if (!topo[serie]) topo[serie] = { t, max: mm.max };
      }
      // series raras (FULL) aparecem pouco: so para de sondar quando ja viu
      // pelo menos uma serie E ja olhou uma janela decente
      // b239 (review do Codex) - com SERIE PEDIDA (ex: 2447/2), parar porque
      // "alguma serie apareceu" e cedo demais: se a serie 2 nao emitiu nada
      // nos dias sondados, ela fica sem ancora, e pulada logo abaixo — 404
      // falso numa nota que existe. Com serieFixa, so para quando ELA aparece.
      if (serieFixa) { if (topo[serieFixa]) break; }
      else if (Object.keys(topo).length > 0 && back >= 30) break;
    }
    log('ancora', { series_achadas: Object.keys(topo).join(',') || 'NENHUMA', topo: Object.fromEntries(Object.entries(topo).map(([k, v]) => [k, { dia: f(v.t), max: v.max }])) });
    const seriesAlvo = serieFixa ? [serieFixa] : Object.keys(topo);
    if (seriesAlvo.length === 0) { log('fim', { motivo: 'ancora nao achou serie nenhuma' }); return []; }

    // ---- 3) BISSECAO POR SERIE (so nas series onde o numero e plausivel) ----
    const achadas = [];
    for (const serie of seriesAlvo) {
      const anc = topo[serie];
      if (!anc) continue;
      if (alvoInt > anc.max) {
        log('pula-serie', { serie, motivo: `alvo ${alvoInt} > teto ${anc.max}` });
        console.log(`[buscarNFsPorNumero] ${alvoStr}: serie ${serie} vai so ate ${anc.max} - pulando`);
        continue; // numero maior que o teto dessa serie: nao existe nela
      }
      const temSerie = (s) => s && !s.erro && s.porSerie[serie];
      // sonda perto: pula domingo/feriado e dias sem essa serie
      async function sondaPerto(t, raio, limLo, limHi) {
        let s = await sondaDia(t);
        if (temSerie(s)) return { mm: s.porSerie[serie], t };
        for (let off = 1; off <= raio; off++) {
          for (const tt of [t - off * DIA_MS, t + off * DIA_MS]) {
            if (tt < limLo || tt > limHi) continue;
            const b = await sondaDia(tt);
            if (temSerie(b)) return { mm: b.porSerie[serie], t: tt };
          }
        }
        return { mm: null, t };
      }

      let tHi = anc.t;
      let tLo = null;
      for (const passoDias of [7, 14, 28, 56, 112, 224, 448]) {
        const alvoT = anc.t - passoDias * DIA_MS;
        if (alvoT < LIM_ANTIGO) { tLo = LIM_ANTIGO; break; }
        const s = await sondaPerto(alvoT, 5, LIM_ANTIGO, tHi);
        if (!s.mm) { tLo = alvoT; break; }             // vazio: piso de data
        if (s.mm.min <= alvoInt) { tLo = s.t; break; } // piso com numero
        tHi = s.t;
      }
      if (tLo == null) tLo = LIM_ANTIGO;
      log('cerco', { serie, de: f(tLo), ate: f(tHi) });

      let diaAlvo = null;
      const sLo = cache[f(tLo)];
      if (sLo && sLo.porSerie[serie] && alvoInt >= sLo.porSerie[serie].min && alvoInt <= sLo.porSerie[serie].max) diaAlvo = tLo;
      let lo = tLo, hi = tHi;
      for (let passo = 0; diaAlvo == null && passo < 14 && lo <= hi; passo++) {
        const midT = Math.floor(((lo + hi) / 2) / DIA_MS) * DIA_MS;
        const s = await sondaPerto(midT, 5, lo, hi);
        if (!s.mm) break;
        if (alvoInt >= s.mm.min && alvoInt <= s.mm.max) { diaAlvo = s.t; break; }
        if (alvoInt < s.mm.min) { hi = s.t - DIA_MS; } else { lo = s.t + DIA_MS; }
      }

      log('bissecao', { serie, dia_alvo: diaAlvo != null ? f(diaAlvo) : 'NAO CONVERGIU' });
      if (diaAlvo != null) {
        let achou = null;
        for (const dd of [0, 1, -1, 2, -2]) {
          if (achou) break;
          const dia = f(diaAlvo + dd * DIA_MS);
          await sleep(300);
          const lista = await nfsDoDia(dia);
          if (!lista || lista.length === 0) continue;
          const m = lista.find(nf => numOf(nf) === alvoInt && serOf(nf) === serie);
          if (m) achou = { id: String(m.id), serie, numero: String(m.numero) };
        }
        if (achou) {
          console.log(`[buscarNFsPorNumero] ${alvoStr}: achou na serie ${serie} (id ${achou.id})`);
          achadas.push(achou);
        }
      }
    }
    if (achadas.length === 0 && diasIncompletos.length) {
      // b261 - "nao achei" so vale se a varredura cobriu o terreno. Com dia
      // truncado (teto de paginas atingido com a ultima cheia), a resposta
      // honesta e "nao consegui olhar tudo" — mesma distincao que ja custou
      // caro nesta busca.
      log('fim', { motivo: 'dias sem cobertura total', dias: diasIncompletos.slice(0, 5) });
      console.log(`[buscarNFsPorNumero] ${alvoStr}: varredura INCOMPLETA em ${diasIncompletos.length} dia(s) - nao da pra afirmar que a NF nao existe`);
    }
    if (achadas.length === 0) console.log(`[buscarNFsPorNumero] ${alvoStr}: nao achou em nenhuma serie`);
    return achadas;
  }

  async function resolverIdNFPorChave(numero, chaveBruta) {
    const chave = String(chaveBruta || '').replace(/\D/g, '');
    const alvoStr = String(numero || '').replace(/^0+/, '');
    const alvoInt = parseInt(alvoStr, 10);
    if (chave.length !== 44 || !alvoStr || isNaN(alvoInt)) return null;
    const ano = 2000 + parseInt(chave.substr(2, 2), 10);
    const mes = parseInt(chave.substr(4, 2), 10);
    const serieChave = String(parseInt(chave.substr(22, 3), 10));
    if (!(mes >= 1 && mes <= 12)) return null;

    const DIA_MS = 864e5;
    const f = (t) => new Date(t).toISOString().slice(0, 10);
    const t0 = Date.UTC(ano, mes - 1, 1);
    const t1 = Date.UTC(ano, mes, 0) + 5 * DIA_MS; // +5d de folga

    const bateSerie = (nf) => nf.serie == null || String(parseInt(nf.serie, 10)) === serieChave;
    const bateNumero = (nf) => String(nf.numero || '').replace(/^0+/, '') === alvoStr && bateSerie(nf);

    // v3.55 - MESMO BUG da busca por numero: o filtro de data do Bling anexa a
    // hora atual, entao inicial==final devolve VAZIO. Todas as sondas de dia
    // desta bissecao voltavam vazias e quem achava a NF era o "plano B"
    // (varredura de paginas) - por isso a chave levava ~20s. Com a janela
    // com margem, a bissecao passa a funcionar de verdade e fica rapida.
    async function pagDia(dia, pg) {
      const t = Date.parse(dia + 'T12:00:00Z');
      const di = new Date(t - 864e5).toISOString().slice(0, 10);
      const df = new Date(t + 864e5).toISOString().slice(0, 10);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${di}&dataEmissaoFinal=${df}`;
      const r = await chamarBling(url);
      if (!r.ok) return null;
      // so as NFs do dia pedido (a janela traz vizinhos por causa da margem)
      return (r.data?.data || []).filter(nf => String(nf.dataEmissao || '').slice(0, 10) === dia);
    }

    // Sonda: menor/maior numero da serie-alvo na pagina 1 do dia
    const cache = {};
    async function sondaDia(t) {
      const dia = f(t);
      if (cache[dia]) return cache[dia];
      await sleep(350);
      const lista = await pagDia(dia, 1);
      if (lista === null) return (cache[dia] = { erro: true });
      const nums = lista.filter(bateSerie)
        .map(nf => parseInt(String(nf.numero || '').replace(/^0+/, ''), 10))
        .filter(n => !isNaN(n));
      if (nums.length === 0) return (cache[dia] = { vazio: true });
      return (cache[dia] = { min: Math.min(...nums), max: Math.max(...nums), cheia: lista.length === 100 });
    }

    // ---- BUSCA BINARIA pelo dia ----
    let lo = t0, hi = t1, diaAlvo = null;
    for (let passo = 0; passo < 12 && lo <= hi; passo++) {
      let midT = Math.floor(((lo + hi) / 2) / DIA_MS) * DIA_MS;
      let a = await sondaDia(midT);
      // Dia sem NF (fim de semana etc): tenta vizinhos +-1..3 dentro do range
      for (let off = 1; a && a.vazio && off <= 3; off++) {
        const candidatos = [midT + off * DIA_MS, midT - off * DIA_MS].filter(t => t >= lo && t <= hi);
        for (const t of candidatos) {
          const b = await sondaDia(t);
          if (b && !b.vazio && !b.erro) { a = b; midT = t; break; }
        }
        if (a && !a.vazio) break;
      }
      if (!a || a.erro) break;
      if (a.vazio) { hi = midT - DIA_MS; continue; } // regiao morta: encolhe
      if (alvoInt >= a.min && alvoInt <= a.max) { diaAlvo = midT; break; }
      if (alvoInt < a.min) { hi = midT - DIA_MS; } else { lo = midT + DIA_MS; }
    }

    // Dia achado: pagina o dia (e vizinhos, por seguranca de borda)
    if (diaAlvo != null) {
      for (const dd of [0, 1, -1]) {
        const dia = f(diaAlvo + dd * DIA_MS);
        // b239 - pagina enquanto vier CHEIA: parar sempre na 4a pagina fazia
        // um dia com mais de 400 notas esconder a procurada (a lista vem em
        // ordem decrescente) e a rota reportava "nao existe".
        for (let pg = 1; pg <= 25; pg++) {
          await sleep(350);
          const lista = await pagDia(dia, pg);
          if (lista === null || lista.length === 0) break;
          const m = lista.find(bateNumero);
          if (m) { console.log(`[resolverIdNFPorChave] ${alvoStr}: achou por bissecao (${dia})`); return String(m.id); }
          if (lista.length < 100) break;
        }
        if (dd === 0 && !cache[f(diaAlvo)]?.cheia) break; // dia nao lotado: vizinhos desnecessarios
      }
    }

    // ---- PLANO B: varre o mes inteiro (ate 30 paginas) ----
    const ini = f(t0 - 2 * DIA_MS), fim = f(t1);
    console.log(`[resolverIdNFPorChave] ${alvoStr}: bissecao nao cravou, varrendo ${ini}..${fim}`);
    for (let pg = 1; pg <= 30; pg++) {
      await sleep(350);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`;
      const r = await chamarBling(url);
      if (!r.ok) break;
      const lista = r.data?.data || [];
      if (lista.length === 0) break;
      const m = lista.find(bateNumero);
      if (m) { console.log(`[resolverIdNFPorChave] ${alvoStr}: achou no plano B (pg${pg})`); return String(m.id); }
      if (lista.length < 100) break;
    }
    return null;
  }

  function formatarCpfCnpj(numero) {
    const digitos = String(numero || '').replace(/\D/g, '');
    if (digitos.length === 11) {
      // CPF: 055.640.477-70
      return digitos.slice(0, 3) + '.' + digitos.slice(3, 6) + '.' + digitos.slice(6, 9) + '-' + digitos.slice(9);
    }
    if (digitos.length === 14) {
      // CNPJ: 33.602.095/0001-72
      return digitos.slice(0, 2) + '.' + digitos.slice(2, 5) + '.' + digitos.slice(5, 8) + '/' + digitos.slice(8, 12) + '-' + digitos.slice(12);
    }
    return numero || '';
  }

  // Detecta tipo de pessoa (F ou J) pelo numero de digitos do documento
  function detectarTipoPessoa(numero) {
    const digitos = String(numero || '').replace(/\D/g, '');
    if (digitos.length === 14) return 'J';
    if (digitos.length === 11) return 'F';
    return null; // indeterminado
  }

  // Cache em memoria pra busca IBGE (evita repetir chamadas)
  const ibgeCache = new Map();

  // Busca codigo IBGE de um municipio pelo nome + UF
  // Usa API publica do IBGE (gratuita, sem auth)
  async function buscarIdMunicipioIBGE(nomeMunicipio, uf) {
    if (!nomeMunicipio || !uf) return null;
    const cacheKey = (uf + '|' + nomeMunicipio).toLowerCase();
    if (ibgeCache.has(cacheKey)) return ibgeCache.get(cacheKey);

    try {
      const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;
      const r = await fetch(url);
      if (!r.ok) {
        console.warn('[IBGE] HTTP', r.status, 'pra UF', uf);
        return null;
      }
      const lista = await r.json();
      if (!Array.isArray(lista)) return null;

      // Normaliza nome (sem acento, lowercase) pra comparar
      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const alvo = norm(nomeMunicipio);

      const match = lista.find(m => norm(m.nome) === alvo);
      if (match && match.id) {
        const id = String(match.id);
        ibgeCache.set(cacheKey, id);
        return id;
      }
      console.warn('[IBGE] Municipio nao achado:', nomeMunicipio, uf);
      return null;
    } catch (e) {
      console.warn('[IBGE] Erro:', e.message);
      return null;
    }
  }

  // Fallback: busca codigo IBGE via CEP (BrasilAPI)
  async function buscarIdMunicipioPorCep(cep) {
    if (!cep) return null;
    const cepLimpo = String(cep).replace(/\D/g, '');
    if (cepLimpo.length !== 8) return null;
    if (ibgeCache.has('cep|' + cepLimpo)) return ibgeCache.get('cep|' + cepLimpo);

    try {
      const url = `https://brasilapi.com.br/api/cep/v2/${cepLimpo}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const data = await r.json();
      const id = data?.city_ibge ? String(data.city_ibge) : null;
      if (id) ibgeCache.set('cep|' + cepLimpo, id);
      return id;
    } catch (e) {
      console.warn('[BrasilAPI CEP] Erro:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // b255 - A NF DE DEVOLUCAO DO FULL, ACHADA NO BLING
  //
  // A API do ML nao entrega essa nota (6 caminhos sondados: 404/405/400, e o
  // ?document_type=return e ignorado). Mas ela ENTRA no Bling, e o raio-x da
  // b254 mostrou a assinatura dela, na venda 2000017624047456:
  //   tipo 0 (ENTRADA) · numero 005364 · serie 2
  //   naturezaOperacao.id 15110882041  -> "devolucao de venda PF" da AMB
  //   contato.nome "Marcelo Rossani Zorzi" · itens[].codigo = SKU da venda
  // O vinculo com a NF de venda NAO vem pela API (`campos_de_referencia` e
  // `observacoes` vieram nulos) — existe so na tela. Entao casamos pelo que
  // ha: natureza de devolucao + CLIENTE + SKU + janela a partir da venda.
  // b306 - dois nomes sao "a mesma pessoa" quando o PRIMEIRO nome e o ULTIMO
  // sobrenome coincidem (sem acento, sem caixa). Nome do meio, abreviacao e
  // acentuacao divergem entre o marketplace e o cadastro fiscal.
  function nomesBatem(a, b) {
    const partes = (x) => String(x || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z\s]/g, ' ')
      .split(/\s+/).filter(p => p.length > 1);   // fora "DE", "DA", iniciais
    const pa = partes(a), pb = partes(b);
    if (!pa.length || !pb.length) return false;
    if (pa.join(' ') === pb.join(' ')) return true;
    return pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1];
  }

  // Devolve `certeza: 'alta'` quando cliente E sku batem; 'media' com um so.
  // ═══════════════════════════════════════════════════════════════════
  async function acharNfDevolucaoBling({ cliente, sku, desde, ate, naturezaId } = {}) {
    const nome = String(cliente || '').trim().toUpperCase();
    const cod = String(sku || '').trim().toUpperCase();
    if (!nome && !cod) return { ok: false, motivo: 'sem cliente nem sku pra procurar' };

    const natureza = String(naturezaId || process.env.AMB_NATUREZA_DEVOLUCAO || '15110882041');
    const ini = (desde || '').slice(0, 10);
    const fim = (ate || new Date().toISOString()).slice(0, 10);
    if (!ini) return { ok: false, motivo: 'sem data da venda pra abrir a janela' };

    const achadas = [];
    let falhou = false;
    for (let pg = 1; pg <= 4; pg++) {
      // tipo=0 -> ENTRADA. A janela comeca na emissao da venda: a devolucao
      // e sempre posterior.
      const r = await chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=0`
        + `&dataEmissaoInicial=${ini}&dataEmissaoFinal=${fim}`);
      if (!r.ok) { falhou = true; break; }
      const lista = (r.data && r.data.data) || [];
      for (const nf of lista) {
        const natOk = !natureza || String(nf.naturezaOperacao?.id || nf.naturezaOperacao || '') === natureza;
        if (!natOk) continue;
        const nomeNf = String(nf.contato?.nome || '').trim().toUpperCase();
        // b306 (review do Codex) - comparar por PARTES do nome. O nome do
        // comprador no marketplace e o do contato fiscal divergem por nome do
        // meio, abreviacao ou acento — "MONICA RODRIGUES" nao esta contido em
        // "MONICA MARIA RODRIGUES" nem o contrario, e a inclusao literal
        // rejeitava nota legitima. Regra: primeiro nome igual E ultimo
        // sobrenome igual, ambos sem acento. Continua exigente o bastante pra
        // nao casar clientes diferentes (o que causou o erro do print).
        const bateCliente = nomesBatem(nome, nomeNf);
        // b305 (review do Codex) - NAO descartar aqui. Este `continue` rodava
        // ANTES da checagem de SKU que a b304 criou, entao o caso "mesmo SKU,
        // outro cliente" nunca chegava a ser detectado e a funcao saia sem
        // motivo nem candidatos. Guardamos todas as notas da natureza e a
        // decisao (que exige cliente E sku) acontece depois, num lugar so.
        achadas.push({
          id: nf.id, numero: nf.numero, serie: nf.serie,
          dataEmissao: nf.dataEmissao, chaveAcesso: nf.chaveAcesso || null,
          cliente: nf.contato?.nome || null, valorNota: nf.valorNota || null,
          bate_cliente: bateCliente,
        });
      }
      if (lista.length < 100) break;
      await sleep(300);
    }
    if (!achadas.length) {
      // b255 - falha do Bling nao vira "nao existe": a diferenca ja custou
      // caro na busca por numero de NF.
      return falhou
        ? { ok: false, motivo: 'o Bling recusou a consulta — nao da pra afirmar que nao existe' }
        : { ok: true, achou: false };
    }
    // b306 (review do Codex) - ORDENAR ANTES DE CORTAR. Como a b305 parou de
    // descartar quem tem cliente diferente, uma janela com 5 notas de outros
    // clientes antes da certa consumiria as 5 consultas de detalhe e a nota
    // CORRETA nunca seria inspecionada. Quem bate o cliente vai na frente.
    achadas.sort((x, y) => (y.bate_cliente ? 1 : 0) - (x.bate_cliente ? 1 : 0));

    // com SKU em maos, confirma pelo item (uma consulta por candidata, teto 5)
    const quaseCerto = [];   // b304 - sku bate mas cliente nao: nao serve pra afirmar
    if (cod) {
      for (const cand of achadas.slice(0, 5)) {
        const rD = await chamarBling(`/nfe/${cand.id}`);
        const det = (rD.ok && rD.data && rD.data.data) || null;
        const temSku = Array.isArray(det?.itens)
          && det.itens.some(it => String(it.codigo || '').trim().toUpperCase() === cod);
        // b304 - so afirma com os DOIS batendo (cliente E sku). SKU igual com
        // cliente diferente e outra venda do mesmo produto — comum aqui, onde
        // o mesmo item vende muitas vezes.
        if (temSku && cand.bate_cliente) {
          return { ok: true, achou: true, nf: cand, certeza: 'alta', via: 'natureza+cliente+sku' };
        }
        if (temSku) quaseCerto.push(cand);
        await sleep(300);
      }
    }
    if (quaseCerto.length) {
      // b304 - havia nota com o MESMO SKU, mas de outro cliente: e outra venda
      return {
        ok: true, achou: false,
        motivo: 'achei nota(s) de entrada com este SKU, mas de OUTRO cliente — e outra venda, nao esta devolucao',
        candidatos: quaseCerto.slice(0, 5).map(n => ({
          id: n.id, numero: n.numero, serie: n.serie,
          data: n.dataEmissao || null,   // b305
          cliente: n.cliente,
        })),
      };
    }
    // b304 (achado dele, 19/08) - AQUI ESTAVA O ERRO. Quando o SKU nao batia
    // em NENHUMA candidata, eu devolvia `achadas[0]` — a PRIMEIRA nota de
    // entrada qualquer da janela — e chamava de "certeza media". Foi assim
    // que a devolucao da Barbara (NF 001500, serie 1, lampada E14) exibiu a
    // NF 006962 da INEZ, serie 2, de outro produto: nada batia, so a
    // natureza. E o painel escondia o botao de gerar por causa disso.
    //
    // Regra da casa (ja valia no de-para de SKU, no deposito e na natureza
    // fiscal): AMBIGUIDADE NAO ESCOLHE. Sem cliente E sku confirmados, nao
    // afirmo que achei — devolvo os candidatos pra quem decide olhar.
    return {
      ok: true,
      achou: false,
      motivo: cod
        ? 'achei nota(s) de entrada na janela, mas NENHUMA tem o SKU desta devolucao — nao da pra dizer que e a mesma volta'
        : 'achei nota(s) de entrada na janela, mas sem o SKU nao da pra confirmar qual e',
      candidatos: achadas.slice(0, 5).map(n => ({
        id: n.id, numero: n.numero, serie: n.serie,
        data: n.dataEmissao || null,   // b305 - o campo guardado e dataEmissao
        cliente: n.cliente, bate_cliente: !!n.bate_cliente,
      })),
    };
  }

  return {
    acharNfDevolucaoBling,   // b255

    mapItensNF,
    resolverIdNFPorChave,
    buscarNFsPorNumero,
    formatarCpfCnpj,
    detectarTipoPessoa,
    buscarIdMunicipioIBGE,
    buscarIdMunicipioPorCep,
  };
};
