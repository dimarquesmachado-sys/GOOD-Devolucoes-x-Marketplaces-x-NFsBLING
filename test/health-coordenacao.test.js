// Roda com: node test/health-coordenacao.test.js
//
// ⚠️ AS DUAS PEÇAS DE COORDENAÇÃO FALHAM EM SILÊNCIO POR DESENHO.
//
// O leitor de token e o cliente do porteiro, quando não conseguem falar com
// o Mover-Pedidos, caem no caminho local — que é o comportamento certo (o
// outro serviço não pode ser ponto único de falha). Mas isso significa que
// "não está funcionando" e "está funcionando" são indistinguíveis de fora.
//
// O combinado com o dono é "ligar e confirmar um período de operação
// normal" antes do corte. Sem visibilidade, confirmar vira torcer.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── o /health expõe as duas ──────────────────────────────────────────
{
  const i = src.indexOf("app.get('/health'");
  const rota = src.slice(i, i + 2500);
  ok(/coordenacao:/.test(rota), 'o /health tem o bloco `coordenacao`');
  ok(/leitura_de_token/.test(rota), '  com o estado da leitura de token');
  ok(/ritmo_compartilhado/.test(rota), '  e do ritmo compartilhado');
}

// ── ⚠️ e NÃO vaza segredo ────────────────────────────────────────────
//
// O /health é público. Um diagnóstico que mostrasse o token ou a chave
// seria pior que não ter diagnóstico nenhum.
{
  const tl = require('../lib/token-leitor');
  const rp = require('../lib/ritmo-porteiro');
  const cru = JSON.stringify({ a: tl.diagnostico(), b: rp.diagnostico() });

  for (const proibido of ['access', 'token_valor', 'chave', 'key', 'secret']) {
    const temCampo = new RegExp('"' + proibido + '"\\s*:\\s*"[^"]{8,}"').test(cru);
    ok(!temCampo, 'o diagnostico nao expoe `' + proibido + '`');
  }
  ok(/configurado|ligado/.test(cru),
     '  mas diz se esta CONFIGURADO (que e o que precisa ser visto)');
}

// ── o health não pode quebrar se um módulo faltar ────────────────────
//
// ⚠️ Uma peça de observabilidade que derruba o que observa é pior que
// nenhuma: o /health é o que responde se o serviço está de pé.
{
  ok(/try \{ return require\('\.\/lib\/token-leitor'\)/.test(src),
     'o diagnostico e tolerante a modulo ausente (try/catch)');
  ok(/catch \(e\) \{ return \{ erro: e\.message \}/.test(src),
     '  devolvendo o erro em vez de derrubar o /health');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
