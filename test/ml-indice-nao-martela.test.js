'use strict';
// b692 — O INDICE DE DEVOLUCOES DO ML NAO MARTELA O MERCADO LIVRE QUANDO NAO CONSEGUE MONTAR.
//
// ⚠️ O CASO (GOOD, 14/11/2026 — /health e /api/debug/ml-returns-indice colados pelo dono):
//   ml_403.por_rota: [{ rota: '/post-purchase/v1/claims/search', vezes: 434, ultima_ha_s: 99 }]   (12 min de servico)
//   indice: { quente: false, total_claims: 0, claims_bloqueadas: 60, duracao_construcao_seg: 16,
//             erro: 'claims/search(closed) ... HTTP 403 em TODAS as 30 da faixa ... PA_UNAUTHORIZED_RESULT_FROM_POLICIES' }
// O ML nega TODAS as reclamacoes da GOOD (abertas e encerradas). Cada montagem gasta 62 chamadas pra descobrir
// isso — e, como o indice nunca esquenta (`IDX.ts` fica 0), TODO mundo que passa por ele manda montar de novo:
// a espreita (`resumoEspreita`), o bipe e o laco que enriquece a espreita (`acharPorTracking`, que ainda ESPERA
// a montagem: ~16 s por codigo). Resultado medido: ~36 chamadas 403 por minuto, sem parar, mais uma releitura do
// token no Mover-Pedidos a cada uma.
//
// A regra agora: quem falhou espera antes de tentar de novo sozinho.
//   - o ML NEGOU (bloqueio de politica nas faixas inteiras) = resposta CONCLUSIVA -> so no ciclo normal (30 min);
//   - erro passageiro (5xx, 429, rede) = "nao sei" -> tenta logo (2 min), dobrando ate 30 min;
//   - o bipe nao espera montagem que acabou de falhar.
// Roda a peca de PRODUCAO (ml-returns-AMB), a mesma das tres empresas.
//
// Roda com: node test/ml-indice-nao-martela.test.js

const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const ARQ = path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'ml-returns-AMB.js');
const P403 = { ok: false, status: 403, error: { blocked_by: 'PolicyAgent', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES', status: 403, message: 'At least one policy returned UNAUTHORIZED.' } };
const P500 = { ok: false, status: 500, error: { message: 'internal error' } };
const VAZIO = { ok: true, status: 200, data: { data: [] } };
const drenagem = require('../lib/drenagem');

// relogio de mentira: a peca le Date.now() pra decidir se ja pode tentar de novo
const agoraReal = Date.now.bind(Date);
let adiantado = 0;
Date.now = () => agoraReal() + adiantado;
const passar = (min) => { adiantado += min * 60000; };
const respirar = (ms) => new Promise((r) => setTimeout(r, ms));

function montar(responder) {
  delete require.cache[require.resolve(ARQ)];
  const reg = { buscas: 0, outras: 0 };
  const chamarML = async (p) => {
    if (/\/claims\/search/.test(p)) { reg.buscas++; return responder(p, reg); }
    reg.outras++;
    if (/\/returns$/.test(p)) return { ok: true, status: 200, data: { shipments: [{ shipment_id: 4711, tracking_number: 'AA123456789BR', status: 'shipped', destination: { name: 'seller_address' } }] } };
    return { ok: true, status: 200, data: {} };
  };
  const peca = require(ARQ).criar({ PREFIXO_ENV: 'GOOD_', ml: { janelaDias: 120 }, clienteMl: { userId: () => '777', chamarML } });
  return { peca, reg };
}
const calado = async (fn) => { const c = { log: console.log, error: console.error, warn: console.warn }; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { Object.assign(console, c); } };

(async () => {
  // ══ b695) 403 que NAO e o do PolicyAgent nao ganha a dica da permissao (seria palpite) ══
  {
    const OUTRO403 = { ok: false, status: 403, error: { message: 'forbidden', error: 'forbidden', status: 403 } };
    const { peca } = montar(async () => OUTRO403);
    await calado(() => peca.construirIndice().catch(() => {}));
    const s = peca.statusIndice();
    ok(/status inteiro parece bloqueado/.test(String(s.erro)) && !/Comunicacoes pre e pos-vendas/.test(String(s.erro)),
       '  403 sem a marca do PolicyAgent: o erro sai como antes, sem a dica da permissao');
  }

  // ══ A) O CASO DA GOOD: o ML nega tudo ══
  {
    // o ML de mentira demora 12 ms por busca (o de verdade, ~250): a montagem negada leva ~0,75 s aqui e ~16 s la
    const { peca, reg } = montar(async () => { await respirar(12); return P403; });
    await calado(() => peca.construirIndice().catch(() => {}));
    const porMontagem = reg.buscas;
    ok(porMontagem === 62, `a montagem que o ML nega inteira custa ${porMontagem} chamadas (2 status x [1 pagina + 30 uma a uma])`);
    const s0 = peca.statusIndice();
    ok(s0.quente === false && s0.claims_bloqueadas === 60 && /status inteiro parece bloqueado/.test(String(s0.erro)), '  estado igual ao que a GOOD mostrou: frio, 60 bloqueadas, "status inteiro parece bloqueado"');
    // b695: a causa conhecida vai junto do erro (a mensagem do ML nao diz) — e sem engolir a resposta original
    ok(/Comunicacoes pre e pos-vendas/.test(String(s0.erro)) && /AUTORIZE DE NOVO/.test(String(s0.erro)) && /PA_UNAUTHORIZED_RESULT_FROM_POLICIES/.test(String(s0.erro)),
       '⚠️ o erro do bloqueio de politica diz ONDE olhar: a permissao do app do ML e a reautorizacao (b695)');

    const t0 = agoraReal();
    await calado(async () => {
      for (let i = 0; i < 6; i++) { await peca.acharPorTracking('AA12345678' + i + 'BR'); peca.resumoEspreita(); }
      await respirar(60);
    });
    const dt = agoraReal() - t0;
    ok(reg.buscas === porMontagem, `⚠️ 6 bipes + 6 passadas da espreita logo depois NAO mandam montar de novo: ${reg.buscas - porMontagem} chamadas a mais (antes: 62 por bipe)`);
    ok(dt < 400, `⚠️ e o bipe NAO espera uma montagem que acabou de ser negada (${dt} ms pros 6 — antes, uma montagem inteira por bipe)`);
    const s1 = peca.statusIndice();
    ok(s1.espera_apos_falha && s1.espera_apos_falha.conclusiva === true && s1.espera_apos_falha.falhas_seguidas === 1
       && s1.espera_apos_falha.proxima_tentativa_em_s > 25 * 60 && s1.espera_apos_falha.proxima_tentativa_em_s <= 30 * 60,
       '  o estado diz por que esta parado e quando tenta de novo: ' + JSON.stringify(s1.espera_apos_falha));

    passar(29);
    await calado(async () => { peca.resumoEspreita(); await peca.acharPorTracking('AA123456789BR'); await respirar(60); });
    ok(reg.buscas === porMontagem, '  29 min depois: ainda esperando (bloqueio de politica so volta no ciclo normal de 30 min)');
    passar(2);
    await calado(async () => { peca.resumoEspreita(); await respirar(1500); });
    ok(reg.buscas === porMontagem * 2, `⚠️ passados os 30 min, a espreita manda montar UMA vez de novo (${reg.buscas} = 2 x ${porMontagem})`);
    await calado(async () => { for (let i = 0; i < 4; i++) { peca.resumoEspreita(); await peca.acharPorTracking('AA123456789BR'); } await respirar(60); });
    ok(reg.buscas === porMontagem * 2 && peca.statusIndice().espera_apos_falha.falhas_seguidas === 2, '  negou de novo: volta a esperar (2 falhas seguidas), sem rajada');
  }

  // ══ B) e quando o ML LIBERA, o indice volta sozinho ══
  {
    let liberado = false;
    const { peca, reg } = montar((p) => {
      if (!liberado) return P403;
      if (/status=opened/.test(p) && /offset=0&/.test(p)) return { ok: true, status: 200, data: { data: [{ id: 51, status: 'opened', resource: 'order', resource_id: 9001 }] } };
      return VAZIO;
    });
    await calado(() => peca.construirIndice().catch(() => {}));
    liberado = true;
    passar(31);
    await calado(async () => { peca.resumoEspreita(); await respirar(900); });
    const s = peca.statusIndice();
    ok(s.quente === true && s.total_claims === 1 && !s.erro && s.espera_apos_falha === null, '⚠️ o ML liberou: no ciclo seguinte o indice esquenta sozinho e a espera some — ' + JSON.stringify({ quente: s.quente, total: s.total_claims, espera: s.espera_apos_falha }));
    const achou = await calado(() => peca.acharPorTracking('AA123456789BR'));
    ok(!!achou, '  e o rastreio volta a ser achado no bipe');
    void reg;
  }

  // ══ C) erro PASSAGEIRO: "nao sei" tenta logo, e vai espacando ══
  {
    const { peca, reg } = montar(() => P500);
    await calado(() => peca.construirIndice().catch(() => {}));
    const base = reg.buscas;
    const e1 = peca.statusIndice().espera_apos_falha;
    ok(e1 && e1.conclusiva === false && e1.proxima_tentativa_em_s > 60 && e1.proxima_tentativa_em_s <= 120, '⚠️ erro passageiro (HTTP 500) NAO e bloqueio: espera curta, de 2 min — ' + JSON.stringify(e1));
    await calado(async () => { for (let i = 0; i < 5; i++) { peca.resumoEspreita(); await peca.acharPorTracking('AA123456789BR'); } await respirar(40); });
    ok(reg.buscas === base, '  dentro dos 2 min ninguem manda montar de novo');
    passar(2.1);
    await calado(async () => { peca.resumoEspreita(); await respirar(60); });
    ok(reg.buscas === base * 2, '  passados 2 min, tenta de novo');
    const e2 = peca.statusIndice().espera_apos_falha;
    ok(e2.falhas_seguidas === 2 && e2.proxima_tentativa_em_s > 180 && e2.proxima_tentativa_em_s <= 240, '  falhou de novo: a espera dobra (4 min) — ' + JSON.stringify(e2));
    for (let i = 0; i < 8; i++) { passar(31); await calado(async () => { peca.resumoEspreita(); await respirar(30); }); }
    const e9 = peca.statusIndice().espera_apos_falha;
    ok(e9.proxima_tentativa_em_s <= 30 * 60, '  e nunca passa de 30 min, por mais que falhe (' + e9.falhas_seguidas + ' falhas -> ' + e9.proxima_tentativa_em_s + ' s)');
  }

  // ══ D) tinha indice BOM e a remontagem falha: mantem o antigo, sem rajada ══
  {
    let modo = 'ok';
    const { peca, reg } = montar((p) => {
      if (modo === 'negado') return P403;
      if (/status=opened/.test(p) && /offset=0&/.test(p)) return { ok: true, status: 200, data: { data: [{ id: 51, status: 'opened', resource: 'order', resource_id: 9001 }] } };
      return VAZIO;
    });
    await calado(() => peca.construirIndice().catch(() => {}));
    ok(peca.statusIndice().quente === true && peca.tamanho() === 1, 'indice bom montado (1 rastreio)');
    modo = 'negado'; passar(31);
    const antes = reg.buscas;
    await calado(async () => { for (let i = 0; i < 5; i++) { peca.resumoEspreita(); await peca.acharPorTracking('AA123456789BR'); await respirar(30); } await respirar(80); });
    ok(reg.buscas - antes === 62, `⚠️ indice velho + ML negando: UMA remontagem (62 chamadas), nao uma por consulta — foram ${reg.buscas - antes}`);
    ok(peca.tamanho() === 1 && !!(await calado(() => peca.acharPorTracking('AA123456789BR'))), '  e o indice anterior continua servindo o bipe');
  }

  // ══ E) indice bom e so VELHO: remonta em segundo plano, como sempre ══
  {
    const { peca, reg } = montar((p) => (/status=opened/.test(p) && /offset=0&/.test(p)) ? { ok: true, status: 200, data: { data: [{ id: 51, status: 'opened', resource: 'order', resource_id: 9001 }] } } : VAZIO);
    await calado(() => peca.construirIndice().catch(() => {}));
    const antes = reg.buscas;
    await calado(async () => { peca.resumoEspreita(); await peca.acharPorTracking('AA123456789BR'); await respirar(40); });
    ok(reg.buscas === antes, '  indice novo: ninguem remonta');
    passar(31);
    await calado(async () => { peca.resumoEspreita(); await respirar(900); });
    ok(reg.buscas > antes && peca.statusIndice().espera_apos_falha === null, '  mais de 30 min: a espreita remonta em segundo plano (o comportamento de antes, intacto)');
  }

  // ══ F) pre-aquecimento: bloqueio do ML nao ganha as 3 tentativas do boot ══
  {
    const agendados = [];
    const daquiAOriginal = drenagem.daquiA;
    drenagem.daquiA = (fn, ms) => { agendados.push(ms); return null; };
    try {
      const a = montar(() => P403);
      await calado(async () => { a.peca.preAquecer(0); await respirar(200); });
      ok(a.reg.buscas === 62 && agendados.length === 0, `⚠️ boot com o ML negando tudo: UMA montagem e nenhuma retentativa agendada (antes: 3 montagens em 90 s) — agendadas: ${agendados.length}`);
      const b = montar(() => P500);
      await calado(async () => { b.peca.preAquecer(0); await respirar(200); });
      ok(agendados.length === 1 && agendados[0] === 30000, '  erro passageiro no boot continua ganhando a retentativa de 30 s (regra da b271, intacta)');
    } finally { drenagem.daquiA = daquiAOriginal; }
  }

  Date.now = agoraReal;
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { Date.now = agoraReal; console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
