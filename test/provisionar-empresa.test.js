// Roda com: node test/provisionar-empresa.test.js
//
// [stated 05/09] "não tem como criar automático essas tabelas supabase, a
// partir do momento q for embarcar a empresa nova?"
//
// Dá — mas é DDL, e DDL errado apaga trabalho de meses. Este teste guarda
// as travas: o sufixo sai da ficha (não é inventado), tem formato fixo, e
// as empresas que já existem são recusadas.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const { sufixoDaFicha, provisionarEmpresa, SUFIXO_VALIDO, RESERVADOS } =
  require('../lib/provisionar-empresa');

// ── o sufixo sai da FICHA ───────────────────────────────────────────
//
// Não invento o nome da tabela: leio do registro. Se a ficha disser
// `devolucoes_gira`, crio `_gira` — assim o que é criado bate exatamente
// com o que o sistema vai procurar depois.
{
  ok(sufixoDaFicha({ tabelas: { devolucoes: 'devolucoes_gira' } }).sufixo === '_gira',
     'o sufixo e deduzido do nome real da tabela na ficha');

  for (const [rot, ficha] of [
    ['ficha sem tabelas', { tabelas: {} }],
    ['nome fora do padrao', { tabelas: { devolucoes: 'tabela_qualquer' } }],
    ['maiuscula', { tabelas: { devolucoes: 'devolucoes_GIRA' } }],
    ['a GOOD (sem sufixo)', { tabelas: { devolucoes: 'devolucoes' } }],
  ]) {
    ok(sufixoDaFicha(ficha).ok === false, '  recusa: ' + rot);
  }
}

// ── as travas, e o que elas protegem ────────────────────────────────
{
  ok(SUFIXO_VALIDO.test('_gira') && SUFIXO_VALIDO.test('_x9'),
     'o formato aceita sufixo normal');
  for (const mau of ['gira', '_G', '_a', '_com-traco', '_' + 'x'.repeat(13), "_a'; drop table x; --"]) {
    ok(!SUFIXO_VALIDO.test(mau), '  rejeita ' + JSON.stringify(mau));
  }
  ok(RESERVADOS.has('_amb') && RESERVADOS.has('_good'),
     'as empresas que ja existem sao reservadas');
}

// ── ⚠️ nada chega ao banco quando a trava pega ──────────────────────
//
// É o ponto mais importante: uma recusa não pode ter efeito colateral.
{
  let chamou = false;
  const espiao = { rpc: async () => { chamou = true; return { data: [], error: null }; } };

  (async () => {
    for (const chave of ['inexistente', 'good', 'ambtotal']) {
      const r = await provisionarEmpresa(chave, espiao);
      ok(r.ok === false, 'recusa `' + chave + '`');
    }
    ok(chamou === false, '  e NAO chamou o banco em nenhuma delas');

    // ── e o SQL precisa existir no repo, com as travas ──────────────
    const sql = fs.readFileSync(path.join(RAIZ, 'sql', 'provisionar-empresa.sql'), 'utf8');
    ok(/\^_\[a-z0-9\]\{2,12\}\$/.test(sql),
       'o SQL valida o sufixo do lado do banco tambem');
    ok(/sufixo in \('_amb', '_good'\)/.test(sql),
       '  e reserva as empresas existentes la tambem');
    ok(/including all/i.test(sql),
       'copia a estrutura da AMB (INCLUDING ALL), nao escreve colunas a mao');
    ok(/enable row level security/i.test(sql),
       '  e liga o RLS na tabela nova, como nas outras');
    ok(/grant execute on function public\.provisionar_empresa\(text\) to service_role/.test(sql),
       'so a service_role pode chamar (a chave anon e publica)');
    ok(!/drop table|truncate|delete from/i.test(sql.split('COMO TESTAR')[0]),
       'a funcao NAO apaga nada — so cria');

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}
