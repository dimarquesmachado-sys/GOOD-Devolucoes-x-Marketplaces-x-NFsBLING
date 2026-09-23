'use strict';
// ⚠️ DOIS COMENTARIOS INLINE DO CODEX NO PR #356, DEPOIS DELE JA TER
// MERGEADO — o PR #357 (b415) resolveu o P1 (fresta do retry) e o P2 do
// ML (OAuth durante a espera), mas deixou DOIS PONTOS DO PROPRIO
// COMENTARIO DO MAGALU sem cobrir:
//
// 1) `ocupado` do magalu (b415) virou
//    `!!(INDICES.fase2Rodando || INDICES.construindo)` — mas
//    `fase2Rodando` SO liga na FASE 2 (buscar reverse_code).
//    `INDICES.construindo` e de OUTRO indice (a espreita /v1/orders, nao
//    os tickets). A FASE 1 inteira (listar as paginas de tickets, o que
//    pode ser a maior parte do tempo com muitos tickets) passava com
//    `ocupado: false` — a fila achava a rotina livre e liberava o Shopee
//    por cima dela. Era exatamente o "Expose and wait on the ticket-build
//    state" que o Codex pediu, e o fase2Rodando nao e esse estado.
//
// 2) O #357 so guardou o ML contra o OAuth-durante-a-espera
//    (`jaPreAquecidoPeloOAuth.ml`). O Magalu — que o proprio Codex chamou
//    de "worse" no comentario original, porque `preAquecer` cria um
//    `setInterval` PERMANENTE — ficou sem guarda nenhuma: o callback do
//    OAuth chama `magalu.preAquecer()` e a fila, ao acordar, chamava nao
//    condicionado a nada de novo — dois `setInterval` de 30 em 30 min pra
//    sempre.
//
// 📌 RODO o codigo de verdade onde da (magalu-AMB nao recebe cliente HTTP
// por injecao como ml/bling — mocko so `axios.get`, mesma instancia do
// cache do Node). O trecho do app-AMB.js nao da pra instanciar em teste
// (precisa da ficha completa da empresa, Supabase etc.) — uso os
// marcadores estaveis do `test/_recorte.js`, nunca janela fixa nem
// contagem de chaves (ver CLAUDE.md, secao 6).

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');

(async () => {
  // ── (1) magalu: `ocupado` precisa ficar true durante a FASE 1 ─────────
  {
    process.env.TESTE_FASE1_MAGALU_ACCESS_TOKEN = 'token-fake-de-teste';

    // ⚠️ magalu-AMB chama `axios.get` direto (sem injecao de cliente).
    // Mocko a UNICA instancia do axios no cache do Node — confirmado que
    // o mesmo arquivo resolve tanto daqui quanto de dentro do
    // magalu-AMB.js — sem rede real nenhuma.
    const axios = require('axios');
    const getOriginal = axios.get;
    axios.get = async () => ({ status: 500, data: null });

    try {
      const magalu = require('../amb-devolucoes/lib-AMB/magalu-AMB').criar({ PREFIXO_ENV: 'TESTE_FASE1_' });

      const promessa = magalu.construirIndiceDevolucoes({ maxPaginas: 1 });
      // ⚠️ so o trecho SINCRONO de uma async function roda antes do 1o
      // `await` interno — da pra checar "ja marcou ocupado" sem esperar
      // a chamada (mockada) responder.
      ok(magalu.statusIndice().ocupado === true,
         '⚠️ magalu: `ocupado` fica true assim que `construirIndiceDevolucoes` comeca (fase 1, nao so fase 2)');

      await promessa;
      ok(magalu.statusIndice().ocupado === false,
         '  magalu: e volta a false quando fase 1 + fase 2 terminam');
    } finally {
      axios.get = getOriginal;
    }
  }

  // ── (2) app-AMB.js: o Magalu tambem precisa do guarda do OAuth ────────
  {
    const declaracao = APP.match(/const jaPreAquecidoPeloOAuth = (\{[^}]*\});/);
    ok(!!declaracao, 'a marca do OAuth existe e e um objeto literal');
    ok(!!declaracao && /magalu:\s*false/.test(declaracao[1]),
       '⚠️ e tem uma chave `magalu` (so tinha `ml` — o #357 deixou o magalu de fora)');

    const callbackMagalu = entreMarcadores(APP,
      "if (reg.servico === 'magalu') {", "res.status(400).json({ ok: false, erro: 'servico desconhecido no state' });");
    ok(/jaPreAquecidoPeloOAuth\.magalu = true;/.test(callbackMagalu),
       '  o callback do OAuth do magalu marca a flag ANTES de chamar preAquecer()');

    const fila = entreMarcadores(APP,
      "// ── Pré-aquecimento: UM DE CADA VEZ", "console.log(`[${TAG_APP}/PREAQUECER] fila concluida`);");
    ok(/if \(jaPreAquecidoPeloOAuth\.magalu\)/.test(fila),
       '⚠️ a fila confere a flag do magalu antes de chamar preAquecer(0) de novo');

    // a MESMA guarda que ja existe pro ml, aplicada ao magalu
    const posGuardaML = fila.indexOf('if (jaPreAquecidoPeloOAuth.ml)');
    const posGuardaMagalu = fila.indexOf('if (jaPreAquecidoPeloOAuth.magalu)');
    const posChamadaMagalu = fila.indexOf('magalu.preAquecer(0);');
    ok(posGuardaML >= 0 && posGuardaMagalu >= 0 && posChamadaMagalu > posGuardaMagalu,
       '  a chamada a `magalu.preAquecer(0)` fica DENTRO do else da guarda (nao solta)');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('ERRO NO TESTE:', e);
  process.exit(1);
});
