'use strict';
/* ============================================================
 * lib/montagem-empresas.js
 * ------------------------------------------------------------
 * MONTA CADA EMPRESA COMO UMA UNIDADE DE FALHA.
 *
 * ⚠️ POR QUE EXISTE
 *
 * Antes, `criarApp` lançando derrubava o BOOT INTEIRO: a GOOD e a AMB — que
 * estão no ar atendendo — ficavam fora por causa de uma env faltando na
 * empresa NOVA. Já aconteceu: em 18/09 o deploy falhou 3× por falta do
 * `AMB_SESSION_SECRET` e o serviço ficou 7 versões atrasado sem ninguém
 * notar.
 *
 * A empresa que quebra é sempre a que está sendo ligada; quem pagava eram as
 * que já funcionavam.
 *
 * 📌 ESTE ARQUIVO JUNTA DUAS VERSÕES. A do Codex trouxe a estrutura (módulo
 * próprio, freio por env, estado no /health); a minha trouxe um cuidado que
 * ela perdia — o 503 que EXPLICA, em vez de 404.
 *
 * ⚠️ (achado do Codex, P1, revisão desta mesma peça) - eu tinha trazido um
 * SEGUNDO cuidado, "derruba o processo se nenhuma empresa montar" — mas
 * `empresas` aqui é só as de FORA (a AMB, e um dia a Girassol); a GOOD é o
 * host que chama este módulo e nunca entra nessa lista. Com uma única
 * empresa ativa (o caso de hoje), a falha dela batia a condição de "nenhuma
 * montou" e derrubava o PROCESSO INTEIRO — o mesmo incidente de 18/09 que
 * este módulo existe pra evitar. Esse cuidado saiu: ver o comentário dentro
 * de `montarEmpresas`, no ponto onde ele lançava.
 * ============================================================ */

const estados = [];

function nomeFreio(chave) {
  return 'DEVOLUCOES_DESATIVAR_' + String(chave || '').toUpperCase();
}

/**
 * ⚠️ O freio por env é o "desligar sem deploy": muda a variável no Render e a
 * empresa não monta no processo novo.
 *
 * 📌 NÃO é desligamento instantâneo: o Render reinicia o serviço ao trocar a
 * env, então o processo ATUAL segue servindo até o reinício terminar. Dizer
 * "desliga na hora" seria promessa que o Render não cumpre.
 */
function freada(chave, ambiente = process.env) {
  return /^(1|true|sim|on)$/i.test(String(ambiente[nomeFreio(chave)] || '').trim());
}

function mensagemErro(erro) {
  return String((erro && erro.message) || erro || 'falha desconhecida').slice(0, 200);
}

/**
 * A resposta da base de uma empresa que não está servindo.
 *
 * ⚠️ 503, NÃO 404. Sem isto a rota não existe, e 404 manda o dono procurar no
 * lugar errado: parece que a empresa nunca foi configurada, quando ela falhou
 * por um motivo que está no log.
 *
 * ⚠️ E O CORPO NÃO LEVA A EXCEÇÃO (apontamento do Codex, e procede). Esta
 * rota fica ANTES do login — qualquer um a alcança. `GIRASSOL_SESSION_SECRET
 * ausente` no corpo entrega o nome da env e o desenho interno a quem só
 * precisava saber que a empresa não está no ar.
 *
 * 📌 O motivo continua inteiro em 2 lugares certos: o log do boot e o
 * /health, que é onde o dono olha.
 */
function rotaIndisponivel(chave, estado) {
  return (req, res) => res.status(503).json({
    ok: false,
    empresa: chave,
    estado,
    erro: estado === 'desativada_por_env'
      ? 'empresa desativada operacionalmente'
      : 'empresa indisponivel porque falhou ao iniciar',
  });
}

/**
 * Monta as empresas, cada uma no próprio contorno.
 *
 * @throws quando NENHUMA das empresas ativas sobe — ver abaixo.

 * Monta as empresas, cada uma no próprio contorno. Nunca lança: uma falha
 * (de uma, de todas, tanto faz) só encolhe o alcance dela mesma — ver
 * comentário abaixo, no ponto onde a versão anterior lançava.
 */
function montarEmpresas({ app, empresas, criarApp, ambiente = process.env, logger = console }) {
  estados.length = 0;
  const lista = empresas || [];

  for (const empresa of lista) {
    const base = { chave: empresa.chave, rota: empresa.rota };

    if (freada(empresa.chave, ambiente)) {
      estados.push({ ...base, estado: 'desativada_por_env' });
      // ⚠️ a desativada TAMBEM responde 503 (apontamento do Codex): sem isto
      // ela dava 404 e parecia nunca ter existido, quando foi VOCE que
      // desligou. Quem abre a tela precisa saber a diferenca.
      app.use(empresa.rota, rotaIndisponivel(empresa.chave, 'desativada_por_env'));
      logger.warn(`[devolucoes] ${empresa.chave} DESATIVADA por ${nomeFreio(empresa.chave)}`);
      continue;
    }

    try {
      // ⚠️ publica a rota SÓ depois que a construção terminou — senão uma
      // falha no meio deixaria meia empresa no ar.
      const router = criarApp(empresa.chave);
      app.use(empresa.rota, router);
      estados.push({ ...base, estado: 'montada' });
      logger.log(`[devolucoes] ${empresa.chave} montada em ${empresa.rota}`);
    } catch (erro) {
      const mensagem = mensagemErro(erro);
      estados.push({ ...base, estado: 'falhou', erro: mensagem });
      logger.error(`[devolucoes] ⚠️ ${empresa.chave} NAO montou; as outras continuam: ${mensagem}`);

      app.use(empresa.rota, rotaIndisponivel(empresa.chave, 'falhou'));
    }
  }

  const montadas = estados.filter((e) => e.estado === 'montada');
  const falhou = estados.filter((e) => e.estado === 'falhou');

  // ⚠️ (achado do Codex, P1) - AQUI HAVIA `if (falhou.length && !montadas.length)
  // throw` — "se nenhuma monta, o processo nao tem razao de existir". Falso
  // pra quem CHAMA este modulo: `empresas` é só as de FORA (a AMB, e um dia a
  // Girassol) — a GOOD é o host (`app`, recebido por parâmetro) e já responde
  // com ou sem nenhuma delas. Hoje `empresas` tem 1 item só (a AMB); se ela
  // falhar (o caso real de 18/09, `AMB_SESSION_SECRET` faltando), o `throw`
  // batia `falhou.length === 1 && !montadas.length` e derrubava o PROCESSO
  // INTEIRO — reproduzindo, ponto por ponto, o incidente que este módulo
  // existe pra evitar. "Servir um app vazio que parece saudável" nunca é o
  // caso aqui: o `app` já tem as rotas do host antes deste módulo rodar.
  //
  // 📌 Uma empresa de fora que falha só encolhe o alcance dela mesma (503,
  // acima). O log abaixo grita quantas ficaram de fora, sem levar o host.
  if (falhou.length) {
    logger.error(`[devolucoes] ⚠️ ${falhou.length} de ${lista.length} empresa(s) `
      + `fora: ${falhou.map((f) => f.chave).join(', ')}`);
  }

  return diagnostico();
}

/** Estado por empresa para o /health. ⚠️ nunca inclui valor de env. */
function diagnostico() {
  return estados.map((item) => ({ ...item }));
}

module.exports = { montarEmpresas, diagnostico, freada, nomeFreio, rotaIndisponivel };
