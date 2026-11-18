'use strict';
// b749 — T-05 (auditoria do Codex, 15/11): INSTALACAO ESTRITA PELO LOCKFILE, COM O NODE ALINHADO.
//
// O que fica provado:
//   1. `npm ci --dry-run --offline` (copia de package.json + package-lock.json num diretorio limpo, cache vazio)
//      termina 0 — o lock resolve o package.json SEM rede. E exatamente o que o runner faz com `npm ci`.
//   2. A mesma chamada com o package.json FORA DO LOCK (uma faixa que o lock nao satisfaz) termina != 0 — prova
//      que o passo 1 nao passa por acaso.
//   3. O Node esta alinhado num lugar so: `.nvmrc` existe, e major dele satisfaz `engines.node`, e o workflow
//      le o `.nvmrc` (`node-version-file`) em vez de cravar um numero proprio; o workflow instala com `npm ci`.
// Roda com: node test/lockfile-estrito.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');

function dryRun(pkgJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-estrito-'));
  fs.writeFileSync(path.join(dir, 'package.json'), pkgJson);
  fs.copyFileSync(path.join(RAIZ, 'package-lock.json'), path.join(dir, 'package-lock.json'));
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--dry-run', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: dir, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { npm_config_cache: path.join(dir, 'cache') }) });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, saida: (r.stdout || '') + (r.stderr || '') };
}

const pkg = fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8');
const lock = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8'));
ok(lock.lockfileVersion >= 2, '  package-lock.json esta no repo (lockfileVersion ' + lock.lockfileVersion + ')');

const certo = dryRun(pkg);
ok(certo.status === 0, '⚠️ npm ci --dry-run --offline resolve o lock sem rede (exit ' + certo.status + ')' + (certo.status !== 0 ? '\n' + certo.saida.split('\n').slice(-8).join('\n') : ''));

// mutacao: uma faixa que o lock nao satisfaz — a MESMA chamada tem que falhar
const p = JSON.parse(pkg);
const dep = Object.keys(p.dependencies)[0];
p.dependencies[dep] = '^999.0.0';
const errado = dryRun(JSON.stringify(p, null, 2));
ok(errado.status !== 0, '⚠️ package.json fora do lock (' + dep + ' ^999) faz o npm ci falhar (exit ' + errado.status + ') — o verde acima nao e por acaso');

// Node alinhado num lugar so
const nvmrc = fs.existsSync(path.join(RAIZ, '.nvmrc')) ? fs.readFileSync(path.join(RAIZ, '.nvmrc'), 'utf8').trim() : '';
const majorNvm = parseInt(nvmrc, 10);
const engines = String((p.engines || {}).node || '');
const minEngines = parseInt((/(\d+)/.exec(engines) || [])[1], 10);
ok(nvmrc && majorNvm > 0, '  .nvmrc existe e diz um major (' + JSON.stringify(nvmrc) + ')');
ok(engines && majorNvm >= minEngines, '  .nvmrc (' + majorNvm + ') satisfaz engines.node (' + engines + ')');
ok(parseInt(process.versions.node, 10) >= minEngines, '  o Node que roda este teste (' + process.version + ') satisfaz engines.node');
const wf = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ai-pr-checks.yml'), 'utf8');
ok(/node-version-file:\s*['"]?\.nvmrc/.test(wf) && !/^\s*node-version:\s*['"]?\d/m.test(wf), '⚠️ o workflow le o Node do .nvmrc (node-version-file), nao crava um numero proprio');
ok(/\bnpm ci\b/.test(wf) && !/\bnpm install\b(?!.*--dry-run)/.test(wf.replace(/#[^\n]*/g, '')), '⚠️ o workflow instala com `npm ci` (estrito), sem `npm install` fora do lock');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
