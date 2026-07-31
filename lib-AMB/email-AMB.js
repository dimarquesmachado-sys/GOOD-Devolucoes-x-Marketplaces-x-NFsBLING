// ============================================================
// amb-devolucoes/lib-AMB/email-AMB.js          (AMB Devol. b11)
// ------------------------------------------------------------
// Aviso por e-mail quando o galpao reporta PROBLEMA.
//
// Usa o MESMO transporte da GOOD: EMAIL_HOST / EMAIL_USER /
// EMAIL_PASS ja existem neste servico do Render. A unica var
// opcional nova e AMB_EMAIL_PARA (destino); sem ela, vai pro
// mesmo EMAIL_PARA da GOOD.
//
// Envio e "fire and forget": falha de e-mail NUNCA derruba a
// triagem — no maximo sai um aviso no log.
// ============================================================

'use strict';

let mailer = null;
let motivoDesligado = null;

function transporte() {
  if (mailer || motivoDesligado) return mailer;
  const HOST = process.env.EMAIL_HOST, USER = process.env.EMAIL_USER, PASS = process.env.EMAIL_PASS;
  if (!HOST || !USER || !PASS) {
    motivoDesligado = 'EMAIL_HOST/USER/PASS ausentes no servico';
    console.log('[AMB/EMAIL] desligado -', motivoDesligado);
    return null;
  }
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: Number(process.env.EMAIL_PORT || 587) === 465,
      auth: { user: USER, pass: PASS },
    });
  } catch (e) {
    motivoDesligado = e.message;
  }
  return mailer;
}

const PARA = () => process.env.AMB_EMAIL_PARA || process.env.EMAIL_PARA || process.env.EMAIL_USER;

/** Problema reportado na triagem -> e-mail pro Diego. */
function avisarProblema(d) {
  const t = transporte();
  if (!t) return;
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
    from: `"Devolucoes AMBTotal" <${process.env.EMAIL_USER}>`,
    to: PARA(),
    subject: `[AMB] Problema na devolucao${d.produto_sku ? ' - ' + d.produto_sku : ''}`,
    text: linhas.join('\n'),
  }).then(() => console.log('[AMB/EMAIL] aviso de problema enviado'))
    .catch(e => console.warn('[AMB/EMAIL] falhou (triagem seguiu normal):', e.message));
}

module.exports = {
  avisarProblema,
  ligado: () => !!transporte(),
  destino: PARA,
};
