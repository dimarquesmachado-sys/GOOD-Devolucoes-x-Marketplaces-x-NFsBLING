// ============================================================
// lib/rotas-impressao.js (v3.45)
// ------------------------------------------------------------
// QZ Tray assinado (cert + sign RSA-SHA512) e fila de impressao
// remota (celular -> estacao). Extraido do server.js LITERAL.
// O estado da fila (filaEtiquetas, estacaoUltimoPoll) fica
// encapsulado aqui dentro.
//
// Uso:
//   const registrarRotasImpressao = require('./lib/rotas-impressao');
//   registrarRotasImpressao(app, { requerEstoquista, crypto, sleep });
// ============================================================

module.exports = function registrarRotasImpressao(app, deps) {
  const { requerEstoquista, crypto, sleep } = deps;

// v3.36 - QZ TRAY ASSINADO: o servidor entrega o certificado e
// ASSINA cada pedido de impressao (RSA-SHA512). Com o mesmo
// certificado que o checkout ja usa (override.crt confiado no
// QZ Tray do notebook), o popup "Allow" some por completo.
// Nomes iguais aos do checkout no Mover-Pedidos (GOODBKP_*) pra copiar
// nome+valor ao pe da letra; aceita QZ_CERT/QZ_PRIVKEY como fallback.
const QZ_CERT = process.env.GOODBKP_QZ_CERT || process.env.QZ_CERT || '';
const QZ_PRIVKEY = process.env.GOODBKP_QZ_PRIVKEY || process.env.QZ_PRIVKEY || '';

app.get('/api/qz/cert', requerEstoquista, (req, res) => {
  if (!QZ_CERT) return res.status(404).send('');
  res.type('text/plain').send(QZ_CERT);
});

app.get('/api/qz/sign', requerEstoquista, (req, res) => {
  try {
    if (!QZ_PRIVKEY) return res.status(404).send('');
    const toSign = String(req.query.request || '');
    if (!toSign) return res.status(400).send('');
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(toSign);
    signer.end();
    const assinatura = signer.sign(QZ_PRIVKEY, 'base64');
    res.type('text/plain').send(assinatura);
  } catch (e) {
    console.error('[QZ-SIGN]', e.message);
    res.status(500).send('erro: ' + e.message);
  }
});

// ============================================================
// v3.38 - FILA DE IMPRESSAO REMOTA: o celular clica 🏷️ e a
// etiqueta sai na Zebra da ESTACAO (qualquer PC com esta pagina
// aberta + QZ Tray). O index vira estacao sozinho ao carregar.
const filaEtiquetas = [];
let estacaoUltimoPoll = 0;

app.post('/api/etiqueta/fila', requerEstoquista, (req, res) => {
  try {
    const zpl = String((req.body && req.body.zpl) || '');
    if (!zpl.startsWith('^XA') || zpl.length > 20000) {
      return res.status(400).json({ ok: false, erro: 'ZPL invalido' });
    }
    const agora = Date.now();
    // limpeza: jobs com mais de 4h caem fora
    while (filaEtiquetas.length && agora - filaEtiquetas[0].criadoEm > 4 * 3600e3) filaEtiquetas.shift();
    if (filaEtiquetas.length >= 50) {
      return res.status(429).json({ ok: false, erro: 'fila cheia (50 etiquetas aguardando)' });
    }
    const job = {
      id: agora + '-' + Math.random().toString(36).slice(2, 7),
      zpl,
      resumo: String((req.body && req.body.resumo) || '').slice(0, 120),
      por: req.usuario,
      criadoEm: agora,
    };
    filaEtiquetas.push(job);
    const estacaoOnline = (agora - estacaoUltimoPoll) < 60e3;
    console.log(`[FILA-ETQ] +job de ${req.usuario} (${job.resumo}) | fila=${filaEtiquetas.length} | estacao=${estacaoOnline ? 'online' : 'offline'}`);
    return res.json({ ok: true, id: job.id, aguardando: filaEtiquetas.length, estacao_online: estacaoOnline });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message || String(e) });
  }
});

// Long-poll da estacao: segura a resposta ate ~25s esperando job chegar
app.get('/api/etiqueta/fila/proximo', requerEstoquista, async (req, res) => {
  const esperaMax = Math.min(25, parseInt(req.query.espera, 10) || 25) * 1000;
  const inicio = Date.now();
  estacaoUltimoPoll = inicio;
  while (Date.now() - inicio < esperaMax) {
    if (filaEtiquetas.length > 0) {
      const job = filaEtiquetas.shift();
      estacaoUltimoPoll = Date.now();
      console.log(`[FILA-ETQ] entregue: ${job.resumo || job.id} (restam ${filaEtiquetas.length})`);
      return res.json({ ok: true, job, restam: filaEtiquetas.length });
    }
    await sleep(500);
    estacaoUltimoPoll = Date.now();
  }
  return res.json({ ok: true, vazio: true });
});

};
