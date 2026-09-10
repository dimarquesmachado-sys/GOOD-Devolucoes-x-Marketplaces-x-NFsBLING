// Roda com: node test/boot-nao-avalancha.test.js
//
// ⚠️ MEDIDO NO /health COM 3 MINUTOS DE VIDA (10/09):
//   ritmo_compartilhado.pausa_ativa = true   ← a conta já em pausa por 429
//   espreita.tem_cache = false               ← não montou
//   indice_nomes.quente = false              ← não montou
//
// A CAUSA, contando os disparos: CINCO varreduras pesadas nos primeiros 70
// SEGUNDOS. Cada uma varre dezenas de páginas.
//
// ⚠️ E a cota do Bling é DA CONTA, dividida com o Mover-Pedidos. Cinco
// varreduras nossas simultâneas + o que eles fizerem = 429 garantido. O
// porteiro põe todo mundo em pausa — inclusive a BIPAGEM do estoquista, que
// não tem nada a ver com isso.
//
// E a consequência na tela: espreita vazia = nenhum card ganha ESTRELA na
// busca por nome. Foi o que o dono viu.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── ⚠️ a largada é espaçada ─────────────────────────────────────────
{
  ok(/const ESPACO = Number\(process\.env\.BOOT_ESPACO_MS/.test(srv),
     'o espacamento do boot existe e e ajustavel por env');

  // os pré-aquecimentos usam o espaçamento, não segundos fixos
  const comEspaco = (srv.match(/ESPACO/g) || []).length;
  ok(comEspaco >= 4,
     '  e os pre-aquecimentos usam ele (achei ' + comEspaco + ' usos)');

  // ⚠️ nenhum deles pode ter voltado para segundos fixos abaixo de 90s
  const fixos = [...srv.matchAll(/drenagem\.daquiA\([^,]+,\s*(\d+)\s*\*\s*1000\)/g)]
    .map((m) => Number(m[1]))
    .filter((s) => s < 90);
  ok(fixos.length <= 1,
     '  e no maximo UM dispara antes de 90s (achei ' + fixos.length + ')');
}

// ── ⚠️ a espreita vem CEDO, porque é ela que a tela precisa ─────────
//
// É ela que marca a estrela na busca por nome. Deixar por último faria a
// tela ficar sem estrela por mais tempo.
{
  const i = srv.indexOf('espreita.preAquecer()');
  const bloco = srv.slice(Math.max(0, i - 400), i + 200);
  ok(/ESPACO \/ 2/.test(bloco),
     '⚠️ a espreita vem cedo (metade do espaco) — e a que a TELA precisa');
}

// ── ⚠️ e pré-aquecimento que falha TENTA DE NOVO ────────────────────
//
// Antes era `catch` e pronto: um 429 no boot deixava o cache vazio por 25
// MINUTOS, até o próximo ciclo. E cache vazio = sem estrela na tela.
{
  const MODULOS = [
    ['lib/nf-nomes.js', 'GOOD nf-nomes'],
    ['lib/ml-returns.js', 'GOOD ml-returns (a da ESTRELA)'],
    ['amb-devolucoes/lib-AMB/nf-nomes-AMB.js', 'AMB nf-nomes'],
    ['amb-devolucoes/lib-AMB/ml-returns-AMB.js', 'AMB ml-returns'],
  ];
  for (const [arq, nome] of MODULOS) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    ok(/tentativa >= 3/.test(src), nome + ': tenta de novo se falhar');
    ok(/30000 \* Math\.pow\(2, tentativa - 1\)/.test(src),
       '  com espera crescente (30s, 60s, 120s)');
  }
}

// ── e a espera é longa de propósito ─────────────────────────────────
//
// ⚠️ Se a causa foi 429, tentar logo de novo só piora — vira o mesmo
// problema que o retry veio resolver.
{
  const ml = fs.readFileSync(path.join(RAIZ, 'lib', 'ml-returns.js'), 'utf8');
  const m = /const espera = (\d+) \* Math\.pow/.exec(ml);
  ok(!!m && Number(m[1]) >= 20000,
     '⚠️ a 1a espera e longa (' + (m ? m[1] : '?') + 'ms) — se foi 429, insistir piora');
}

// ── ⚠️ CADA RETRY CHAMA COM A ASSINATURA DO SEU ARQUIVO ─────────────
//
// Portei o retry da GOOD para a AMB SEM LER a assinatura de lá. Na GOOD o
// parâmetro é a tentativa; na AMB é o ATRASO EM MS. Meu
// `preAquecer(tentativa + 1)` passaria **2 milissegundos** como atraso — e
// pior, `tentativa` nem existia naquele escopo: ReferenceError na primeira
// falha.
//
// ⚠️ `node --check` não pega (variável inexistente é sintaxe válida) e
// nenhum teste passava ali — o caminho só roda quando o pré-aquecimento
// FALHA. É a Regra 4.12 (ler o produtor antes de escrever o consumidor),
// violada no mesmo dia em que a apliquei em outros 4 arquivos.
{
  const MODULOS = [
    'lib/nf-nomes.js', 'lib/ml-returns.js',
    'amb-devolucoes/lib-AMB/nf-nomes-AMB.js',
    'amb-devolucoes/lib-AMB/ml-returns-AMB.js',
  ];
  for (const arq of MODULOS) {
    const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    const assina = /function preAquecer\(([^)]*)\)/.exec(src);
    const chama = /preAquecer\(([^)]*)\), espera\)/.exec(src);
    if (!assina || !chama) continue;

    const nParams = assina[1].split(',').filter((x) => x.trim()).length;
    const nArgs = chama[1].split(',').filter((x) => x.trim()).length;
    ok(nArgs === nParams,
       path.basename(arq) + ': o retry chama com ' + nArgs + ' argumento(s) '
       + 'e a funcao recebe ' + nParams + ' — batem');

    // ⚠️ e a variável do retry existe no escopo da função
    ok(/tentativa/.test(assina[1]),
       '  e `tentativa` esta DECLARADA na assinatura (nao veio de fora)');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
