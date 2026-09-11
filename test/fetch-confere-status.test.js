// Roda com: node test/fetch-confere-status.test.js
//
// ⚠️ [stated 11/09] "fica travado nessa tela" — o modal abria, mostrava
// "Buscando no Bling..." e NUNCA saía disso.
//
// A CAUSA: `await r.json()` rodava sem olhar o status. Se a resposta não for
// JSON — sessão expirada devolvendo HTML de login, 502 do Render, proxy no
// meio — o `.json()` LANÇA, o catch de fora não repinta a caixa, e a tela
// fica pendurada sem erro visível.
//
// ⚠️ E EU JÁ TINHA CONSERTADO ISSO HOJE (#220, na busca de foto) e não varri
// as outras chamadas. Regra 4.2: caminho novo = varrer quem o dispara. A
// varredura achou mais TRÊS — inclusive a que SALVA o defeito.
//
// Este teste é a varredura virada em trava: toda chamada de front que faz
// `.json()` tem que conferir o status antes.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const JS = path.join(__dirname, '..', 'public', 'js');
// ⚠️ HOJE O TESTE COBRE SO `lancar-defeito.js`, E ISSO E DIVIDA MEDIDA, NAO
// esquecimento: a varredura completa achou 19 chamadas desprotegidas nos
// outros arquivos do front — incluindo `triagem.js` e `busca.js`, que sao a
// tela do GALPAO.
//
// Consertar 19 chamadas num PR que veio arrumar o modal seria inflar o
// escopo (Regra 4.9: resolveu o bug que motivou o PR? parou). Cada uma
// precisa de mensagem propria — "a busca falhou" nao serve pra quem estava
// SALVANDO uma triagem.
//
// 📌 FICA ANOTADO: ampliar `COBERTOS` a cada arquivo tratado, ate cobrir o
// front inteiro. O numero so anda pra cima.
const COBERTOS = ['lancar-defeito.js'];
const ARQUIVOS = fs.readdirSync(JS).filter((f) => COBERTOS.includes(f));

let totalFetch = 0;
const desprotegidas = [];

for (const arq of ARQUIVOS) {
  const linhas = fs.readFileSync(path.join(JS, arq), 'utf8').split('\n');
  linhas.forEach((l, i) => {
    if (!/await fetch\(/.test(l)) return;
    totalFetch++;
    // janela generosa: o .json() costuma vir logo abaixo, às vezes com
    // comentários no meio
    const janela = linhas.slice(i, i + 14).join(' ');
    if (!/\.json\(\)/.test(janela)) return;          // não faz parse, ok
    if (/if \(!r\.ok\)|if \(!resp\.ok\)|r\.ok \?/.test(janela)) return;   // confere
    desprotegidas.push(arq + ':' + (i + 1));
  });
}

ok(totalFetch > 0, 'achei chamadas de front pra conferir (' + totalFetch + ')');
ok(desprotegidas.length === 0,
   '⚠️ toda chamada que faz .json() confere o status antes'
   + (desprotegidas.length
     ? '\n      SEM GUARDA: ' + desprotegidas.join(', ')
     : ''));

// ── ⚠️ E STATUS RUIM NEM SEMPRE E ERRO ──────────────────────────────
//
// Apontamento do Codex (#244, P1): minha guarda genérica `if (!r.ok) throw`
// matou um caminho que existe DE PROPÓSITO — quando o Bling não identifica
// o kit, o servidor responde **400 com `kit: true` e `componentes_det`**, e
// é assim que a tela oferece o lançamento por componente.
//
// Com o throw, esse ramo virava inalcançável e o dono levava "HTTP 400" em
// vez da escolha de componente.
//
// 📌 A lição: onde o status carrega DADO, leia o corpo antes de decidir.
{
  const mod = fs.readFileSync(path.join(JS, 'lancar-defeito.js'), 'utf8');
  const i = mod.indexOf("'/api/defeitos/adicionar'");
  // ⚠️ sem comentarios: o meu proprio comentario EXPLICA o erro citando
  // `if (!r.ok) throw`, e o teste acusava o texto que documenta a correcao.
  // Terceira vez hoje que comentario meu derruba teste meu.
  const semC = mod.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const iC = semC.indexOf("'/api/defeitos/adicionar'");
  const bloco = semC.slice(iC, iC + 1400);
  ok(/var d = await r\.json\(\)\.catch/.test(bloco),
     '⚠️ o lançamento LE o corpo antes de rejeitar (o 400 do kit e DADO)');
  ok(!/if \(!r\.ok\) throw/.test(bloco),
     '  e nao tem guarda generica que mataria o ramo do kit');
  ok(/componentes_det|kit/.test(mod),
     '  (o ramo do kit segue no codigo)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
