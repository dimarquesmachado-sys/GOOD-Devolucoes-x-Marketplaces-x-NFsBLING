// ============================================================
// amb-devolucoes/lib-AMB/impressao-AMB.js      (AMB Devol. b11)
// ------------------------------------------------------------
// Etiqueta de DEFEITO na Zebra, no mesmo esquema da GOOD:
//
//  - QZ TRAY ASSINADO: o servidor entrega o certificado e assina
//    cada pedido (RSA-SHA512). Usa o MESMO GOODBKP_QZ_CERT /
//    GOODBKP_QZ_PRIVKEY que ja existem neste servico — o QZ Tray
//    do notebook ja confia nesse certificado, entao o popup
//    "Allow" nao aparece. ZERO env var nova.
//
//  - FILA REMOTA: o celular enfileira, e QUALQUER computador com
//    o painel aberto + QZ Tray vira "estacao" e imprime. E assim
//    que o galpao da GOOD funciona hoje.
//
//  - A ETIQUETA (10x15, ^XA...^XZ): SKU em codigo de barras 128,
//    defeito, local, quem triou e a data. Cola na caixa do
//    produto quebrado — meses depois ninguem lembra o que era.
// ============================================================

'use strict';

const crypto = require('crypto');

const QZ_CERT = process.env.GOODBKP_QZ_CERT || process.env.QZ_CERT || '';
const QZ_PRIVKEY = process.env.GOODBKP_QZ_PRIVKEY || process.env.QZ_PRIVKEY || '';

// fila propria da AMB (a da GOOD vive no server dela)
const fila = [];
let ultimoPollEstacao = 0;

const limpo = (s, max) => String(s == null ? '' : s)
  .replace(/[\^~\\]/g, ' ')            // ^ e ~ sao comandos ZPL
  .replace(/[\r\n]+/g, ' ')
  .slice(0, max || 40);

/**
 * Monta a etiqueta ZPL de defeito (10x15 cm, 203dpi = 812x1218).
 * Fonte grande em cima (SKU), barras 128 no meio, detalhes embaixo.
 */
function zplDefeito({ sku, defeito, localizacao, quem, quando, nf }) {
  const data = quando || new Date().toLocaleDateString('pt-BR');
  return [
    '^XA',
    '^CI28',                                     // UTF-8
    '^PW812',
    '^LL1218',
    '^FO30,40^A0N,60,60^FDDEFEITO - AMBTotal^FS',
    '^FO30,110^GB752,4,4^FS',
    `^FO30,150^A0N,70,70^FD${limpo(sku, 22)}^FS`,
    `^FO30,250^BY3^BCN,140,N,N,N^FD${limpo(sku, 24)}^FS`,
    `^FO30,430^A0N,44,44^FDDefeito:^FS`,
    `^FO30,485^A0N,40,40^FB752,3,0,L^FD${limpo(defeito, 110) || '(sem descricao)'}^FS`,
    `^FO30,640^A0N,44,44^FDLocal: ${limpo(localizacao, 26) || '-'}^FS`,
    nf ? `^FO30,700^A0N,40,40^FDNF ${limpo(nf, 14)}^FS` : '',
    `^FO30,${nf ? 760 : 700}^A0N,36,36^FDTriado por ${limpo(quem, 20) || '-'} em ${data}^FS`,
    '^FO30,1120^GB752,4,4^FS',
    '^FO30,1150^A0N,30,30^FDNao vender - aguardando decisao^FS',
    '^XZ',
  ].filter(Boolean).join('\n');
}

/** Registra as rotas no router. Todas exigem login. */
function registrarRotas(router, requerLogin) {
  // Certificado pro QZ do navegador
  router.get('/api/qz/cert', requerLogin, (req, res) => {
    if (!QZ_CERT) return res.status(404).send('');
    res.type('text/plain').send(QZ_CERT);
  });

  // Assinatura RSA-SHA512 de cada pedido de impressao
  router.get('/api/qz/sign', requerLogin, (req, res) => {
    try {
      if (!QZ_PRIVKEY) return res.status(404).send('');
      const toSign = String(req.query.request || '');
      if (!toSign) return res.status(400).send('');
      const signer = crypto.createSign('RSA-SHA512');
      signer.update(toSign); signer.end();
      res.type('text/plain').send(signer.sign(QZ_PRIVKEY, 'base64'));
    } catch (e) {
      res.status(500).send('erro: ' + e.message);
    }
  });

  // O celular poe a etiqueta na fila
  router.post('/api/etiqueta/fila', requerLogin, (req, res) => {
    const b = req.body || {};
    if (!b.sku) return res.status(400).json({ ok: false, erro: 'falta o sku' });
    const zpl = zplDefeito({
      sku: b.sku, defeito: b.defeito, localizacao: b.localizacao,
      quem: req.usuario, nf: b.nf,
    });
    fila.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), zpl, criado: Date.now() });
    if (fila.length > 50) fila.shift();
    res.json({
      ok: true,
      na_fila: fila.length,
      estacao_ativa: (Date.now() - ultimoPollEstacao) < 20000,
      aviso: (Date.now() - ultimoPollEstacao) >= 20000
        ? 'nenhuma estacao de impressao ativa - abra o painel num computador com QZ Tray'
        : null,
    });
  });

  // A estacao (painel aberto num PC) busca a proxima
  router.get('/api/etiqueta/proxima', requerLogin, (req, res) => {
    ultimoPollEstacao = Date.now();
    const prox = fila.shift() || null;
    res.json({ ok: true, etiqueta: prox, restam: fila.length });
  });

  // Preview do ZPL (debug / conferencia)
  router.get('/api/etiqueta/preview', requerLogin, (req, res) => {
    res.type('text/plain').send(zplDefeito({
      sku: req.query.sku || 'SKU-EXEMPLO',
      defeito: req.query.defeito || 'nao liga',
      localizacao: req.query.local || 'D3',
      quem: req.usuario,
    }));
  });

  router.get('/api/etiqueta/status', requerLogin, (req, res) => {
    res.json({
      ok: true,
      qz_configurado: !!(QZ_CERT && QZ_PRIVKEY),
      na_fila: fila.length,
      estacao_ativa: (Date.now() - ultimoPollEstacao) < 20000,
    });
  });
}

module.exports = { registrarRotas, zplDefeito, qzConfigurado: () => !!(QZ_CERT && QZ_PRIVKEY) };
