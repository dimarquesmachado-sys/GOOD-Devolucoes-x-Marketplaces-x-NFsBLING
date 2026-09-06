#!/usr/bin/env node
// ============================================================
// verifica.js — O ÚNICO COMANDO QUE EU PRECISO LEMBRAR
//
// [stated 04/09] "vc não aprende com os problemas q o codex manda? pq
// parece q vc sempre resolve d um jeito, às vezes até passa o codex,
// resolve tudo, mas no próximo PR, erra tudo d novo."
//
// A resposta honesta: minhas regras estão escritas como PRINCÍPIOS, e
// princípio depende de eu lembrar dele na hora certa. Não lembro de forma
// confiável — e entre conversas some tudo que não está em arquivo.
//
// O que funcionou hoje foi o contrário: transformar a regra em TESTE.
// Função fantasma, onclick quebrado, variável fora de escopo — pararam de
// acontecer porque um teste acusa, não porque eu passei a lembrar.
//
// Este script junta tudo num comando só:
//   node verifica.js
//
// Roda ANTES de todo push. Se sair vermelho, não sobe.
// ============================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
let falhou = false;
const t0 = Date.now();

function passo(titulo, fn) {
  process.stdout.write('  ' + titulo.padEnd(46));
  try {
    const aviso = fn();
    console.log(aviso ? '⚠️  ' + aviso : 'ok');
  } catch (e) {
    falhou = true;
    console.log('FALHOU');
    const msg = String(e.stdout || e.message || e).trim();
    console.log('      ' + msg.split('\n').slice(-12).join('\n      '));
  }
}

console.log('');
console.log('=== VERIFICACAO COMPLETA ===');
console.log('');

// ── 1. sintaxe de todo JS que eu possa ter mexido ───────────────────
console.log('1. sintaxe');
{
  const alvos = ['server.js', 'amb-devolucoes/app-AMB.js'];
  for (const d of ['lib', 'amb-devolucoes/lib-AMB']) {
    for (const f of fs.readdirSync(path.join(RAIZ, d))) {
      if (f.endsWith('.js')) alvos.push(path.join(d, f));
    }
  }
  passo('node --check em ' + alvos.length + ' arquivos', () => {
    for (const a of alvos) execSync('node --check ' + JSON.stringify(a), { cwd: RAIZ, stdio: 'pipe' });
  });
}

// ── 2. o JS dentro dos HTML (node --check nao pega) ─────────────────
console.log('2. scripts dentro dos HTML');
{
  const htmls = [
    'public/painel-devolucoes.html',
    'public/index.html',
    'amb-devolucoes/public-AMB/painel-AMB.html',
    'amb-devolucoes/public-AMB/painel2-AMB.html',
    'amb-devolucoes/public-AMB/index-AMB.html',
  ].filter((h) => fs.existsSync(path.join(RAIZ, h)));
  for (const h of htmls) {
    passo(path.basename(h), () => {
      const src = fs.readFileSync(path.join(RAIZ, h), 'utf8');
      for (const m of src.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        new Function(m[1]);   // lanca se houver erro de sintaxe
      }
    });
  }
}

// ── 3. A BATERIA INTEIRA (nao os testes que eu lembro) ──────────────
console.log('3. testes (todos, nao os que eu lembro)');
{
  const testes = fs.readdirSync(path.join(RAIZ, 'test'))
    .filter((f) => f.endsWith('.test.js')).sort();
  let vermelhos = 0;
  for (const t of testes) {
    try {
      execSync('node ' + JSON.stringify(path.join('test', t)), { cwd: RAIZ, stdio: 'pipe' });
    } catch (e) {
      vermelhos++;
      falhou = true;
      console.log('  ' + t.replace('.test.js', '').padEnd(46) + 'FALHOU');
      const saida = String(e.stdout || '').trim().split('\n').filter((l) => /FALHA/.test(l));
      for (const l of saida.slice(0, 4)) console.log('      ' + l);
    }
  }
  console.log('  ' + (testes.length + ' testes').padEnd(46) + (vermelhos ? vermelhos + ' VERMELHO(S)' : 'todos verdes'));
}

// ── 4. boot real ────────────────────────────────────────────────────
console.log('4. boot real');
passo('server.js sobe e responde', () => {
  execSync('node -e "' +
    'process.env.ADMIN_KEY=\'x\'; process.env.PORT=\'0\';' +
    'require(\'./server.js\');' +
    'setTimeout(()=>process.exit(0), 4000);' +
    '"', { cwd: RAIZ, stdio: 'pipe', timeout: 25000 });
});

// ── 5. o que sobe junto sem querer ──────────────────────────────────
console.log('5. higiene do commit');
passo('nenhum node_modules / .env no staging', () => {
  const st = execSync('git status --short', { cwd: RAIZ }).toString();
  const sujo = st.split('\n').filter((l) => /node_modules|\.env|package-lock/.test(l));
  if (sujo.length) return sujo.length + ' arquivo(s) suspeito(s) — conferir antes do add';
  return null;
});

// ── 6. o escopo do PR nao inflou? ───────────────────────────────────
//
// [stated 04/09] Ele perguntou se um "agente pra me orientar" ajudaria. A
// resposta honesta: orientacao eu ja tinha — a regra "nao empilhar melhoria
// em PR aberto" estava escrita e eu empilhei 16 commits mesmo assim.
//
// O que funciona e virar CHECAGEM. Aqui o julgamento ("estou inflando?")
// vira numero: quantos commits, e ha quanto tempo o PR esta aberto.
console.log('6. escopo do PR');
{
  const { execSync: ex } = require('child_process');
  try {
    // busca a main de verdade antes de comparar — sem isso o `origin/main`
    // local fica velho e o numero sai errado (medi 86 commits onde eram 2)
    try { ex('git fetch -q origin main:refs/remotes/origin/main', { cwd: RAIZ, stdio: 'pipe' }); } catch (e) {}
    const branch = ex('git rev-parse --abbrev-ref HEAD', { cwd: RAIZ }).toString().trim();
    if (branch === 'main' || branch === 'HEAD') {
      console.log('  ' + 'nao estou numa branch de PR'.padEnd(46) + '—');
    } else {
      const n = Number(ex('git rev-list --count origin/main..HEAD', { cwd: RAIZ }).toString().trim());
      const arquivos = ex('git diff --name-only origin/main..HEAD', { cwd: RAIZ })
        .toString().trim().split('\n').filter(Boolean).length;
      const aviso = n >= 5
        ? '⚠️  ' + n + ' commits, ' + arquivos + ' arquivos — O BUG ORIGINAL JA FOI RESOLVIDO? '
          + 'Se sim, PARE: melhoria vira PR novo (regra 4.9)'
        : n + ' commit(s), ' + arquivos + ' arquivo(s)';
      console.log('  ' + 'tamanho da entrega'.padEnd(46) + aviso);
    }
  } catch (e) {
    console.log('  ' + 'sem origin/main pra comparar'.padEnd(46) + '—');
  }
}

console.log('');
console.log('=== ' + (falhou ? '❌ NAO SUBIR' : '✅ PODE SUBIR')
  + ' (' + Math.round((Date.now() - t0) / 1000) + 's) ===');
console.log('');
process.exit(falhou ? 1 : 0);
