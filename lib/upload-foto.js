'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  lib/upload-foto.js — b711 (P1-10 do ROTEIRO-LIQUIDACAO-2026-11)
//
//  O caminho do upload de foto da triagem, igual nas 3 empresas (e em qualquer CNPJ futuro):
//   - Multer 2.x (o 1.4.5-lts.2 do lock tinha CVE-2025-47944 e CVE-2026-2359: multipart malformado derrubava o
//     processo; upload interrompido segurava recurso);
//   - UM limite pras duas pontas (a GOOD tinha 6 MB e a fabrica 12 MB — nivelado por cima), 1 arquivo, poucos campos;
//   - erro do parser vira resposta HTTP (413 grande demais, 400 malformado/campo errado) em JSON — antes caia no
//     tratador padrao do Express: 500 em HTML, e a tela so via "erro";
//   - o CONTEUDO e conferido pelos primeiros bytes (JPEG/PNG/WebP/GIF), nao pelo mimetype que o cliente declarou.
// ════════════════════════════════════════════════════════════════════════════

const TAMANHO_MAXIMO = 12 * 1024 * 1024;   // 12 MB por foto (o maior dos dois limites que existiam)

/** Cria o middleware do Multer com os limites da casa. Recebe o `multer` por injecao (a fabrica ja o recebe assim). */
function criarUploadDeFoto(multer, { maxBytes = TAMANHO_MAXIMO } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, parts: 12, fieldSize: 64 * 1024 },
  });
}

/** O que a foto E, pelos primeiros bytes. null = nao e imagem que a casa aceita. */
function tipoDaImagem(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  return null;
}

const EXTENSAO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Tratador de erro de rota (4 argumentos): o Multer chama next(err) e o Express pula pra aqui, ainda dentro da rota.
 * Grande demais = 413; qualquer outro erro do parser = 400. Nunca ecoa o corpo. O que nao e do upload segue adiante.
 */
function tratarErroDeUpload(err, req, res, next) {
  if (!err) return next();
  const doMulter = err.name === 'MulterError' || typeof err.code === 'string' && /^LIMIT_/.test(err.code);
  const doParser = /multipart|boundary|Unexpected end of form|Malformed/i.test(String(err.message || ''));
  if (!doMulter && !doParser) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, erro: `foto grande demais (limite ${Math.round(TAMANHO_MAXIMO / 1024 / 1024)} MB)`, codigo: 'LIMIT_FILE_SIZE' });
  }
  return res.status(400).json({ ok: false, erro: 'upload invalido: ' + (err.code || 'formato do envio'), codigo: err.code || 'MULTIPART_INVALIDO' });
}

module.exports = { criarUploadDeFoto, tipoDaImagem, tratarErroDeUpload, EXTENSAO, TAMANHO_MAXIMO };
