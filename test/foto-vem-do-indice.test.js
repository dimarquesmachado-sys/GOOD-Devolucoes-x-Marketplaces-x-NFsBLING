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

// ── revisao Codex #271 (rodada 3): o indice ainda frio acorda sozinho ──
{
  const iFn = srv.indexOf('fotoDoIndice: (chave) => {');
  const iGatilho = srv.indexOf("tentarConstruirIndice('foto pediu')", iFn);
  const iGuarda = srv.indexOf('if (!IDX_PROD.ts || !Array.isArray(IDX_PROD.itens)) return null;', iFn);
  ok(iFn > 0 && iGatilho > iFn && iGatilho < iGuarda,
     '⚠️ com o indice ainda frio (ts=0), a propria foto dispara `tentarConstruirIndice`'
     + ' — senao so a busca por nome acordava o indice, e a tela de defeitos'
     + ' ficava refem do Bling ate alguem abrir a outra tela');
}

// ── revisao Codex #271 (rodada 3): a foto da variacao vem do PAI, via indice ──
{
  const iFn = srv.indexOf('fotoDoIndice: (chave) => {');
  const corpo = srv.slice(iFn, srv.indexOf('\n  },', iFn));
  ok(/if \(it\.pai\)/.test(corpo),
     '⚠️ quando o item nao tem foto propria, consulta o PAI (guardado no indice)');
  ok(/IDX_PROD\.itens\.find\(\(x\) => String\(x\.id \|\| ''\) === String\(it\.pai\)\)/.test(corpo),
     '  achando o pai pelo id, no MESMO indice (sem chamada extra ao Bling)');
}

// ── revisao Codex #271 (rodada 3): a montagem do indice grava o `pai` ──
{
  ok(/pai: \(p\.produtoPai && p\.produtoPai\.id\) \|\| null,/.test(srv),
     '⚠️ cada item do indice guarda o id do produtoPai (quando a listagem traz)');
  ok(/if \(!p\.pai && det && det\.produtoPai && det\.produtoPai\.id\) p\.pai = det\.produtoPai\.id;/.test(srv),
     '  e o enriquecimento em BACKGROUND completa quem so veio no DETALHE');
}

// ── revisao Codex #271 (rodada 3): falha transitoria NAO tira da fila ──
{
  const iEnriquece = srv.indexOf('function enriquecerEansEmBackground()');
  const iFimLoop = srv.indexOf('[PRODUTOS] EANs prontos', iEnriquece);
  const corpoLoop = srv.slice(iEnriquece, iFimLoop);

  // ⚠️ so marca "carregado" dentro do `if (r && r.ok)` — uma falha (pausa
  // do Bling, timeout) nao pode fixar o produto como concluido, senao ele
  // fica sem EAN/imagem pro resto da vida do processo (o indice so monta
  // UMA VEZ por deploy - nao ha rebuild periodico que va tentar de novo)
  ok(/if \(r && r\.ok\) \{[\s\S]*p\.eansCarregados = true;/.test(corpoLoop),
     '⚠️ `eansCarregados = true` so roda dentro do sucesso (`r.ok`)');
  ok(!/catch \(e\) \{ p\.eansCarregados = true; \}/.test(corpoLoop),
     '  ⚠️ o catch NAO marca mais `eansCarregados` numa excecao (fica elegivel pro retry)');

  // e o loop que retoma o que ficou (v4.07) agora tambem pega quem falhou
  const iRetry = srv.indexOf('IDX_PROD.itens.some(x => x.id && !x.eansCarregados)', iFimLoop);
  ok(iRetry > iFimLoop,
     '  e o loop de retomada (`retoma o que ficou`) volta a pegar quem falhou por transitorio');
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
  // revisao Codex #271 (rodada 3, P2): itens de VARIACAO (sem foto propria)
  // resolvem pelo PAI, tambem dentro do indice.
  const IDX = { ts: Date.now(), itens: [
    { id: '16234567', sku: 'LV-ASH-4', imagem: 'https://x/foto.jpg' },
    { sku: 'PT-06-ROSA', imagem: null },
    { id: '333', sku: 'ABCA', imagem: 'https://x/abca.jpg' },
    { id: '444', sku: 'ABCÁ', imagem: 'https://x/abca-acento.jpg' },
    { id: '555', sku: '288-VAR', imagem: null, pai: '556' },
    { id: '556', sku: '288', imagem: 'https://x/pai-288.jpg' },
    { id: '777', sku: 'ORFAO-VAR', imagem: null, pai: '999' },   // pai fora do indice
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
    if (!it) return null;
    if (it.imagem) return it.imagem;
    if (it.pai) {
      const pai = IDX.itens.find((x) => String(x.id || '') === String(it.pai));
      if (pai && pai.imagem) return pai.imagem;
    }
    return null;
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
  ok(fotoDoIndice('288-VAR') === 'https://x/pai-288.jpg',
     '⚠️ variacao sem foto propria pega a foto do PAI, dentro do indice');
  ok(fotoDoIndice('ORFAO-VAR') === null,
     '  e se o pai tambem nao esta no indice (ou nao tem foto), cai no Bling');
}

// ── ⚠️ e o índice aceita URL SEM extensão ───────────────────────────
//
// Apontamento do Codex (P2): `extrairImagem` exige extensão no fim da URL
// (.jpg/.png/...). Mas o Bling usa também o formato SEM extensão
// (`lh3.googleusercontent.com/d/...`), e esses produtos ficavam com
// `imagem: null` no índice — então a foto deles caía no Bling, que está em
// pausa.
//
// ⚠️ Era justamente o caso que este PR veio resolver: meio conserto de novo.
{
  ok(/imagemDoProduto\(p\) \|\| extrairImagem\(p\)/.test(srv),
     '⚠️ a listagem popula o indice com `imagemDoProduto` tambem');
  ok(/imagemDoProduto\(det\) \|\| extrairImagem\(det\)/.test(srv),
     '  e o detalhe tambem (os 2 caminhos de popular)');

  // a diferença entre os dois extratores
  const extrai = (o) => (typeof o === 'string' && /^https?:\/\//i.test(o.trim())
    && /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(o.trim())) ? o.trim() : null;
  const doProduto = (p) => (p && p.imagemURL) || null;

  const semExt = { imagemURL: 'https://lh3.googleusercontent.com/d/1a2b3c' };
  ok(extrai(semExt.imagemURL) === null,
     '  (o extrator antigo REJEITA url sem extensao — era o bug)');
  ok(doProduto(semExt) === semExt.imagemURL,
     '  ⚠️ e o novo aceita (Google Drive nao poe extensao na url)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
