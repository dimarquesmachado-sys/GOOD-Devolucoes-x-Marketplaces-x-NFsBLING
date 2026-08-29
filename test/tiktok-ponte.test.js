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
ok(/ult\.status === 'falhou' \|\| ult\.ok === false/.test(PONTE),
   '  e trata os dois formatos possiveis de "falhou"');
ok(/out\.ok = false;[\s\S]{0,400}a ULTIMA COLETA falhou/.test(PONTE),
   '  coleta que falhou vira ERRO, mesmo com a leitura tendo dado 200');
ok(/nao porque nao ha devolucoes/.test(PONTE),
   '  com mensagem que separa "nao ha devolucoes" de "a coleta quebrou"');

// ── a simulação ──────────────────────────────────────────────────────
{
  // reproduz a decisao final da ponte
  function veredito(corpoLeitura) {
    const ult = corpoLeitura.ultima_coleta;
    if (ult && (ult.status === 'falhou' || ult.ok === false)) return 'erro';
    return 'ok';
  }

  ok(veredito({ devolucoes: [], ultima_coleta: { status: 'falhou', erro: 'token expirado' } }) === 'erro',
     'lista vazia + coleta FALHOU = erro (era o silencio que matava)');
  ok(veredito({ devolucoes: [], ultima_coleta: { status: 'ok' } }) === 'ok',
     'lista vazia + coleta OK = fato: nao ha devolucoes mesmo');
  ok(veredito({ devolucoes: [{ id: 1 }], ultima_coleta: { status: 'ok' } }) === 'ok',
     'lista cheia + coleta ok = normal');
  ok(veredito({ devolucoes: [{ id: 1 }], ultima_coleta: { ok: false, erro: 'x' } }) === 'erro',
     'lista CHEIA mas coleta falhou tambem e erro — o dado pode estar velho');
  ok(veredito({ devolucoes: [] }) === 'ok',
     'sem o campo (versao antiga de la), nao inventa erro');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
