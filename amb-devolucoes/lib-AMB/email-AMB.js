// ============================================================
// amb-devolucoes/lib-AMB/email-AMB.js          (AMB Devol. b14)
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
// b14 — o Diego criou as variaveis com os nomes da familia do
// Mover-Pedidos (AMBBKP_SMTP_*), que e como o SMTP da AMB ja se
// chama no resto do ecossistema. Em vez de obriga-lo a renomear,
// o codigo aceita AS DUAS familias — e assim os nomes ficam
// iguais nos dois servicos, uma coisa a menos pra decorar:
//
//     AMB_EMAIL_HOST  ou  AMBBKP_SMTP_HOST   (br226.hostgator.com.br)
//     AMB_EMAIL_PORT  ou  AMBBKP_SMTP_PORT   (HostGator: 465)
//     AMB_EMAIL_USER  ou  AMBBKP_SMTP_USER   (o e-mail completo)
//     AMB_EMAIL_PASS  ou  AMBBKP_SMTP_PASS   (senha da caixa)
//     AMB_EMAIL_PARA  ou  AMBBKP_SMTP_PARA   (opcional; destino)
//
// Se as duas existirem, AMB_EMAIL_* vence.
// As vars EMAIL_* (da GOOD) NUNCA sao lidas aqui.
//
// Envio e "fire and forget": falha de e-mail NUNCA derruba a
// triagem — no maximo sai um aviso no log.
// ============================================================

'use strict';

let mailer = null;
let motivoDesligado = null;

const pega = (a, b) => process.env[a] || process.env[b] || '';

function credenciais() {
  const host = pega('AMB_EMAIL_HOST', 'AMBBKP_SMTP_HOST');
  const user = pega('AMB_EMAIL_USER', 'AMBBKP_SMTP_USER');
  const pass = pega('AMB_EMAIL_PASS', 'AMBBKP_SMTP_PASS');
  if (!host || !user || !pass) return null;      // sem conta da AMB = desligado
  return { host, user, pass, port: Number(pega('AMB_EMAIL_PORT', 'AMBBKP_SMTP_PORT') || 587) };
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
  return pega('AMB_EMAIL_PARA', 'AMBBKP_SMTP_PARA') || (c && c.user) || null;
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
    falta: c ? null : 'AMBBKP_SMTP_HOST, AMBBKP_SMTP_USER e AMBBKP_SMTP_PASS (ou a familia AMB_EMAIL_*) no Render',
    observacao: 'este modulo nunca usa a conta de e-mail da GOOD',
  };
}

module.exports = {
  avisarProblema,
  ligado: () => !!credenciais(),
  destino,
  diagnostico,
};
