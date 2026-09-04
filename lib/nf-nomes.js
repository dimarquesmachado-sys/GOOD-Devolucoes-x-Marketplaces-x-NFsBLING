// ============================================================
// NF POR NOME (v3.71) - busca pelo REMETENTE da etiqueta Correios
// ------------------------------------------------------------
// Devolucoes Amazon (e outras) chegam por Correios so com o NOME do
// cliente como pista - e a etiqueta imprime COLADO ("RENATONEVES",
// "PEDRONOGUEIRAADDOR"). Nao da pra "separar" o nome; da pra fazer o
// contrario: COLAPSAR o nome do Bling tambem (sem espaco/acento) e
// comparar colapsado com colapsado. Match deterministico.
//
// Indice pre-aquecido (padrao da casa): varre as NFs de saida dos
// ultimos ~60 dias (listagem natural DESC, sem filtro de data - evita
// o quirk do Bling) e monta nomeColapsado -> [NFs]. A busca devolve
// CANDIDATOS; quem decide e o estoquista, conferindo com a caixa.
// ============================================================

module.exports = ({ chamarBling }) => {
  const IDX = { ts: 0, mapa: {}, mapaCurto: {}, totalNFs: 0, nomes: 0, nomesCurtos: 0, duracaoSeg: 0, erro: null };   // v3.72
  const DIAS = 120; // v3.71.1 - Correios e lento: devolucao pode levar meses

  const colapsar = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toUpperCase().replace(/[^A-Z]/g, '');            // so letras

  // v3.72 (porte da AMB) - "Marilia Goncalves De Sousa Veiga" -> "MARILIAVEIGA"
  // A etiqueta dos Correios imprime o nome COLADO e muitas vezes so
  // primeiro+ultimo; o match por substring continua nunca achava esses.
  const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
  function primeiroUltimo(nomeCompleto) {
    const partes = String(nomeCompleto || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().split(/\s+/)
      .map(p => p.replace(/[^A-Z]/g, ''))
      .filter(p => p.length > 0 && !PARTICULAS.has(p));
    if (partes.length < 2) return null;
    return partes[0] + partes[partes.length - 1];
  }

  async function construirIndice(opts = {}) {
    const t0 = Date.now();
    const maxPaginas = opts.maxPaginas || 80; // teto de seguranca (80x100 = 8000 NFs, cobre 120d)
    const corte = Date.now() - DIAS * 864e5;
    const mapa = {};
    const mapaCurto = {};   // v3.72 - primeiro+ultimo nome
    let totalNFs = 0, erroBusca = null, parouPorData = false;
    let maisAntiga = null, paginasLidas = 0;

    for (let pg = 1; pg <= maxPaginas; pg++) {
      // b228 - RITMO e RETENTATIVA. O dono mandou o estado do indice:
      //   "erro": "nfe pagina 20 HTTP 429", total_nfs: 1896
      // Sem pausa entre paginas, o Bling corta na 20a — 1.896 notas, uns 40
      // dias na GOOD. A janela e de 120, mas o indice nunca chegava la, e a
      // busca por nome so via agosto.
      if (pg > 1) await new Promise((ok) => setTimeout(ok, 400));
      let r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1`);
      if (!r.ok && r.status === 429) {
        // 429 e fila, nao recusa: espera e tenta ate 3x antes de desistir
        for (let tent = 1; tent <= 3 && !r.ok && r.status === 429; tent++) {
          await new Promise((ok) => setTimeout(ok, 2000 * tent));
          r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1`);
        }
      }
      if (!r.ok) { erroBusca = `nfe pagina ${pg} HTTP ${r.status}`; break; }
      const lista = r.data?.data || [];
      paginasLidas = pg;
      if (lista.length === 0) break;
      for (const nf of lista) {
        const quando = Date.parse(String(nf.dataEmissao || '').replace(' ', 'T'));
        if (quando && quando < corte) { parouPorData = true; break; }
        if (nf.dataEmissao && (!maisAntiga || String(nf.dataEmissao) < maisAntiga)) maisAntiga = String(nf.dataEmissao);
        const nomeOriginal = nf.contato?.nome || '';
        const chave = colapsar(nomeOriginal);
        if (!chave || chave.length < 5) continue;
        const registro = {
          id: String(nf.id),
          numero: String(nf.numero || ''),
          serie: String(nf.serie || ''),
          nome: nomeOriginal,
          dataEmissao: nf.dataEmissao || null,
          valor: nf.valorNota != null ? nf.valorNota : null,
        };
        (mapa[chave] = mapa[chave] || []).push(registro);
        // v3.72 - indice extra: primeiro+ultimo nome (particulas fora)
        const curto = primeiroUltimo(nomeOriginal);
        if (curto && curto.length >= 5 && curto !== chave) {
          (mapaCurto[curto] = mapaCurto[curto] || []).push(registro);
        }
        totalNFs++;
      }
      if (parouPorData || lista.length < 100) break;
      await new Promise(s => setTimeout(s, 320)); // respeita o rate do Bling
    }

    IDX.ts = Date.now();
    IDX.maisAntiga = maisAntiga;
    IDX.paginas = paginasLidas;
    IDX.parouPor = parouPorData ? 'data (cobriu a janela)'
      : (erroBusca ? 'erro: ' + erroBusca : 'fim das paginas ou dos dados');
    IDX.mapa = mapa;
    IDX.mapaCurto = mapaCurto;   // v3.72
    IDX.totalNFs = totalNFs;
    IDX.nomes = Object.keys(mapa).length;
    IDX.nomesCurtos = Object.keys(mapaCurto).length;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = erroBusca;
    console.log(`[NF-NOMES] indice: ${totalNFs} NFs de ${IDX.nomes} nomes (${DIAS}d) em ${IDX.duracaoSeg}s`);
    return IDX;
  }

  function statusIndice() {
    return {
      quente: IDX.ts > 0,
      idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
      total_nfs: IDX.totalNFs,
      nomes_distintos: IDX.nomes,
      nomes_curtos: IDX.nomesCurtos,   // v3.72 - primeiro+ultimo
      janela_dias: DIAS,
      duracao_construcao_seg: IDX.duracaoSeg || null,
      // b233 - a data da NF mais ANTIGA que entrou. [stated] "só tá puxando
      // agosto e setembro. cade os 4 meses q ia puxar?" — `janela_dias` diz
      // a INTENCAO (120); isto diz o que o indice REALMENTE cobre.
      nf_mais_antiga: IDX.maisAntiga || null,
      paginas_lidas: IDX.paginas || null,
      parou_por: IDX.parouPor || null,
      erro: IDX.erro,
    };
  }

  // Busca candidatos pelo nome (colapsado). Regras:
  //   1. match EXATO do nome inteiro (RENATONEVES == RenatoNeves)
  //   2. se nada, match por PREFIXO/CONTEM (nome parcial digitado)
  // Devolve no maximo 8 candidatos, mais recentes primeiro.
  async function buscarPorNome(texto) {
    const alvo = colapsar(texto);
    if (alvo.length < 5) return { alvo, candidatos: [] };
    // b228 - RECONSTRUIR EM BACKGROUND, servindo o indice velho enquanto isso.
    //
    // Com ritmo, o indice completo leva ~60s. Refazer na hora da busca (como
    // era) faria o estoquista esperar um minuto na primeira busca depois do
    // vencimento — com a etiqueta na mao. Agora: se existe indice, uso ele e
    // disparo a reconstrucao por tras; so espero quando NAO ha indice nenhum.
    const vencido = !IDX.ts || (Date.now() - IDX.ts) > 30 * 60000;
    if (vencido && !IDX.ts) {
      try { await construirIndice(); } catch (e) { /* segue com o que tiver */ }
    } else if (vencido && !IDX.reconstruindo) {
      IDX.reconstruindo = true;
      construirIndice()
        .catch((e) => console.error('[NF-NOMES] reconstrucao em background falhou:', e.message))
        .finally(() => { IDX.reconstruindo = false; });
    }
    let hits = IDX.mapa[alvo] ? [...IDX.mapa[alvo]] : [];
    // v3.72 - via 2: primeiro+ultimo nome ("MARILIAVEIGA" acha
    // "Marilia Goncalves De Sousa Veiga") - antes do aproximado
    if (hits.length === 0 && IDX.mapaCurto[alvo]) hits = [...IDX.mapaCurto[alvo]];
    if (hits.length === 0) {
      for (const [nome, nfs] of Object.entries(IDX.mapa)) {
        if (nome.startsWith(alvo) || nome.includes(alvo) || alvo.includes(nome)) hits.push(...nfs);
        if (hits.length >= 24) break;
      }
    }
    hits.sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
    return { alvo, candidatos: hits.slice(0, 8) };
  }

  function preAquecer() {
    construirIndice().catch(e => console.error('[NF-NOMES] pre-aquecimento falhou:', e.message));
  }

  return { construirIndice, statusIndice, buscarPorNome, preAquecer, colapsar };
};
