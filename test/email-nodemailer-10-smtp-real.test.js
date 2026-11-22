'use strict';
// b742 — P2-17c do ROTEIRO-LIQUIDACAO-2026-11: NODEMAILER 6 → 10 SEM QUEBRAR O ENVIO.
//
// O `npm audit` apontava nodemailer <=10.1.3 (injecao SMTP/CRLF). Subir 4 majors de uma vez exige PROVA, nao fe:
// aqui um servidor SMTP falso (socket puro, sem rede) recebe o envio do email-AMB REAL (fabrica das 3 empresas)
// com o nodemailer instalado — HELO/AUTH/MAIL/RCPT/DATA — e o teste confere versao, remetente, destino, assunto e
// corpo. Tambem o ramo "desligado" (sem credenciais) e a quebra documentada do 8.0 (NoAuth → ENOAUTH) nao ser usada.
// Roda com: node test/email-nodemailer-10-smtp-real.test.js
require('./_fonte-fabrica');
const net = require('net');
const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// servidor SMTP minimo: aceita AUTH PLAIN e guarda o DATA
function smtpFalso() {
  const recebido = { auth: null, from: null, to: [], data: '' };
  const srv = net.createServer((sock) => {
    let modoData = false;
    sock.write('220 falso.local ESMTP\r\n');
    sock.on('data', (chunk) => {
      const texto = chunk.toString();
      if (modoData) {
        recebido.data += texto;
        if (recebido.data.includes('\r\n.\r\n')) { modoData = false; sock.write('250 OK queued\r\n'); }
        return;
      }
      for (const linha of texto.split('\r\n').filter(Boolean)) {
        const cmd = linha.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-falso.local\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (cmd === 'AUTH') { recebido.auth = linha; sock.write('235 ok\r\n'); }
        else if (cmd === 'MAIL') { recebido.from = linha; sock.write('250 ok\r\n'); }
        else if (cmd === 'RCPT') { recebido.to.push(linha); sock.write('250 ok\r\n'); }
        else if (cmd === 'DATA') { modoData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, porta: srv.address().port, recebido })));
}

(async () => {
  const versao = require('nodemailer/package.json').version;
  ok(/^10\./.test(versao), 'nodemailer instalado e o 10.x (' + versao + ')');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  ok(/^\^10\./.test(pkg.dependencies.nodemailer), '  package.json pede ^10');
  const fonte = ['server.js', 'amb-devolucoes/lib-AMB/email-AMB.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  ok(!/['"]NoAuth['"]/.test(fonte) && !/nodemailer\/lib\//.test(fonte), '  o repo nao depende do que mudou (codigo NoAuth→ENOAUTH, caminhos internos nodemailer/lib)');

  const { srv, porta, recebido } = await smtpFalso();
  const P = 'TESTE_MAIL_';
  Object.assign(process.env, { [P + 'EMAIL_HOST']: '127.0.0.1', [P + 'EMAIL_PORT']: String(porta), [P + 'EMAIL_USER']: 'devolucoes@teste.local', [P + 'EMAIL_PASS']: 'segredo', [P + 'EMAIL_PARA']: 'dono@teste.local' });
  const email = require('../amb-devolucoes/lib-AMB/email-AMB.js').criar({ PREFIXO_ENV: P, NOME_EMPRESA: 'Empresa Teste', SIGLA_EMPRESA: 'TST', CHAVE_REGISTRO: 'teste' });
  ok(email.ligado() === true, '  email-AMB ligado com as credenciais da empresa de teste');
  email.avisarProblema({ produto_sku: 'SKU-77', produto_titulo: 'Peca de teste', order_id: '123', nf_numero: '555', problema_tipo: 'avaria', problema_descricao: 'quebrou' });
  for (let i = 0; i < 100 && !recebido.data.includes('\r\n.\r\n'); i++) await new Promise((r) => setTimeout(r, 50));
  ok(!!recebido.auth && /^AUTH (PLAIN|LOGIN)/.test(recebido.auth), '⚠️ nodemailer 10 autenticou no SMTP (sem a conta de outra empresa): ' + String(recebido.auth).split(' ').slice(0, 2).join(' '));
  ok(/devolucoes@teste\.local/.test(recebido.from || ''), '  MAIL FROM e o remetente da empresa');
  ok(recebido.to.some((t) => /dono@teste\.local/.test(t)), '  RCPT TO e o destino configurado');
  ok(/Subject: .*TESTE_MAIL.*SKU-77/.test(recebido.data) || /Subject: =\?UTF-8\?/.test(recebido.data), '  assunto com a sigla (do prefixo) e o SKU (ou codificado em UTF-8)');
  ok(/SKU-77/.test(recebido.data) && /quebrou/.test(recebido.data), '  corpo chegou inteiro (SKU e descricao)');
  srv.close();

  // sem credenciais: desligado, sem estourar
  const vazio = require('../amb-devolucoes/lib-AMB/email-AMB.js').criar({ PREFIXO_ENV: 'SEM_NADA_', NOME_EMPRESA: 'X', SIGLA_EMPRESA: 'X', CHAVE_REGISTRO: 'x' });
  ok(vazio.ligado() === false, '  sem credenciais: desligado (comportamento de sempre)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
