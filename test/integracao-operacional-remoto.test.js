'use strict';
// b732 — P2-08 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): MODO REMOTO NAO DEPENDE DE TOKEN LOCAL.
//
// ml-AMB.js e bling-AMB.js (fabrica das 3 empresas) respondiam temToken() so pelo ACCESS_TOKEN local. Em politica
// remota/sombra o access vem do DONO a cada chamada e o local pode nem existir: o pre-aquecimento do boot pulava os
// indices e as telas davam a integracao como desligada. Agora ha operacional() (pergunta ao leitor) e temToken()
// tambem responde true depois que um token do dono foi visto.
// Roda com: node test/integracao-operacional-remoto.test.js
require('./_fonte-fabrica');
const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const tokenLeitor = require('../lib/token-leitor');
let resposta = { usar: 'remoto', access: 'TOKEN-DO-DONO', politica: 'remoto' };
let perguntas = 0;
tokenLeitor.resolverToken = async () => { perguntas++; return resposta; };

const cfgBase = require('../amb-devolucoes/config-AMB');
// sem NENHUM token local no ambiente desta empresa de teste
const cfg = Object.assign({}, cfgBase, { CHAVE_REGISTRO: 'teste-remoto', PREFIXO_ENV: 'TESTE_REMOTO_' });
for (const k of Object.keys(process.env)) if (k.startsWith('TESTE_REMOTO_')) delete process.env[k];

(async () => {
  for (const [nome, fabrica] of [['ml', require('../amb-devolucoes/lib-AMB/ml-AMB')], ['bling', require('../amb-devolucoes/lib-AMB/bling-AMB')]]) {
    const mod = fabrica.criar(cfg);
    // politica remota, sem token local: operacional
    resposta = { usar: 'remoto', access: 'TOKEN-DO-DONO', politica: 'remoto' };
    const antes = perguntas;
    ok(await mod.operacional() === true, '⚠️ ' + nome + ': politica remota, SEM token local → operacional() = true (antes: temToken() false e nada pre-aquecia)');
    ok(perguntas === antes + 1, '  ' + nome + ': perguntou ao leitor uma vez');
    ok(mod.temToken() === true, '  ' + nome + ': temToken() passa a responder true (token do dono ja visto)');
    // leitor dizendo falhar (remoto sem rede): nao operacional
    const mod2 = fabrica.criar(cfg);
    resposta = { usar: 'falhar', access: null, politica: 'remoto', motivo: 'dono fora' };
    ok(await mod2.operacional() === false && mod2.temToken() === false, '  ' + nome + ': remoto com dono fora do ar → nao operacional');
    // Codex #599: MESMA instancia que ja viu o token do dono — falha depois do sucesso apaga o "visto"
    ok(await mod.operacional() === false && mod.temToken() === false, '⚠️ ' + nome + ': sucesso seguido de falhar na MESMA instancia → temToken() volta a false');
    resposta = { usar: 'remoto', access: 'TOKEN-DO-DONO', politica: 'remoto' };
    ok(await mod.operacional() === true && mod.temToken() === true, '  ' + nome + ': e volta a true quando o dono volta');
    tokenLeitor.resolverToken = async () => { throw new Error('leitor caiu'); };
    ok(await mod.operacional() === false && mod.temToken() === false, '  ' + nome + ': leitor estourando depois de sucesso → temToken() false');
    tokenLeitor.resolverToken = async () => { perguntas++; return resposta; };
    // politica local sem token local: nao operacional
    resposta = { usar: 'local', access: null, politica: 'local' };
    ok(await mod2.operacional() === false && mod2.temToken() === false, '  ' + nome + ': politica local sem token local → nao operacional');
    // leitor estourando: nao operacional, sem derrubar
    tokenLeitor.resolverToken = async () => { throw new Error('leitor caiu'); };
    ok(await mod2.operacional() === false, '  ' + nome + ': leitor estourando → false, sem derrubar');
    tokenLeitor.resolverToken = async () => { perguntas++; return resposta; };
  }
  // o pre-aquecimento do boot decide por operacional(), nao por temToken()
  const app = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  ok(/if \(await ml\.operacional\(\)\)/.test(app) && /if \(await bling\.operacional\(\)\)/.test(app), '⚠️ app-AMB: o pre-aquecimento pergunta operacional() (ML e Bling)');
  ok(!/if \(ml\.temToken\(\)\) \{\s*\n\s*\/\/ ⚠️ b415/.test(app), '  e nao mais temToken() no boot');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
