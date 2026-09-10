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

// b263 - pra parar a varredura quando o processo esta saindo.
// ⚠️ require direto (nao injecao) de proposito: a drenagem e estado do
// PROCESSO, nao da empresa — todas as instancias compartilham o mesmo
// sinal de encerramento, entao injetar por empresa seria enganoso.
const drenagem = require('./drenagem');

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

  // b237.1 (Codex): `fundo` so quando ha indice velho pra servir. Na
  // primeira construcao (`IDX.ts` vazio) a busca ESPERA por ela — e parte
  // do que o estoquista pediu, nao rotina de fundo. Marcar como fundo faria
  // ele ficar atras de qualquer outro trafego.
  async function construirIndice(opts = {}) {
    // b264 - ⚠️ O CANCELAMENTO E ENCERRAMENTO NORMAL, NAO FALHA.
    //
    // `drenagem.pausar()` LANCA quando o processo esta saindo. Trato aqui,
    // no lugar unico, em vez de espalhar checagem por 13 pontos — que foi o
    // que gerou 10 apontamentos do Codex no #203.
    //
    // ⚠️ E o `return` aqui e o que impede a publicacao do indice parcial:
    // saio ANTES do `IDX.ts = Date.now()`, entao o indice velho continua
    // valendo e o processo NOVO monta um completo. Era o P2 do Codex.
    try {
      return await construirIndiceInterno(opts);
    } catch (e) {
      if (drenagem.ehCancelamento(e)) {
        console.log(`[NF-NOMES] ${e.message} — indice NAO publicado, o processo novo monta`);
        return;
      }
      throw e;
    }
  }

  async function construirIndiceInterno(opts = {}) {
    const deFundo = opts.fundo !== undefined ? !!opts.fundo : !!IDX.ts;
    const t0 = Date.now();
    const maxPaginas = opts.maxPaginas || 80; // teto de seguranca (80x100 = 8000 NFs, cobre 120d)
    const corte = Date.now() - DIAS * 864e5;
    const mapa = {};
    const mapaCurto = {};   // v3.72 - primeiro+ultimo nome
    let totalNFs = 0, erroBusca = null, parouPorData = false;
    let maisAntiga = null, paginasLidas = 0;
    let cancelado = false;   // b263.1: drenagem no meio de reconstrucao de fundo

    for (let pg = 1; pg <= maxPaginas; pg++) {
      // b263 - ⚠️ PARA NO MEIO SE O PROCESSO ESTA SAINDO.
      //
      // A drenagem (b262) cancela os TIMERS, mas uma varredura que JA
      // comecou continua paginando o Bling ate o fim — no processo que
      // deveria estar quieto. Sao ate 40 paginas com 400ms entre elas: 16
      // segundos gastando cota da conta durante o deploy, enquanto o
      // processo NOVO faz o mesmo trabalho.
      //
      // ⚠️ Eu criei o `estaDrenando()` no b262 e NAO USEI EM LUGAR NENHUM.
      // A peca existia e nao estava ligada — o tipo de coisa que passa
      // porque o teste do modulo passa.
      // b263.1 (Codex, P2) - ⚠️ SO CANCELO RECONSTRUCAO DE FUNDO.
      //
      // Meu break era incondicional, e isso QUEBRAVA justamente o que a
      // drenagem existe pra proteger: se o SIGTERM chega enquanto o
      // estoquista espera uma busca fria, eu abortava a varredura DELE — e
      // a linha 120 logo abaixo publica o indice assim mesmo, carimbando
      // `ts` como se estivesse completo. A busca voltaria VAZIA.
      //
      // A drenagem deixa o processo vivo de proposito pra requisicao em voo
      // terminar. Cancelar a varredura que ELA pediu e o oposto disso.
      if (deFundo && drenagem.estaDrenando()) {
        console.log(`[NF-NOMES] drenando — paro o indice de fundo na pagina ${pg}`);
        cancelado = true;
        break;
      }

      // b228 - RITMO e RETENTATIVA. O dono mandou o estado do indice:
      //   "erro": "nfe pagina 20 HTTP 429", total_nfs: 1896
      // Sem pausa entre paginas, o Bling corta na 20a — 1.896 notas, uns 40
      // dias na GOOD. A janela e de 120, mas o indice nunca chegava la, e a
      // busca por nome so via agosto.
      // b264: a pausa do ritmo do Bling E o ponto de cancelamento — se o
      // processo esta saindo, ela lanca. Nao ha checagem manual pra eu
      // esquecer, e a proxima varredura herda o comportamento.
      // b301 (auditoria da b268.1) - o `chamarBling` abaixo tambem precisa
      // considerar `IDX.viroufundo`: sem isto, a varredura orfa (ninguem
      // espera mais) continuava se anunciando como INTERATIVA pro portao
      // de ritmo (`ritmoBling`/`chamarBling`), furando a fila de trafego
      // real — a mesma inconsistencia que a `drenagem.pausar()` ja tinha
      // corrigido duas linhas acima, so que no lado da PRIORIDADE em vez
      // do lado da CANCELABILIDADE.
      if (pg > 1) await drenagem.pausar(400, deFundo || IDX.viroufundo, 'indice-nomes');
      let r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1`, { fundo: deFundo || IDX.viroufundo });
      if (!r.ok && r.status === 429) {
        // 429 e fila, nao recusa: espera e tenta ate 3x antes de desistir
        for (let tent = 1; tent <= 3 && !r.ok && r.status === 429; tent++) {
          await drenagem.pausar(2000 * tent, deFundo || IDX.viroufundo, 'indice-nomes/retry');
          r = await chamarBling(`https://api.bling.com.br/Api/v3/nfe?limite=100&pagina=${pg}&tipo=1`, { fundo: deFundo || IDX.viroufundo });
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
      // b268 - ⚠️ PUBLICA O PARCIAL A CADA 10 PAGINAS.
      //
      // A publicacao era ATOMICA no fim — bom desenho (nunca ha estado
      // intermediario), mas significa que uma busca que espera 12s e
      // desiste recebe VAZIO. O teto sozinho nao resolveria nada.
      //
      // As paginas vem da mais RECENTE pra mais antiga, entao o parcial ja
      // cobre o que a devolucao de hoje precisa.
      //
      // ⚠️ `ts` fica em 0 de proposito: o indice esta USAVEL mas nao
      // COMPLETO, e a proxima busca deve continuar reconstruindo. Quem le
      // `IDX.ts` pra decidir "esta quente?" continua vendo frio — e isso
      // esta certo.
      // b268.1 (Codex, P1) - ⚠️ O PARCIAL SO VALE SE NAO HA INDICE COMPLETO.
      //
      // Minha 1a versao publicava sempre — e numa reconstrucao QUENTE isso
      // SUBSTITUIA os mapas completos de 120 dias pelas primeiras paginas,
      // mantendo o `ts` antigo. As buscas durante a varredura passariam a
      // NAO ACHAR notas antigas que hoje acham.
      //
      // Eu pioraria o caso que funciona pra consertar o que nao funciona.
      //
      // ⚠️ E o 1o checkpoint saiu da pagina 10 pra 3 (P2): com as duas
      // esperas que ja existem (400ms + 320ms), a pagina 10 so sai depois
      // de ~6,5s MAIS 10x a latencia do Bling — com latencia media acima de
      // ~550ms o parcial nem chegava dentro dos 12s. Na pagina 3 chega.
      const primeiraMontagem = !IDX.ts;
      if (primeiraMontagem && (pg === 3 || pg % 10 === 0)) {
        IDX.mapa = { ...mapa };
        IDX.mapaCurto = { ...mapaCurto };
        IDX.parcialAte = pg;
        IDX.totalNFs = totalNFs;
        console.log(`[NF-NOMES] parcial publicado: ${pg} paginas, ${totalNFs} NFs — ja da pra buscar`);
      }

      if (parouPorData || lista.length < 100) break;
      await new Promise(s => setTimeout(s, 320)); // respeita o rate do Bling
    }

    // b263.1 (Codex, P2) - ⚠️ NAO PUBLICA INDICE INCOMPLETO. Carimbar `ts`
    // aqui faria o indice parcial parecer fresco, e a proxima busca serviria
    // dele em vez de reconstruir. Melhor deixar o velho (ou o vazio) e
    // deixar o processo NOVO montar direito.
    if (cancelado) {
      console.log('[NF-NOMES] indice NAO publicado: a reconstrucao foi cancelada pela drenagem');
      return;
    }

    IDX.ts = Date.now();
    IDX.parcialAte = null;   // b268: agora esta COMPLETO
    IDX.viroufundo = false;
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
      // b268.1 (Codex, P1) - ⚠️ QUEM CHAMA PRECISA SABER QUE ESTA PARCIAL.
      //
      // Sem isto, "nao achei" (definitivo) e "ainda nao varri essa pagina"
      // (temporario) chegam iguais na tela — e o estoquista desiste de uma
      // devolucao que EXISTE, so nao foi indexada ainda.
      parcial_ate_pagina: IDX.parcialAte || null,
      completo: !!IDX.ts && !IDX.parcialAte,
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
    // b268.1: `indiceParcial` vai no retorno pra tela poder dizer "ainda
    // estou montando" em vez de "nao existe".
    const marcarParcial = (r) => ({ ...r, indiceParcial: IDX.parcialAte || null });
    // b228 - RECONSTRUIR EM BACKGROUND, servindo o indice velho enquanto isso.
    //
    // Com ritmo, o indice completo leva ~60s. Refazer na hora da busca (como
    // era) faria o estoquista esperar um minuto na primeira busca depois do
    // vencimento — com a etiqueta na mao. Agora: se existe indice, uso ele e
    // disparo a reconstrucao por tras; so espero quando NAO ha indice nenhum.
    const vencido = !IDX.ts || (Date.now() - IDX.ts) > 30 * 60000;
    if (vencido && !IDX.ts) {
      // b268 - ⚠️ A BUSCA FRIA NAO PODE PRENDER O ESTOQUISTA.
      //
      // MEDIDO: o teto e 80 paginas com 400ms entre elas = 32s so de
      // espera, MAIS o tempo de resposta do Bling por pagina (medido no
      // /health: 422ms tipico, 1481ms no pior). Da 66s no melhor caso e
      // 150s no pior — e isso SEM nenhum 429. Com retry (2+4+6s por
      // pagina) explode.
      //
      // O dono buscou "charles" e passou de 3 MINUTOS olhando a tela:
      // "não posso esperar infinito pra 1 simples busca".
      //
      // ⚠️ O TETO DE TEMPO E DO ESTOQUISTA, NAO DO INDICE. Espero no
      // maximo 12s pela construcao; passou disso, respondo com o que ha e
      // a construcao CONTINUA em segundo plano. A proxima busca, minutos
      // depois, ja acha.
      //
      // 12s porque e o limite do que alguem espera olhando pra tela sem
      // achar que travou — e porque, com ~450ms por pagina, cobre ~26
      // paginas: as notas mais RECENTES, que sao as que a devolucao de
      // hoje precisa.
      const TETO_ESPERA_MS = Number(process.env.NF_NOMES_TETO_BUSCA_MS || 12000);
      let respondeuNoPrazo = true;

      // b268.1 (Codex, P1) - ⚠️ REUSA A CONSTRUCAO JA EM ANDAMENTO.
      //
      // Depois do timeout, `IDX.ts` fica ZERO de proposito (o indice esta
      // parcial, nao completo) — mas isso fazia CADA busca seguinte entrar
      // aqui e comecar OUTRA varredura de 80 paginas.
      //
      // O estoquista que nao acha e busca de novo — que e o comportamento
      // natural — DOBRAVA o trafego do Bling, e cada varredura extra
      // aproxima o 429 que trava a operacao inteira.
      //
      // Guardo a promessa: quem chegar enquanto ela roda ESPERA a mesma, em
      // vez de abrir a sua.
      if (!IDX.emConstrucao) {
        IDX.emConstrucao = construirIndice()
          .catch(() => {})
          .finally(() => { IDX.emConstrucao = null; });
      }

      try {
        await Promise.race([
          IDX.emConstrucao,
          new Promise((ok) => setTimeout(() => { respondeuNoPrazo = false; ok(); }, TETO_ESPERA_MS)),
        ]);
      } catch (e) { /* segue com o que tiver */ }

      if (!respondeuNoPrazo) {
        // b268.1 (Codex, P2) - ⚠️ A PARTIR DAQUI E TRABALHO DE FUNDO.
        //
        // O build frio nasce com `deFundo = false` (nao havia indice pra
        // servir), e isso esta certo ENQUANTO o estoquista espera. Mas
        // depois do timeout ninguem esta mais esperando — e o
        // `drenagem.pausar(..., deFundo, ...)` continuava recebendo `false`,
        // entao um SIGTERM no meio NAO cancelava a varredura orfa.
        //
        // Ela seguiria paginando o Bling no processo que ja deveria estar
        // quieto — exatamente o que a drenagem veio impedir.
        IDX.viroufundo = true;
        console.log(`[NF-NOMES] indice ainda montando apos ${TETO_ESPERA_MS}ms — `
          + 'respondo com o parcial e sigo montando em segundo plano (agora cancelavel)');
      }
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
      // b235 - VARRER TUDO ANTES DE CORTAR. [stated] "vc não entendeu, não
      // tá pegando 120 dias" — ele insistiu, e estava certo.
      //
      // O indice cobre os 120 dias (6.811 NFs desde 07/05, confirmado no
      // JSON dele). Mas esta varredura parava nas PRIMEIRAS 24 e SO DEPOIS
      // ordenava por data. Como o mapa e montado do mais recente pro mais
      // antigo, essas 24 eram todas recentes — as de maio nunca chegavam a
      // ser consideradas. Medido: 400 NFs em 4 meses devolviam 8, todas do
      // mes mais novo.
      //
      // O mapa tem alguns milhares de nomes; percorrer inteiro custa
      // microssegundos e nao chama a API. O corte volta a ser onde deve
      // ser: DEPOIS de ordenar.
      for (const [nome, nfs] of Object.entries(IDX.mapa)) {
        if (nome.startsWith(alvo) || nome.includes(alvo) || alvo.includes(nome)) hits.push(...nfs);
      }
    }
    // sem duplicatas: o mesmo id pode vir pelo mapa exato e pelo aproximado
    const vistos = new Set();
    hits = hits.filter((h) => {
      const k = String(h.id);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    hits.sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));

    // b235 - O CORTE EM 8 ESCONDIA OS ANTIGOS. Mesmo varrendo os 120 dias,
    // se ha muitos "Rafael" os 8 mais recentes sao todos do mes atual — e a
    // caixa que o estoquista tem na mao pode ser de maio (Correios reverso
    // leva meses, que e a razao da janela de 120 dias existir).
    //
    // Entao: os 8 mais recentes SEMPRE, mais ate 6 dos mais antigos que
    // sobraram, distribuidos. Assim maio nunca fica invisivel.
    const MAIS_RECENTES = 8;
    const DOS_ANTIGOS = 6;
    const recentes = hits.slice(0, MAIS_RECENTES);
    const resto = hits.slice(MAIS_RECENTES);
    const antigos = [];
    if (resto.length) {
      // b235.1 (Codex): a MAIS ANTIGA entra sempre. Com 15 homonimos o
      // passo dava 1 e a ultima ficava de fora — inalcancavel, sem
      // paginacao na tela. Ela e a mais provavel de ser uma devolucao
      // velha do Correios, justamente o caso que motivou tudo isto.
      const indices = new Set([resto.length - 1]);
      const passo = Math.max(1, Math.floor(resto.length / DOS_ANTIGOS));
      for (let i = 0; i < resto.length && indices.size < DOS_ANTIGOS; i += passo) indices.add(i);
      for (const i of [...indices].sort((a, b) => a - b)) {
        antigos.push({ ...resto[i], _antigo: true });
      }
    }
    return marcarParcial({
      alvo,
      candidatos: [...recentes, ...antigos],
      total_encontrados: hits.length,
      mostrando: recentes.length + antigos.length,
    });
  }

  // b272 - ⚠️ ACEITA OPCOES, e a `tentativa` fica no 2o parametro.
  //
  // O boot faz DOIS passes: um curto (3 paginas, ~15 dias) aos 45s pra
  // deixar a busca util rapido, e o completo depois. Sem `opcoes` aqui, o
  // server chamaria `preAquecer({maxPaginas:3})` e o objeto viraria
  // `tentativa` — o retry contaria errado e o teto seria ignorado.
  function preAquecer(opcoes = {}, tentativa = 1) {
    // b237.4 (Codex): o pre-aquecimento do BOOT e rotina de fundo — ninguem
    // esta esperando por ele. Sem `fundo: true` explicito, o `deFundo`
    // deduzia pelo `IDX.ts` (vazio no boot) e classificava as 80 paginas
    // como interativas, comendo a prioridade de quem esta bipando.
    //
    // ⚠️ (Codex, PR #213) mesmo problema do lib/ml-returns.js: HTTP ruim
    // vira `IDX.erro` e a promise RESOLVE — o `.catch()` sozinho nunca via
    // o 429. O `.then()` abaixo confere o indice publicado antes de
    // considerar a tentativa um sucesso.
    //
    // ⚠️ RESOLUCAO DO CONFLITO (b273): o `.then()` e do Claude do GitHub
    // (achou o erro que nao rejeitava); o `...opcoes` e meu (o passe curto
    // de 3 paginas). As DUAS coisas sao necessarias — sem o `.then()` o
    // retry nunca dispara; sem as opcoes o passe curto varre 80 paginas.
    construirIndice({ fundo: true, ...opcoes }).then((idx) => {
      if (!idx) return; // cancelado pela drenagem - nem sucesso nem falha
      if (idx.erro) throw new Error(idx.erro);
    }).catch((e) => {
      // b271 - ⚠️ FALHOU, TENTA DE NOVO. Sem isto, um 429 no boot deixa o
      // indice de nomes vazio por 25 min — e a proxima busca do estoquista
      // paga a construcao inteira na frente dele (2-3 min de tela parada,
      // que e o que a gente acabou de consertar).
      console.error(`[NF-NOMES] pre-aquecimento falhou (tentativa ${tentativa}/3):`, e.message);
      if (tentativa >= 3) return;
      const espera = 30000 * Math.pow(2, tentativa - 1);
      console.log(`[NF-NOMES] tento de novo em ${espera / 1000}s`);
      // ⚠️ (Codex) setTimeout cru nao e cancelado pela drenagem — registro
      // com daquiA pra nao acordar o processo VELHO durante um deploy.
      // ⚠️ b273: e passo `opcoes` adiante (era meu), senao o retry do passe
      // curto viraria varredura completa.
      drenagem.daquiA(() => preAquecer(opcoes, tentativa + 1), espera);
    });
  }

  return { construirIndice, statusIndice, buscarPorNome, preAquecer, colapsar };
};
