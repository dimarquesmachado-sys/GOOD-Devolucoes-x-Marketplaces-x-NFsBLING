// Roda com: node test/tiktok-ponte.test.js
//
// A ponte com o Mover-Pedidos, onde moram os tokens do TikTok.
//
// Em 29/08 o outro serviço mudou o contrato (PR #272 de lá): a coleta
// passou a responder 202 na hora e coletar em background — por causa do
// 502 que a coleta de 60 dias dava aqui. E ganhou o campo `ultima_coleta`,
// que diz se a última coleta deu certo.
//
// Esse campo é o que impede o silêncio: o aviso de lá foi explícito —
// "a coleta do TikTok resolve com erro em vez de lançar, então sem isso
// vocês veriam '0 devoluções' achando que está certo". É exatamente o que
// nos custou uma noite com a Shopee.

const fs = require('fs');
const path = require('path');
const PONTE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-ponte.js'), 'utf8');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// ── coleta em background ─────────────────────────────────────────────
ok(/esperar: esperar \? 1 : undefined/.test(PONTE),
   'a ponte manda ?esperar=1 quando quem chamou quer o resultado antes de ler');
ok(/timeoutMs: esperar \? 120000 : 30000/.test(PONTE),
   '  com timeout maior no modo esperar, e curto no disparo (que volta 202)');
ok(/c\.http === 202 \? 'em background' : 'concluida'/.test(PONTE),
   '  e diz qual dos dois aconteceu');

// ── a invariante da loja, afrouxada no lugar certo ───────────────────
ok(/if \(c\.corpo && c\.corpo\.loja && c\.corpo\.loja !== loja\)/.test(PONTE),
   'loja DIFERENTE na coleta continua sendo erro (nunca aceitar efeito de loja que nao pedi)');
ok(/aviso_coleta/.test(PONTE),
   '  mas coleta SEM loja virou aviso: o 202 e "aceitei", nao "terminei"');
ok(/if \(r\.corpo\.loja !== loja\)/.test(PONTE),
   '  e a LEITURA continua recusando loja errada — e la que o dado chega');

// ── o campo que impede o "zero devolucoes" enganoso ──────────────────
ok(/const ult = r\.corpo\.ultima_coleta;/.test(PONTE), 'a ponte le o ultima_coleta');
ok(/String\(ult\.estado \|\| ''\)\.toLowerCase\(\) === 'falhou'/.test(PONTE),
   '  pelo campo REAL (estado), medido na tela em 29/08');
ok(/String\(ult\.status \|\| ''\)\.toLowerCase\(\) === 'falhou'/.test(PONTE),
   '  e por status tambem, pra nao depender de qual nome o outro servico usa');
ok(/out\.ok = false;[\s\S]{0,400}a ULTIMA COLETA falhou/.test(PONTE),
   '  coleta que falhou vira ERRO, mesmo com a leitura tendo dado 200');
ok(/nao porque nao ha devolucoes/.test(PONTE),
   '  com mensagem que separa "nao ha devolucoes" de "a coleta quebrou"');

// ── b343.1: coleta ENFILEIRADA nao vira "ok" com dado velho ──────────
ok(/if \(out\.coleta_enfileirada \|\| aindaRodando\)/.test(PONTE),
   'coleta enfileirada OU ainda rodando e sinalizada, nao reportada como completa');
ok(/const ESTADOS_RODANDO = /.test(PONTE), '  reconhecendo os varios nomes de "rodando"');
ok(!/String\(q\.esperar \|\| ''\) !== '1'\) \{/.test(PONTE),
   '  e o 202 vale mesmo com ?esperar=1 (a resposta DELE manda, nao o meu parametro)');
ok(/coleta_pendente = true/.test(PONTE), '  marcando coleta_pendente');
ok(/a lista abaixo e do estado ANTERIOR/.test(PONTE),
   '  e dizendo em texto que o dado e de antes (era a mesma falha silenciosa, por outro caminho)');
ok(/estadoFalhou/.test(PONTE),
   '  e a falha e reconhecida pelo campo REAL (`estado`), nao so por `status`');

// ── b343.1: tolerar falta de `loja` SO no 202 ────────────────────────
ok(/if \(c\.http !== 202\) \{[\s\S]{0,300}SEM identificar a loja/.test(PONTE),
   '200 sem `loja` volta a ser ERRO (pode ter coletado a loja padrao em silencio)');
ok(/out\.aviso_coleta = 'coleta aceita em background \(202\)/.test(PONTE),
   '  e so o 202 ganha o beneficio da duvida');

// ── a simulação ──────────────────────────────────────────────────────
{
  // reproduz a decisao final da ponte
  function veredito(corpoLeitura) {
    const ult = corpoLeitura.ultima_coleta;
    // o campo real e `estado` (medido: estado:"falhou"); `status` fica por
    // compatibilidade, e ok:false idem
    if (ult && (String(ult.estado||'').toLowerCase()==='falhou'
             || String(ult.status||'').toLowerCase()==='falhou'
             || ult.ok === false)) return 'erro';
    return 'ok';
  }

  ok(veredito({ devolucoes: [], ultima_coleta: { status: 'falhou', erro: 'token expirado' } }) === 'erro',
     'lista vazia + coleta FALHOU = erro (era o silencio que matava)');
  // o formato REAL, medido na tela em 29/08
  ok(veredito({ devolucoes: [], ultima_coleta: { estado: 'falhou', erro: "return_orders: Expired credentials" } }) === 'erro',
     '  com o campo `estado`, que e o nome de verdade na resposta');
  ok(veredito({ devolucoes: [], ultima_coleta: { status: 'ok' } }) === 'ok',
     'lista vazia + coleta OK = fato: nao ha devolucoes mesmo');
  ok(veredito({ devolucoes: [{ id: 1 }], ultima_coleta: { status: 'ok' } }) === 'ok',
     'lista cheia + coleta ok = normal');
  ok(veredito({ devolucoes: [{ id: 1 }], ultima_coleta: { ok: false, erro: 'x' } }) === 'erro',
     'lista CHEIA mas coleta falhou tambem e erro — o dado pode estar velho');
  ok(veredito({ devolucoes: [] }) === 'ok',
     'sem o campo (versao antiga de la), nao inventa erro');

  // b343.1: a decisao com coleta enfileirada
  function vereditoComColeta(corpo, enfileirada, esperar) {
    if (enfileirada && esperar !== '1') return 'pendente';
    return veredito(corpo);
  }
  ok(vereditoComColeta({ devolucoes: [], ultima_coleta: { status: 'ok' } }, true, undefined) === 'pendente',
     'coleta recem-enfileirada: resposta diz PENDENTE, nao "ok, zero devolucoes"');
  // b343.2: coleta de OUTRA chamada, ainda rodando — o caso que o dono viu
  function vereditoCompleto(corpo, enfileirada) {
    const ult = corpo.ultima_coleta;
    const ehRodando = (v) => ['rodando','em_andamento','pendente','running','pending']
      .indexOf(String(v || '').toLowerCase()) !== -1;
    const rodando = ult && (ehRodando(ult.estado) || ehRodando(ult.status));
    if (enfileirada || rodando) return 'pendente';
    return veredito(corpo);
  }
  ok(vereditoCompleto({ devolucoes: [], ultima_coleta: { status: 'running' } }, false) === 'pendente',
     'rodando pelo campo STATUS tambem conta (sustentamos os dois nomes na falha; tinha que ser igual aqui)');
  ok(vereditoCompleto({ devolucoes: [], ultima_coleta: { estado: 'rodando' } }, false) === 'pendente',
     'coleta de outra chamada AINDA RODANDO: pendente (era o "ok:true" que ele viu na tela)');
  ok(vereditoCompleto({ devolucoes: [], ultima_coleta: { estado: 'falhou', erro: 'x' } }, false) === 'erro',
     '  coleta terminada em falha segue como erro');
  ok(vereditoCompleto({ devolucoes: [{ id: 1 }], ultima_coleta: { estado: 'ok' } }, false) === 'ok',
     '  e terminada com sucesso, normal');
  ok(vereditoComColeta({ devolucoes: [{ id: 1 }], ultima_coleta: { status: 'ok' } }, false, undefined) === 'ok',
     '  e leitura sem coleta segue normal');

  // a tolerancia da loja, por status
  function lojaOk(http, temLoja) {
    if (temLoja) return 'ok';
    return http === 202 ? 'aviso' : 'erro';
  }
  ok(lojaOk(202, false) === 'aviso', '202 sem loja: aviso (aceitei o pedido, nao terminei)');
  ok(lojaOk(200, false) === 'erro', '200 sem loja: ERRO (pode ter coletado a loja padrao)');
  ok(lojaOk(200, true) === 'ok', '200 com loja: normal');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
