// Roda com: node test/telemetria-eixo.test.js
//
// Penúltimo item do parecer: "o /health atual é inventário instantâneo, não
// evidência operacional".
//
// ⚠️ O critério de saída da sombra é "nenhum uso inesperado de fallback
// local" — e isso não dá para afirmar olhando um retrato. Precisa de
// contagem, e de alguém dizendo o que a contagem significa.

const http = require('http');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const carregar = () => {
  const p = path.join(__dirname, '..', 'lib', 'token-leitor.js');
  delete require.cache[require.resolve(p)];
  return require(p);
};

(async () => {
  let resposta = { status: 200, corpo: { access: 'T1', expira_em: null, versao: 1 } };
  const servidor = http.createServer((req, res) => {
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resposta.corpo));
  });
  await new Promise((r) => servidor.listen(0, r));
  process.env.MOVER_PEDIDOS_URL = 'http://127.0.0.1:' + servidor.address().port;
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'k';
  for (const k of Object.keys(process.env)) if (k.startsWith('TOKEN_POLITICA_')) delete process.env[k];

  // ── ⚠️ a FONTE separa `remoto` de `cache` ─────────────────────────
  //
  // Os dois "funcionaram", mas só o primeiro prova que a rota do dono
  // respondeu AGORA. Somar os dois esconderia um dono fora do ar por até
  // 5 minutos.
  {
    const p = carregar();
    await p.resolverToken('good', 'ml');
    await p.resolverToken('good', 'ml');
    const m = p.diagnostico().telemetria.por_eixo['good/ml'];
    ok(m.fonte.remoto === 1 && m.fonte.cache === 1,
       'a fonte separa `remoto` (a rota respondeu) de `cache` (nao chamou)');
  }

  // ── ⚠️ o veredito muda quando o dono falha ────────────────────────
  //
  // É o ponto todo: em sombra, cair no local significa que o dono não
  // entregou. Cortar assim transformaria cada uma dessas em FALHA.
  {
    const p = carregar();
    await p.resolverToken('good', 'bling');
    ok(p.vereditoDeCorte()['good/bling'].pronto === true,
       'com o dono respondendo, o eixo aparece como PRONTO');

    resposta = { status: 502, corpo: {} };
    p.invalidar('good', 'bling');
    await p.resolverToken('good', 'bling');

    const v = p.vereditoDeCorte()['good/bling'];
    ok(v.pronto === false, '⚠️ um unico fallback local derruba o veredito');
    ok(/caiu no local/.test(v.por_que || ''), '  e diz POR QUE (' + v.por_que + ')');
  }

  // ── sem tráfego não é "pronto" ────────────────────────────────────
  //
  // ⚠️ Zero fallback com zero leitura é o estado de quem acabou de subir.
  // Ler isso como "tudo certo" seria cortar às cegas.
  {
    const p = carregar();
    const v = p.vereditoDeCorte()['good/ml'];
    ok(v.pronto === false && /sem trafego/.test(v.por_que),
       'sem trafego medido, NAO e pronto (zero-zero nao prova nada)');
  }

  // ── e o `desde` diz de quando é a conta ───────────────────────────
  //
  // O reinício zera os contadores. Sem o `desde`, alguém leria "0 fallback"
  // logo após um deploy como prova de saúde.
  {
    const p = carregar();
    const t = p.diagnostico().telemetria;
    ok(typeof t.desde === 'string' && t.desde.includes('T'),
       'a telemetria diz DESDE QUANDO conta (o reinicio zera)');
  }

  // ── as invalidações são separadas por status ──────────────────────
  //
  // 403 em volume pode ser permissão faltando, não token vencido — somar
  // com 401 esconderia isso.
  {
    const p = carregar();
    p.anotarInvalidacao('good', 'ml', 401);
    p.anotarInvalidacao('good', 'ml', 403);
    p.anotarInvalidacao('good', 'ml', 403);
    const inv = p.diagnostico().telemetria.por_eixo['good/ml'].invalidacoes;
    ok(inv.por_401 === 1 && inv.por_403 === 2,
       '401 e 403 sao contados separados (403 em volume pode ser permissao)');
  }

  // ── ⚠️ e a telemetria não guarda token ────────────────────────────
  {
    const p = carregar();
    await p.resolverToken('good', 'ml').catch(() => {});
    // ⚠️ meu primeiro detector procurava o literal "T1" e acusou o
    // `2026-09-09T16:59` do timestamp — o T1 do ISO 8601. Falso positivo
    // num teste de vazamento e o pior tipo: ensina a ignorar o vermelho
    // justamente onde ele nao pode ser ignorado.
    //
    // Agora olho as CHAVES da estrutura, nao o texto serializado.
    const chaves = [];
    const varrer = (o) => {
      for (const [k, v2] of Object.entries(o || {})) {
        chaves.push(k);
        if (v2 && typeof v2 === 'object') varrer(v2);
      }
    };
    varrer(p.diagnostico().telemetria);
    const suspeitas = chaves.filter((k) => /access|token|secret|refresh/i.test(k));
    ok(suspeitas.length === 0,
       'a telemetria NAO tem campo de token'
       + (suspeitas.length ? ' (SUSPEITO: ' + suspeitas.join(', ') + ')' : ''));
  }

  await new Promise((r) => servidor.close(r));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
