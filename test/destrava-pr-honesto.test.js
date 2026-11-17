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

// cenario.threads: lista de {id, prova} — o gh falso devolve, pro --jq do script, exatamente o que a query real devolveria
// (o --jq roda no gh de verdade; aqui o gh e falso, entao devolvemos o RESULTADO ja filtrado no formato "id prova")
function rodar({ repo, prs = '', listaFalha = false, alvo = '', comentariosFalham = false, threadsFalham = false, threads = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'destrava-'));
  const log = path.join(dir, 'gh.log');
  const linhasThreads = threads.map((t) => t.id + ' ' + (t.prova ? 'prova' : 'sem-prova')).join('\n');
  // gh falso: registra a chamada; `pr list` devolve os PRs do cenario (ou falha como o gh de verdade sem .git)
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/bash
echo "$@" >> "${log}"
if [ "$1 $2" = "pr list" ]; then
  if [ "${listaFalha ? '1' : '0'}" = "1" ] || [ -z "$GH_REPO" ]; then echo "failed to run git: fatal: not a git repository" >&2; exit 1; fi
  for p in ${prs}; do echo "$p"; done; exit 0
fi
if [ "$1 $2" = "pr view" ]; then
  case "$*" in *commits*) echo "2026-11-17T10:00:00Z";; *) echo "CLEAN";; esac; exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  case "$*" in
    *resolveReviewThread*) echo '{"data":{}}'; exit 0;;
    *reviewThreads*) if [ "${threadsFalham ? '1' : '0'}" = "1" ]; then echo "gh: HTTP 502" >&2; exit 1; fi; printf '%s\n' "${linhasThreads}"; exit 0;;
  esac
fi
if [ "$1" = "api" ]; then
  case "$2" in
    */comments*) if [ "${comentariosFalham ? '1' : '0'}" = "1" ]; then echo "gh: HTTP 403 rate limit" >&2; exit 1; fi; echo "0"; exit 0;;
  esac
  echo ""; exit 0
fi
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
// 6) b739 (P2-16): erro de consulta NAO vira "zero apontamento" — nada e resolvido e o passo fica vermelho
{
  const r = rodar({ repo: 'dono/repo', prs: '12', comentariosFalham: true, threads: [{ id: 'T1', prova: true }] });
  const resolveu = r.chamadas.filter((c) => /resolveReviewThread/.test(c));
  ok(r.codigo === 1 && /::error::PR #12: nao consegui ler os apontamentos/.test(r.saida) && resolveu.length === 0, '⚠️ (P2-16) consulta dos apontamentos falhando: ::error::, NENHUMA conversa resolvida, exit 1 (antes: virava "0 apontamentos" e resolvia tudo)');
  const r2 = rodar({ repo: 'dono/repo', prs: '12', threadsFalham: true });
  ok(r2.codigo === 1 && /nao consegui ler as conversas/.test(r2.saida) && !r2.chamadas.some((c) => /resolveReviewThread/.test(c)), '  consulta das conversas falhando: idem');
}
// 7) b739 (P2-16): so resolve conversa COM PROVA (resposta de alguem que nao e o Codex, ou trecho ja alterado)
{
  const r = rodar({ repo: 'dono/repo', prs: '12', threads: [{ id: 'T-respondida', prova: true }, { id: 'T-outdated', prova: true }, { id: 'T-muda', prova: false }] });
  const resolvidas = r.chamadas.filter((c) => /resolveReviewThread/.test(c)).map((c) => (c.match(/-F id=(\S+)/) || [])[1]);
  ok(r.codigo === 0 && resolvidas.join() === 'T-respondida,T-outdated', '⚠️ (P2-16) resolve so as 2 com prova; a sem prova NAO. Resolvidas: ' + resolvidas.join());
  ok(/conversa T-muda aberta SEM prova de tratamento — fica aberta/.test(r.saida) && /1 conversa\(s\) sem prova seguem abertas/.test(r.saida), '  a sem prova e nomeada no log');
  ok(/2 conversa\(s\) resolvida\(s\) \(com prova\)/.test(r.saida), '  e o log diz "com prova"');
  // Codex #604: com sobra sem prova, o comentario NAO pode dizer "Pronto pra merge"
  const comentarios = r.chamadas.filter((c) => /^pr comment/.test(c));
  ok(comentarios.length === 1 && /seguem abertas sem prova/.test(comentarios[0]) && !/Pronto pra merge/.test(comentarios[0]), '⚠️ (Codex #604) com 1 sem prova: o aviso diz que NAO esta pronto, nunca "Pronto pra merge". Veio: ' + comentarios.join(' | ').slice(0, 160));
  const r2 = rodar({ repo: 'dono/repo', prs: '12', threads: [{ id: 'T-a', prova: true }, { id: 'T-b', prova: true }] });
  const c2 = r2.chamadas.filter((c) => /^pr comment/.test(c));
  ok(c2.length === 1 && /Pronto pra merge/.test(c2[0]), '  todas com prova: ai sim "Pronto pra merge"');
}
// 8) o --jq da consulta real: prova = resposta de NAO-Codex depois do apontamento, ou isOutdated
{
  const { spawnSync } = require('child_process');
  const jq = yml.match(/--jq '(\.data\.repository\.pullRequest\.reviewThreads[\s\S]*?)' 2>\/tmp\/erro-gh/);
  ok(!!jq, '  achei o --jq da consulta de conversas');
  if (jq) {
    const filtro = jq[1].replace(/\\\(/g, '\\(');
    const entrada = { data: { repository: { pullRequest: { reviewThreads: { nodes: [
      { id: 'A', isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:00:00Z' }, { author: { login: 'dimarquesmachado-sys' }, createdAt: '2026-11-17T09:30:00Z' }] } },
      { id: 'B', isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:00:00Z' }] } },
      { id: 'C', isResolved: false, isOutdated: true, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:00:00Z' }] } },
      { id: 'D', isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:00:00Z' }, { author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:10:00Z' }] } },
      { id: 'E', isResolved: true, isOutdated: false, comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, createdAt: '2026-11-17T09:00:00Z' }] } },
    ] } } } } };
    const temJq = spawnSync('jq', ['--version']).status === 0;
    if (temJq) {
      const r = spawnSync('jq', ['-r', filtro], { input: JSON.stringify(entrada), encoding: 'utf8' });
      ok(r.status === 0 && r.stdout.trim().split('\n').join('|') === 'A prova|B sem-prova|C prova|D sem-prova', '⚠️ o --jq real: A (respondida por humano) prova; B (so o Codex) sem; C (outdated) prova; D (so o Codex de novo) sem; E (resolvida) fora. Veio: ' + r.stdout.trim().split('\n').join('|') + ' ' + (r.stderr || ''));
    } else console.log('ok    (jq nao instalado aqui — o --jq real e conferido no CI)');
  }
}
// 5) o yml declara GH_REPO no env do passo e o job segue continue-on-error (nunca bloqueia o PR)
ok(/GH_REPO: \$\{\{ github\.repository \}\}/.test(yml) && /jobs:\n  destravar:[\s\S]*?continue-on-error: true/.test(yml), '  yml: GH_REPO no env do passo; job continue-on-error (o PR nunca e bloqueado por este workflow)');
ok(!/- name: Destravar o que for mecanico\n        continue-on-error: true/.test(yml), '  o PASSO nao engole mais a propria falha');

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
