'use strict';
// b737 — P2-15 (auditoria do Codex, 15/11): SUBIR O server.js DE VERDADE NUM TESTE, SEM ACEITAR PROCESSO QUEBRADO.
//
// O teste do painel so checava a AUSENCIA de uma frase no log depois de 12s: um filho morto por SyntaxError no boot
// (log vazio) passava. Este helper faz o que todo teste de boot precisa:
//   - morte antecipada (exit antes de responder) = FALHA, com o fim do log;
//   - espera o /health responder 200 de verdade (porta livre escolhida aqui), com teto;
//   - `pedir()` pra bater nas rotas depois; `matar()` no fim.
// Uso: const { subir } = require('./_boot-real'); const s = await subir({ env: {...} }); ... s.matar();
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const RAIZ = path.join(__dirname, '..');

function portaLivre() { return new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function pedir(porta, caminho, { metodo = 'GET', cookie = null, corpo = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    // b738 (Codex #603): todo caminho de falha resolve UMA vez — erro, inatividade do socket, resposta abortada/truncada
    // (headers e depois queda, sem 'end') e prazo TOTAL da requisicao. Antes, a resposta truncada ficava pendente.
    let resolvido = false; let prazo = null; let req = null;
    const fim = (r) => { if (resolvido) return; resolvido = true; clearTimeout(prazo); resolve(r); };
    const falha = () => { fim({ status: 0, corpo: '', headers: {} }); try { req.destroy(); } catch (e) { /* ja fechou */ } };
    req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: Object.assign({}, cookie ? { Cookie: cookie } : {}, dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}) }, (res) => {
      let c = ''; res.on('data', (x) => { c += x; });
      res.on('end', () => fim({ status: res.statusCode, corpo: c, headers: res.headers }));
      res.on('aborted', falha); res.on('error', falha);
      res.on('close', () => { if (!res.complete) falha(); });
    });
    prazo = setTimeout(falha, timeoutMs);
    req.on('error', falha);
    req.setTimeout(timeoutMs, falha);
    if (dados) req.write(dados);
    req.end();
  });
}

async function subir({ env = {}, tetoMs = 30000, arquivo = 'server.js' } = {}) {
  const porta = await portaLivre();
  const ambiente = Object.assign({ ADMIN_KEY: 'x', NODE_ENV: 'test' }, process.env, env, { PORT: String(porta) });
  const filho = spawn(process.execPath, [path.join(RAIZ, arquivo)], { cwd: RAIZ, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  filho.stdout.on('data', (c) => { log = (log + c).slice(-8000); });
  filho.stderr.on('data', (c) => { log = (log + c).slice(-8000); });
  let morreu = null;
  filho.on('exit', (codigo, sinal) => { morreu = { codigo, sinal }; });
  const t0 = Date.now();
  let subiu = false;
  while (Date.now() - t0 < tetoMs) {
    if (morreu) break;                                   // morte antecipada: nao adianta esperar
    const h = await pedir(porta, '/health', { timeoutMs: 2000 });
    if (h.status === 200) { subiu = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  const fimDoLog = () => log.split('\n').slice(-25).map((l) => '        | ' + l).join('\n');
  return {
    porta, subiu,
    morreuCedo: !!morreu && !subiu,
    morte: morreu,
    motivo: morreu && !subiu ? 'o processo MORREU antes de responder (codigo ' + morreu.codigo + ', sinal ' + morreu.sinal + ')' : (!subiu ? 'o /health nao respondeu 200 em ' + tetoMs + 'ms' : null),
    log: () => log, fimDoLog,
    pedir: (caminho, opcoes) => pedir(porta, caminho, opcoes),
    matar: () => { try { filho.kill('SIGKILL'); } catch (e) { /* ja morreu */ } },
  };
}

module.exports = { subir, pedir, portaLivre };
