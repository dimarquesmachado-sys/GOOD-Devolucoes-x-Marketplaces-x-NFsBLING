'use strict';
// b735 — P2-11 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): DOWNLOAD DE ERRO NAO E "FOTO BAIXADA".
//
// baixarTodasFotos (painel-AMB.html, painel unico das 3 empresas) salvava QUALQUER resposta como `_foto_NN.jpg`
// (um 401 em JSON virava arquivo) e o toast dizia "✅ N fotos baixadas!". Aqui a funcao roda DE VERDADE (recorte por
// marcadores) com fetch/document/URL/toast falsos.
// Roda com: node test/baixar-fotos-confere-resposta.test.js
require('./_fonte-painel');
const { fonteCrua } = require('./_fonte-painel');
const { entreMarcadores } = require('./_recorte');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const fonte = entreMarcadores(fonteCrua(), "    const EXTENSAO_POR_TIPO = {", '    function copiarNF(num) {');
function montar(respostas) {
  const salvos = []; const toasts = [];
  const resposta = (r) => ({ ok: r.status < 400, status: r.status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? r.tipo : null) }, blob: async () => ({ size: r.tamanho == null ? 10 : r.tamanho, tipo: r.tipo }) });
  const stubs = {
    fetch: async (url) => { const r = respostas[url]; if (!r) throw new Error('rede caiu'); return resposta(r); },
    srcFoto: (u) => u,
    toast: (msg, tipo) => toasts.push({ msg, tipo }),
    document: { createElement: () => ({ click() { salvos.push(this.download); } }), body: { appendChild() {}, removeChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout: (f) => f(),   // sem esperar 300ms por foto
    console: { error() {} },
  };
  const baixar = new Function('__s', 'with (__s) { ' + fonte + '\n return baixarTodasFotos; }')(stubs);
  return { baixar, salvos, toasts };
}

(async () => {
  // a cena do Codex: 401 em JSON no meio
  {
    const { baixar, salvos, toasts } = montar({
      'a.jpg': { status: 200, tipo: 'image/jpeg' },
      'b.jpg': { status: 401, tipo: 'application/json; charset=utf-8' },
      'c.png': { status: 200, tipo: 'image/png' },
    });
    const r = await baixar(['a.jpg', 'b.jpg', 'c.png'], 'DEV-7');
    ok(salvos.length === 2 && salvos[0] === 'DEV-7_foto_01.jpg' && salvos[1] === 'DEV-7_foto_03.png', '⚠️ 401 em JSON NAO vira arquivo; as 2 imagens salvam com a extensao do tipo real. Salvos: ' + salvos.join(','));
    ok(r.baixadas === 2 && r.falhas.length === 1 && /foto 2: HTTP 401/.test(r.falhas[0]), '  resultado: 2 baixadas, 1 falha "foto 2: HTTP 401"');
    const fim = toasts[toasts.length - 1];
    ok(fim.tipo === 'err' && /2 de 3 fotos baixadas/.test(fim.msg) && /HTTP 401/.test(fim.msg), '⚠️ o toast final conta so o que baixou e diz o que falhou (antes: "✅ 3 fotos baixadas!"). Veio: ' + fim.msg);
  }
  // 200 que nao e imagem (HTML de login) tambem nao e foto
  {
    const { baixar, salvos, toasts } = montar({ 'x.jpg': { status: 200, tipo: 'text/html' } });
    const r = await baixar(['x.jpg'], 'D');
    ok(salvos.length === 0 && r.baixadas === 0 && /não é imagem \(text\/html\)/.test(r.falhas[0]), '  200 com text/html: nao salva, falha explica o tipo');
    ok(toasts[toasts.length - 1].tipo === 'err', '  toast de erro (classe err do painel)');
  }
  // tudo certo: toast verde com a contagem real; rede caindo numa: segue as outras
  {
    const a = montar({ '1.jpg': { status: 200, tipo: 'image/jpeg' }, '2.webp': { status: 200, tipo: 'image/webp' } });
    const r = await a.baixar(['1.jpg', '2.webp'], 'D');
    ok(r.baixadas === 2 && a.toasts[a.toasts.length - 1].msg === '✅ 2 fotos baixadas!' && a.salvos[1].endsWith('.webp'), '  tudo certo: "✅ 2 fotos baixadas!", webp com extensao webp');
    const b = montar({ '1.jpg': { status: 200, tipo: 'image/jpeg' } });
    const r2 = await b.baixar(['1.jpg', 'some.jpg'], 'D');
    ok(r2.baixadas === 1 && /foto 2: rede caiu/.test(r2.falhas[0]) && b.salvos.length === 1, '  rede caindo numa foto: a outra salva, a falha e nomeada');
    const c = montar({ 'v.jpg': { status: 200, tipo: 'image/jpeg', tamanho: 0 } });
    const r3 = await c.baixar(['v.jpg'], 'D');
    ok(r3.baixadas === 0 && /vazia/.test(r3.falhas[0]), '  imagem vazia (0 bytes) nao conta');
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
