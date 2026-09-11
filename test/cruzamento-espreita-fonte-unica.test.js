// Roda com: node test/cruzamento-espreita-fonte-unica.test.js
//
// 3 apontamentos do Codex no PR #225 (postados no instante do merge,
// sobre o codigo que ele mesmo tinha acabado de revisar no P1 anterior):
//
//   1. `/health` contava a mesma NF mais de uma vez quando ela aparecia em
//      duas listas do cache (`nunca_bipadas` + `em_transito`), inflando
//      `nfs_no_cruzamento_qtd` acima do que o cruzamento real usa.
//   2. `/api/espreita/casa-nf/:nf` respondia `onde: "?"` pra quem casava
//      via `nunca_bipadas`/`em_transito`, porque lia `_estado` de um campo
//      que so existe nas copias temporarias do cruzamento real — nao no
//      cache cru que a rota concatenava.
//   3. A mesma rota respondia `ok:true, casou:false` quando `ESP_CACHE`
//      ainda nao existia (90s apos boot, ou build que falhou) —
//      indistinguivel de "essa NF nao esta la", quando nenhuma lista foi
//      de fato consultada.
//
// O conserto: extrair `montarCruzamentoEspreita()` como fonte UNICA —
// `/health`, a rota autenticada e o cruzamento real da busca por nome
// passam a usar o MESMO Map deduplicado por NF normalizada.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── 1) a logica em si: NF repetida entre listas conta UMA vez ───────
{
  // copia fiel de `montarCruzamentoEspreita` — server.js nao exporta
  // (o require ja sobe o app e escuta a porta), entao valido o
  // ALGORITMO aqui e confirmo por regex que o server.js usa o mesmo.
  function montarCruzamentoEspreita(cache) {
    const c = cache || {};
    const bruto = []
      .concat((Array.isArray(c.entregues_recentes) ? c.entregues_recentes : [])
        .map((e) => ({ ...e, _estado: 'entregue' })))
      .concat((Array.isArray(c.nunca_bipadas) ? c.nunca_bipadas : [])
        .map((e) => ({ ...e, _estado: 'entregue' })))
      .concat((Array.isArray(c.em_transito) ? c.em_transito : [])
        .map((e) => ({ ...e, _estado: 'em_transito' })))
      .filter((e) => !e.baixado);
    const chaveNF = (nf, serie) => String(nf || '').replace(/^0+/, '')
      + '/' + (String(serie || '').replace(/^0+/, '') || '1');
    const porNF = new Map();
    for (const e of bruto) {
      const n = String(e.nf || '').replace(/^0+/, '');
      if (!n) continue;
      const k = chaveNF(n, e.nf_serie || e.serie);
      if (!porNF.has(k) || e._estado === 'entregue') porNF.set(k, e);
    }
    return { porNF, chaveNF };
  }

  // a NF 076687 aparece em `nunca_bipadas` E em `em_transito` (dado sujo
  // real: o cache pode ter a mesma devolucao em dois estados). A CONTAGEM
  // UNICA do cruzamento tem que ser 2 (076687 + 133832), nao 3.
  const cache = {
    nunca_bipadas: [{ nf: '076687', nf_serie: '1', dias: 6 }],
    em_transito: [
      { nf: '076687', nf_serie: '1', dias_em_transito: 1 },
      { nf: '133832', nf_serie: '1', dias_em_transito: 4 },
    ],
  };
  const { porNF } = montarCruzamentoEspreita(cache);
  ok(porNF.size === 2, 'NF repetida entre listas conta UMA vez no cruzamento (2 NFs unicas, nao 3)');
  ok(porNF.get('76687/1')._estado === 'entregue',
     '  ⚠️ e entregue tem prioridade sobre em transito quando a mesma NF aparece nas duas');

  // 2) estado correto pra quem casa via nunca_bipadas/em_transito (nao "?")
  const soEmTransito = montarCruzamentoEspreita({ em_transito: [{ nf: '999', nf_serie: '1' }] });
  ok(soEmTransito.porNF.get('999/1')._estado === 'em_transito',
     'quem casa via `em_transito` sai com _estado correto (nao "?")');
  const soNuncaBipada = montarCruzamentoEspreita({ nunca_bipadas: [{ nf: '888', nf_serie: '1' }] });
  ok(soNuncaBipada.porNF.get('888/1')._estado === 'entregue',
     'quem casa via `nunca_bipadas` tambem (idem)');
}

// ── server.js: uma SO funcao, usada nos 3 lugares ────────────────────
{
  ok(/function montarCruzamentoEspreita\(cache\)/.test(SRV),
     'existe uma funcao unica pro cruzamento da espreita');

  const iFn = SRV.indexOf('function montarCruzamentoEspreita');
  const iFimFn = SRV.indexOf('\napp.get(\'/health\'', iFn);
  const corpo = SRV.slice(iFn, iFimFn);
  ok(/c\.entregues_recentes/.test(corpo) && /c\.nunca_bipadas/.test(corpo) && /c\.em_transito/.test(corpo),
     '  le as 3 listas certas do cache');
  ok(/\.filter\(\(e\) => !e\.baixado\)/.test(corpo), '  filtra baixado');

  // /health: a contagem usa o Map deduplicado, nao concat+filter cru
  const iHealth = SRV.indexOf("app.get('/health'");
  const blocoHealth = SRV.slice(iHealth, iHealth + 4000);
  ok(/montarCruzamentoEspreita\(c\)\.porNF\.size/.test(blocoHealth),
     '/health conta NF UNICA (Map deduplicado), nao concat cru');
  ok(!/nfs_no_cruzamento_qtd: \[\]/.test(blocoHealth),
     '  ⚠️ nao mais o concat+filter que contava duplicata');

  // /api/espreita/casa-nf/:nf: rejeita sem cache, usa a mesma funcao
  const iRota = SRV.indexOf("app.get('/api/espreita/casa-nf/:nf'");
  const blocoRota = SRV.slice(iRota, iRota + 2000);
  ok(/if \(!ESP_CACHE\)/.test(blocoRota) && /res\.status\(503\)/.test(blocoRota),
     'casa-nf: sem cache montado responde 503/inconclusivo, nao "ok:true, casou:false"');
  ok(/montarCruzamentoEspreita\(ESP_CACHE\)/.test(blocoRota),
     '  e usa a mesma funcao do cruzamento real (nao uma 3a copia)');
  ok(/onde: casou \? casou\._estado : null/.test(blocoRota),
     '  `onde` le o _estado marcado por quem monta a lista (nao um campo ausente)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
