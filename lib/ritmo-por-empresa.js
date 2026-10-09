'use strict';
/* ============================================================
 * lib/ritmo-por-empresa.js
 * ------------------------------------------------------------
 * RITMO DE CHAMADAS AO BLING, UMA FILA POR EMPRESA.
 *
 * ⚠️ POR QUE EXISTE
 *
 * O cliente do Bling da AMB — que a Girassol também usa — NÃO passava por
 * fila nenhuma: batia direto, tomava 429, esperava 1,5s fixo e tentava de
 * novo. Um martelo. A AMB nunca incomodou porque tem volume baixo; a Girassol
 * tem o dobro (445 devoluções, 8.000 notas no índice) e saturou o Bling dela
 * no primeiro pré-aquecimento — o log encheu de `429`.
 *
 * O ritmo da GOOD (`lib/ritmo-bling.js`) é um SINGLETON amarrado ao porteiro
 * central, que tem a conta cravada em 'good'. Reaproveitá-lo mandaria a
 * Girassol pedir vez na cota da GOOD. Então este aqui é uma FÁBRICA: uma
 * fila por empresa, cada uma com o seu limite.
 *
 * 📌 O QUE ELE FAZ
 *
 *   - no máximo N chamadas por segundo por empresa (padrão 3, a cota do Bling)
 *   - interativo (alguém esperando na tela) passa na frente de fundo (índice,
 *     pré-aquecimento)
 *   - quando um 429 chega, a fila PAUSA — e o dado de hoje diz que o Bling
 *     NÃO manda retry-after, então a pausa é nossa: curta e proporcional,
 *     não 60s cegos
 *   - teto de espera: ninguém fica preso na fila para sempre
 *
 * ⚠️ O que ele NÃO faz: não fala com o porteiro central do Mover-Pedidos. A
 * cota do Bling é DA CONTA, e o Mover-Pedidos também consome a da Girassol —
 * somar os dois é o passo seguinte, quando o porteiro aceitar a conta certa.
 * Este módulo tira o martelo; não resolve a soma.
 * ============================================================ */

function criarRitmo(cfg = {}) {
  const NOME = String(cfg.nome || 'bling');
  const LIMITE = Math.max(1, Number(cfg.limitePorSegundo || 3));
  const JANELA_MS = 1000;
  const TETO_MS = Number(cfg.tetoMs || 120000);

  let liberadas = [];          // instantes das últimas liberações
  // ⚠️ b443 (Codex, P1) - ESPAÇAR, NÃO RAJADA. Minha 1ª versão liberava as 3
  // vagas de uma vez via setImmediate: três chamadas no mesmo milissegundo.
  // O Bling conta por janela deslizante, e uma rajada no início da janela
  // seguinte encosta na anterior — 6 em pouco mais de 1s = 429. O ritmo da
  // GOOD já espaçava (`INTERVALO_MIN_MS`); eu deixei isso de fora.
  const INTERVALO_MIN_MS = Math.round(JANELA_MS / LIMITE);
  let ultimaLiberacao = 0;
  const filaInterativa = [];
  const filaDeFundo = [];
  let despachando = false;
  let pausaAte = 0;
  let pausaFundoAte = 0;
  let stats = { liberadas: 0, pausas429: 0, estouros: 0 };
  // b577 - PORTEIRO CENTRAL (Mover-Pedidos /bling-ritmo) na conta DESTA empresa: antes de liberar uma vaga, pede a vez
  // (operacao ou fundo); 429 e ok viajam pra la com a origem. Sem cfg.contaPorteiro (ou porteiro desligado), so o
  // ritmo local, como antes. Porteiro fora do ar/mal configurado -> 'local' (o porteiro abre o circuito sozinho).
  const porteiro = cfg.contaPorteiro ? require('./ritmo-porteiro').criarPorteiro({ conta: cfg.contaPorteiro }) : null;

  // Codex #466 (P1): DUAS pausas locais, espelhando o porteiro central. 429 de FUNDO pausa so o fundo; a operacao
  // (alguem na tela) so para por 429 de operacao. O fundo respeita as duas.
  const pausaDa = (ehOperacao) => (ehOperacao ? pausaAte : Math.max(pausaAte, pausaFundoAte));
  function podeAgora(ehOperacao) {
    const agora = Date.now();
    if (agora < pausaDa(ehOperacao)) return false;
    if (agora - ultimaLiberacao < INTERVALO_MIN_MS) return false;   // espaça
    liberadas = liberadas.filter((t) => agora - t < JANELA_MS);
    return liberadas.length < LIMITE;
  }

  function esperaAte(ehOperacao) {
    const agora = Date.now();
    if (agora < pausaDa(ehOperacao)) return pausaDa(ehOperacao) - agora;
    const porIntervalo = Math.max(0, ultimaLiberacao + INTERVALO_MIN_MS - agora);
    if (!liberadas.length) return porIntervalo;
    const porJanela = Math.max(0, liberadas[0] + JANELA_MS - agora + 5);
    return Math.max(porIntervalo, porJanela > 0 && liberadas.length >= LIMITE ? porJanela : 0);
  }

  // Codex #466 (P2): o despachante dorme num timer que uma OPERACAO nova pode acordar (como em lib/ritmo-bling.js);
  // sem isso ela herdava a espera de um item de fundo (ate 5s do `esperar_ms` do porteiro).
  let timerPasso = null;
  const dormir = (ms) => { timerPasso = setTimeout(() => { timerPasso = null; passo(); }, ms); };

  function passo() {
    // ⚠️ interativo SEMPRE antes de fundo: quem está na tela não espera o
    // índice terminar.
    const ehOperacao = filaInterativa.length > 0;
    const fila = ehOperacao ? filaInterativa : filaDeFundo;
    if (!fila.length) { despachando = false; return; }
    if (!podeAgora(ehOperacao)) { dormir(esperaAte(ehOperacao)); return; }
    if (porteiro && porteiro.LIGADO) {
      porteiro.pedirPermissao(ehOperacao ? 'operacao' : 'fundo').then((perm) => {
        if (perm && perm.via === 'espere') { dormir(Math.max(5, Math.min(perm.ms || 250, 5000))); return; }
        // Codex #466 (P1): a pausa local pode ter nascido (429 de outra chamada em voo) ENQUANTO esperava o porteiro.
        if (!podeAgora(ehOperacao)) { dormir(esperaAte(ehOperacao)); return; }
        liberarProximo(fila);
      }, () => liberarProximo(fila));   // erro inesperado: segue no ritmo local (nunca trava a fila)
      return;
    }
    liberarProximo(fila);
  }

  function liberarProximo(fila) {
    if (!fila.length) { despachando = false; return; }
    const proximo = fila.shift();
    // ⚠️ b443 (Codex, P2) - QUEM JÁ ESTOUROU O TETO NÃO CONSOME VAGA. Antes
    // eu registrava a liberação e SÓ DEPOIS o callback descobria que já
    // tinha desistido — a vaga ia pro lixo e o próximo esperava mais um
    // intervalo à toa. `liberar()` devolve false quando o crachá já saiu.
    const usou = proximo();
    if (!usou) { setImmediate(passo); return; }   // vaga não gasta: tenta o próximo
    const agora = Date.now();
    liberadas.push(agora);
    ultimaLiberacao = agora;
    stats.liberadas++;
    dormir(INTERVALO_MIN_MS);   // espaçado, não setImmediate
  }

  function despachar() {
    if (despachando) return;
    despachando = true;
    passo();
  }

  /**
   * Espera a vez. Rejeita (com `filaEstourou`) se passar do teto.
   */
  function aguardarVez(opcoes = {}) {
    return new Promise((liberar, falhar) => {
      let saiu = false;
      const cracha = () => { if (saiu) return true; saiu = true; return false; };
      const fila = opcoes.fundo ? filaDeFundo : filaInterativa;
      const t = setTimeout(() => {
        if (cracha()) return;
        // Codex #466 (P2): sai da fila ao estourar — callback vencido nao pode gastar vaga do porteiro central.
        const i = fila.indexOf(entrada);
        if (i >= 0) fila.splice(i, 1);
        stats.estouros++;
        const e = new Error(`[${NOME}] espera na fila passou de ${TETO_MS / 1000}s`);
        e.filaEstourou = true;
        falhar(e);
      }, TETO_MS);
      const entrada = () => {
        if (cracha()) return false;   // já estourou: NÃO consumiu a vaga
        clearTimeout(t);
        liberar();
        return true;
      };
      fila.push(entrada);
      // operacao nova acorda o despachante que dorme (se ha pedido ao porteiro em voo, ele mesmo reavalia ao voltar)
      if (!opcoes.fundo && timerPasso) { clearTimeout(timerPasso); timerPasso = null; passo(); return; }
      despachar();
    });
  }

  /**
   * ⚠️ O 429 chegou. Pausa a fila — MAS proporcional, não 60s cegos.
   *
   * O dado medido em 28/09 (log da Girassol): o Bling NÃO manda `retry-after`.
   * Então a pausa é escolha nossa. Com o limite sendo por segundo, esperar 1
   * janela inteira já basta para a cota "esvaziar"; cada 429 seguido dobra,
   * até um teto, porque 429 em sequência é sinal de que outro processo (o
   * Mover-Pedidos, na mesma conta) também está consumindo.
   */
  let seguidos429 = 0;
  function avisar429(retryAfterS, prioridade) {
    if (porteiro && porteiro.LIGADO) porteiro.avisar429(retryAfterS, prioridade === 'fundo' ? 'fundo' : 'operacao').catch(() => {});   // b577
    stats.pausas429++;
    seguidos429++;
    const base = Number(retryAfterS) > 0
      ? Number(retryAfterS) * 1000                       // o Bling mandou: obedece
      : Math.min(JANELA_MS * Math.pow(2, seguidos429 - 1), 15000);  // 1s, 2s, 4s… até 15s
    // Codex #466 (P1): 429 de fundo so pausa o fundo localmente (o central ja separa as duas).
    if (prioridade === 'fundo') pausaFundoAte = Math.max(pausaFundoAte, Date.now() + base);
    else pausaAte = Math.max(pausaAte, Date.now() + base);
    return base;
  }
  // Codex #466 (P2): sucesso de OPERACAO nao cancela pausa de FUNDO (nem local, nem no porteiro); sucesso de fundo limpa as duas.
  function avisarOk(prioridade) {
    seguidos429 = 0;
    if (prioridade === 'fundo') pausaFundoAte = 0;
    pausaAte = 0;
    if (porteiro && porteiro.LIGADO) porteiro.avisarOk(prioridade === 'fundo' ? 'fundo' : 'operacao').catch(() => {});   // b577
  }

  function estado() {
    return {
      nome: NOME,
      limite_por_segundo: LIMITE,
      na_fila: { interativa: filaInterativa.length, fundo: filaDeFundo.length },
      pausa_ativa: Date.now() < pausaAte,
      pausa_termina_em_s: Math.max(0, Math.round((pausaAte - Date.now()) / 1000)),
      pausa_fundo_termina_em_s: Math.max(0, Math.round((pausaFundoAte - Date.now()) / 1000)),
      seguidos_429: seguidos429,
      porteiro: porteiro ? porteiro.diagnostico() : null,   // b577
      ...stats,
    };
  }

  // 09/10 - o estado do porteiro central desta conta (quem consome a cota), pra rota de admin
  const estadoPorteiro = () => (porteiro ? porteiro.estadoDaConta() : Promise.resolve({ ok: false, erro: 'esta empresa nao usa o porteiro' }));
  return { aguardarVez, avisar429, avisarOk, estado, estadoPorteiro, LIMITE };
}

module.exports = { criarRitmo };
