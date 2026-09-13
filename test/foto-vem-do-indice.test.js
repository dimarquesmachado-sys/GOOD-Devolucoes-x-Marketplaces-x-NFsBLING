// Roda com: node test/foto-vem-do-indice.test.js
//
// [stated 13/09] "a foto dos produtos na tela com defeitos não tá aparecendo"
//
// ⚠️ A rota `/api/produto/imagem` ia no Bling SEMPRE — e o /health mostra a
// conta com `pausa_ativa: true`. Com a pausa, toda chamada de foto falha, e
// a lista pede até 12 de uma vez.
//
// O índice local já tem as imagens (1.091 produtos, cada um com `imagem`).
// Só não era consultado aqui.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const rota = fs.readFileSync(path.join(RAIZ, 'lib', 'rotas-admin-nf.js'), 'utf8');

// ── o servidor passa a consulta ao índice ───────────────────────────
{
  ok(/fotoDoIndice: \(chave\) => \{/.test(srv),
     'o server passa `fotoDoIndice` pra rota');
  ok(/String\(x\.id \|\| ''\) === bruto/.test(srv),
     '⚠️ e ela aceita SKU **e** ID (as 2 telas mandam chaves diferentes)');
  ok(/String\(x\.sku \|\| x\.codigo \|\| ''\)\.toUpperCase\(\) === alvo/.test(srv),
     '⚠️ e o SKU compara SO maiusculo, sem tirar acento (normProd juntaria SKUs diferentes)');

  // ⚠️ uma FUNÇÃO, não o objeto: assim a rota lê o estado ATUAL do índice,
  // não uma foto do momento em que o servidor subiu
  ok(/if \(!IDX_PROD\.ts \|\| !Array\.isArray\(IDX_PROD\.itens\)\) return null;/.test(srv),
     '⚠️ que le o estado ATUAL (funcao, nao o objeto capturado)');
}

// ── e a rota consulta antes do Bling ────────────────────────────────
{
  const iRota = rota.indexOf("app.get('/api/produto/imagem/:id'");
  const iIdx = rota.indexOf('deps.fotoDoIndice', iRota);
  const iBling = rota.indexOf('chamarBling', iRota);
  ok(iIdx > 0, 'a rota consulta o indice');
  ok(iIdx < iBling, '⚠️ e ANTES do Bling (que esta em pausa)');
  ok(/via: 'indice'/.test(rota), '  marcando de onde veio');
  ok(iBling > 0, '  e o Bling fica como reserva (nao foi removido)');
}

// ── ⚠️ e a consulta se comporta ─────────────────────────────────────
{
  // revisao Codex #271 (P2): so maiuscula pra comparar - NAO tira acento
  // (normProd tira, e "ABCA"/"ABCÁ" viravam o mesmo alvo: a foto de um
  // vazava - e ficava CACHEADA - pro outro).
  const IDX = { ts: Date.now(), itens: [
    { id: '16234567', sku: 'LV-ASH-4', imagem: 'https://x/foto.jpg' },
    { sku: 'PT-06-ROSA', imagem: null },
    { id: '333', sku: 'ABCA', imagem: 'https://x/abca.jpg' },
    { id: '444', sku: 'ABCÁ', imagem: 'https://x/abca-acento.jpg' },
  ] };
  // ⚠️ b315.1 (Codex): as duas telas chamam a rota com chaves DIFERENTES —
  // `lancar-defeito.js` manda `p.id`, `defeitos-ficha.js` manda o SKU.
  // Minha 1a versao so procurava por SKU: o modal de lançar defeito (de
  // onde veio a reclamacao) continuaria indo no Bling. Meio conserto.
  const fotoDoIndice = (chave) => {
    if (!IDX.ts || !Array.isArray(IDX.itens)) return null;
    const bruto = String(chave || '').trim();
    if (!bruto) return null;
    const alvo = bruto.toUpperCase();
    const it = IDX.itens.find((x) => String(x.sku || '').toUpperCase() === alvo
      || String(x.id || '') === bruto);
    return (it && it.imagem) || null;
  };
  ok(fotoDoIndice('LV-ASH-4') === 'https://x/foto.jpg', '  acha pelo SKU');
  ok(fotoDoIndice('lv-ash-4') === 'https://x/foto.jpg', '  ignorando maiuscula');
  ok(fotoDoIndice('PT-06-ROSA') === null,
     '  ⚠️ entrada SEM imagem cai no Bling (nao devolve vazio como se fosse foto)');
  ok(fotoDoIndice('NAO-EXISTE') === null, '  e SKU fora do indice tambem');
  ok(fotoDoIndice('') === null, '  e sku vazio nao quebra');
  ok(fotoDoIndice('16234567') === 'https://x/foto.jpg',
     '⚠️ e acha pelo ID tambem (o modal de lançar manda `p.id`, nao o SKU)');
  ok(fotoDoIndice('ABCA') === 'https://x/abca.jpg',
     '⚠️ "ABCA" e "ABCÁ" sao SKUs DIFERENTES — nao casa um pelo outro (sem tirar acento)');
  ok(fotoDoIndice('ABCÁ') === 'https://x/abca-acento.jpg',
     '  e o SKU com acento acha o proprio, nao o do vizinho');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
