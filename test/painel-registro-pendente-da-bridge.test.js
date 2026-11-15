'use strict';
require('./_fonte-painel');   // fatia 0 (docs/MODULARIZACAO.md): le o painel com os modulos js-AMB/painel-*.js embutidos
// b719 — P1-06 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11), LADO DO PAINEL. A extensao viva e a Toolbox
// (Mover-Pedidos, PR #904, 2.1.19): o registro passa a ir pra area da empresa certa e o que NAO gravou fica numa fila
// que ela entrega a qualquer painel do Devolucoes que abrir (GOOD_BRIDGE_FALHAS_REGISTRO). Aqui o painel:
//   - regrava as pendencias DESTA empresa (a sessao admin daqui so vale aqui), manda limpar as que gravou, avisa o resto;
//   - ao gerar NF, se nem o painel nem a extensao registraram, AVISA que a NF existe no Bling (antes: catch mudo).
// A extensao-bridge/ deste repo esta congelada desde 28/08 — nao se mexe nela.
// Roda com: node test/painel-registro-pendente-da-bridge.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const PB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'painel-bridge.js'), 'utf8');

function fonte(src, nome) {
  const i = src.search(new RegExp('(?:async )?function ' + nome + '\\s*\\('));
  if (i < 0) return '';
  let j = src.indexOf('{', i), p = 0, k = j;
  for (; k < src.length; k++) { if (src[k] === '{') p++; else if (src[k] === '}') { p--; if (p === 0) break; } }
  return src.slice(i, k + 1);
}
function montar(empresa, respostas) {
  const log = { puts: [], alerts: [], posts: [] };
  const ctx = {
    window: { APP_EMPRESA: empresa, APP_BASE: empresa === 'good' ? '' : '/' + empresa, postMessage: (m) => log.posts.push(m) },
    alert: (t) => log.alerts.push(t), console: { log() {} }, String, Object, Array, JSON, Promise, encodeURIComponent,
    fetch: async (url) => { log.puts.push(String(url)); const id = String(url).split('/').pop(); return { ok: respostas[id] !== false, status: respostas[id] === false ? 401 : 200 }; },
  };
  vm.createContext(ctx);
  vm.runInContext(fonte(PB, 'chaveDaEmpresaDoPainel') + '\n' + fonte(PB, 'tratarFalhasDeRegistroDaBridge'), ctx);
  return { ctx, log };
}
const FALHAS = [
  { empresa: 'girassol', devolucaoId: '42', idNotaDevolucao: '555', numero: '127999', erro: 'HTTP 401' },
  { empresa: 'girassol', devolucaoId: '43', idNotaDevolucao: '556', numero: '128000', erro: 'HTTP 500' },
  { empresa: 'ambtotal', devolucaoId: '9', idNotaDevolucao: '1', numero: '2', erro: 'HTTP 401' },
];

(async () => {
  // painel da Girassol: regrava as 2 dela (uma falha de novo), nao toca na da AMB, limpa a que gravou, avisa o resto
  {
    const t = montar('girassol', { 42: true, 43: false });
    const r = await t.ctx.tratarFalhasDeRegistroDaBridge(FALHAS);
    ok(t.log.puts.length === 2 && t.log.puts.every((u) => /^\/girassol\/api\/admin\/registrar-devolucao-gerada\/4[23]$/.test(u)), '⚠️ regrava SO as da Girassol, na area da Girassol (' + t.log.puts.join(', ') + ')');
    ok(r.gravadas.length === 1 && r.gravadas[0].devolucaoId === '42', '  a 42 gravou');
    ok(t.log.posts.length === 1 && t.log.posts[0].tipo === 'GOOD_BRIDGE_FALHAS_LIMPAR' && t.log.posts[0].chaves.join() === 'girassol:42', '  manda limpar SO a que gravou (girassol:42)');
    const texto = t.log.alerts.join('\n');
    ok(/1 NF\(s\).*gravadas agora/.test(texto) && /43 → NF 128000/.test(texto) && /1 registro\(s\) de OUTRA empresa/.test(texto), '  o aviso diz: 1 gravada, a 43 continua sem gravar (com a NF), 1 de outra empresa');
  }
  // painel da AMB chega como 'amb' (caminho da URL): resolve pra ambtotal
  {
    const t = montar('amb', { 9: true });
    const r = await t.ctx.tratarFalhasDeRegistroDaBridge(FALHAS);
    ok(t.log.puts.length === 1 && t.log.puts[0] === '/amb/api/admin/registrar-devolucao-gerada/9' && r.gravadas.length === 1, '  painel em /amb regrava a da ambtotal, e so ela');
  }
  // sem falhas: silencio
  {
    const t = montar('good', {});
    await t.ctx.tratarFalhasDeRegistroDaBridge([]);
    ok(t.log.alerts.length === 0 && t.log.posts.length === 0, '  lista vazia: nenhum alerta, nenhum limpar');
  }
  // o painel escuta a mensagem da extensao e as 2 chamadas do gerar-NF avisam quando nem painel nem extensao registraram
  ok(/event\.data\.tipo !== 'GOOD_BRIDGE_FALHAS_REGISTRO'/.test(PB), 'painel-bridge escuta GOOD_BRIDGE_FALHAS_REGISTRO');
  const PG = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'painel-gerar-nf.js'), 'utf8');
  ok((PG.match(/FOI CRIADA no Bling, mas o sistema N[ÃA]O conseguiu registrar/g) || []).length === 2 && /result\.auto_registro && result\.auto_registro\.ok/.test(PG), '⚠️ painel-gerar-nf: as 2 chamadas avisam quando nem o painel nem a extensao (auto_registro) registraram');
  ok(!/\} catch \(e\) \{ \/\* extensao ja registrou sozinha \*\/ \}/.test(PG), '  o catch mudo "extensao ja registrou sozinha" sumiu');
  const PAINEL = require('./_fonte-painel').fonteCrua();
  for (const m of ['painel-bridge', 'painel-gerar-nf']) {
    const v = PAINEL.match(new RegExp(m + '\\.js\\?v=b(\\d+)'));
    ok(v && Number(v[1]) >= 719, `  ${m}.js?v=b${v ? v[1] : '?'} (>= b719)`);
  }
  ok(!fs.existsSync(path.join(RAIZ, 'test', 'extensao-empresa-em-todas-as-etapas.test.js')), '  a extensao-bridge/ congelada nao foi mexida (sem teste pra ela aqui; a viva e a Toolbox)');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
