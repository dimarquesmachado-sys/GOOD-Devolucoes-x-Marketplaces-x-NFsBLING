// Roda com: node test/token-leitor.test.js
//
// PASSO 2: o Devoluções LÊ o token do dono (Mover-Pedidos) em vez de
// renovar. Este teste sobe um servidor falso e exercita cada resposta do
// contrato de leitura.
//
// ⚠️ O QUE ESTÁ EM JOGO: o refresh do ML é de USO ÚNICO. Enquanto os dois
// serviços renovam as mesmas contas, um consome o refresh do outro. Este
// módulo é o primeiro passo para matar isso — e um bug aqui não aparece
// como erro, aparece como token morto no meio do expediente.

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
  let resposta = { status: 200, corpo: { access: 'TOKEN-1', expira_em: null, versao: 1 } };
  let chamadas = 0;
  let ultimoHeader = null;
  let ultimaUrl = null;

  const servidor = http.createServer((req, res) => {
    chamadas++;
    ultimoHeader = req.headers['x-token-leitura'] || null;
    ultimaUrl = req.url;
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resposta.corpo || {}));
  });
  await new Promise((r) => servidor.listen(0, r));
  const porta = servidor.address().port;

  process.env.MOVER_PEDIDOS_URL = 'http://127.0.0.1:' + porta;
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'chave-de-teste';
  const tl = carregar();

  // ── a leitura básica, e a AUTH por header ─────────────────────────
  {
    const t = await tl.lerToken('good', 'bling');
    ok(t === 'TOKEN-1', 'le o access do dono');
    ok(ultimoHeader === 'chave-de-teste',
       '  mandando a chave no HEADER `x-token-leitura`');
    // ⚠️ a querystring foi BANIDA pelo dono: credencial em URL fica em log
    // de proxy e em URL copiada. Se eu mandasse `?k=`, levaria 400.
    ok(!/[?&]k=/.test(ultimaUrl || ''),
       '  e NUNCA na querystring (o dono responde 400 se eu mandar)');
  }

  // ── o cache: a 2ª leitura não chama de novo ───────────────────────
  {
    const antes = chamadas;
    const t = await tl.lerToken('good', 'bling');
    ok(t === 'TOKEN-1' && chamadas === antes,
       'a 2a leitura vem do cache (nao chamou o dono)');
  }

  // ── ⚠️ o 401 invalida NA HORA, sem esperar o TTL ──────────────────
  //
  // É a regra contra-intuitiva do contrato: quem lê "TTL 5 min" tende a
  // achar que o 401 é redundante. É o contrário — `expira_em` vem null
  // (o dono renova por 401 e não expõe o instante), então o relógio não
  // serve como sinal. Sem esta invalidação, um token morto sobreviveria
  // 5 minutos, levando 401 a cada chamada.
  {
    resposta = { status: 200, corpo: { access: 'TOKEN-2', expira_em: null, versao: 2 } };
    tl.invalidar('good', 'bling');
    const antes = chamadas;
    const t = await tl.lerToken('good', 'bling');
    ok(t === 'TOKEN-2' && chamadas === antes + 1,
       'apos invalidar, re-pede ao dono e pega o token NOVO');
  }

  // ── 404: a empresa não tem a integração (GOOD/tiktok) ─────────────
  {
    resposta = { status: 404, corpo: { erro: 'integracao ausente' } };
    const t = await tl.lerToken('good', 'tiktok');
    ok(t === null, '404 (integracao ausente) devolve null, sem quebrar');
    const antes = chamadas;
    await tl.lerToken('good', 'tiktok');
    ok(chamadas === antes,
       '  e fica no cache: 404 e resposta CORRETA, nao vale re-pedir');
  }

  // ── 501: integração ainda sem leitor no dono ──────────────────────
  {
    resposta = { status: 501, corpo: { erro: 'sem leitor' } };
    const t = await tl.lerToken('ambtotal', 'magalu');
    ok(t === null, '501 (sem leitor ainda) devolve null');
  }

  // ── ⚠️ 502: falha PASSAGEIRA — não pode virar cache ───────────────
  //
  // O dono avisou: "re-peçam em instantes — a renovação segue em
  // background". Se eu cacheasse o vazio por 5 min, transformaria um
  // soluço de segundos num apagão de minutos.
  {
    resposta = { status: 502, corpo: { erro: 'falha de aquisicao' } };
    const t1 = await tl.lerToken('good', 'ml');
    ok(t1 === null, '502 (falha de aquisicao) devolve null');

    resposta = { status: 200, corpo: { access: 'TOKEN-3', expira_em: null, versao: 3 } };
    const t2 = await tl.lerToken('good', 'ml');
    ok(t2 === 'TOKEN-3',
       '  e a proxima leitura JA pega o token (o 502 nao foi cacheado)');
  }

  // ── o dono fora do ar: silêncio, porque há rede local ─────────────
  //
  // ⚠️ Derrubar a bipagem porque o outro serviço caiu seria trocar um
  // problema invisível (a corrida do refresh) por um visível no galpão.
  {
    await new Promise((r) => servidor.close(r));
    tl.invalidar('good', 'bling');
    let lancou = false;
    let t = 'nao-executou';
    try { t = await tl.lerToken('good', 'bling'); } catch (e) { lancou = true; }
    ok(!lancou, 'com o dono FORA DO AR, nao lanca');
    ok(t === null, '  devolve null — quem chama cai na renovacao local (a rede)');
  }

  // ── e o diagnóstico não vaza token ────────────────────────────────
  {
    const d = tl.diagnostico();
    const cru = JSON.stringify(d);
    ok(!/TOKEN-[0-9]/.test(cru),
       'o diagnostico NAO expoe o token (so se tem, e a idade)');
    ok(d.configurado === true && typeof d.ttl_s === 'number',
       '  mas diz se esta configurado e qual o TTL');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
