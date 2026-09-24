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
 * próprio, freio por env, estado no /health); a minha trouxe dois cuidados
 * que ela perdia — o 503 que EXPLICA e a derrubada quando nenhuma monta.
 * Nenhuma das duas sozinha cobria o caso inteiro.
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

  // ⚠️ SE NENHUMA MONTOU, O PROCESSO NÃO TEM RAZÃO DE EXISTIR.
  //
  // Servir um app vazio que responde 200 no /health é PIOR que cair: o Render
  // acha que está tudo bem, não reinicia, e ninguém percebe até alguém abrir
  // a tela. Melhor morrer alto e deixar o Render tentar de novo.
  //
  // 📌 Só conta FALHA. Se todas foram desativadas por env, isso é escolha do
  // dono — não derruba.
  if (falhou.length && !montadas.length) {
    throw new Error('[devolucoes] NENHUMA empresa montou: '
      + falhou.map((f) => `${f.chave} (${f.erro})`).join(' | '));
  }

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
