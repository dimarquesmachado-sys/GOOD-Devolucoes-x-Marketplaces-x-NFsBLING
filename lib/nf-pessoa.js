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
    })) : null;
  }

  // v3.31.1 - acha o ID Bling de uma NF de VENDA usando a chave de acesso.
  // Estrategia: numeros de NF sao SEQUENCIAIS no tempo -> busca binaria
  // pelo DIA dentro do mes da chave (AAMM, pos. 3-6): sonda um dia,
  // compara os numeros, divide o mes ao meio (~5-7 requisicoes, qualquer
  // volume). Plano B: varre o mes inteiro (ate 30 paginas).
  /**
   * v3.50 - Acha o ID da NF no Bling pelo NUMERO (sem a chave).
   * A chave carrega ano/mes/serie embutidos; o numero sozinho nao. Entao:
   *  1) Tenta o filtro direto /nfe?numero= (1 chamada - o /nfe honra alguns
   *     filtros, como numeroLoja; se honrar numero tambem, acabou aqui).
   *  2) Bissecao por DATA num range largo: NFs sao emitidas em ordem
   *     crescente ao longo do tempo, entao sondamos o min/max de numeros de
   *     cada dia ate cercar o alvo. Mesma mecanica ja provada da bissecao
   *     por chave - so que sem saber o mes de antemao.
   * serieAlvo: default '1' (padrao da casa). null = aceita qualquer serie.
   */
  async function resolverIdNFPorNumero(numero, serieAlvo = '1', opts = {}) {
    const alvoStr = String(numero || '').replace(/\D/g, '').replace(/^0+/, '');
    const alvoInt = parseInt(alvoStr, 10);
    if (!alvoStr || isNaN(alvoInt)) return null;
    const serie = (serieAlvo != null && String(serieAlvo).trim() !== '')
      ? String(parseInt(serieAlvo, 10)) : null;

    const DIA_MS = 864e5;
    const f = (t) => new Date(t).toISOString().slice(0, 10);
    const bateSerie = (nf) => !serie || nf.serie == null || String(parseInt(nf.serie, 10)) === serie;
    const bateNumero = (nf) => String(nf.numero || '').replace(/^0+/, '') === alvoStr && bateSerie(nf);

    // ---- 1) FILTRO DIRETO (barato: 1 chamada) ----
    try {
      await sleep(200);
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=1&tipo=1&numero=${encodeURIComponent(alvoInt)}`;
      const r = await chamarBling(url);
      const lista = (r.ok && r.data?.data) ? r.data.data : [];
      const m = lista.find(bateNumero);
      if (m) {
        console.log(`[resolverIdNFPorNumero] ${alvoStr}: achou via filtro ?numero= (1 chamada)`);
        return String(m.id);
      }
    } catch (e) { /* filtro ignorado pelo Bling: segue pra bissecao */ }

    // ---- 2) BISSECAO POR DATA (com ANCORAGEM) ----
    // Range largo tem trechos vazios (antes de existir NF, feriados...), e
    // "dia vazio -> encolhe" faria a busca colapsar pro lado errado. Entao:
    //   a) acha o dia MAIS RECENTE com NF -> ancora superior (t_hi, max)
    //   b) recua em passos EXPONENCIAIS ate um dia cujo min <= alvo -> t_lo
    //   c) bisseciona entre t_lo e t_hi (ja garantidamente cercando o alvo)
    async function pagDia(dia, pg) {
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${dia}&dataEmissaoFinal=${dia}`;
      const r = await chamarBling(url);
      return r.ok ? (r.data?.data || []) : null;
    }
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
    // sonda t e, se vazio, tenta vizinhos ate +-raio (pula domingo/feriado)
    async function sondaPerto(t, raio = 4, limLo = -Infinity, limHi = Infinity) {
      let a = await sondaDia(t);
      if (a && !a.vazio && !a.erro) return { a, t };
      for (let off = 1; off <= raio; off++) {
        for (const tt of [t - off * DIA_MS, t + off * DIA_MS]) {
          if (tt < limLo || tt > limHi) continue;
          const b = await sondaDia(tt);
          if (b && !b.vazio && !b.erro) return { a: b, t: tt };
        }
      }
      return { a: null, t };
    }

    const MESES = opts.mesesAtras || 18;
    const HOJE = Math.floor(Date.now() / DIA_MS) * DIA_MS;
    const LIM_ANTIGO = HOJE - MESES * 30 * DIA_MS;

    // (a) ancora superior: dia mais recente com NF (olha ate 12 dias atras)
    const topo = await sondaPerto(HOJE, 12, LIM_ANTIGO, HOJE);
    if (!topo.a) return null; // sem dados: nada a fazer
    if (alvoInt > topo.a.max) {
      console.log(`[resolverIdNFPorNumero] ${alvoStr}: maior que a NF mais recente (${topo.a.max}) - nao existe`);
      return null;
    }
    let tHi = topo.t;

    // (b) recuo exponencial ate cercar o alvo por baixo. Um passo que cai em
    // regiao VAZIA (antes de existir NF) tambem serve de limite inferior de
    // DATA - o alvo esta entre ele e o tHi atual, entao para por ali.
    let tLo = null;
    for (const passoDias of [7, 14, 28, 56, 112, 224, 448]) {
      const alvoT = topo.t - passoDias * DIA_MS;
      if (alvoT < LIM_ANTIGO) { tLo = LIM_ANTIGO; break; }
      const s = await sondaPerto(alvoT, 4, LIM_ANTIGO, tHi);
      if (!s.a) { tLo = alvoT; break; }           // vazio: serve de piso de data
      if (s.a.min <= alvoInt) { tLo = s.t; break; } // achou piso com numero
      tHi = s.t;                                   // ainda acima do alvo: novo teto
    }
    if (tLo == null) tLo = LIM_ANTIGO;

    // (c) bissecao entre tLo e tHi (o alvo esta garantidamente dentro)
    let diaAlvo = null;
    const sLo = cache[f(tLo)];
    if (sLo && alvoInt >= sLo.min && alvoInt <= sLo.max) diaAlvo = tLo;
    let lo = tLo, hi = tHi;
    for (let passo = 0; diaAlvo == null && passo < 14 && lo <= hi; passo++) {
      const midT = Math.floor(((lo + hi) / 2) / DIA_MS) * DIA_MS;
      const s = await sondaPerto(midT, 4, lo, hi);
      if (!s.a) break; // trecho totalmente vazio: desiste da bissecao
      const { a, t } = s;
      if (alvoInt >= a.min && alvoInt <= a.max) { diaAlvo = t; break; }
      if (alvoInt < a.min) { hi = t - DIA_MS; } else { lo = t + DIA_MS; }
    }

    if (diaAlvo != null) {
      for (const dd of [0, 1, -1, 2, -2]) {
        const dia = f(diaAlvo + dd * DIA_MS);
        for (let pg = 1; pg <= 4; pg++) {
          await sleep(350);
          const lista = await pagDia(dia, pg);
          if (lista === null || lista.length === 0) break;
          const m = lista.find(bateNumero);
          if (m) {
            console.log(`[resolverIdNFPorNumero] ${alvoStr}: achou por bissecao (${dia})`);
            return String(m.id);
          }
          if (lista.length < 100) break;
        }
      }
    }
    console.log(`[resolverIdNFPorNumero] ${alvoStr}: NAO achou (serie ${serie || 'qualquer'}, ${MESES} meses)`);
    return null;
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

    async function pagDia(dia, pg) {
      const url = `https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1&dataEmissaoInicial=${dia}&dataEmissaoFinal=${dia}`;
      const r = await chamarBling(url);
      return r.ok ? (r.data?.data || []) : null;
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
        for (let pg = 1; pg <= 4; pg++) {
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

  return {
    mapItensNF,
    resolverIdNFPorChave,
    resolverIdNFPorNumero,
    formatarCpfCnpj,
    detectarTipoPessoa,
    buscarIdMunicipioIBGE,
    buscarIdMunicipioPorCep,
  };
};
