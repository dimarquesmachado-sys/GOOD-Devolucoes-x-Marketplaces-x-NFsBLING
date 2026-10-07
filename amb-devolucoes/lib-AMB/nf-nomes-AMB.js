// ============================================================
// amb-devolucoes/lib-AMB/nf-nomes-AMB.js       (AMB Devol. b47)
// ------------------------------------------------------------
// O PEGA-TUDO: acha a venda pelo NOME DO REMETENTE da etiqueta.
//
// POR QUE ISTO E ESSENCIAL NA AMBTOTAL: ela vende no TikTok Shop,
// que nao tem integracao aqui — e a Amazon comeca em breve. Uma
// caixa desses canais chega no galpao com etiqueta dos Correios e
// NENHUM identificador que o sistema conheca. O unico dado util e
// o nome do cliente impresso no bloco REMETENTE.
//
// O TRUQUE: a etiqueta imprime o nome COLADO ("IANDRAMATIASRIBEIRO").
// Nao da pra separar de volta. Da pra fazer o contrario: COLAPSAR
// tambem o nome que vem do Bling e comparar colapsado com colapsado.
// Match deterministico, sem adivinhacao.
//
// A busca devolve CANDIDATOS. Quem decide e sempre o estoquista,
// conferindo com a caixa na mao — o sistema nunca escolhe sozinho.
//
// b5 — PAGINACAO DE VERDADE. Antes a busca cortava em 8 e NAO
// avisava que havia mais: se a NF certa fosse a 9a, ela era
// invisivel. Acontece de verdade em dois casos — cliente que
// comprou 12 vezes em 120 dias, e colisao de nome curto (com
// 3.575 nomes curtos, existe mais de um "JOSESILVA"). Agora a
// busca conta o TOTAL real, devolve a pagina pedida e diz se
// tem mais.
//
// ============================================================
// MELHORIA SOBRE A GOOD (pendencia conhecida de la):
// na GOOD, o match exige substring CONTINUA. Entao "MARILIAVEIGA"
// (como sai na etiqueta) NAO acha "Marilia Goncalves De Sousa
// Veiga" — porque no nome completo tem "GONCALVESDESOUSA" no meio.
// Aqui o indice guarda TAMBEM a combinacao primeiro+ultimo nome,
// que e exatamente como a maioria das etiquetas abrevia.
// ============================================================

'use strict';

// b248 - FASE 3, passo 3 (ultimo antes do app): RECEBE a ficha.
//
// ⚠️ O ESTADO AQUI E DE CONTROLE, nao de credencial: `construindo`,
// `ENTREGA_RODANDO`, `NFV_RODANDO`, `ULTIMA_BUSCA`. Sao travas de "ja esta
// rodando" e caches de indice. Compartilhadas entre empresas, uma
// BLOQUEARIA a construcao do indice da outra — a segunda veria
// `construindo=true` e desistiria, ficando com indice vazio pra sempre.
//
// A fabrica move essas travas pra dentro de cada instancia.
// ⚠️ b377 - o `config-AMB` fixo SAIU. Ficou so o require, sem uso, depois
// que a instancia padrao foi removida — e require de arquivo da AMB num
// modulo multiempresa e pegadinha esperando alguem usar.
// b263 - pra parar a varredura quando o processo esta saindo
const drenagem = require('../../lib/drenagem');

// ⚠️ b372 - O BLING VEM DA EMPRESA, nao a instancia padrao.
//
// Era `require('./bling-AMB')` — a instancia criada com o `config-AMB` fixo.
// A Girassol consultaria o Bling DA AMBTOTAL aqui: veria as notas dela e
// emitiria na conta errada.
//

// ⚠️ b377 - SEM O CLIENTE DA EMPRESA, DERRUBA.
//
// Meu script removeu esta funcao junto com a instancia padrao e deixou o
// USO — `blingDa is not defined` no boot. `node --check` passou: a funcao
// nao existir e erro de runtime, nao de sintaxe.
//
// 📌 Fallback pro cliente da AMB nao entra: e vazamento com cara de
// compatibilidade, e ja tirei 4 iguais hoje.
function blingDa(cfg) {
  const c = cfg && cfg.clienteBling;
  if (!c) {
    throw new Error('[nf-nomes-AMB] `clienteBling` nao veio na config da '
      + 'empresa — sem ele eu usaria o Bling da AMBTotal.');
  }
  return c;
}

function criarNfNomes(cfg) {
  // ⚠️ b396 - A ETIQUETA DO LOG DIZ QUAL EMPRESA.
  //
  // Era `[AMB/...]` fixo. O Render junta o log das duas no MESMO
  // lugar: com a Girassol montada, um erro dela apareceria como
  // `[AMB/...]` e mandaria caçar no app errado.
  const TAG_EMP = String((cfg && cfg.PREFIXO_ENV) || 'AMB_')
    .replace(/_$/, '');
  // ⚠️ b372: prefere o cliente Bling DESTA empresa
  const bling = blingDa(cfg);   // b377

const IDX = {
  ts: 0,
  mapa: {},        // nome completo colapsado -> [NFs]
  mapaCurto: {},   // primeiro+ultimo nome colapsado -> [NFs]
  totalNFs: 0, nomes: 0, duracaoSeg: 0, erro: null,
};

let construindo = false;
let geracaoConstrucao = 0;   // b556: quem abandona uma construcao travada invalida o `finally` dela
// ⚠️ b415 (Codex, P1) - "VAI TENTAR DE NOVO" e diferente de "parou".
//
// Quando a construcao falha (429, por exemplo), `construindo` vira false
// e SO DEPOIS o `catch` agenda a proxima tentativa. Nessa fresta a fila
// de pre-aquecimento achava que esta rotina tinha terminado e soltava a
// seguinte — e 30s depois as duas rodavam juntas.
//
// 📌 Justo no cenario que a fila existe pra evitar: o 429.
let reagendado = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// b44 - SERIE REAL da NF: sai da chave de acesso NF-e (44 digitos),
// posicoes 22-25. É o dado CONSTATADO, emitido na nota. O campo
// nf.serie da listagem /nfe vem vazio/undefined, entao usamos a chave.
// Mapa de series da AMB (so referencia): 1=matriz, 2=ML Full,
// 3=Magalu Full venda, 4=Magalu Full devolucao, 5=Shopee Full.
function serieDaChave(chave, fallback) {
  const ch = String(chave || '').replace(/\D/g, '');
  if (ch.length === 44) {
    const s = ch.slice(22, 25).replace(/^0+/, '');
    if (s) return s;
  }
  return fallback || null;
}

/** Tira acento, pontuacao e espaco. Sobram so letras maiusculas. */
const colapsar = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '');

/**
 * "Marilia Goncalves De Sousa Veiga" -> "MARILIAVEIGA"
 * Ignora as particulas (de, da, dos...) na hora de achar o sobrenome.
 */
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
  // b264 - ⚠️ mesmo tratamento da GOOD: o cancelamento e encerramento
  // normal, e o `return` impede a publicacao do indice parcial.
  try {
    return await construirIndiceInterno(opts);
  } catch (e) {
    if (drenagem.ehCancelamento(e)) {
      console.log(`[NF-NOMES-AMB] ${e.message} — indice NAO publicado`);
      return;
    }
    throw e;
  }
}

// b579 - a regra de cadastrar UMA nota no indice (a montagem completa e a renovacao incremental usam esta mesma).
// Devolve false quando o nome e curto demais pra indexar.
function indexarNF(nf, m) {
  const { mapa, mapaCurto, porPedido, porNumero, porId } = m;
  const nomeOriginal = (nf.contato && nf.contato.nome) || '';
  const chave = colapsar(nomeOriginal);
  if (!chave || chave.length < 5) return false;

    const registro = {
      id: String(nf.id),
      numero: String(nf.numero || '').replace(/^0+/, ''),   // b41 - sem zeros a esquerda
      serie: serieDaChave(nf.chaveAcesso, String(nf.serie || '').trim() || null),   // b44 - serie REAL da chave de acesso
      nome: nomeOriginal,
      dataEmissao: nf.dataEmissao || null,
      valor: nf.valorNota != null ? nf.valorNota : null,
    };

    // b17 - indice POR PEDIDO: e daqui que o painel puxa o
    // cliente e a NF da venda pra cada devolucao a espreita.
    const nlj = String(nf.numeroLoja || nf.numeroPedidoLoja || '').trim();
    if (nlj) porPedido[nlj] = registro;
    const numN = String(nf.numero || '').replace(/^0+/, '');
    // ⚠️ b473 - MESMO NUMERO EM SERIES DIFERENTES (a serie 2 do Full) e
    // AMBIGUIDADE: o atalho "busca por numero usa o id do indice" so pode
    // valer quando ha UMA nota com esse numero. Marco a colisao; quem usa
    // o atalho cai na varredura antiga (que trata a ambiguidade) se vir
    // `_series_colidem`.
    if (numN) {
      if (porNumero[numN] && String(porNumero[numN].serie || '') !== String(registro.serie || '')) {
        porNumero[numN]._series_colidem = true;
        registro._series_colidem = true;
      }
      porNumero[numN] = registro;
    }
    if (numN) if (nf.id) porId[String(nf.id)] = registro;

    (mapa[chave] = mapa[chave] || []).push(registro);

    // indice extra: primeiro+ultimo nome
    const curto = primeiroUltimo(nomeOriginal);
    if (curto && curto.length >= 5 && curto !== chave) {
      (mapaCurto[curto] = mapaCurto[curto] || []).push(registro);
    }

  return true;
}

// b580 - INDICE SALVO (cfg.armazemNfNomes = lib/armazem-indices). Depois de montar (completa) ou de a renovacao trazer
// nota nova (no maximo 1 gravacao a cada 20 min), grava um retrato compacto; quando o servidor sobe, carrega o retrato
// em vez de remontar pelo Bling e so renova o que entrou depois. Retrato de mais de 36 h ou ilegivel = montagem normal.
const ARMAZEM = (cfg && cfg.armazemNfNomes) || null;
let _ultimaGravacao = 0;
function retratoDoIndice() {
  const pedidoDe = {};
  for (const [ped, reg] of Object.entries(IDX.porPedido || {})) if (reg && reg.id) pedidoDe[String(reg.id)] = ped;
  const vistos = new Set(); const nfs = [];
  for (const lista of Object.values(IDX.mapa || {})) {
    for (const r of lista) {
      const id = String(r.id); if (vistos.has(id)) continue; vistos.add(id);
      nfs.push([id, r.numero || '', r.serie || '', r.nome || '', r.dataEmissao || null, r.valor != null ? r.valor : null, pedidoDe[id] || '']);
    }
  }
  return { v: 1, salvo_em: new Date().toISOString(), ultimaCompleta: IDX.ultimaCompleta || null, maisAntiga: IDX.maisAntiga || null,
    parcialAte: IDX.parcialAte || null, parouPor: IDX.parouPor || null, nfs };
}
async function gravarIndice(motivo, forcar) {
  if (!ARMAZEM || !IDX.ts) return;
  if (!forcar && Date.now() - _ultimaGravacao < 20 * 60000) return;
  _ultimaGravacao = Date.now();
  const r = await ARMAZEM.salvar('nf-nomes', retratoDoIndice());
  IDX.ultimaGravacao = { em: new Date().toISOString(), motivo, ok: !!(r && r.ok), bytes: (r && r.bytes) || null, erro: (r && r.erro) || null };
}
async function carregarIndiceSalvo() {
  if (!ARMAZEM || IDX.ts) return false;
  const ret = await ARMAZEM.carregar('nf-nomes');
  if (!ret || ret.v !== 1 || !Array.isArray(ret.nfs) || !ret.ultimaCompleta) return false;
  if (Date.now() - Date.parse(ret.ultimaCompleta) > 36 * 3600e3) return false;   // velho demais: monta pelo Bling
  const m = { mapa: {}, mapaCurto: {}, porPedido: {}, porNumero: {}, porId: {} };
  let n = 0;
  for (const [id, numero, serie, nome, dataEmissao, valor, pedido] of ret.nfs) {
    if (indexarNF({ id, numero, serie, chaveAcesso: null, contato: { nome }, dataEmissao, valorNota: valor, numeroLoja: pedido }, m)) n++;
  }
  if (IDX.ts) return false;   // uma montagem terminou enquanto lia o retrato: vale a dela
  Object.assign(IDX, m, { totalNFs: n, ultimaCompleta: Date.parse(ret.ultimaCompleta), maisAntiga: ret.maisAntiga || null,
    parcialAte: ret.parcialAte || null, parouPor: ret.parouPor || null, _ids: null, ts: Date.now(), erro: null,
    carregadoDoArmazem: ret.salvo_em });
  console.log(`[${TAG_EMP}/NF-NOMES] indice carregado do armazem: ${n} NFs (salvo em ${ret.salvo_em}) — renovo so o que entrou depois`);
  return true;
}

// b579 - RENOVACAO INCREMENTAL (dono, 06/10: 'senao vai atolar as chamadas no Bling'). Antes, toda renovacao (de 30 em
// 30 min de uso, e a cada pre-aquecimento) remontava o indice INTEIRO — na Girassol, todas as paginas de 120 dias. A
// lista de NFs do Bling vem da mais nova pra mais antiga: a renovacao le so as primeiras paginas e para na primeira
// que ja tem nota conhecida. A montagem completa (que tira o que saiu da janela) fica pra MADRUGADA, 1x por dia.
const INCR_MAX_PAGINAS = 10;
let _incrementando = false;
function montagemCompletaVencida() {
  const ult = IDX.ultimaCompleta || 0;
  if (!ult) return true;
  const idadeH = (Date.now() - ult) / 3600e3;
  if (idadeH > 36) return true;   // passou da madrugada sem montar: nao fica mais de 1,5 dia sem limpar
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  return idadeH > 20 && h >= 1 && h < 6;   // so de madrugada (fora do horario do galpao)
}
async function atualizarIndice(opts = {}) {
  if (!IDX.ts && ARMAZEM && await carregarIndiceSalvo()) return atualizarIndice(opts);   // b580 - sobe com o indice salvo
  if (!IDX.ts || !IDX.porId || montagemCompletaVencida()) return construirIndice(Object.assign({}, opts, { fundo: true }));
  if (construindo || _incrementando) return IDX;
  _incrementando = true;
  try {
    if (!IDX._ids) {
      IDX._ids = new Set();
      for (const lista of Object.values(IDX.mapa || {})) for (const reg of lista) IDX._ids.add(String(reg.id));
    }
    const alvo = { mapa: IDX.mapa, mapaCurto: IDX.mapaCurto, porPedido: IDX.porPedido || (IDX.porPedido = {}),
      porNumero: IDX.porNumero || (IDX.porNumero = {}), porId: IDX.porId };
    let novas = 0, paginas = 0, erro = null;
    for (let pg = 1; pg <= INCR_MAX_PAGINAS; pg++) {
      if (drenagem.estaDrenando()) break;
      if (pg > 1) await drenagem.pausar(400, true, 'indice-nomes/incremental');
      const r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=1`, { fundo: true });
      if (!r.ok) { erro = `pagina ${pg} HTTP ${r.status}`; break; }
      const lista = (r.data && r.data.data) || [];
      paginas = pg;
      if (!lista.length) break;
      let conhecidas = 0;
      for (const nf of lista) {
        const id = String(nf.id);
        if (IDX._ids.has(id)) { conhecidas++; continue; }
        if (indexarNF(nf, alvo)) { IDX._ids.add(id); novas++; IDX.totalNFs = (IDX.totalNFs || 0) + 1; }
      }
      if (conhecidas > 0) break;   // chegou na parte que o indice ja tem
    }
    if (!erro) IDX.ts = Date.now();   // "nao sei" (erro) nao finge que renovou: a proxima busca tenta de novo
    IDX.ultimaIncremental = { em: new Date().toISOString(), paginas, novas, erro };
    if (novas > 0) gravarIndice('renovacao').catch(() => {});   // b580
    console.log(`[${TAG_EMP}/NF-NOMES] renovacao incremental: ${novas} NF(s) nova(s) em ${paginas} pagina(s)` + (erro ? ` — ${erro}` : ''));
    return IDX;
  } finally { _incrementando = false; }
}

async function construirIndiceInterno(opts = {}) {
  if (construindo) return { ...IDX, jaEmAndamento: true };
  IDX._maisAntigaAcum = null;   // b560 - recalculada a cada montagem (a janela anda); so DEPOIS da guarda (b561)
  construindo = true;
  const t0 = Date.now();
  const minhaGeracao = ++geracaoConstrucao;
  IDX.construindoDesde = t0;   // b556: carimbo no caminho COMUM (pre-aquecimento, rota manual, autocura e busca)
  // b559 (Codex, P1) - TETO NO CAMINHO COMUM: pre-aquecimento, rota manual e autocura chamam `construirIndice()`
  // direto; se uma delas travar, a busca fria so recebia `jaEmAndamento`. O teto abandona AQUI (so a propria geracao).
  const TETO_CONSTRUCAO_MS = Number(process.env.NF_NOMES_TETO_CONSTRUCAO_MS || 240000);
  const timerTeto = setTimeout(() => {
    if (minhaGeracao !== geracaoConstrucao) return;
    console.warn(`[${TAG_EMP}/NF-NOMES] construcao passou de ${TETO_CONSTRUCAO_MS / 1000}s — abandono e libero pra proxima tentar`);
    abandonarConstrucao();
  }, TETO_CONSTRUCAO_MS);
  if (timerTeto.unref) timerTeto.unref();

  try {
    const dias = opts.dias || Number(process.env[(cfg && cfg.PREFIXO_ENV || 'AMB_') + 'NF_JANELA_DIAS'] || 120);
    // b579 - teto da montagem COMPLETA ajustavel por empresa (<PREFIXO>NF_NOMES_MAX_PAGINAS; a Girassol passa de 8.000
    // NFs em 120 dias). Padrao 80 (8.000 NFs). A montagem completa agora so roda no boot e de madrugada.
    const maxPaginas = opts.maxPaginas || Number(process.env[String((cfg && cfg.PREFIXO_ENV) || '') + 'NF_NOMES_MAX_PAGINAS']) || 80;
    const corte = Date.now() - dias * 864e5;

    // b263.1 - ⚠️ EU USEI ESTAS DUAS SEM DECLARAR NESTE ARQUIVO. A GOOD
    // tinha, a AMB nao — teria quebrado em producao com ReferenceError,
    // porque `node --check` nao pega variavel inexistente e o caminho so
    // roda DURANTE a drenagem (nenhum teste passava por ele).
    //
    // Achei porque escrevi um teste que confere a DECLARACAO, nao o uso.
    //
    // `deFundo`: so e de fundo quando ja ha indice velho pra servir —
    // reconstrucao pedida por busca fria e do estoquista e nao se cancela.
    const deFundo = opts.fundo !== undefined ? !!opts.fundo : !!IDX.ts;
    let cancelado = false;
    const mapa = {};
    const mapaCurto = {};
    const porPedido = {};
    const porId = {};   // b35 - NF por id do Bling (casa com a venda vinculada)
    const vendasPorLoja = {};   // b34 - numeroLoja GARANTIDO nas vendas
    const porNumero = {};
    let totalNFs = 0, erroBusca = null, parouPorData = false;
    let ultimaCheia = false, paginasLidas = 0;   // b562 - pra saber se foi o TETO de paginas que parou

    // A listagem do Bling vem naturalmente da mais nova pra mais
    // velha. Nao usamos filtro de data de proposito: o Bling anexa a
    // hora atual na data e o filtro de mesmo dia sempre volta zero.
    // Paginamos e cortamos pela data no nosso lado.
    for (let pg = 1; pg <= maxPaginas; pg++) {
      if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b558 - abandonada pelo teto: para de chamar o Bling
      // b263 - o SEGUNDO laco deste arquivo tambem. ⚠️ Achei porque conferi a
      // contagem depois de aplicar — a primeira tentativa pegou so um dos dois,
      // por diferenca de indentacao.
      // b564 (Codex, P2) - SO TRABALHO DE FUNDO PARA NA DRENAGEM: a busca fria que o estoquista espera (`deFundo` falso,
      // sem `viroufundo`) segue ate o fim — parar aqui devolveria um "nao encontrado" falso. E quem para marca
      // `cancelado`, pra o indice truncado NAO ser carimbado como completo nem sobrescrever o que ja estava servindo.
      if (drenagem.estaDrenando() && (deFundo || IDX.viroufundo)) {
        console.log(`[NF-NOMES-AMB] drenando — paro o indice na pagina ${pg}`);
        cancelado = true;
        break;
      }
      // b228 - RITMO e RETENTATIVA (o mesmo da GOOD, que parava na pagina 20
      // com 429 e so indexava ~40 dias dos 120 da janela)
      // b264: a pausa do ritmo do Bling E o ponto de cancelamento — se o
      // processo esta saindo, ela lanca. Nao ha checagem manual pra eu
      // esquecer, e a proxima varredura herda o comportamento.
      if (pg > 1) await drenagem.pausar(400, deFundo || IDX.viroufundo, 'indice-nomes');
      if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559 - abandonada durante a pausa: nao chama o Bling
      // ⚠️ b445 (Codex, P2) - `IDX.viroufundo` TAMBEM CONTA AQUI, nao so no
      // `drenagem.pausar` acima. Uma busca fria que estourou o teto de 12s
      // vira fundo (b268.1) e o `drenagem.pausar` ja respeitava isso — mas
      // o `chamarBling` desta MESMA varredura continuava mandando `fundo:
      // deFundo` (travado no valor do INICIO), entao a fila do ritmo seguia
      // tratando como interativo mesmo depois que ninguem mais esperava.
      let r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=1`, { fundo: deFundo || IDX.viroufundo });   // b443
      if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559 - abandonada com a chamada pendente: nao tenta de novo nem publica parcial
      // ⚠️ b352 (Codex, P1) - O PORTAO TAMBEM PRECISA ACEITAR 401.
      //
      // Eu acrescentei 401 ao laco de dentro, mas o `if` que ENVOLVE o laco
      // so deixava passar 429. Resultado: o retry que eu escrevi PRA TRATAR
      // O 401 nunca rodava num 401 — exatamente o caso do dono (o indice da
      // AMB morreu em `nfe pagina 1 HTTP 401`).
      //
      // 📌 Meio conserto, e do pior tipo: o codigo novo existe, parece
      // certo na revisao, e nao e alcancado. So um teste que EXERCITA o
      // caminho pega.
      if (!r.ok && (r.status === 429 || r.status === 401)) {
        // ⚠️ b351: 401 tambem entra no retry — mesma razao do bloco das
        // vendas. E ESTE e o caminho das NOTAS, que a busca por NOME usa:
        // foi aqui que o `nfe pagina 1 HTTP 401` matou o indice inteiro.
        //
        // ⚠️ b354 (Codex, P1) - `semRetentativa` daqui pra frente: a
        // chamada de cima ja deixou o `chamarBling` renovar o token UMA
        // vez sozinho (e o `renovarToken` tem "pega carona" pra renovacao
        // concorrente). Sem `semRetentativa`, cada uma destas 3 voltas
        // tambem dispararia sua PROPRIA renovacao em caso de 401 — com as
        // 8 tentativas de build la de cima, isso chegava a ~32 rotacoes
        // do refresh token (uso unico) por um 401 so persistente.
        for (let tent = 1; tent <= 3 && !r.ok
          && (r.status === 429 || r.status === 401); tent++) {
          await drenagem.pausar(2000 * tent, deFundo || IDX.viroufundo, 'indice-nomes/retry');
          if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559
          r = await bling.chamarBling(`/nfe?limite=100&pagina=${pg}&tipo=1`, { fundo: deFundo || IDX.viroufundo, semRetentativa: true });
          if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559
        }
        if (cancelado) break;
      }
      if (!r.ok) { erroBusca = `nfe pagina ${pg} HTTP ${r.status}`; break; }

      const lista = (r.data && r.data.data) || [];
      if (lista.length === 0) break;

      for (const nf of lista) {
        const quando = Date.parse(String(nf.dataEmissao || '').replace(' ', 'T'));
        if (quando && quando < corte) { parouPorData = true; break; }
        // b560/b561 - a NF mais antiga do indice (cobertura); so conta NF que ENTROU (depois do corte)
        if (nf.dataEmissao && (!IDX._maisAntigaAcum || String(nf.dataEmissao) < IDX._maisAntigaAcum)) IDX._maisAntigaAcum = String(nf.dataEmissao);

        if (!indexarNF(nf, { mapa, mapaCurto, porPedido, porNumero, porId })) continue;   // b579 - regra unica (montagem e renovacao)
        totalNFs++;
      }

      // b268 - publica o parcial a cada 10 paginas, senao o teto acima
      // devolveria vazio. As paginas vem da mais RECENTE pra mais antiga.
      // ⚠️ `ts` fica em 0: usavel, mas nao completo.
      // b268.1 - ⚠️ so na PRIMEIRA montagem (senao substitui o indice
      // completo por 3 paginas), e a partir da pagina 3 (a 10 nao chega
      // dentro dos 12s com a latencia real do Bling).
      const primeiraMontagem = !IDX.ts;
      if (primeiraMontagem && (pg % 3 === 0 || pg % 10 === 0)   /* b562 - porte da GOOD: checkpoint a cada 3 paginas na 1a montagem */) {
        IDX.mapa = { ...mapa };
        IDX.mapaCurto = { ...mapaCurto };
        IDX.porNumero = { ...porNumero };   // b474 (Codex, P2): o parcial tambem publica o indice por numero
        IDX.parcialAte = pg;
        IDX.totalNFs = totalNFs;
        IDX.maisAntiga = IDX._maisAntigaAcum || IDX.maisAntiga || null;
        console.log(`[${TAG_EMP}/NF-NOMES] parcial publicado: ${pg} paginas, ${totalNFs} NFs`);
      }

      paginasLidas = pg; ultimaCheia = lista.length >= 100;   // b562
      if (parouPorData || lista.length < 100) break;
      await sleep(cfg.bling.pausaMs / 2);   // respeita o rate limit do Bling
    }

    // ── b34: PASSE 2 — VENDAS do Bling. /pedidos/vendas traz
    // numeroLoja SEMPRE (mais contato e total) — é a espinha dos
    // checkouts. Cobre Shopee/TikTok/Amazon quando a lista de NFs
    // não casa pelo pedido. Erro aqui NÃO derruba o índice de NFs.
    let vendasLidas = 0, erroVendas = null;
    try {
      // b564 (Codex, P2) - `cfg.semVendas`: a GOOD so usa nome/status/numero, nao os mapas de venda; pula ate 80 paginas de
      // /pedidos/vendas que estourariam o teto de construcao. Sem a opcao, nada muda (AMB/Girassol).
      const maxPaginasVendas = (cfg && cfg.semVendas) ? 0 : maxPaginas;
      for (let pg = 1; pg <= maxPaginasVendas; pg++) {
        if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b558 - abandonada pelo teto: para de chamar o Bling
        // b263 - o SEGUNDO laco deste arquivo tambem. ⚠️ Achei porque conferi a
        // contagem depois de aplicar — a primeira tentativa pegou so um dos dois,
        // por diferenca de indentacao.
        if (drenagem.estaDrenando() && (deFundo || IDX.viroufundo)) {   // b564: mesma regra do laco das NFs
          console.log(`[NF-NOMES-AMB] drenando — paro o indice na pagina ${pg}`);
          cancelado = true;
          break;
        }
        // b40 - 429 (rate limit do Bling) na leitura de vendas NAO derruba mais
        // o indice: espera e tenta a MESMA pagina de novo, ate 4x com backoff.
        let r = null;
        for (let tent = 1; tent <= 4; tent++) {
          if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559 - abandonada durante o backoff
          // ⚠️ b354 (Codex, P1) - so a 1a tentativa deixa o `chamarBling`
          // renovar o token sozinho no 401. Da 2a em diante, `semRetentativa`
          // evita que CADA volta deste laco dispare sua PROPRIA renovacao
          // (o refresh token e de uso unico; 4 tentativas x 8 builds de
          // `tentar()` chegava a rotacoes demais por um 401 so persistente).
          // ⚠️ b443 (Codex, P2) - `fundo: deFundo` FALTAVA aqui tambem. O
          // apontamento citou as 3 chamadas deste laco (NFs x2 + vendas); a
          // rodada anterior consertou so as duas de `/nfe` e esqueceu esta.
          r = await bling.chamarBling(`/pedidos/vendas?limite=100&pagina=${pg}`, tent === 1 ? { fundo: deFundo || IDX.viroufundo } : { semRetentativa: true, fundo: deFundo || IDX.viroufundo });
          if (minhaGeracao !== geracaoConstrucao) { cancelado = true; break; }   // b559 - abandonada com a chamada pendente
          if (r.ok) { erroVendas = null; break; }
          // ⚠️ b351 - 401 TAMBEM ENTRA NO RETRY.
          //
          // [stated 15/09] o dono buscou "Lyvia" e nao achou. O indice
          // mostrava `total_nfs: 0` e `erro: "nfe pagina 1 HTTP 401"`.
          //
          // ⚠️ E O TOKEN ESTAVA BOM: `/amb/bling/teste` respondeu na hora. O
          // 401 foi PASSAGEIRO — o token estava sendo renovado naquele
          // instante, e o indice tomou a recusa na PRIMEIRA pagina, desistiu,
          // e ficou VAZIO ate o proximo reinicio do servico.
          //
          // 📌 Resultado pro dono: a busca por nome respondia "nao
          // encontrado" pra TODO mundo, e parecia que o pedido nao existia.
          // A nota da Lyvia estava no Bling o tempo todo.
          if (r.status === 429 || r.status === 503 || r.status === 401) {
            erroVendas = `vendas pagina ${pg} HTTP ${r.status} (tent ${tent}/4)`;
            await sleep(1500 * tent);   // 1.5s, 3s, 4.5s
            continue;
          }
          erroVendas = `vendas pagina ${pg} HTTP ${r.status}`;
          break;   // erro nao-recuperavel: para
        }
        if (cancelado) break;
        if (!r || !r.ok) break;   // esgotou as tentativas desta pagina
        const lote = (r.data && r.data.data) || [];
        if (!lote.length) break;
        let velhas = 0;
        for (const v of lote) {
          const quando = Date.parse(v.data || '') || 0;
          if (quando && quando < corte) { velhas++; continue; }
          const loja = String(v.numeroLoja || '').trim();
          if (!loja) continue;
          vendasLidas++;
          const ja = vendasPorLoja[loja];
          if (!ja || (quando && quando > (ja._q || 0))) {
            vendasPorLoja[loja] = {
              nome: (v.contato && v.contato.nome) || null,
              valor: (v.total != null ? v.total : null),
              id_venda: String(v.id || ''),
              numero_venda: String(v.numero || ''),
              _q: quando,
            };
          }
        }
        if (velhas === lote.length) break;   // página inteira antes do corte
        await sleep(350);
      }
    } catch (e) { erroVendas = e.message; }

    // Mesma regra do indice do ML: se falhou e nao veio nada, nao
    // marca como quente — o proximo bipe tenta de novo em vez de
    // confiar num indice vazio por 30 minutos.
    // b558 - montagem ABANDONADA pelo teto (outra ja pode estar montando): nao toca no indice — quem manda nele agora
    // e a montagem nova; o `finally` desta tambem nao mexe na guarda (geracao diferente).
    if (minhaGeracao !== geracaoConstrucao) return IDX;
    const falhouGeral = !!erroBusca && totalNFs === 0;
    if (cancelado) return IDX;   // b564: interrompida pela drenagem — nao publica o indice truncado (o parcial dos checkpoints ja ficou)
    // b263.1 (Codex, P2) - ⚠️ CANCELAMENTO CONTA COMO FALHA AQUI.
    //
    // A AMB ja tinha o `falhouGeral` pra nao carimbar `ts` quando a
    // varredura nao completou — reaproveito em vez de criar outro caminho.
    // Publicar um indice parcial com `ts` fresco faria a proxima busca
    // servir dele em vez de reconstruir.
    // b562 - porte da GOOD: se foi o TETO de paginas que parou (a ultima pagina lida ainda estava CHEIA), o indice NAO
    // esta completo — continua PARCIAL, e a busca avisa. So a data de corte ou o fim dos dados fecham o indice.
    const parouPorTeto = !parouPorData && ultimaCheia && paginasLidas >= maxPaginas;
    IDX.parouPor = parouPorTeto ? 'teto' : (parouPorData ? 'data' : 'fim');
    IDX.ts = (falhouGeral || cancelado) ? 0 : Date.now();
    // b280.2 (auditoria do #228, Codex P1) - ⚠️ A AMB NUNCA LIMPAVA ISTO.
    //
    // A GOOD zera `IDX.parcialAte` quando a varredura termina (b268: "agora
    // esta COMPLETO"). A AMB publica o parcial nos checkpoints (`pg === 3`,
    // `pg % 10 === 0`) mas nunca tinha o espelho — uma vez que a 1a
    // montagem publicasse QUALQUER checkpoint, `parcialAte` ficava travado
    // naquela pagina PARA SEMPRE, mesmo depois do indice completar os 120
    // dias. O aviso que este PR porta pra AMB (rN.parcial_ate_pagina)
    // ficaria ligado o tempo todo — o estoquista veria "indice incompleto"
    // numa busca com o indice ja pronto ha horas.
    if (!falhouGeral && !cancelado) {
      if (parouPorTeto) IDX.parcialAte = paginasLidas;
      else IDX.parcialAte = null;
    }
    IDX.mapa = mapa;
    IDX.porPedido = porPedido;
    IDX.porId = porId;
    IDX.ultimaCompleta = Date.now();   // b579 - a renovacao incremental mede a idade a partir daqui
    setTimeout(() => gravarIndice('montagem completa', true).catch(() => {}), 0);   // b580 - depois de publicar
    IDX._ids = null;                   // b579 - o conjunto de ids conhecidos e refeito na 1a renovacao
    IDX.vendasPorLoja = vendasPorLoja;
    IDX.vendasLidas = vendasLidas;
    IDX.erroVendas = erroVendas;
    IDX.porNumero = porNumero;
    IDX.mapaCurto = mapaCurto;
    IDX.totalNFs = totalNFs;
    IDX.maisAntiga = IDX._maisAntigaAcum || IDX.maisAntiga || null;
    IDX.nomes = Object.keys(mapa).length;
    IDX.duracaoSeg = Math.round((Date.now() - t0) / 1000);
    IDX.erro = erroBusca;

    console.log(`[${TAG_EMP}/NF-NOMES] indice: ${totalNFs} NFs de ${IDX.nomes} nomes (${dias}d) em ${IDX.duracaoSeg}s`);
    return IDX;
  } finally {
    clearTimeout(timerTeto);
    // b556: se a construcao foi abandonada pelo teto, a guarda ja foi liberada (e talvez retomada por outra)
    if (geracaoConstrucao === minhaGeracao) { construindo = false; IDX.construindoDesde = null; }
  }
}

// b556: libera a guarda de uma construcao travada. Nao da pra cancelar a promessa, mas o `finally` dela
// (geracao antiga) deixa de mexer na guarda — a proxima busca consegue montar um indice novo.
function abandonarConstrucao() {
  geracaoConstrucao++;
  construindo = false;
  IDX.construindoDesde = null;
}

function statusIndice() {
  return {
    // b415: a fila do pre-aquecimento precisa saber se ainda VEM mais
    ocupado: construindo || reagendado,
    construindo,
    // b268.1 - quem chama precisa distinguir "nao achei" de "ainda nao
    // varri essa pagina"
    parcial_ate_pagina: IDX.parcialAte || null,
    completo: !!IDX.ts && !IDX.parcialAte,
    com_pedido: IDX.porPedido ? Object.keys(IDX.porPedido).length : 0,
    vendas_com_loja: Object.keys(IDX.vendasPorLoja || {}).length,
    nf_por_venda_ok: [...NF_POR_VENDA.values()].filter(e => e.numero).length,
    nf_por_loja_ok: NF_POR_LOJA.size,
    nf_por_venda_nulas: [...NF_POR_VENDA.values()].filter(e => !e.numero).length,
    nf_por_venda_amostra: [...NF_POR_VENDA.entries()].slice(0, 3)
      .map(([id, e]) => ({ id_venda: id, numero: e.numero, http: e.http, tent: e.tent })),
    vendas_lidas: IDX.vendasLidas || 0,
    erro_vendas: IDX.erroVendas || null,
    com_numero: IDX.porNumero ? Object.keys(IDX.porNumero).length : 0,
    quente: IDX.ts > 0,
    construindo,
    idade_min: IDX.ts ? Math.round((Date.now() - IDX.ts) / 60000) : null,
    total_nfs: IDX.totalNFs,
      parou_por: IDX.parouPor || null,   // b562 - 'teto' = cortado pelo limite de paginas
      nf_mais_antiga: IDX.maisAntiga || null,
      ultima_completa: IDX.ultimaCompleta ? new Date(IDX.ultimaCompleta).toISOString() : null,   // b579
      ultima_incremental: IDX.ultimaIncremental || null,
      ultima_gravacao: IDX.ultimaGravacao || null,   // b580
      carregado_do_armazem: IDX.carregadoDoArmazem || null,   // b580   // b579   // b560 - a tela da GOOD le este campo
      construindo_ha_s: IDX.construindoDesde ? Math.round((Date.now() - IDX.construindoDesde) / 1000) : null,   // b556
    nomes_distintos: IDX.nomes,
    nomes_curtos: Object.keys(IDX.mapaCurto).length,
    janela_dias: Number(process.env[(cfg && cfg.PREFIXO_ENV || 'AMB_') + 'NF_JANELA_DIAS'] || 120),
    duracao_construcao_seg: IDX.duracaoSeg || null,
    erro: IDX.erro,
  };
}

/**
 * Busca candidatos pelo nome.
 *
 * Roda as TRES estrategias e junta o resultado, em vez de parar na
 * primeira que da match. Motivo descoberto no teste: "Jose Silva
 * Ramos" vira JOSERAMOS no indice curto, entao uma etiqueta escrita
 * JOSESILVA achava so o "Jose Antonio Silva" e escondia o outro —
 * sendo que JOSESILVA e prefixo de JOSESILVARAMOS. Parar na
 * primeira estrategia custava recall justamente nos casos ambiguos,
 * que sao os que mais precisam de ajuda.
 *
 * A ordem de confianca vira a ordem da lista:
 *   1. nome completo exato    (mais confiavel)
 *   2. primeiro+ultimo nome
 *   3. prefixo / contem       (menos confiavel)
 * Dentro de cada faixa, mais recente primeiro.
 */
async function buscarPorNome(texto, opts = {}) {
  // b563 - nome minimo por empresa (a GOOD para com menos de 5 letras — nao devolve uma lista enorme). Sem a
  // opcao, nada muda (AMB/Girassol).
  const _MIN_NOME = Number(cfg && cfg.nomeMinimo) || 0;
  if (_MIN_NOME && colapsar(texto).length < _MIN_NOME) {
    return { alvo: colapsar(texto), via: null, vias: [], candidatos: [], total: 0, total_encontrados: 0, pagina: 1, por_pagina: 0, tem_mais: false, montando: !IDX.ts, indiceParcial: !!IDX.parcialAte };
  }
  const porPagina = Math.min(Math.max(Number(opts.porPagina) || 8, 1), 50);
  const pagina = Math.max(Number(opts.pagina) || 1, 1);
  const alvo = colapsar(texto);

  // ⚠️ b351 - a resposta vazia DIZ SE O INDICE ESTA CEGO.
  //
  // Sem isto, "nao ha NF com esse nome" e "o indice nunca montou" chegam na
  // tela do mesmo jeito — e o dono conclui que o pedido nao existe.
  const vazio = (aviso) => ({
    alvo, via: null, candidatos: [],
    total: 0, pagina, por_pagina: porPagina, tem_mais: false, aviso,
    // ⚠️ avaliado com GETTER, nao no momento da definicao.
    //
    // `vazio()` e definido no TOPO da funcao, antes de o indice tentar
    // montar — se eu calcular aqui, capturo o estado VELHO e o sinal chega
    // errado. Com getter, le quando a resposta e montada.
    //
    // ⚠️ (Codex, P2) so `!IDX.ts` — IDX.ts so vira Date.now() apos
    // construcao BEM-SUCEDIDA (`falhouGeral` zera pra 0). Contar
    // `Object.keys(IDX.mapa).length` junto marcava uma conta nova/vazia
    // (indice construido, zero NFs de verdade) como "indice cego", e uma
    // busca legitima virava 503 de indisponibilidade.
    get indice_vazio() {
      return !IDX.ts;
    },
    get erro_indice() { return IDX.erro || null; },
  });

  if (alvo.length < 5) return vazio('texto curto demais (minimo 5 letras)');

  // ESPERAR SO QUANDO NAO HA ALTERNATIVA.
  // Visto em producao: depois de um restart o indice esfria, e a
  // busca ficava 57s montando com o estoquista e a caixa na mao.
  // Agora: indice VAZIO -> espera (nao ha o que responder).
  // Indice VELHO mas cheio -> responde JA com o que tem e
  // reconstroi por tras. O pior caso vira "a NF de 10 minutos
  // atras ainda nao entrou", e devolucao que chega hoje e de
  // venda de semanas atras — nao atrapalha nada.
  if (!IDX.ts) {
    // b268 - ⚠️ MESMO TETO DA GOOD. A busca fria varria ate 80 paginas
    // (8.000 NFs) antes de responder: 66s no melhor caso, 150s no pior.
    // O dono passou de 3 min esperando na GOOD — a AMB tinha o mesmo.
    //
    // Espero no maximo 12s; passou disso, respondo com o parcial e a
    // construcao segue em segundo plano.
    const TETO_ESPERA_MS = Number(process.env.NF_NOMES_TETO_BUSCA_MS || 12000);
    let respondeuNoPrazo = true;
    // b268.1 - ⚠️ REUSA a construcao em andamento: sem isto, cada busca
    // depois do timeout comeca OUTRA varredura de 80 paginas, e o
    // estoquista que busca de novo dobra o trafego do Bling.
    if (!IDX.emConstrucao) {
      // b556 - TETO DE CONSTRUCAO (protecao que so a copia da GOOD tinha): se a montagem passar do teto (porteiro
      // do Bling pausado, fila travada), ela e abandonada e libera a proxima tentativa — sem isto o `emConstrucao`
      // ficava pendurado e toda busca seguinte esperava por ele. O carimbo de inicio aparece no status (/health) e
      // e limpo ao terminar.
      const TETO_CONSTRUCAO_MS = Number(process.env.NF_NOMES_TETO_CONSTRUCAO_MS || 240000);
      let timerTeto;
      IDX.emConstrucao = Promise.race([
        atualizarIndice(),   // b580 - sem indice: tenta o salvo antes de montar pelo Bling
        new Promise((ok) => { timerTeto = setTimeout(() => {
          // b559: quem abandona (libera a guarda) e o teto de `construirIndiceInterno`; aqui so solta a espera da busca
          ok();
        }, TETO_CONSTRUCAO_MS + 1000); }),
      ])
        .catch(() => {})
        .finally(() => { clearTimeout(timerTeto); IDX.emConstrucao = null; });
    }
    try {
      await Promise.race([
        IDX.emConstrucao,
        new Promise((ok) => setTimeout(() => { respondeuNoPrazo = false; ok(); }, TETO_ESPERA_MS)),
      ]);
    } catch (e) { /* segue vazio */ }
    if (!respondeuNoPrazo) {
      // b268.1 - ⚠️ dai em diante e trabalho de FUNDO: ninguem mais espera,
      // entao um SIGTERM tem que conseguir cancelar a varredura orfa.
      IDX.viroufundo = true;
      console.log(`[${TAG_EMP}/NF-NOMES] indice ainda montando apos ${TETO_ESPERA_MS}ms — `
        + 'respondo com o parcial e sigo montando (agora cancelavel)');
    }
  } else if ((Date.now() - IDX.ts) > 30 * 60000) {
    atualizarIndice().catch(e => console.error(`[${TAG_EMP}/NF-NOMES] atualizacao em background falhou:`, e.message));   // b579
  }

  const jaVi = new Set();
  const hits = [];
  const vias = [];

  const juntar = (lista, forca, nomeVia) => {
    let entrou = 0;
    for (const nf of lista || []) {
      if (jaVi.has(nf.id)) continue;
      jaVi.add(nf.id);
      hits.push({ ...nf, forca, via: nomeVia });
      entrou++;
    }
    if (entrou > 0) vias.push(nomeVia);
  };

  // 1) nome completo exato
  juntar(IDX.mapa[alvo], 1, 'nome completo');

  // 2) primeiro+ultimo nome
  juntar(IDX.mapaCurto[alvo], 2, 'primeiro+ultimo nome');

  // 3) aproximado — sem teto artificial, pra o total nao mentir
  const aprox = [];
  for (const [nome, nfs] of Object.entries(IDX.mapa)) {
    if (nome.startsWith(alvo) || nome.includes(alvo) || alvo.includes(nome)) {
      aprox.push(...nfs);
    }
  }
  juntar(aprox, 3, 'aproximado');

  // confianca primeiro, data depois
  hits.sort((a, b) => (a.forca - b.forca)
    || String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));

  const total = hits.length;
  const inicio = (pagina - 1) * porPagina;
  // b560/b561 - porte da GOOD ('era o bug: so o mes atual chegava'): na 1a pagina, alem dos mais recentes, vem uma AMOSTRA
  // das vendas antigas (sempre inclui a mais antiga de todas), marcada `_antigo`. b561 (Codex): a amostra sai de uma
  // visao ORDENADA POR DATA do resto (hits vem ordenado por confianca) e fica FORA da paginacao (a pagina 2 nao a repete).
  let amostra = [];
  const idsAmostra = new Set();
  if (hits.length > porPagina) {
    const resto = hits.slice(porPagina).sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
    const idxs = new Set([resto.length - 1]);
    const passo = Math.max(1, Math.floor(resto.length / 6));
    for (let i = 0; i < resto.length && idxs.size < 6; i += passo) idxs.add(i);
    amostra = [...idxs].sort((x, y) => x - y).map((i) => Object.assign({}, resto[i], { _antigo: true }));
    for (const m of amostra) idsAmostra.add(m.id);
  }
  const paginaveis = idsAmostra.size ? hits.filter((h) => !idsAmostra.has(h.id)) : hits;
  let fatia = paginaveis.slice(inicio, inicio + porPagina);   // let: a marca de antigo reatribui
  const fatiaPrincipal = fatia.length;
  if (inicio === 0) fatia = fatia.concat(amostra);

  // b560 - porte da GOOD (testes antigos dela rodados sobre esta copia): (1) quem nao esta entre os 8 mais recentes
  // vem marcado `_antigo`, pro estoquista saber que e venda antiga; (2) `montando` quando ainda nao ha indice
  // completo — a tela diz 'ainda montando' em vez de 'nao encontrado' seco (inclusive quando a 1a montagem falha).
  const MAIS_RECENTES = 8;
  fatia = fatia.map((c, i) => ((inicio + i) >= MAIS_RECENTES ? Object.assign({}, c, { _antigo: true }) : c));
  return {
    alvo,
    via: vias[0] || null,
    vias,
    candidatos: fatia,
    montando: !IDX.ts,   // b560
    indiceParcial: !!IDX.parcialAte,   // b562 - porte da GOOD: o indice ainda nao cobre a janela toda
    total_encontrados: hits.length,   // b560 - nome que a GOOD usa (mesmo valor de `total`)
    total,
    pagina,
    por_pagina: porPagina,
    tem_mais: inicio + fatiaPrincipal < paginaveis.length,
    // todas do mesmo cliente: o nome nao desempata, so os itens
    muitos_iguais: total > porPagina && new Set(hits.map(h => h.nome)).size === 1,
    // busca generica demais: buscar "SILVA" trouxe 503 NFs reais.
    // Paginar 63 vezes nao ajuda ninguem — melhor pedir o nome
    // completo do remetente, que e o que esta impresso na caixa.
    generica: total > 50,
    // b301 (auditoria da b268.1, P1) - a GOOD marca o retorno de
    // buscarPorNome() com `indiceParcial` (via `marcarParcial()`); esta
    // funcao aqui na AMB ficou de fora do porte ("AS 5 PORTADAS PRA AMB"
    // valeu pro statusIndice, nao pra este retorno) -- um nome cuja NF
    // esta numa pagina ainda nao lida virava resultado vazio comum.
    parcial_ate_pagina: IDX.parcialAte || null,
    // ⚠️ b351 - O RETORNO PRINCIPAL TAMBEM DIZ SE O INDICE ESTA CEGO.
    //
    // Eu tinha posto isto so no `vazio()` — mas ESTE e o retorno que a
    // busca usa quando nao acha nada com o indice montado (ou nao).
    // Descobri porque o campo chegava `undefined` no teste real; sem ele,
    // "nao ha NF com esse nome" e "o indice nunca montou" chegam iguais.
    //
    // ⚠️ (Codex, P2) so `!IDX.ts` — ver o mesmo ajuste no getter de vazio()
    // acima: contar `mapa.length` marcava conta nova/vazia como indice
    // cego.
    indice_vazio: !IDX.ts,
    erro_indice: IDX.erro || null,
  };
}

/** Ordena no lugar: mais recente primeiro. NAO corta mais. */
function ordenar(lista) {
  lista.sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')));
  return lista;
}

/** Pre-aquecimento atrasado, pelo mesmo motivo do indice do ML. */
// b272 - ⚠️ CORRIGINDO UM BUG QUE EU INTRODUZI NA b271.
//
// Aqui o parametro e o ATRASO em ms, nao a tentativa — assinatura
// diferente da GOOD. Meu retry chamava `preAquecer(tentativa + 1)`, o que
// passaria **2** como atraso (2 MILISSEGUNDOS) e, pior, `tentativa` nem
// existia neste escopo: quebraria com ReferenceError na primeira falha.
//
// ⚠️ `node --check` nao pega (variavel inexistente e sintaxe valida) e
// nenhum teste passava por ali — o caminho so roda quando o
// pre-aquecimento FALHA.
//
// Porte cego: copiei o retry da GOOD sem ler a assinatura de ca. E a
// Regra 4.12 — LER O PRODUTOR ANTES DE ESCREVER O CONSUMIDOR — que eu
// violei no mesmo dia em que a apliquei em outros 4 arquivos.
function preAquecer(atrasoMs, tentativa = 1) {
  // b563 - aceita tambem o formato da GOOD: preAquecer({ maxPaginas }) = monta JA, como fundo, com essas opcoes (o
  // passe curto do boot); preAquecer(ms) e o formato da AMB/Girassol (agenda). Sem argumento, como sempre (4 min).
  // b564 (Codex, P2): as opcoes ficam na CLOSURE de cada agendamento (e de suas retentativas) — uma variavel unica era
  // sobrescrita por um preaquecimento posterior e a retentativa do passe curto perdia o `maxPaginas`.
  let opcoes = {};
  if (atrasoMs && typeof atrasoMs === 'object') { opcoes = atrasoMs; atrasoMs = 0; }
  const atraso = atrasoMs != null ? atrasoMs : 4 * 60 * 1000;
  console.log(`[${TAG_EMP}/NF-NOMES] pre-aquecimento agendado para daqui a ${Math.round(atraso / 1000)}s`);
  reagendado = true;   // b415: a fila do pre-aquecimento espera isto
  setTimeout(() => tentar(1, opcoes), atraso).unref();
}

// ⚠️ (Codex, PR #213) mesmo bug do ml-returns-AMB.js: `preAquecer(atrasoMs)`
// nao tem `tentativa`, e o retry referenciava uma variavel inexistente —
// ReferenceError dentro do `.catch()`, virando rejeicao nao tratada.
function tentar(tentativa, opcoes) {
  reagendado = false;   // b415
  // ⚠️ b445 (Codex, P2) - PRE-AQUECIMENTO E SEMPRE FUNDO. `deFundo` (dentro
  // de `construirIndiceInterno`) so vira `true` sozinho quando ja existe um
  // indice VELHO pra servir (`!!IDX.ts`) — no boot `IDX.ts` ainda e 0, entao
  // esta varredura de ate 8.000 NFs entrava na fila INTERATIVA, disputando
  // espaco com buscas de verdade, mesmo sem ninguem esperando por ela: e
  // trabalho de fundo por definicao.
  // b579 - com indice pronto (e sem pedido de passe curto), renova em vez de remontar tudo (a GOOD chama de 25 em 25 min)
  ((ARMAZEM && !IDX.ts) || (IDX.ts && !(opcoes && opcoes.maxPaginas)) ? atualizarIndice(opcoes) : construirIndice(Object.assign({}, opcoes, { fundo: true })))   /* b580: na subida, tenta o indice salvo */.then((idx) => {   // b563/b579
    if (!idx) return; // cancelado pela drenagem - nem sucesso nem falha
    if (idx.erro) throw new Error(idx.erro);
  }).catch((e) => {
    // b271 - ⚠️ FALHOU, TENTA DE NOVO (a AMB tambem — regra da casa).
    // Um 429 no boot deixava o cache vazio por 25 min.
    console.error(`[${TAG_EMP}/NF-NOMES] pre-aquecimento falhou (tentativa ${tentativa}/3):`, e.message);
    // ⚠️ b351 - 3 TENTATIVAS EM 3,5 MIN NAO BASTAM.
    //
    // [stated 15/09] o indice da AMB estava com `total_nfs: 0` e
    // `erro: "nfe pagina 1 HTTP 401"` — e o token estava BOM (o
    // /amb/bling/teste respondeu na hora). O 401 foi passageiro, mas as 3
    // tentativas queimaram nele e o indice ficou VAZIO ate o reinicio.
    //
    // 📌 Resultado: a busca por nome dizia "nao encontrado" pra TODO mundo,
    // o dia inteiro. O dono procurou "Lyvia", nao achou, e a nota estava no
    // Bling o tempo todo.
    //
    // ⚠️ Agora 8 tentativas com teto de 10 min: cobre ~40 min de Bling
    // instavel em vez de 3,5. E o `.unref()` garante que isso nao segura o
    // processo.
    if (tentativa >= 8) {
      console.error(`[${TAG_EMP}/NF-NOMES] desisti apos 8 tentativas — o indice fica `
        + 'VAZIO ate o proximo reinicio. A busca por NOME nao vai achar nada.');
      return;
    }
    const espera = Math.min(30000 * Math.pow(2, tentativa - 1), 10 * 60 * 1000);
    console.log(`[${TAG_EMP}/NF-NOMES] tento de novo em ${espera / 1000}s`);
    // ⚠️ (Codex) setTimeout cru nao e cancelado pela drenagem — registra
    // com daquiA pra nao acordar o processo VELHO durante um deploy.
    // ⚠️ b416 (Codex, P1) - AQUI e a retentativa de verdade.
    //
    // No b415 eu marquei `reagendado` no `preAquecer` — o disparo
    // INICIAL — e achei que tinha coberto. A retentativa usa
    // `drenagem.daquiA`, nao `setTimeout`, entao minha busca nao achou e
    // a fresta continuou aberta: `construindo` cai, o catch chega aqui, e
    // nesse meio a fila soltava o proximo.
    //
    // 📌 Consertei o sintoma no lugar errado e o teste passou, porque ele
    // so conferia se o texto `reagendado = true` existia no arquivo.
    reagendado = true;
    drenagem.daquiA(() => tentar(tentativa + 1, opcoes), espera);
  });
}

/** Cliente e NF da venda pelo numero do pedido do marketplace. */
// ── b35: NF pela VENDA vinculada. Pros cards em que o ML nega a
// chave (invoice_data 404) e a lista de NFs não casa (com_pedido 0),
// o detalhe da venda (GET /pedidos/vendas/{id}) aponta a NF gerada.
// Cache permanente com retentativa (padrão da ENTREGA_REAL/b30).
const NF_POR_VENDA = new Map();
const NF_POR_LOJA = new Map();   // b39 - numeroLoja -> {numero,serie} (a chave que o card sempre tem)   // id_venda -> { numero, serie, id_nf, tent, http }
let NFV_RODANDO = false;

// b47 - acha a NF por NOME direto no indice em memoria (SINCRONO, sem rebuild).
// Serve pro FULL: a NF do Full (serie 5 Shopee, 2/3/4 etc) entra por XML sem
// numeroPedidoLoja, entao nao casa por pedido — mas o nome do cliente casa.
// Devolve a NF mais recente que bate o nome (mesma logica do buscarPorNome).
function acharNfPorNomeIndice(nome) {
  const alvo = colapsar(nome);
  if (!alvo || alvo.length < 5 || !IDX.mapa) return null;
  // mesmas vias 1 e 2 do buscarPorNome: nome completo, depois primeiro+ultimo
  let cand = (IDX.mapa[alvo] && IDX.mapa[alvo].length) ? IDX.mapa[alvo]
           : (IDX.mapaCurto[alvo] && IDX.mapaCurto[alvo].length) ? IDX.mapaCurto[alvo]
           : null;
  if (!cand || !cand.length) return null;
  // a mais recente (maior dataEmissao) que tenha numero
  let melhor = null;
  for (const nf of cand) {
    if (!nf || !nf.numero) continue;
    if (!melhor || String(nf.dataEmissao || '') > String(melhor.dataEmissao || '')) melhor = nf;
  }
  return melhor ? { numero: melhor.numero, serie: melhor.serie, id: melhor.id } : null;
}

function nfDaLoja(numeroLoja) {
  const e = numeroLoja ? NF_POR_LOJA.get(String(numeroLoja).trim()) : null;
  return (e && e.numero) ? e : null;
}

function nfDaVenda(idVenda) {
  const e = idVenda ? NF_POR_VENDA.get(String(idVenda)) : null;
  return (e && e.numero) ? e : null;
}

function dispararNfPorVenda(pares) {
  if (NFV_RODANDO) return;
  // aceita ['id', ...] (compat) OU [{id, loja}, ...] (b39). Normaliza.
  const norm = (pares || []).map(x => (x && typeof x === 'object') ? { id: String(x.id || ''), loja: String(x.loja || '') } : { id: String(x || ''), loja: '' }).filter(x => x.id);
  const vistos = new Set();
  const fila = norm.filter(x => {
    if (vistos.has(x.id)) return false; vistos.add(x.id);
    const e = NF_POR_VENDA.get(x.id);
    return !e || (!e.numero && (e.tent || 0) < 3);
  }).slice(0, 40);
  if (!fila.length) return;
  NFV_RODANDO = true;
  (async () => {
    for (const item of fila) {
      const id = item.id, loja = item.loja;
      const antes = NF_POR_VENDA.get(id) || { tent: 0 };
      try {
        const r = await bling.chamarBling('/pedidos/vendas/' + id);
        const v = (r.ok && r.data && r.data.data) || null;
        const nfId = v && v.notaFiscal && v.notaFiscal.id ? String(v.notaFiscal.id) : null;
        let numero = null, http = r.status || (r.ok ? 200 : null);
        let serie = null;
        if (nfId) {
          const reg = (IDX.porId && IDX.porId[nfId]) || null;
          if (reg && reg.numero) { numero = String(reg.numero); serie = reg.serie || null; }   // b44 - reg.serie ja vem da chave
          else {
            const rn = await bling.chamarBling('/nfe/' + nfId);
            const nf = (rn.ok && rn.data && rn.data.data) || null;
            if (nf && nf.numero) { numero = String(nf.numero).replace(/^0+/, ''); serie = serieDaChave(nf.chaveAcesso, (nf.serie != null && String(nf.serie).trim()) ? String(nf.serie).trim() : null); }   // b44 - serie da chave
            http = rn.status || http;
          }
        }
        NF_POR_VENDA.set(id, { numero, serie, id_nf: nfId, tent: (antes.tent || 0) + 1, http });
        if (loja && numero) NF_POR_LOJA.set(loja, { numero, serie });
      } catch (e) {
        NF_POR_VENDA.set(id, { numero: null, serie: null, id_nf: null, tent: (antes.tent || 0) + 1, http: 'exc:' + String(e.message).slice(0, 40) });
      }
      await new Promise(rs => setTimeout(rs, 350));
    }
    const ok = [...NF_POR_VENDA.values()].filter(e => e.numero).length;
    console.log(`[${TAG_EMP}/NF-NOMES] NFs pela venda: ` + ok + ' de ' + NF_POR_VENDA.size + ' consultadas');
  })().catch(() => {}).finally(() => { NFV_RODANDO = false; });
}

function acharVendaPorLoja(k) {
  const c = String(k || '').trim();
  return (c && IDX.vendasPorLoja && IDX.vendasPorLoja[c]) || null;
}

function acharPorNumero(numero) {
  const k = String(numero || '').replace(/^0+/, '');
  return (k && IDX.porNumero && IDX.porNumero[k]) || null;
}

function acharPorPedido(pedido) {
  const k = String(pedido || '').trim();
  return (k && IDX.porPedido && IDX.porPedido[k]) || null;
}

return {
  construirIndice, atualizarIndice, statusIndice, buscarPorNome, acharPorPedido, acharPorNumero, acharVendaPorLoja, nfDaVenda, nfDaLoja, acharNfPorNomeIndice, dispararNfPorVenda, preAquecer,
  colapsar, primeiroUltimo,
};
}

// b248: export padrao = objeto pronto da AMB; fabrica em `.criar`.
// ⚠️ b377 - A INSTANCIA PADRAO SAIU.
//
// Era `module.exports = criarNfNomes(configAMB)` — criada NO REQUIRE, com o
// `config-AMB` fixo. Duas coisas erradas:
//
//   1. carregava o arquivo da AMB em todo boot, mesmo sem ninguem usar
//   2. e agora que o modulo EXIGE o cliente da empresa, ela quebrava o boot:
//      o `configAMB` nao tem `clienteMl`
//
// 📌 Ninguem mais a consome — o app usa `.criar(CFG_EMPRESA)`. Exporto so a
// fabrica, como nos outros 8 modulos.
module.exports = { criar: criarNfNomes };
