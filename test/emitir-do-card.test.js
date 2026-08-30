// Roda com: node test/emitir-do-card.test.js
//
// [stated] "se tá ali, pode até criar gerar automático esse registro. pq no
// fim, o q vai interessar mm é a emissão da NF e pra qual depósito eu vou
// direcionar"
//
// POR QUE PRECISA REGISTRAR: quem emite a NF de devolucao e a extensao
// Bridge, e ela grava o resultado usando o id de uma TRIAGEM. Os casos do
// card de estornadas nao tem triagem — ninguem bipou, o produto nem sempre
// voltou. Entao o registro e criado na hora em que ele manda emitir.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const PAINEL = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');

// ── a rota que registra ──────────────────────────────────────────────
{
  const i = SERVER.indexOf("'/api/admin/sem-retorno/registrar'");
  ok(i !== -1, 'ha rota que registra o caso pra poder emitir');
  const rota = SERVER.slice(i, i + 4000);

  ok(/tipo: 'aprovado'/.test(rota),
     'o registro entra como APROVADO — cai na fila normal de "aguardando NF"');
  ok(/\.eq\('order_id', pedido\)/.test(rota),
     'e confere se JA existe antes de criar');
  ok(/ja_existia: true/.test(rota),
     '  devolvendo o id do existente: clicar duas vezes nao cria dois registros');
  ok(/nf_ja_emitida: !!existentes\[0\]\.nf_devolucao_id_bling/.test(rota),
     '  e avisando quando a NF ja saiu');

  ok(/\[ESTORNADA SEM RETORNO\]/.test(rota),
     'o registro carrega o RASTRO de onde veio');
  ok(/NAO houve bipagem: a mercadoria pode nao ter voltado/.test(rota),
     '  dizendo que nao houve bipagem — quem olhar depois precisa saber');

  ok(/sem pedido, nao da pra registrar/.test(rota), 'e sem pedido, recusa');
}

// ── a correcao dele sobre o estoque ──────────────────────────────────
{
  ok(/A NF DE VENDA JA[\s\S]{0,40}DEU BAIXA no estoque/.test(SERVER),
     'o comentario registra POR QUE a entrada nao duplica estoque');
  ok(/é só gerar devolução normal, e depósito Geral/.test(SERVER),
     '  com a correcao dele, que estava certa e a minha preocupacao nao');
}

// ── o botao e a funcao no card ───────────────────────────────────────
{
  const iFn = PAINEL.indexOf('async function gerarDoCardEstornadas');
  ok(iFn !== -1, 'ha funcao que registra e abre o modal');
  const fn = PAINEL.slice(iFn, iFn + 3000);

  ok(/sem-retorno\/registrar/.test(fn), '  chamando a rota de registro');
  ok(/abrirModalGerarDevolucao\(\s*String\(j\.id\)/.test(fn),
     'e caindo no MESMO modal das "Aprovadas" — nao duplico fluxo de emissao');
  ok(/JÁ tem NF de devolução emitida/.test(fn),
     'com aviso quando a NF ja saiu: duas notas da mesma venda e problema fiscal');
  ok(/j\.ja_existia/.test(fn), '  e avisando quando o caso ja estava registrado');
  ok(/dados do card ilegíveis/.test(fn), 'JSON quebrado nao vira excecao solta');

  ok(/🧾 Gerar NF de devolução<\/button>/.test(PAINEL), 'e o botao aparece no card');
  ok(/x\.nf_id_bling\s*\?[\s\S]{0,200}gerarDoCardEstornadas/.test(PAINEL),
     '  so quando a NF foi localizada no Bling — sem ela o modal nao saberia de qual gerar');
}

// ── o JSON no atributo aguenta texto real ────────────────────────────
{
  const montar = (d) => JSON.stringify(JSON.stringify(d)).replace(/'/g, '&#39;');
  const comApostrofo = { pedido: '1', produto: "Lustre 8' Dourado d'agua" };
  const attr = montar(comApostrofo);
  ok(!attr.includes("'"), 'produto com APOSTROFO nao quebra o atributo HTML');

  const voltou = JSON.parse(JSON.parse(attr.replace(/&#39;/g, "'")));
  ok(voltou.produto === comApostrofo.produto, '  e o texto sobrevive de volta inteiro');

  const comAspas = montar({ produto: 'Globo 15" Branco' });
  ok(JSON.parse(JSON.parse(comAspas)).produto === 'Globo 15" Branco',
     'e com aspas duplas tambem');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
