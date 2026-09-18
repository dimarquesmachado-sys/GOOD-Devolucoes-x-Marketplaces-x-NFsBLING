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
// ⚠️ b377 - o modulo agora EXIGE o cliente da empresa.
//
// Antes caia na instancia PADRAO, criada no require com o `config-AMB`
// fixo — a empresa nova usaria o Bling DA AMBTOTAL sem nada avisar.
//
// 📌 O teste ja substitui o `chamarBling` (e o que ele exercita), entao
// so preciso entregar o objeto pelo caminho novo.
// ⚠️ UMA instancia, criada aqui, pra o teste poder substituir o
// `chamarBling` NELA — antes ele substituia no MODULO, que agora nao tem
// instancia propria.
const blingDaEmpresa = require('../amb-devolucoes/lib-AMB/bling-AMB')
  .criar(require('../amb-devolucoes/config-AMB'));
const comCliente = (cfg) => Object.assign({}, cfg, { clienteBling: blingDaEmpresa });


let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const chamarBlingOriginal = blingDaEmpresa.chamarBling;

(async () => {
  try {
    // ── indice construido com ZERO NFs de verdade nao pode parecer cego ──
    {
      blingDaEmpresa.chamarBling = async (url) => {
        if (url.startsWith('/nfe')) return { ok: true, status: 200, data: { data: [] } };
        return { ok: false, status: 400 };   // vendas: erro nao-recuperavel, para na hora
      };

      const nf = nfNomesFactory.criar(comCliente(configAMB));
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
      blingDaEmpresa.chamarBling = async (url) => {
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

      const nf = nfNomesFactory.criar(comCliente(configAMB));
      await nf.construirIndice();

      const st = nf.statusIndice();
      ok(chamadas >= 2, 'a 1a chamada (401) foi seguida de uma retentativa');
      ok(!st.erro, '⚠️ P1 (Codex): um 401 passageiro na 1a pagina NAO mata o indice inteiro');
      ok(st.total_nfs === 1, '  e a NF da retentativa entrou no indice');

      const r = await nf.buscarPorNome('Fulano Testado');
      ok(r.candidatos.length === 1, '  a busca acha a NF que entrou depois do retry');
    }

    // ── b354 (Codex, P1): 401 PERSISTENTE nao pode renovar o token a
    // cada volta do retry manual. `chamarBling` de verdade ja renova
    // sozinho no 401 (a nao ser que peca `semRetentativa`) — sem isso,
    // as 3 voltas do laco de NFs e as 4 do laco de vendas dispararia uma
    // renovacao CADA UMA, gastando o refresh token (uso unico) a toa.
    {
      let renovacoesNfe = 0, chamadasNfe = 0;
      let renovacoesVendas = 0, chamadasVendas = 0;
      // Mock fiel ao contrato real do chamarBling: sem `semRetentativa`,
      // um 401 renova o token sozinho antes de responder (e aqui a
      // resposta segue 401, simulando renovacao que nao resolve).
      blingDaEmpresa.chamarBling = async (url, opts) => {
        if (url.startsWith('/nfe')) {
          chamadasNfe++;
          if (!(opts && opts.semRetentativa)) renovacoesNfe++;
          return { ok: false, status: 401 };
        }
        chamadasVendas++;
        if (!(opts && opts.semRetentativa)) renovacoesVendas++;
        return { ok: false, status: 401 };
      };

      const nf = nfNomesFactory.criar(comCliente(configAMB));
      await nf.construirIndice();

      const st = nf.statusIndice();
      ok(chamadasNfe === 4, '  laco de NFs esgotou as 4 chamadas (1 + 3 retries)');
      ok(renovacoesNfe === 1,
         '  ⚠️ P1 (Codex): so a 1a chamada renova o token - as 3 retentativas usam semRetentativa');
      ok(chamadasVendas === 4, '  laco de vendas esgotou as 4 tentativas');
      ok(renovacoesVendas === 1,
         '  ⚠️ P1 (Codex): idem no laco de vendas - so a 1a das 4 tentativas renova');
      ok(!!st.erro, '  com 401 persistente nos dois lacos, o indice registra erro (nao trava sem avisar)');
    }
  } finally {
    blingDaEmpresa.chamarBling = chamarBlingOriginal;
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

    ok(/comRecados\(resultado, req\.params\.codigo\)/.test(bloco),
       '⚠️ P2 (Codex): o 503 de indice indisponivel usa req.params.codigo, nao req.para (undefined)');
    ok(!/comRecados\(resultado, req\.para\b/.test(bloco),
       '  (nao regrediu pro req.para que nunca existiu no Express)');

    ok(/status: rN\.candidatos\.length \? 200 : \(.*indice_vazio.*\? 503 : 404\)|nfPorNomeIndisponivel/.test(bloco),
       '  ⚠️ P2 (Codex): a tentativa nf_por_nome reporta 503 (nao 404) quando o indice esta cego');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
