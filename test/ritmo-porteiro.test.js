// Roda com: node test/ritmo-porteiro.test.js
//
// O portão local vira CLIENTE do porteiro que mora no Mover-Pedidos.
//
// ⚠️ POR QUE: o limite do Bling é POR CONTA (CNPJ), não por processo. A
// conta `good` é dividida entre este serviço e o módulo `good` do
// Mover-Pedidos — 3 req/s local em cada um soma 6/s e estoura. Foi assim
// que um backfill em dia útil deixou a bipagem da Expedição sem pedido.
//
// ⚠️ E O PORTEIRO NÃO PODE SER PONTO ÚNICO DE FALHA: se ele cair, cada
// serviço segue com o ritmo próprio. Mas "falhar aberto" tem lugar certo —
// só erro de TRANSPORTE. As quatro armadilhas abaixo vieram do Codex na
// revisão do cliente da Expedição, e todas eram falhar aberto no lugar
// errado.

const http = require('http');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const carregar = () => {
  const p = path.join(__dirname, '..', 'lib', 'ritmo-porteiro.js');
  delete require.cache[require.resolve(p)];
  return require(p);
};

(async () => {
  let resposta = { status: 200, corpo: { ok: true } };
  let ultimoHeader = null;
  let ultimaUrl = null;
  let atrasoMs = 0;
  const recebidos = [];

  const servidor = http.createServer(async (req, res) => {
    ultimoHeader = req.headers['x-ritmo-key'] || null;
    ultimaUrl = req.url;
    recebidos.push(req.url);
    if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resposta.corpo));
  });
  await new Promise((r) => servidor.listen(0, r));
  const porta = servidor.address().port;

  process.env.BLING_RITMO_URL = 'http://127.0.0.1:' + porta;
  process.env.BLING_RITMO_KEY = 'chave-ritmo';
  process.env.BLING_RITMO_CONTA = 'good';
  let p = carregar();

  // ── o caminho feliz, e a credencial no HEADER ─────────────────────
  {
    const r = await p.pedirPermissao('operacao');
    ok(r.via === 'porteiro', 'com `ok:true`, o porteiro libera');
    ok(ultimoHeader === 'chave-ritmo', '  mandando a chave no header `x-ritmo-key`');
    ok(!/[?&]k=/.test(ultimaUrl || ''),
       '  e NUNCA na querystring (o porteiro responde 400)');
    ok(/prioridade=operacao/.test(ultimaUrl || ''),
       '  e a fila interativa vira `prioridade=operacao`');
  }

  // ── ⚠️ ARMADILHA 1: `ok` truthy NÃO é `ok === true` ───────────────
  //
  // `{"ok":"false"}` é a STRING "false", que é verdadeira em JS. Uma
  // resposta degradada assim liberaria a fila furando até o ritmo local.
  {
    for (const valorDegradado of ['false', 1, 'sim', {}, []]) {
      resposta = { status: 200, corpo: { ok: valorDegradado } };
      const r = await p.pedirPermissao('operacao');
      ok(r.via !== 'porteiro',
         'NAO libera com `ok: ' + JSON.stringify(valorDegradado) + '` (truthy nao basta)');
    }
  }

  // ── ⚠️ ARMADILHA 2: contenção NÃO vira liberação ──────────────────
  //
  // Porteiro SAUDÁVEL mandando esperar é coordenação funcionando. Chamar o
  // Bling assim mesmo seria furar a fila justo quando a conta está no teto.
  {
    resposta = { status: 200, corpo: { ok: false, esperar_ms: 300 } };
    const r = await p.pedirPermissao('operacao');
    ok(r.via === 'espere' && r.ms === 300,
       'com `esperar_ms`, manda ESPERAR — nao libera nem cai no local');

    resposta = { status: 200, corpo: { ok: false } };
    const r2 = await p.pedirPermissao('fundo');
    ok(r2.via === 'espere',
       '  e `ok:false` sem instrucao tambem e espera, nunca liberacao');
  }

  // ── a pausa global da conta (429 em algum serviço) ────────────────
  {
    resposta = { status: 200, corpo: { ok: false, pausa_s: 120, motivo: '429' } };
    const r = await p.pedirPermissao('operacao');
    ok(r.via === 'espere', 'com `pausa_s`, espera a conta liberar');
    const d = p.diagnostico();
    ok(d.pausa_ativa === true, '  e o diagnostico mostra a pausa ativa');
  }

  // ── erros de CONFIGURAÇÃO caem no local (não adianta retry) ───────
  {
    for (const [st, oque] of [[503, 'porteiro sem chave'], [404, 'chave errada'], [400, 'conta invalida']]) {
      p = carregar();
      resposta = { status: st, corpo: { erro: oque } };
      const r = await p.pedirPermissao('operacao');
      ok(r.via === 'local', 'HTTP ' + st + ' (' + oque + ') -> cai no ritmo local');
    }
  }

  // ── ⚠️ ARMADILHA 3: o primeiro timeout ABRE O CIRCUITO ────────────
  //
  // Se o porteiro aceita conexão e não responde, cada chamada paga o
  // timeout: 100 chamadas = ~100s de espera. Marco indisponível por 30s.
  {
    p = carregar();
    atrasoMs = 6000;              // maior que o timeout de 4s do cliente
    resposta = { status: 200, corpo: { ok: true } };

    const t0 = Date.now();
    const r1 = await p.pedirPermissao('operacao');
    const gastou = Date.now() - t0;
    ok(r1.via === 'local', 'no timeout, cai no ritmo local (nao trava a fila)');
    ok(gastou < 5500, '  e o timeout e curto (' + gastou + 'ms)');

    const antes = recebidos.length;
    const t1 = Date.now();
    const r2 = await p.pedirPermissao('operacao');
    ok(r2.via === 'local' && recebidos.length === antes,
       '  e a chamada seguinte NAO tenta de novo — circuito aberto');
    ok(Date.now() - t1 < 100, '  respondendo na hora (nao paga outro timeout)');
    ok(p.diagnostico().circuito_aberto === true, '  e o diagnostico mostra isso');
    atrasoMs = 0;
  }

  // ── ⚠️ ARMADILHA 4: o 429 estende a pausa, nunca encurta ──────────
  //
  // Se um 429 concorrente trouxer `Retry-After` MAIOR, a pausa tem que
  // crescer — senão os outros serviços voltam com o prazo do primeiro.
  {
    p = carregar();
    resposta = { status: 200, corpo: { ok: true } };
    await p.avisar429(120);
    const d1 = p.diagnostico();
    await p.avisar429(30);          // prazo MENOR chegando depois
    const d2 = p.diagnostico();
    ok(d2.pausa_termina_em_s >= d1.pausa_termina_em_s - 2,
       'um 429 com prazo MENOR nao encurta a pausa que ja vale');

    await p.avisar429(300);         // prazo MAIOR
    ok(p.diagnostico().pausa_termina_em_s > d1.pausa_termina_em_s,
       '  mas um prazo MAIOR estende');
  }

  // ── ⚠️ P1: a PAUSA vale mesmo com o circuito ABERTO ───────────────
  //
  // Estava ao contrario: com o circuito aberto, `disponivel()` devolvia
  // 'local' e a pausa nunca era olhada. Um 429 tomado durante o fallback
  // registrava a pausa, e o retry seguinte chamava o Bling assim mesmo —
  // martelando uma conta que ACABOU de dizer "pare".
  {
    p = carregar();
    atrasoMs = 6000;
    await p.pedirPermissao('operacao');          // abre o circuito
    atrasoMs = 0;
    ok(p.diagnostico().circuito_aberto === true, 'circuito aberto (pre-condicao)');

    await p.avisar429(90);                        // 429 tomado no fallback
    const r = await p.pedirPermissao('operacao');
    ok(r.via === 'espere',
       'com o circuito ABERTO e pausa ativa, ainda manda ESPERAR (nao "local")');
  }

  // ── ⚠️ P2: o aviso-429 recusado NAO conta como sucesso ────────────
  //
  // Com `validateStatus: () => true`, um 400/404/500 resolvia normalmente
  // e eu reportava sucesso — a pausa CENTRAL não foi registrada, os outros
  // serviços não souberam, e ninguém ficou sabendo do silêncio.
  {
    p = carregar();
    resposta = { status: 500, corpo: { erro: 'falhou' } };
    const aceitou = await p.avisar429(60);
    ok(aceitou === false, 'aviso-429 recusado (HTTP 500) devolve false, nao sucesso');
    ok(p.diagnostico().circuito_aberto === true,
       '  e abre o circuito — o porteiro nao esta confiavel agora');
  }

  // ── e nasce DESLIGADO sem as duas envs ────────────────────────────
  {
    delete process.env.BLING_RITMO_URL;
    const p2 = carregar();
    ok(p2.LIGADO === false, 'sem BLING_RITMO_URL, nasce DESLIGADO');
    const r = await p2.pedirPermissao('operacao');
    ok(r.via === 'local', '  e toda permissao cai no ritmo local');
  }

  await new Promise((r) => servidor.close(r));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
