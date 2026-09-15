// Roda com: node test/nf-nomes-amb-indice-vazio-401.test.js
//
// Apontamentos do Codex na revisao inline do #301 (b351, AMB):
//
//   P1 - `nf-nomes-AMB.js`: o gate externo `if (!r.ok && r.status === 429)`
//   barrava um 401 de ENTRAR no retry. Era exatamente o cenario real (token
//   sendo renovado na 1a pagina) que o PR dizia consertar — o indice
//   morria vazio do mesmo jeito.
//
//   P2 - `nf-nomes-AMB.js`: `indice_vazio` contava
//   `Object.keys(IDX.mapa).length === 0`, o que marca uma conta nova/vazia
//   (indice CONSTRUIU, so nao tem NF nenhuma de verdade) como "indice
//   cego" — uma busca legitima nessa conta virava 503 de indisponibilidade
//   em vez de "nao encontrado".
//
//   P2 - `identificar-AMB.js`: a tentativa `nf_por_nome` ja entrava com
//   `status: 404` fixo ANTES de checar se o indice estava cego, e o 503
//   novo usava `req.para` (undefined) em vez de `req.params.codigo`.
//
// Os dois primeiros sao testados EXECUTANDO construirIndice()/buscarPorNome()
// de verdade (regra da casa: comportamento, nao grep de fonte), com
// bling.chamarBling trocado por um mock. O terceiro fica em marcadores
// estaveis (test/_recorte.js) porque a rota inteira tem dezenas de
// dependencias (mlReturns, espreita, tiktok...) caras de instanciar so pra
// isto.

const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');

const nfNomesFactory = require('../amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
const configAMB = require('../amb-devolucoes/config-AMB.js');
const bling = require('../amb-devolucoes/lib-AMB/bling-AMB.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const chamarBlingOriginal = bling.chamarBling;

(async () => {
  try {
    // ── indice construido com ZERO NFs de verdade nao pode parecer cego ──
    {
      bling.chamarBling = async (url) => {
        if (url.startsWith('/nfe')) return { ok: true, status: 200, data: { data: [] } };
        return { ok: false, status: 400 };   // vendas: erro nao-recuperavel, para na hora
      };

      const nf = nfNomesFactory.criar(configAMB);
      await nf.construirIndice();

      const st = nf.statusIndice();
      ok(st.total_nfs === 0 && !st.erro, 'indice construiu com 0 NFs, sem erro (conta nova/vazia)');
      ok(st.quente === true, '  e fica "quente" (ts carimbado - construcao terminou bem)');

      const r = await nf.buscarPorNome('MARIA DA SILVA SOBRENOME');
      ok(r.candidatos.length === 0, '  a busca no indice vazio nao acha nada');
      ok(r.indice_vazio === false,
         '  ⚠️ P2 (Codex): mas NAO marca indice_vazio - o indice construiu, so nao tem esse nome');
    }

    // ── 401 na 1a pagina do /nfe entra no retry (nao so 429) ─────────────
    {
      let chamadas = 0;
      bling.chamarBling = async (url) => {
        if (url.startsWith('/nfe')) {
          chamadas++;
          if (chamadas === 1) return { ok: false, status: 401 };   // token sendo renovado
          return {
            ok: true, status: 200,
            data: { data: [{ id: '999', numero: '123', contato: { nome: 'Fulano Testado' }, dataEmissao: new Date().toISOString() }] },
          };
        }
        return { ok: false, status: 400 };   // vendas: erro nao-recuperavel, para na hora
      };

      const nf = nfNomesFactory.criar(configAMB);
      await nf.construirIndice();

      const st = nf.statusIndice();
      ok(chamadas >= 2, 'a 1a chamada (401) foi seguida de uma retentativa');
      ok(!st.erro, '⚠️ P1 (Codex): um 401 passageiro na 1a pagina NAO mata o indice inteiro');
      ok(st.total_nfs === 1, '  e a NF da retentativa entrou no indice');

      const r = await nf.buscarPorNome('Fulano Testado');
      ok(r.candidatos.length === 1, '  a busca acha a NF que entrou depois do retry');
    }
  } finally {
    bling.chamarBling = chamarBlingOriginal;
  }

  // ── a rota de identificar deriva o status da tentativa do indice_vazio,
  // e usa req.params.codigo (nao req.para, que e sempre undefined) ───────
  {
    const RAIZ = path.join(__dirname, '..');
    const src = fs.readFileSync(
      path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
    const bloco = entreMarcadores(src,
      'const alvoNome = nfNomes.colapsar(codigoOriginal);',
      'b226 - a mesma ajuda da GOOD');

    ok(!/req\.para\b/.test(bloco),
       '⚠️ P2 (Codex): o 503 de indice indisponivel usa req.params.codigo, nao req.para (undefined)');
    ok(/req\.params\.codigo/.test(bloco), '  (mesmo padrao de todo o resto da rota)');

    ok(/status: rN\.candidatos\.length \? 200 : \(.*indice_vazio.*\? 503 : 404\)|nfPorNomeIndisponivel/.test(bloco),
       '  ⚠️ P2 (Codex): a tentativa nf_por_nome reporta 503 (nao 404) quando o indice esta cego');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
