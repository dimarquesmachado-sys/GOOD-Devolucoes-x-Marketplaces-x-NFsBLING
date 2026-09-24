'use strict';
// Roda com: node test/amb-nao-registra-timer-sem-montar.test.js
//
// ⚠️ b422 (achado do Codex, P1) - QUANDO A EMPRESA NAO MONTA, ELA NAO PODE
// DEIXAR TIMER PRA TRAS.
//
// `criarAppEmpresa()` (amb-devolucoes/app-AMB.js) cria `bling`/`ml` ANTES de
// validar o `<PREFIXO>SESSION_SECRET` (auth-AMB). Os dois `.criar()` chamam
// `registrarPreventiva()` com `autoLigar: true` — que AGENDA de verdade
// (`setTimeout`/`setInterval`) so de ser criado, antes de qualquer rota
// existir. Se o `auth-AMB.criar()` (mais abaixo) lancasse por falta do
// segredo, o `try/catch` do bootstrap (server.js / lib/montagem-empresas.js)
// so cuidava da ROTA — pos em 503 — mas os timers de renovacao preventiva
// da empresa "que nao subiu" continuavam vivos, e horas depois renovariam
// de verdade o refresh token de USO UNICO do Bling/ML, gravando o novo no
// Render de uma empresa fora do ar.
//
// 📌 O conserto move a validacao do auth pra ANTES de qualquer `.criar()`
// que registre timer: se a empresa nao monta, nada foi construido e nada
// foi agendado.

const { execFileSync } = require('child_process');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const raiz = path.join(__dirname, '..');

function rodar() {
  try {
    const saida = execFileSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'production';
      process.env.RENDER = '1';
      process.env.DEVOLUCOES_EMPRESA = 'ambtotal';
      process.env.AMB_SESSION_SECRET = '';
      let lancou = null;
      try {
        require('./amb-devolucoes/app-AMB').criar('ambtotal');
      } catch (e) {
        lancou = e.message;
      }
      const { listar } = require('./lib/token-preventiva');
      console.log(JSON.stringify({ lancou, registradas: listar().map((r) => r.empresa + '/' + r.integracao) }));
    `], { cwd: raiz, env: Object.assign({}, process.env), stdio: 'pipe' });
    return JSON.parse(String(saida).trim().split('\n').pop());
  } catch (e) {
    return { erro: String(e.stderr || e) };
  }
}

const r = rodar();

ok(!r.erro, '⚠️ o processo isolado rodou sem crash inesperado: ' + (r.erro || ''));
if (!r.erro) {
  ok(!!r.lancou && /AMB_SESSION_SECRET/.test(r.lancou),
     '⚠️ sem o segredo, criarAppEmpresa(\'ambtotal\') lanca (a empresa nao monta)');
  ok(Array.isArray(r.registradas) && r.registradas.length === 0,
     '⚠️ e NENHUMA renovacao preventiva fica registrada pra uma empresa que nao montou '
     + '(achei: ' + JSON.stringify(r.registradas) + ')');
}

// ── ⚠️ b422: NENHUMA validacao pode ficar DEPOIS dos clientes ───────
//
// No b421 subi o SESSION_SECRET e parei ali — o `chaveDados` continuou sendo
// validado 120 linhas depois, ja com os timers agendados, com o MESMO efeito
// que eu tinha acabado de consertar.
//
// 📌 Entao o teste VARRE: qualquer `throw` depois do primeiro `.criar()` que
// registra timer e um buraco igual. Checar so o campo citado foi o erro.
{
  const fs = require('fs');
  const APP = fs.readFileSync(
    path.join(raiz, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const linhas = APP.split('\n');
  const iCliente = linhas.findIndex((l) =>
    !l.trim().startsWith('//') && /(bling|ml)-AMB'\)\.criar/.test(l));
  const tardios = linhas
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => i > iCliente && /throw new Error/.test(l)
                          && !l.trim().startsWith('//'));

  ok(iCliente > 0, 'achei onde o 1o cliente com timer nasce');
  ok(tardios.length === 0,
     '⚠️ NENHUM `throw` depois do 1o cliente com timer'
     + (tardios.length ? ` (L${tardios.map((t) => t.i + 1).join(', L')})` : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
