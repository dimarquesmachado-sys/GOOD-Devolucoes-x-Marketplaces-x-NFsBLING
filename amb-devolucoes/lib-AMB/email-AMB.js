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

// ⚠️ b364 - VIRA FABRICA: o mailer — o aviso sairia com o REMETENTE da outra.
//
// Era instancia unica do processo. Mesma tecnica dos anteriores: envolvo
// SEM REINDENTAR, pra o diff ficar legivel.
//
// ⚠️ As envs com prefixo passam a vir da empresa, com `AMB_` de padrao —
// a AMB le exatamente as mesmas de hoje.
function criar(cfgEmpresa) {
const _PREFIXO = String((cfgEmpresa && cfgEmpresa.PREFIXO_ENV) || 'AMB_');
// nome pro remetente/diagnostico e sigla pro assunto — mesmos valores de
// hoje pra AMB (fallback), derivados da ficha pra qualquer empresa nova.
const NOME_EMPRESA = String((cfgEmpresa && cfgEmpresa.NOME_EMPRESA) || 'AMBTotal');
const SIGLA_EMPRESA = _PREFIXO.replace(/_+$/, '') || 'AMB';
'use strict';

// ⚠️ b347 - gaveta do e-mail. Compartilhado, o aviso de uma empresa
// sairia com o REMETENTE da outra.
// ⚠️ b355 - PASSO 3: fabrica do estado deste modulo.
//
// o mailer — e-mail sairia com o remetente da outra.
//
// Mesma tecnica das fatias 1 e 2: a gaveta continua existindo com o
// mesmo nome, mas NASCE de uma funcao — entao o passo 3 cria uma por
// empresa em vez de uma por processo. Comportamento identico hoje.
function criarEstadoEmail() {
  return {
    mail: {
  mailer: null,
  motivoDesligado: null,
},
  };
}

// ⚠️ a instancia de hoje VEM da fabrica — sem duas fontes do mesmo estado
const _EST = criarEstadoEmail();
const MAIL = _EST.mail;
// (MAIL.mailer -> MAIL.mailer)
// (MAIL.motivoDesligado -> MAIL.motivoDesligado)

const pega = (a, b) => process.env[a] || (b ? process.env[b] : '') || '';

// ⚠️ apontamento do Codex no PR #325 (P1): `credenciais()`/`destino()` liam
// o literal 'AMB_EMAIL_*' direto, ignorando o `_PREFIXO` que a fabrica ja
// calcula — uma 2a empresa sem credencial propria enviaria (e o dono
// receberia) o aviso pela conta da AMBTotal em vez de ficar desligado.
//
// A familia alternativa `AMBBKP_SMTP_*` e nome HISTORICO da propria AMB
// (regra do Diego, ver cabecalho do arquivo) — nao existe padrao
// equivalente pra outra empresa, entao so entra como fallback quando quem
// esta chamando E a AMB. Sem essa guarda, uma empresa nova sem `<PREFIXO>
// EMAIL_*` cairia na conta da AMB em vez de ficar desligada.
const _LEGADO_AMB = _PREFIXO === 'AMB_';

function credenciais() {
  const host = pega(_PREFIXO + 'EMAIL_HOST', _LEGADO_AMB ? 'AMBBKP_SMTP_HOST' : null);
  const user = pega(_PREFIXO + 'EMAIL_USER', _LEGADO_AMB ? 'AMBBKP_SMTP_USER' : null);
  const pass = pega(_PREFIXO + 'EMAIL_PASS', _LEGADO_AMB ? 'AMBBKP_SMTP_PASS' : null);
  if (!host || !user || !pass) return null;      // sem conta da empresa = desligado
  return { host, user, pass, port: Number(pega(_PREFIXO + 'EMAIL_PORT', _LEGADO_AMB ? 'AMBBKP_SMTP_PORT' : null) || 587) };
}

function transporte() {
  if (MAIL.mailer || MAIL.motivoDesligado) return MAIL.mailer;
  const c = credenciais();
  if (!c) {
    MAIL.motivoDesligado = 'faltam ' + _PREFIXO + 'EMAIL_HOST / ' + _PREFIXO + 'EMAIL_USER / '
      + _PREFIXO + 'EMAIL_PASS no Render';
    console.log('[AMB/EMAIL] desligado -', MAIL.motivoDesligado);
    return null;
  }
  try {
    const nodemailer = require('nodemailer');
    MAIL.mailer = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
    });
    console.log(`[AMB/EMAIL] ligado - conta da ${NOME_EMPRESA} (${c.user})`);
  } catch (e) {
    MAIL.motivoDesligado = e.message;
  }
  return MAIL.mailer;
}

function destino() {
  const c = credenciais();
  return pega(_PREFIXO + 'EMAIL_PARA', _LEGADO_AMB ? 'AMBBKP_SMTP_PARA' : null) || (c && c.user) || null;
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
    from: `"Devolucoes ${NOME_EMPRESA}" <${c.user}>`,
    to: destino(),
    subject: `[${SIGLA_EMPRESA}] Problema na devolucao${d.produto_sku ? ' - ' + d.produto_sku : ''}`,
    text: linhas.join('\n'),
  }).then(() => console.log('[AMB/EMAIL] aviso de problema enviado'))
    .catch(e => console.warn('[AMB/EMAIL] falhou (triagem seguiu normal):', e.message));
}

/** Pro /amb/config: estado real, sem expor senha. */
function diagnostico() {
  const c = credenciais();
  return {
    ligado: !!c,
    conta: c ? `${NOME_EMPRESA} (propria)` : null,
    remetente: c ? c.user : null,
    destino: destino(),
    falta: c
      ? null
      : _PREFIXO + 'EMAIL_HOST, ' + _PREFIXO + 'EMAIL_USER e ' + _PREFIXO + 'EMAIL_PASS'
        + (_LEGADO_AMB ? ' (ou a familia AMBBKP_SMTP_*)' : '') + ' no Render',
    observacao: 'este modulo nunca usa a conta de e-mail de outra empresa',
  };
}


return {
  avisarProblema,
  ligado: () => !!credenciais(),
  destino,
  diagnostico,
};
}

// ⚠️ so a fabrica — sem instancia padrao, pra ninguem usar a velha sem notar
module.exports = { criar };
