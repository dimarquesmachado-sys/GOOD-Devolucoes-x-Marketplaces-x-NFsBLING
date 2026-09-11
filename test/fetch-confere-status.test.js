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

// ⚠️ revisao Codex #245 (P1) - `/api/defeitos/adicionar` SEMPRE devolve
// corpo JSON estruturado, mesmo no 400 (kit detectado, sessao expirada,
// SKU invalido) — e o proprio `d.kit`/`d.erro` so existem depois do
// parse. Conferir `r.ok` ANTES do `.json()`, como a regra pede pras
// outras chamadas, jogava esse corpo fora e escondia o caminho do kit.
//
// Estas duas chamadas continuam PROTEGIDAS contra o problema original
// da Regra 4.2 (resposta que nao e JSON — sessao expirada sem corpo,
// 502 do Render — travando a tela): o `.json()` delas vive dentro de um
// `try` que tem `catch` proprio, repintando a mensagem de erro e
// destravando o botao. So nao seguem o padrao `if (!r.ok)` porque
// PRECISAM ler o corpo do 400 antes de decidir o que fazer.
const EXCECOES = new Set(['lancar-defeito.js:469', 'lancar-defeito.js:600']);

let totalFetch = 0;
const desprotegidas = [];

for (const arq of ARQUIVOS) {
  const linhas = fs.readFileSync(path.join(JS, arq), 'utf8').split('\n');
  linhas.forEach((l, i) => {
    if (!/await fetch\(/.test(l)) return;
    totalFetch++;
    const chave = arq + ':' + (i + 1);
    if (EXCECOES.has(chave)) return;
    // janela generosa: o .json() costuma vir logo abaixo, às vezes com
    // comentários no meio
    const janela = linhas.slice(i, i + 14).join(' ');
    if (!/\.json\(\)/.test(janela)) return;          // não faz parse, ok
    if (/if \(!r\.ok\)|if \(!resp\.ok\)|r\.ok \?/.test(janela)) return;   // confere
    desprotegidas.push(chave);
  });
}

ok(totalFetch > 0, 'achei chamadas de front pra conferir (' + totalFetch + ')');
ok(desprotegidas.length === 0,
   '⚠️ toda chamada que faz .json() confere o status antes'
   + (desprotegidas.length
     ? '\n      SEM GUARDA: ' + desprotegidas.join(', ')
     : ''));

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
