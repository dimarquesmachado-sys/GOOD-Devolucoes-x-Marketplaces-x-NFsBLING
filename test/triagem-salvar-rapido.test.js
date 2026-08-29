// Roda com: node test/triagem-salvar-rapido.test.js
//
// Guarda o BO de 29/08: "Salvando..." travado depois de bipar o EAN, e
// triagem duplicada (mesmo shipment 47501559178, dois registros, 2 min de
// diferenca).
//
// As duas coisas tinham a MESMA causa. A rota consultava o Bling ANTES de
// gravar — ate 12 paginas com teto de 20s no /aprovar, e 50 paginas SEM
// teto nenhum no /problema e no /divergente. Isso (a) segurava o botao e
// (b) era a janela em que uma segunda requisicao passava pela checagem de
// duplicata, porque a primeira ainda nao tinha gravado.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
const TRIAGEM = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'triagem.js'), 'utf8');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

function rota(nome) {
  const i = SERVER.indexOf("app.post('/api/triagem/" + nome + "'");
  if (i === -1) return '';
  const fim = SERVER.indexOf('\n});', i);
  return SERVER.slice(i, fim);
}

const ROTAS = ['aprovar', 'problema', 'divergente'];

// ── nenhuma rota de triagem espera o Bling pra gravar ────────────────
ROTAS.forEach((r) => {
  const src = rota(r);
  ok(src.length > 0, '/api/triagem/' + r + ' existe');
  ok(!/await buscarPedidoBlingPorNumeroLoja/.test(src),
     '  nao busca o pedido no Bling antes de gravar');
  ok(!/await buscarNFePorId/.test(src),
     '  nem os itens da NF');
  ok(/agendarEnriquecimento\(data\.id, dados\)/.test(src),
     '  e agenda o enriquecimento depois de gravar');
});

// ── o enriquecimento faz o trabalho que saiu do caminho ──────────────
{
  const i = SERVER.indexOf('async function enriquecerTriagem');
  const src = SERVER.slice(i, SERVER.indexOf('\n}', SERVER.indexOf('[TRIAGEM] enriquecimento falhou')));
  ok(/buscarPedidoBlingPorNumeroLoja/.test(src), 'o enriquecimento busca o numero do pedido');
  ok(/buscarNFePorId/.test(src), '  e os itens da NF');
  ok(/\.update\(patch\)/.test(src), '  e completa o registro ja gravado');
  ok(/setTimeout\(\(\) => resolve\(\{ ok: false, timeout: true \}\), 25000\)/.test(SERVER),
     '  com teto proprio, pra nao ficar preso pra sempre em background');

  const ag = SERVER.slice(SERVER.indexOf('function agendarEnriquecimento'), SERVER.indexOf('async function enriquecerTriagem'));
  ok(/setImmediate/.test(ag), 'o agendamento sai do caminho da resposta');
  ok(/\.catch\(/.test(ag), '  e tem catch (promessa sem dono derruba o processo)');
}

// ── a duplicata agora morre no banco, nao so na checagem ─────────────
{
  ROTAS.forEach((r) => {
    ok(/error\.code === '23505'/.test(rota(r)),
       '/api/triagem/' + r + ' trata a recusa de unicidade do banco (23505)');
  });
  ok(/erro: 'duplicata'/.test(rota('aprovar')),
     '  e responde com o MESMO codigo da checagem antiga (a tela ja sabe tratar)');
  ok(fs.existsSync(path.join(RAIZ, 'docs', 'INDICE-UNICO-TRIAGEM.md')),
     'o SQL do indice unico esta documentado (falta rodar no Supabase)');
  const doc = fs.readFileSync(path.join(RAIZ, 'docs', 'INDICE-UNICO-TRIAGEM.md'), 'utf8');
  ok(/CREATE UNIQUE INDEX/.test(doc), '  com o CREATE UNIQUE INDEX');
  ok(/WHERE shipment_id IS NOT NULL/.test(doc),
     '  e o WHERE que deixa de fora quem nao tem shipment_id (senao colidiriam entre si)');
  ok(/SELECT shipment_id, COUNT/.test(doc),
     '  e a consulta pra achar duplicata ANTES de criar o indice');
}

// ── o front tambem nao segura o botao esperando o Bling ──────────────
{
  ok(!/const r = await fetch\(url\);/.test(TRIAGEM),
     'nenhuma busca do front espera sem teto');
  const races = (TRIAGEM.match(/Promise\.race\(\[/g) || []).length;
  ok(races === 3, '  os 3 fluxos (aprovar, problema, divergente) tem teto — achei ' + races);
  ok(/setTimeout\(\(\) => resolve\(null\), 4000\)/.test(TRIAGEM), '  de 4 segundos');
  ok(/if \(d && d\.ok && d\.nf\)/.test(TRIAGEM),
     '  e o codigo aguenta a resposta vazia do teto (era d.ok direto: quebraria)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
