'use strict';
// b689 — O /health NAO PODE MENTIR SOBRE QUEM LE O TOKEN DE QUEM.
//
// ⚠️ O CASO (dono, 12/11/2026, ensaio do freio da AMB em producao): o /health dizia
//     'ambtotal/*': 'renova LOCAL (nao ligado ao dono)'      'girassol/*': 'empresa nao ativa neste servico'
// e, no MESMO json, a telemetria mostrava `girassol/ml` lendo do dono 280 vezes. A tabela `EIXOS` de
// lib/token-leitor.js era de setembro: a Girassol entrou em 30/09, e desde a b424 os modulos da fabrica
// (lib-AMB/ml-AMB.js, lib-AMB/bling-AMB.js) consultam o leitor e honram a politica por empresa. Quem mexeu
// na fiacao nao mexeu no inventario — e um teste (token-leitor.test) ainda TRAVAVA o texto velho.
//
// O que este teste prova:
//   1. nao existe mais tabela escrita a mao: os eixos saem do que esta MONTADO e da politica EFETIVA;
//   2. a FIACAO que o texto afirma existe — se alguem tirar o leitor de um modulo, isto cai e o texto muda;
//   3. empresa desativada por env aparece como desativada (nao com a politica de quando rodava);
//   4. no servidor de verdade, o /health mostra os 6 eixos certos.
//
// Roda com: node test/health-eixos-de-verdade.test.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const carregar = () => { delete require.cache[require.resolve('../lib/token-leitor')]; return require('../lib/token-leitor'); };

// ── 1. sem tabela escrita a mao ──
const fonte = rd('lib/token-leitor.js');
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
ok(!/const EIXOS\s*=\s*\{/.test(codigo), '⚠️ lib/token-leitor: a tabela fixa `EIXOS` saiu (o inventario e derivado)');
ok(!/empresa nao ativa neste servico/.test(codigo) && !/_ambtotal\s*:/.test(codigo) && !/renova LOCAL \(nao ligado ao dono\)/.test(codigo),
   '  nenhum dos tres textos velhos sobrou no CODIGO (so nos comentarios que contam a historia)');
ok(/eixos:\s*eixosDeVerdade\(\)/.test(codigo) && /\.\.\.politicasDeVerdade\(\)/.test(codigo), '  o diagnostico usa os derivados (eixos e politica)');
ok(/require\('\.\/montagem-empresas'\)\.diagnostico\(\)/.test(codigo), '  as empresas vem do que o boot montou (lib/montagem-empresas — a mesma lista do /health)');

// ── 2. a fiacao que o texto afirma EXISTE ──
for (const [arq, integ] of [['amb-devolucoes/lib-AMB/ml-AMB.js', 'ml'], ['amb-devolucoes/lib-AMB/bling-AMB.js', 'bling']]) {
  const s = rd(arq);
  ok(new RegExp("tokenLeitor\\.resolverToken\\(CHAVE_TOKEN, '" + integ + "'\\)").test(s) && /if \(d\.usar === 'remoto'\) return d\.access;/.test(s),
     `⚠️ fabrica: ${path.basename(arq)} pede o token ao leitor PELA EMPRESA e usa o access do dono quando ele responde`);
  ok(new RegExp("tokenLeitor\\.politicaDe\\(CHAVE_TOKEN, '" + integ + "'\\)").test(s) && /polRenov === 'remoto' \|\| polRenov === 'bloqueado'/.test(s),
     `  e recusa a renovacao local quando o eixo esta em remoto/bloqueado`);
  ok(/const CHAVE_TOKEN = \(cfg && cfg\.CHAVE_REGISTRO\) \|\| SEM_EMPRESA;/.test(s), '  a chave do eixo e a da EMPRESA da instancia (nunca fixa)');
}
for (const [arq, integ] of [['lib/ml.js', 'ml'], ['lib/bling.js', 'bling']]) {
  ok(new RegExp("tokenLeitor\\.resolverToken\\('good', '" + integ + "'\\)").test(rd(arq)), `  GOOD: ${arq} pede o token ao leitor`);
}

// ── 3. o texto segue a politica efetiva e o estado da montagem ──
const ENVS = ['TOKEN_POLITICA_AMBTOTAL_ML', 'TOKEN_POLITICA_GIRASSOL_BLING', 'TOKEN_POLITICA_GOOD_ML', 'TOKEN_POLITICA_PADRAO'];
const guardadas = Object.fromEntries(ENVS.map((e) => [e, process.env[e]]));
for (const e of ENVS) delete process.env[e];
{
  const d = carregar().diagnostico();
  const eixos = Object.keys(d.eixos).sort().join(',');
  ok(eixos === 'ambtotal/bling,ambtotal/ml,girassol/bling,girassol/ml,good/bling,good/ml', '⚠️ fora do servidor: os 6 eixos do REGISTRO (' + eixos + ')');
  ok(Object.values(d.eixos).every((t) => /^le do dono; se o dono falhar, usa a rede local \(sombra\)$/.test(t)), '  padrao `sombra`: "le do dono; se o dono falhar, usa a rede local" — o que resolverToken faz');
  ok(d.politica['girassol/ml'] === 'sombra' && d.politica['ambtotal/bling'] === 'sombra' && d.politica['good/ml'] === 'sombra', '  `politica` lista os eixos das TRES empresas');
  ok(/fabrica/.test(d.politica._quem_honra || '') && d.politica._ambtotal === undefined, '  e diz quem honra — a nota "_ambtotal: NAO honra" saiu');

  process.env.TOKEN_POLITICA_AMBTOTAL_ML = 'local';
  process.env.TOKEN_POLITICA_GIRASSOL_BLING = 'remoto';
  process.env.TOKEN_POLITICA_GOOD_ML = 'remotto';   // typo: falha FECHADO (b258)
  const d2 = carregar().diagnostico();
  ok(/^renova LOCAL/.test(d2.eixos['ambtotal/ml']) && d2.politica['ambtotal/ml'] === 'local', '⚠️ eixo em `local` -> "renova LOCAL" (e so esse eixo: o Bling da AMB segue ' + d2.politica['ambtotal/bling'] + ')');
  ok(/SEM rede local \(remoto\)/.test(d2.eixos['girassol/bling']), '  eixo em `remoto` -> "le do dono, SEM rede local"');
  ok(/BLOQUEADO/.test(d2.eixos['good/ml']) && d2.politica['good/ml'] === 'bloqueado', '  politica com typo -> BLOQUEADO (o texto nao esconde)');
  for (const e of ENVS) delete process.env[e];
}
{
  // com a montagem do boot: quem foi desativada aparece como desativada
  delete require.cache[require.resolve('../lib/montagem-empresas')];
  const montagem = require('../lib/montagem-empresas');
  const appFalso = { use() {} };
  montagem.montarEmpresas({
    app: appFalso,
    empresas: [{ chave: 'ambtotal', rota: '/amb' }, { chave: 'girassol', rota: '/girassol' }],
    criarApp: () => (req, res, next) => next(),
    ambiente: { DEVOLUCOES_DESATIVAR_AMBTOTAL: '1' },
    logger: { log() {}, warn() {}, error() {} },
  });
  montagem.registrarHospedeira({ chave: 'good', rota: '/', estado: 'montada' });
  const d = carregar().diagnostico();
  ok(/^empresa desativada_por_env neste servico/.test(d.eixos['ambtotal/ml']) && /^empresa desativada_por_env/.test(d.eixos['ambtotal/bling']),
     '⚠️ com a AMB desativada por env: os eixos dela dizem "empresa desativada_por_env neste servico" — ' + d.eixos['ambtotal/ml']);
  ok(/^le do dono/.test(d.eixos['girassol/ml']) && /^le do dono/.test(d.eixos['good/bling']), '  e as montadas seguem com o texto da politica');
  delete require.cache[require.resolve('../lib/montagem-empresas')];
}
for (const e of ENVS) { if (guardadas[e] === undefined) delete process.env[e]; else process.env[e] = guardadas[e]; }

// ── 4. no servidor de verdade ──
function pegar(porta, caminho) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: caminho }, (res) => { let c = ''; res.on('data', (x) => { c += x; }); res.on('end', () => resolve({ status: res.statusCode, corpo: c })); });
    req.on('error', () => resolve({ status: 0, corpo: '' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ status: 0, corpo: '' }); });
  });
}
(async () => {
  const porta = 39000 + Math.floor(Math.random() * 900);
  const env = Object.assign({}, process.env, {
    ADMIN_KEY: 'x', PORT: String(porta), DEVOLUCOES_DESATIVAR_AMBTOTAL: '1',
    GIRASSOL_SESSION_SECRET: 'segredo-de-ensaio-com-mais-de-16-chars', GIRASSOL_USERS: 'ana:123',
  });
  for (const e of ENVS) delete env[e];
  const filho = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env, stdio: 'ignore' });
  let h = null;
  for (let i = 0; i < 80 && !h; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const r = await pegar(porta, '/health');
    if (r.status === 200) { try { h = JSON.parse(r.corpo); } catch (e) { h = null; } }
    if (h && !((h.coordenacao || {}).montagem_empresas || []).some((m) => m.chave === 'good')) h = null;   // a hospedeira ainda nao se registrou
  }
  try { filho.kill('SIGKILL'); } catch (e) { /* ja morreu */ }
  ok(!!h, 'boot real: o /health respondeu com a montagem completa');
  if (h) {
    const lt = h.coordenacao.leitura_de_token;
    const estados = Object.fromEntries(h.coordenacao.montagem_empresas.map((m) => [m.chave, m.estado]));
    ok(estados.ambtotal === 'desativada_por_env' && estados.girassol === 'montada' && estados.good === 'montada', '  montagem: ' + JSON.stringify(estados));
    ok(/desativada_por_env/.test(lt.eixos['ambtotal/ml']) && /desativada_por_env/.test(lt.eixos['ambtotal/bling']), '⚠️ /health: os eixos da AMB desativada dizem que ela esta desativada');
    ok(/^le do dono/.test(lt.eixos['girassol/ml']) && /^le do dono/.test(lt.eixos['girassol/bling']), '⚠️ /health: a Girassol MONTADA aparece lendo do dono (era "empresa nao ativa neste servico")');
    ok(/^le do dono/.test(lt.eixos['good/ml']) && Object.keys(lt.eixos).length === 6 && !('girassol/*' in lt.eixos), '  6 eixos, nenhum curinga');
    ok(lt.politica['girassol/ml'] === 'sombra' && lt.politica._ambtotal === undefined, '  `politica` traz os eixos da fabrica');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
