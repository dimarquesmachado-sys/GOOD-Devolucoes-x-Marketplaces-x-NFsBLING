'use strict';
// b556 — o indice de nomes da AMB/Girassol ganha o TETO DE CONSTRUCAO que so a copia da GOOD tinha: montagem que passa
// do teto e abandonada. Codex (PR #455): o abandono tem que LIBERAR a guarda `construindo` (senao a proxima busca
// recebe `jaEmAndamento` e nunca reconstroi), o timer do teto morre quando a montagem termina antes, e o carimbo
// `construindo_ha_s` vale em TODOS os caminhos (nao so na busca). Executa o modulo de verdade, com Bling mockado.
const nfNomesFactory = require('../amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
const configAMB = require('../amb-devolucoes/config-AMB.js');
const blingDaEmpresa = require('../amb-devolucoes/lib-AMB/bling-AMB').criar(configAMB);
const comCliente = (cfg) => Object.assign({}, cfg, { clienteBling: blingDaEmpresa });

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const vazio = async (url) => (url.startsWith('/nfe')
  ? { ok: true, status: 200, data: { data: [] } } : { ok: false, status: 400 });

(async () => {
  process.env.NF_NOMES_TETO_CONSTRUCAO_MS = '300';
  process.env.NF_NOMES_TETO_BUSCA_MS = '100';
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (...a) => { avisos.push(a.join(' ')); };
  try {
    // 1) carimbo no caminho comum: construirIndice() direto (pre-aquecimento/rota/autocura)
    {
      let solta;
      blingDaEmpresa.chamarBling = (url) => (url.startsWith('/nfe')
        ? new Promise((r) => { solta = () => r({ ok: true, status: 200, data: { data: [] } }); }) : vazio(url));
      const nf = nfNomesFactory.criar(comCliente(configAMB));
      const p = nf.construirIndice();
      await espera(50);
      const st = nf.statusIndice();
      ok(st.construindo === true && st.construindo_ha_s !== null, '⚠️ construirIndice() direto: construindo_ha_s tem valor (nao null)');
      while (!solta) await espera(10);
      solta(); await p;
      ok(nf.statusIndice().construindo === false && nf.statusIndice().construindo_ha_s === null, '  ao terminar: guarda e carimbo limpos');
    }
    // 2) teto: construcao travada e abandonada e a proxima REALMENTE reconstroi
    {
      blingDaEmpresa.chamarBling = (url) => (url.startsWith('/nfe') ? new Promise(() => {}) : vazio(url));
      const nf = nfNomesFactory.criar(comCliente(configAMB));
      await nf.buscarPorNome('MARIA DA SILVA SOBRENOME');       // responde no prazo curto, construcao segue
      ok(nf.statusIndice().construindo === true, 'construcao travada segue "construindo" ate o teto');
      await espera(450);
      ok(nf.statusIndice().construindo === false && nf.statusIndice().construindo_ha_s === null, '⚠️ P1: passado o teto a guarda `construindo` e liberada');
      blingDaEmpresa.chamarBling = vazio;
      const r = await nf.construirIndice();
      ok(!r || !r.jaEmAndamento, '  a proxima tentativa NAO recebe jaEmAndamento');
      ok(nf.statusIndice().quente === true, '  e monta o indice de verdade');
    }
    // 3) montagem que termina antes do teto: sem aviso falso depois
    {
      avisos.length = 0;
      blingDaEmpresa.chamarBling = vazio;
      const nf = nfNomesFactory.criar(comCliente(configAMB));
      await nf.buscarPorNome('MARIA DA SILVA SOBRENOME');
      await espera(450);
      ok(!avisos.some((a) => /passou de/.test(a)), '⚠️ P2: timer do teto cancelado — nenhum aviso "passou de Ns" depois de terminar bem');
    }
  } finally {
    console.warn = warnOriginal;
  }
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
