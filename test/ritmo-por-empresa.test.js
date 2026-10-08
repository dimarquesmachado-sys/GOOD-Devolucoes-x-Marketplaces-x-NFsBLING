'use strict';
// ⚠️ O CLIENTE DO BLING DA AMB/GIRASSOL TEM QUE RESPEITAR A COTA.
//
// Ele NÃO passava por fila nenhuma: batia direto, tomava 429, esperava 1,5s
// fixo e batia de novo. A AMB nunca incomodou (volume baixo); a Girassol tem o
// dobro e saturou o Bling dela no 1º pré-aquecimento — o log encheu de 429.
//
// 📌 E a cota do Bling é DA CONTA. Uma fila por empresa, cada uma com seu
// limite — não a fila da GOOD, que é singleton com a conta cravada.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { criarRitmo } = require('../lib/ritmo-por-empresa');

// ⚠️ b445 - para testar `chamarBling` de verdade (nao so grep de fonte),
// troco o `axios` no cache do require ANTES do 1o `require('bling-AMB')`
// deste processo — e o `tokenLeitor.resolverToken`, que senao tentaria
// falar com o Render de verdade. `chamarBling` E a funcao com o bug (dois
// `if (status === 429)` avisando o mesmo erro); mockar so ele, como os
// outros testes fazem, escondia justamente o codigo que preciso exercitar.
const axiosPath = require.resolve('axios');
let respostasAxios = [];
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: () => {
    const proxima = respostasAxios.shift();
    if (!proxima) return Promise.resolve({ status: 200, data: { data: [] } });
    return proxima.erro ? Promise.reject(proxima.erro) : Promise.resolve(proxima.ok);
  },
};
const tokenLeitorAMB = require('../lib/token-leitor');
tokenLeitorAMB.resolverToken = async () => ({ usar: 'local', access: null });
const blingAMBFactory = require('../amb-devolucoes/lib-AMB/bling-AMB');
const configAMB = require('../amb-devolucoes/config-AMB');
function erro429(retryAfter) {
  const e = new Error('429');
  e.response = { status: 429, headers: retryAfter ? { 'retry-after': String(retryAfter) } : {}, data: {} };
  return e;
}

// ── o ritmo segura no limite ────────────────────────────────────────
(async () => {
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 3 });
    const t0 = Date.now(); const tempos = [];
    for (let i = 0; i < 4; i++) { await r.aguardarVez(); tempos.push(Date.now() - t0); }
    // ⚠️ b443 (Codex, P1): ESPAÇADAS, não rajada. Minha 1ª versão soltava as
    // 3 no mesmo milissegundo — uma rajada no início da janela encosta na
    // anterior e o Bling conta 6 em pouco mais de 1s.
    ok(tempos[1] >= 300 && tempos[2] >= 600 && tempos[3] >= 950,
       `⚠️ as liberacoes sao ESPACADAS (~333ms), nao em rajada (${tempos.join(',')}ms)`);
  }

  // ── interativo passa na frente do fundo ─────────────────────────
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 1 });
    await r.aguardarVez();
    const ordem = [];
    const pF = r.aguardarVez({ fundo: true }).then(() => ordem.push('fundo'));
    await new Promise((x) => setTimeout(x, 30));
    const pI = r.aguardarVez().then(() => ordem.push('interativo'));
    await Promise.all([pF, pI]);
    ok(ordem[0] === 'interativo',
       '⚠️ quem esta na tela passa na frente do indice');
  }

  // ── ⚠️ o 429 pausa PROPORCIONAL, não 60s cegos ──────────────────
  //
  // Dado medido em 28/09 (log da Girassol): o Bling NÃO manda retry-after.
  // Então a pausa é escolha nossa — curta e crescente, não fixa.
  {
    const r = criarRitmo({ nome: 't' });
    ok(r.avisar429() === 1000, '  1o 429 sem retry-after: 1s');
    ok(r.avisar429() === 2000, '  2o seguido: 2s');
    ok(r.avisar429() === 4000, '  3o seguido: 4s (dobra)');
    ok(r.avisar429(7) === 7000, '⚠️ com retry-after do Bling, OBEDECE');
    r.avisarOk();
    ok(r.avisar429() === 1000, '  depois de um OK, zera');
    let teto = 0;
    for (let i = 0; i < 10; i++) teto = r.avisar429();
    ok(teto === 15000, '  e nunca passa de 15s');
  }

  // ── ⚠️ quem estourou o teto NÃO consome vaga ────────────────────
  //
  // Antes o callback expirado ficava na fila, o despachante registrava a
  // liberação e SÓ DEPOIS ele descobria que já tinha desistido — a vaga ia
  // pro lixo e o próximo esperava um intervalo à toa.
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 3, tetoMs: 100 });
    r.avisar429(1);   // pausa 1s: os 2 abaixo vão estourar o teto de 100ms
    const a = r.aguardarVez().catch(() => 'estourou');
    const b = r.aguardarVez().catch(() => 'estourou');
    await Promise.all([a, b]);
    // ao sair da pausa, o próximo pedido deve ser atendido sem pagar por eles
    await new Promise((x) => setTimeout(x, 1000));
    const antes = r.estado().liberadas;
    await r.aguardarVez();
    ok(r.estado().liberadas === antes + 1,
       '⚠️ os 2 expirados NAO contaram como liberacao (so o vivo contou)');
  }

  // ── o teto de espera não prende ninguém pra sempre ──────────────
  {
    const r = criarRitmo({ nome: 't', limitePorSegundo: 1, tetoMs: 300 });
    await r.aguardarVez();
    r.avisar429(5);   // pausa 5s, teto 300ms
    let estourou = false;
    try { await r.aguardarVez(); } catch (e) { estourou = !!e.filaEstourou; }
    ok(estourou, '⚠️ passou do teto: rejeita com `filaEstourou` (nao prende)');
  }

  // ── ⚠️ e o cliente da AMB USA o ritmo ────────────────────────────
  {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8');
    const semCom = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/ritmo-por-empresa/.test(semCom), '⚠️ o bling-AMB cria o ritmo dele');
    ok(/nome: CHAVE_TOKEN \+ '\/bling'/.test(semCom),
       '  com o nome da EMPRESA (uma fila por conta)');
    ok(/await ritmo\.aguardarVez\(\{ fundo: !!opcoes\.fundo \}\)/.test(semCom),
       '⚠️ e pede a vez ANTES de chamar');
    ok(/ritmo\.avisar429\(/.test(semCom), '  e avisa o ritmo no 429');
    ok(!/await sleep\(1500\);/.test(semCom),
       '⚠️ e o sleep(1500) fixo SAIU (era o martelo)');
    ok(/estadoRitmo/.test(semCom), '  e expoe o estado (pro /status)');

    // ⚠️ b443 (Codex, P1): TODO 429 avisa — semRetentativa, retry do 401,
    // 2º 429 seguido. Um 429 que a fila não vê é um 429 que se repete.
    const avisos = (semCom.match(/ritmo\.avisar429\(/g) || []).length;
    ok(avisos >= 4, `⚠️ o 429 avisa o ritmo em TODOS os caminhos (${avisos} pontos, era 1)`);

    // e o retry pós-401 passa pela fila
    const i401 = semCom.indexOf('if (status === 401)');
    const bloco401 = semCom.slice(i401, semCom.indexOf('if (status === 429)', i401));
    ok(/await ritmo\.aguardarVez/.test(bloco401),
       '⚠️ o retry pos-401 pede a VEZ (nao chama fazer() direto)');
  }

  // ── ⚠️ o pré-aquecimento entra como FUNDO ────────────────────────
  //
  // Ninguém na AMB passava `fundo: true` — tudo entrava como interativo, e o
  // índice de 8.000 notas competia de igual com o clique do estoquista.
  {
    const nomes = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'), 'utf8');
    ok(/chamarBling\(`\/nfe[^`]*`, \{ fundo: deFundo/.test(nomes),
       '⚠️ a varredura de nomes passa `fundo` pro cliente');
    // ⚠️ b443 (Codex, P2), 2a rodada: o apontamento citou 3 chamadas de
    // `chamarBling` neste laco (NFs x2 + vendas) — a 1a rodada consertou so
    // as duas de `/nfe` e a de `/pedidos/vendas` ficou de fora, sem `fundo`
    // nenhum. VARREDURA das 3, uma por uma, pra nao repetir: quem chamar de
    // novo sem `fundo` acusa aqui, nao so grep pontual.
    {
      const iFn = nomes.indexOf('async function construirIndiceInterno(opts = {}) {');
      const iFim = nomes.indexOf('async function buscarPorNome(', iFn);
      ok(iFn >= 0 && iFim > iFn, '  achei os marcadores de construirIndiceInterno');
      const corpo = nomes.slice(iFn, iFim);
      const chamadas = [...corpo.matchAll(/bling\.chamarBling\([^)]*\)/gs)];
      ok(chamadas.length === 4,   // b589: NFs x2 + pagina-sentinela do teto + vendas
         `  as 4 chamadas do laco de construcao (achei ${chamadas.length})`);
      const semFundo = chamadas.filter((m) => !/fundo/.test(m[0]));
      ok(semFundo.length === 0,
         '⚠️ TODAS as chamadas do laco (NFs e vendas) passam `fundo`'
         + (semFundo.length ? ' (SEM fundo: ' + semFundo.map((m) => m[0]).join(' | ') + ')' : ''));
    }
    const ent = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-entrada-AMB.js'), 'utf8');
    ok(/chamarBling\(`\/nfe[^`]*`, \{ fundo: true/.test(ent),
       '  e a de notas de entrada tambem');

    // e o identificar não pede mais vez na fila da GOOD
    const ident = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
    const identSem = ident.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(!/ritmoBling\.aguardarVez/.test(identSem),
       '⚠️ o identificar NAO pede mais vez na fila singleton da GOOD');
  }

  // ── ⚠️ b445 (Codex, P2) - um 429 SO avisa o ritmo UMA vez ───────────
  //
  // O conserto do b443 (avisar mesmo com `semRetentativa`) virou um NOVO
  // bug: uma chamada NORMAL (sem `semRetentativa`) avisava no bloco de
  // cima E DE NOVO no bloco de baixo, pro MESMO erro — 1 HTTP 429 contava
  // como 2, e o backoff pulava de 1s pra 2s num 429 so.
  {
    const bling = blingAMBFactory.criar(configAMB);
    respostasAxios = [
      { erro: erro429() },                          // 1a tentativa: 429
      { ok: { status: 200, data: { data: [] } } },   // retry (dentro do proprio chamarBling): OK
    ];
    const r = await bling.chamarBling('/teste-429-unico');
    ok(r.ok === true, '⚠️ chamarBling se recupera sozinho depois de 1 429');
    ok(bling.estadoRitmo().pausas429 === 1,
       `⚠️ um 429 SO avisa o ritmo 1 vez (pausas429=${bling.estadoRitmo().pausas429}, era 2)`);
  }

  // ── e com `semRetentativa`, o 429 ainda avisa (o P1 original) ───────
  {
    const bling = blingAMBFactory.criar(configAMB);
    respostasAxios = [{ erro: erro429() }];
    const r = await bling.chamarBling('/teste-429-semretentativa', { semRetentativa: true });
    ok(r.ok === false && r.status === 429, '  semRetentativa devolve a falha sem tentar de novo');
    ok(bling.estadoRitmo().pausas429 === 1,
       '  ⚠️ e MESMO ASSIM avisa o ritmo (nao regride o P1 do b443)');
  }

  // ── ⚠️ b445 (Codex, P1) - cancelamento ANTES de sair da fila ────────
  //
  // No identificar-AMB.js, o `desistiu.agora` so valia se checado ANTES da
  // chamada esperar a vez na fila da empresa — senao um candidato que
  // "desistiu" (timeout de 5s da corrida) ainda saia pro Bling depois de
  // esperar minutos numa pausa de 429, gastando cota que ja não importava
  // pra ninguem. A GOOD resolve isso esperando a vez FORA (`ritmoBling.
  // aguardarVez()`) e SO DEPOIS checando `desistiu` — o mesmo desenho tem
  // que valer aqui, com a fila DESTA empresa.
  {
    const ident = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
    const iBloco = ident.indexOf('const desistiu = { agora: false };');
    const iFim = ident.indexOf('new Promise((ok) => setTimeout(() => { desistiu.agora = true;', iBloco);
    ok(iBloco >= 0 && iFim > iBloco, '  achei os marcadores do bloco de corrida (Promise.race)');
    const bloco = ident.slice(iBloco, iFim);
    const iEspera = bloco.indexOf('await aguardarVezBling()');
    const iCheca = bloco.indexOf('if (desistiu.agora) return { _tarde: true };');
    ok(iEspera >= 0 && iCheca > iEspera,
       '⚠️ espera a vez na fila da empresa ANTES de checar `desistiu` (nao depois)');
    ok(/buscarNFePorId\(c\.id, \{ semRitmo: true \}\)/.test(bloco),
       '  e pula a espera DE DENTRO do chamarBling (semRitmo) — so espera 1 vez');

    // e a fila usada e a DESTA empresa (exposta pelo cliente Bling), nao a
    // GOOD: `bling.aguardarVez` -> injetada como `aguardarVezBling` nas
    // deps do registrarIdentificar.
    const app = fs.readFileSync(
      path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
    ok(/aguardarVezBling: bling\.aguardarVez/.test(app),
       '  a fila injetada e a do cliente Bling DESTA empresa (bling.aguardarVez)');
    ok(/aguardarVez: \(opcoes\) => ritmo\.aguardarVez\(opcoes\)/.test(
       fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'bling-AMB.js'), 'utf8')),
       '  e o cliente expoe a fila DELE (nao um singleton emprestado)');

    // ⚠️ e o adaptador cru precisa REPASSAR opcoes, senao `semRitmo` (e
    // `fundo`, e qualquer outra) morre silenciosa no meio do caminho — foi
    // exatamente essa a causa do P2 anterior (b443) com o `semRitmo` velho.
    ok(/const nfePorIdCru = \(id, opcoes\) => bling\.chamarBling\(`\/nfe\/\$\{id\}`, opcoes\)/.test(app),
       '⚠️ o adaptador `nfePorIdCru` repassa `opcoes` (nao descarta o 2o argumento)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
