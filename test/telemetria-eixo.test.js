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

  // ── ⚠️ NENHUMA ANOTACAO DEPOIS DE UM `return` ────────────────────
  //
  // Meu script de edicao inseriu `anotarRetry` DEPOIS do `return` em dois
  // blocos, e APAGOU o `return` em outros dois. O primeiro caso e pior: o
  // codigo compila, o teste unitario da funcao passa, e o contador fica em
  // ZERO pra sempre — justamente o numero que deveria provar que o retry
  // funciona.
  //
  // `node --check` nao pega: linha inalcancavel e sintaxe valida.
  //
  // b267.2 (Codex) - ⚠️ ESTE DETECTOR TINHA UM PONTO CEGO: so olhava a linha
  // IMEDIATAMENTE anterior. O bug real (lib/ml.js e lib/bling.js, retry em
  // politica `remoto`) tinha um bloco de 4 linhas de comentario ENTRE o
  // `return` morto e o `anotarRetry` inalcancavel — 'mortas' dava zero e o
  // teste passava com o bug vivo. Agora ando pra tras pulando comentario e
  // linha em branco ate achar o codigo de verdade.
  {
    const fs3 = require('fs');
    const RAIZ3 = path.join(__dirname, '..');
    for (const arq of ['lib/ml.js', 'lib/bling.js']) {
      const linhas = fs3.readFileSync(path.join(RAIZ3, arq), 'utf8').split('\n');
      let mortas = 0;
      let semRetorno = 0;
      linhas.forEach((l, i) => {
        if (!/anotarRetry\(.*, true\)/.test(l)) return;
        let j = i - 1;
        while (j >= 0 && (linhas[j].trim() === '' || linhas[j].trim().startsWith('//'))) j--;
        const anterior = (linhas[j] || '').trim();
        const seguinte = (linhas[i + 1] || '').trim();
        if (anterior.startsWith('return ')) mortas++;          // inalcancavel
        if (!seguinte.startsWith('return { ok: true')) semRetorno++;
      });
      ok(mortas === 0, arq + ': nenhuma anotacao DEPOIS de um return, pulando comentarios (seria linha morta)');
      ok(semRetorno === 0, '  e cada uma e seguida do return de sucesso');
    }
  }

  // ── ⚠️ TODA saida anota, por CONSTRUCAO ──────────────────────────
  //
  // O Codex apontou a mesma classe DUAS vezes: eu anotava saida por saida
  // e esquecia algumas. Ia continuar apontando, porque cada saida nova
  // nasceria sem anotacao.
  //
  // A correcao nao foi cobrir as que faltavam — foi mover a anotacao pro
  // PONTO UNICO de saida. Entao o teste guarda a ESTRUTURA, nao os casos:
  // se alguem voltar a anotar espalhado, ou criar um `return` cru na
  // funcao interna sem passar pelo embrulho, isto acusa.
  {
    const fs4 = require('fs');
    const src = fs4.readFileSync(path.join(__dirname, '..', 'lib', 'token-leitor.js'), 'utf8');

    const anotacoesDeEstado = (src.match(/anotar\(empresa, integracao, 'estado'/g) || []).length;
    ok(anotacoesDeEstado === 1,
       'a anotacao de estado acontece em UM lugar so (achei ' + anotacoesDeEstado + ')');

    ok(/async function lerTokenDetalhado[\s\S]{0,900}lerTokenBruto\(empresa, integracao\)/.test(src),
       '  e ela embrulha a funcao interna (saida nova entra coberta)');
  }

  // e, por garantia, os casos que eu tinha esquecido
  {
    const p2 = carregar();
    delete process.env.ADMIN_TOKEN_LEITURA_KEY;
    const p3 = carregar();
    await p3.lerTokenDetalhado('good', 'ml');
    const e = p3.diagnostico().telemetria.por_eixo['good/ml'].estados;
    ok(e.nao_configurado === 1,
       '`nao_configurado` aparece nos estados (era uma das 3 que escapavam)');
    process.env.ADMIN_TOKEN_LEITURA_KEY = 'k';
  }

  // ── ⚠️ o CACHE nao carimba `ultimo_sucesso` ──────────────────────
  //
  // Com o dono FORA e o cache quente, o /health mostraria "sucesso ha 3
  // segundos" enquanto ninguem fala com ele ha 5 minutos. O campo mais
  // confiavel do painel viraria o mais enganoso.
  {
    const p2 = carregar();
    resposta = { status: 200, corpo: { access: 'T', expira_em: null, versao: 1 } };
    await p2.lerTokenDetalhado('good', 'ml');
    const antes = p2.diagnostico().telemetria.por_eixo['good/ml'].ultimo_sucesso;

    await new Promise((r) => setTimeout(r, 1100));
    await p2.lerTokenDetalhado('good', 'ml');          // vem do cache
    const m2 = p2.diagnostico().telemetria.por_eixo['good/ml'];

    ok(m2.ultimo_sucesso === antes,
       'o cache NAO carimba `ultimo_sucesso` (so a leitura remota carimba)');
    ok(!!m2.ultimo_do_cache,
       '  e o cache tem carimbo PROPRIO, separado e honesto');
  }

  // ── ⚠️ `ausente` e `nao_implementado` NAO sao falha ──────────────
  //
  // Achei auditando a funcao inteira, nao veio de apontamento. 404 = a
  // empresa nao tem a integracao (GOOD/tiktok e o caso real); 501 = o dono
  // ainda nao implementou. Carimbar como falha deixaria o painel parecendo
  // degradado PRA SEMPRE num eixo que nunca vai existir — e ai ninguem
  // olha mais o painel.
  {
    const p3 = carregar();
    resposta = { status: 404, corpo: {} };
    await p3.lerTokenDetalhado('good', 'tiktok');
    const m3 = p3.diagnostico().telemetria.por_eixo['good/tiktok'];
    ok(!m3.ultima_falha,
       '`ausente` (404) NAO marca ultima_falha — e resposta correta, nao erro');
    ok(m3.estados.ausente === 1, '  mas aparece nos estados (nao some)');
  }

  // ── e a latencia da FALHA tambem e medida ────────────────────────
  //
  // Dono lento e o sintoma que antecede o timeout — medir so o sucesso
  // esconderia justamente a degradacao.
  {
    const p4 = carregar();
    resposta = { status: 502, corpo: {} };
    await p4.lerTokenDetalhado('good', 'bling');
    const m4 = p4.diagnostico().telemetria.por_eixo['good/bling'];
    ok(m4.latencia_ms.ultima !== null,
       'a latencia da FALHA e medida (dono lento antecede o timeout)');
  }

  // ── ⚠️ UMA FONTE POR PERGUNTA no diagnostico ─────────────────────
  //
  // O `pronto_pra_cortar` afirmava PRONTO olhando so a fiacao, enquanto o
  // `pode_cortar` — vizinho no MESMO json — dizia NAO com base na
  // evidencia. Quem lesse o primeiro cortaria um eixo inseguro.
  {
    const p5 = carregar();
    const d = p5.diagnostico();
    ok(d.pronto_pra_cortar === undefined,
       'nenhum campo afirma "pronto" sem olhar a evidencia');
    ok(d.ainda_local === undefined,
       '  e nenhum repete o que `eixos` ja diz');

    // e o veredito nomeia CADA causa, nao so "caiu no local"
    const causas = ['ADMIN_TOKEN_LEITURA_KEY ausente', 'config_invalida',
                    'nunca teve token pra este eixo'];
    const fonte = require('fs').readFileSync(
      path.join(__dirname, '..', 'lib', 'token-leitor.js'), 'utf8');
    for (const c of causas) {
      ok(fonte.includes(c), '  o veredito sabe dizer: ' + c);
    }
  }

  await new Promise((r) => servidor.close(r));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
