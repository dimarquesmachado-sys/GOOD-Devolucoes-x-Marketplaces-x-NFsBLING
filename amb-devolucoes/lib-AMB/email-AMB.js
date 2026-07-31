// ============================================================
// amb-devolucoes/lib-AMB/email-AMB.js          (AMB Devol. b13)
// ------------------------------------------------------------
// Aviso por e-mail quando o galpao reporta PROBLEMA.
//
// REGRA DO DIEGO (31/07, sem excecao): empresa separada,
// e-mail separado. O aviso da AMB sai SOMENTE pela conta da
// AMBTotal. NAO EXISTE plano B pela conta da GOOD — enquanto
// as credenciais da AMB nao estiverem no Render, o e-mail fica
// DESLIGADO (a triagem funciona normal, so nao avisa por
// e-mail) e o /amb/config diz exatamente o que falta.
//
// Variaveis (servico GOOD-Devolucoes-x-Marketplaces-x-NFsBLING,
// aba Environment):
//     AMB_EMAIL_HOST   ex: smtp.gmail.com
//     AMB_EMAIL_PORT   opcional (padrao 587)
//     AMB_EMAIL_USER   o endereco da AMBTotal
//     AMB_EMAIL_PASS   SENHA DE APP (nao a senha normal)
//     AMB_EMAIL_PARA   opcional (quem recebe; sem ela, o aviso
//                      vai pro proprio AMB_EMAIL_USER)
//
// As vars EMAIL_* (da GOOD) NUNCA sao lidas aqui.
//
// Envio e "fire and forget": falha de e-mail NUNCA derruba a
// triagem — no maximo sai um aviso no log.
// ============================================================

'use strict';

let mailer = null;
let motivoDesligado = null;

function credenciais() {
  const host = process.env.AMB_EMAIL_HOST;
  const user = process.env.AMB_EMAIL_USER;
  const pass = process.env.AMB_EMAIL_PASS;
  if (!host || !user || !pass) return null;      // sem conta da AMB = desligado
  return { host, user, pass, port: Number(process.env.AMB_EMAIL_PORT || 587) };
}

function transporte() {
  if (mailer || motivoDesligado) return mailer;
  const c = credenciais();
  if (!c) {
    motivoDesligado = 'faltam AMB_EMAIL_HOST / AMB_EMAIL_USER / AMB_EMAIL_PASS no Render';
    console.log('[AMB/EMAIL] desligado -', motivoDesligado);
    return null;
  }
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
    });
    console.log(`[AMB/EMAIL] ligado - conta da AMBTotal (${c.user})`);
  } catch (e) {
    motivoDesligado = e.message;
  }
  return mailer;
}

function destino() {
  const c = credenciais();
  return process.env.AMB_EMAIL_PARA || (c && c.user) || null;
}

/** Problema reportado na triagem -> e-mail pro Diego. */
function avisarProblema(d) {
  const t = transporte();
  if (!t) return;                                 // desligado: segue sem e-mail
  const c = credenciais();
  const linhas = [
    `Funcionario: ${d.funcionario || '?'}`,
    d.marketplace ? `Marketplace: ${d.marketplace}` : null,
    d.buyer_nome ? `Cliente: ${d.buyer_nome}` : null,
    d.nf_numero ? `NF: ${d.nf_numero}` : null,
    d.order_id ? `Pedido: ${d.order_id}` : null,
    d.produto_sku ? `SKU: ${d.produto_sku}` : null,
    d.defeito_qtd ? `Quantidade: ${d.defeito_qtd}` : null,
    d.localizacao ? `Guardado em: ${d.localizacao}` : null,
    '',
    `Problema: ${d.problema_descricao || '(sem descricao)'}`,
  ].filter(x => x !== null);

  t.sendMail({
    from: `"Devolucoes AMBTotal" <${c.user}>`,
    to: destino(),
    subject: `[AMB] Problema na devolucao${d.produto_sku ? ' - ' + d.produto_sku : ''}`,
    text: linhas.join('\n'),
  }).then(() => console.log('[AMB/EMAIL] aviso de problema enviado'))
    .catch(e => console.warn('[AMB/EMAIL] falhou (triagem seguiu normal):', e.message));
}

/** Pro /amb/config: estado real, sem expor senha. */
function diagnostico() {
  const c = credenciais();
  return {
    ligado: !!c,
    conta: c ? 'AMBTotal (propria)' : null,
    remetente: c ? c.user : null,
    destino: destino(),
    falta: c ? null : 'AMB_EMAIL_HOST, AMB_EMAIL_USER e AMB_EMAIL_PASS no Render (senha de APP)',
    observacao: 'este modulo nunca usa a conta de e-mail da GOOD',
  };
}

module.exports = {
  avisarProblema,
  ligado: () => !!credenciais(),
  destino,
  diagnostico,
};
