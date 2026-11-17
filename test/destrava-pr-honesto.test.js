'use strict';
// b736 — P2-13 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O WORKFLOW destrava-pr NAO FICA VERDE SEM OPERAR.
//
// Nao ha checkout no job (so API): `gh pr list` sem repositorio dava "fatal: not a git repository", a lista vinha
// vazia, o loop nao rodava e o job terminava VERDE. Aqui o script do passo RODA de verdade (bash) com um `gh` falso
// no PATH: (1) sem repositorio o passo falha explicitamente; (2) com repositorio, todo `gh` leva o repo;
// (3) zero PR aberto = "nada a fazer", exit 0; (4) listagem falhando = ::error:: e exit 1.
// Roda com: node test/destrava-pr-honesto.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'destrava-pr.yml'), 'utf8');
// o bloco `run: |` do unico passo, com os ${{ }} trocados por env de teste
// o `run: |` e o ultimo bloco do arquivo: vai do marcador ate o fim
const inicio = yml.indexOf('\n        run: |\n');
ok(inicio > 0, 'achei o bloco run do passo');
let script = yml.slice(inicio + '\n        run: |\n'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
script = script.replace(/\$\{\{ github\.event\.pull_request\.number \|\| github\.event\.inputs\.pr \}\}/g, '${ALVO_TESTE}')
  .replace(/\$\{\{ github\.repository \}\}/g, '${GH_REPO}')
  .replace(/\$\{\{ github\.repository_owner \}\}/g, 'dono').replace(/\$\{\{ github\.event\.repository\.name \}\}/g, 'repo')
  .replace(/\$\{\{ github\.event_name \}\}/g, '${EVENTO_TESTE}');
ok(!/\$\{\{/.test(script), '  nenhum ${{ }} sobrou sem tradução');

function rodar({ repo, prs = '', listaFalha = false, alvo = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'destrava-'));
  const log = path.join(dir, 'gh.log');
  // gh falso: registra a chamada; `pr list` devolve os PRs do cenario (ou falha como o gh de verdade sem .git)
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/bash
echo "$@" >> "${log}"
if [ "$1 $2" = "pr list" ]; then
  if [ "${listaFalha ? '1' : '0'}" = "1" ] || [ -z "$GH_REPO" ]; then echo "failed to run git: fatal: not a git repository" >&2; exit 1; fi
  for p in ${prs}; do echo "$p"; done; exit 0
fi
if [ "$1 $2" = "pr view" ]; then echo "CLEAN"; exit 0; fi
if [ "$1" = "api" ]; then echo ""; exit 0; fi
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  const r = spawnSync('bash', ['-c', script], { env: Object.assign({}, process.env, { PATH: dir + ':' + process.env.PATH, GH_REPO: repo, GH_TOKEN: 'x', ALVO_TESTE: alvo, EVENTO_TESTE: 'pull_request' }), encoding: 'utf8' });
  const chamadas = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { codigo: r.status, saida: (r.stdout || '') + (r.stderr || ''), chamadas };
}

// 1) sem repositorio: falha EXPLICITA (antes: verde)
{
  const r = rodar({ repo: '' });
  ok(r.codigo === 1 && /::error::GH_REPO vazio/.test(r.saida), '⚠️ sem GH_REPO: o passo falha com ::error:: (antes: lista vazia e job verde). Codigo ' + r.codigo);
}
// 2) listagem falhando (o "fatal: not a git repository" do Codex): ::error:: e exit 1
{
  const r = rodar({ repo: 'dono/repo', listaFalha: true });
  ok(r.codigo === 1 && /::error::nao consegui listar os PRs abertos: .*not a git repository/.test(r.saida), '⚠️ `gh pr list` falhando: ::error:: com a causa, exit 1. Codigo ' + r.codigo);
}
// 3) zero PR aberto: "nada a fazer", exit 0, sem fingir trabalho
{
  const r = rodar({ repo: 'dono/repo', prs: '' });
  ok(r.codigo === 0 && /nenhum PR aberto — nada a fazer/.test(r.saida), '  zero PR aberto: "nada a fazer", exit 0');
}
// 4) com PRs: o loop roda e TODO `gh pr`/`gh workflow` leva o repositorio
{
  const r = rodar({ repo: 'dono/repo', prs: '12 13' });
  ok(r.codigo === 0 && /PR #12/.test(r.saida) && /PR #13/.test(r.saida), '  2 PRs abertos: o loop passa pelos dois');
  const semRepo = r.chamadas.filter((c) => /^(pr|workflow) /.test(c) && !/--repo dono\/repo/.test(c));
  ok(r.chamadas.length > 3 && semRepo.length === 0, '⚠️ todo gh pr/workflow leva --repo (sem checkout nao ha .git). Sem repo: ' + JSON.stringify(semRepo));
}
// 5) o yml declara GH_REPO no env do passo e o job segue continue-on-error (nunca bloqueia o PR)
ok(/GH_REPO: \$\{\{ github\.repository \}\}/.test(yml) && /jobs:\n  destravar:[\s\S]*?continue-on-error: true/.test(yml), '  yml: GH_REPO no env do passo; job continue-on-error (o PR nunca e bloqueado por este workflow)');
ok(!/- name: Destravar o que for mecanico\n        continue-on-error: true/.test(yml), '  o PASSO nao engole mais a propria falha');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
