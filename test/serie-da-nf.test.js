// Roda com: node test/serie-da-nf.test.js
//
// O CASO REAL que o dono achou: a NF 637 do card e a NF 637 que a busca
// devolvia sao notas DIFERENTES.
//
//   card:   35260564289091000100550010000006371757802116  -> serie 001, mai/26
//   achada: 35260864289091000100550030000006371448079669  -> serie 003, ago/26
//
// Mesmo numero, series diferentes. A busca por numero devolvia a mais
// recente (a errada), minha checagem de chave recusava, e o caso ficava sem
// vinculo — sem explicar por que.
//
// [stated] "pq vc não coloca no card pra eu escolher qual das NFs seguir
// pro caso? ou será q não teria como confrontar então os nomes dos
// clientes?"
//
// A serie ja esta DENTRO da chave que temos, entao da pra filtrar exato —
// sem pedir escolha e sem depender do nome do cliente (que vem null em
// varios casos).

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── a serie sai da chave ────────────────────────────────────────────
{
  const serie = (ch) => {
    const d = String(ch || '').replace(/\D/g, '');
    return d.length === 44 ? d.slice(22, 25).replace(/^0+/, '') : null;
  };
  ok(serie('35260564289091000100550010000006371757802116') === '1',
     'a chave do card diz serie 001');
  ok(serie('35260864289091000100550030000006371448079669') === '3',
     'e a que a busca achava, serie 003 — notas diferentes');
  ok(serie('123') === null, 'chave curta nao vira serie inventada');
  ok(serie(null) === null, 'nem nula');
}

// ── a busca filtra por serie ────────────────────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 5000);
    ok(/const serieDaChave = /.test(fn), nome + ': extrai a serie da chave');
    ok(/'&serie=' \+ encodeURIComponent\(serieDaChave\)/.test(fn),
       nome + '  e passa no filtro — a busca ja vem certa');
    ok(/sao notas DIFERENTES com o mesmo numero/.test(fn),
       nome + ': com o caso real registrado');
  }

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/chave: item\.nf_chave/.test(src),
       nome + ': a rota passa a chave, de onde a serie sai');
  }
}

// ── e quando nao acha, o card DIZ por que ───────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/nf_motivo_sem_vinculo/.test(src),
       nome + ': o item carrega o MOTIVO de nao ter vinculo');
    // b210.1: o texto ficou mais honesto — "nao achei", nao "nao existe"
    ok(/pode estar cancelada, fora do alcance da busca/.test(src),
       nome + '  explicando a hipotese, em vez de so "nao localizada"');
  }

  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/x\.nf_motivo_sem_vinculo/.test(html), nome + ': e a tela mostra o motivo');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
