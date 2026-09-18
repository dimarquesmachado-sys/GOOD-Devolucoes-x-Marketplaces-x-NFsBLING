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

    // ⚠️ (Codex, PR #323, P2) - defeito_comentarios/defeito_pedidos NAO
    // entravam no molde: ativar uma empresa nova criava as 5 tabelas de
    // sempre, mas o ciclo de defeitos (comentario, pedido, listarDefeitos)
    // continuava sem tabela pra gravar — falha so descoberta na primeira
    // vez que alguem mexesse numa peca com defeito da empresa nova.
    ok(/\['defeito_comentarios',\s*'defeito_comentarios_amb'\]/.test(sql),
       'o molde de defeito_comentarios entra na lista de tabelas criadas');
    ok(/\['defeito_pedidos',\s*'defeito_pedidos_amb'\]/.test(sql),
       '  e o de defeito_pedidos tambem');

    // ── ⚠️ (Codex, PR #323, P1, b376) - a CONFERENCIA pos-RPC, com sufixo real ──
    //
    // `provisionarEmpresa` roda a funcao do banco e depois sonda se as 7
    // tabelas existem de verdade. O b376 consertou 2 furos nessa sonda (o
    // sufixo ja vem com '_', e o `code` do erro nao era olhado quando a
    // `message` vinha preenchida) mas nao deixou teste pra travar a
    // regressao. Pra exercitar a sonda preciso de uma empresa com sufixo
    // (nem 'good' nem 'ambtotal' tem), entao troco o que `obterEmpresa`
    // devolve so aqui.
    {
      const empresasPath = require.resolve('../lib/empresas');
      const provisionarPath = require.resolve('../lib/provisionar-empresa');
      const empresasReal = require.cache[empresasPath];

      const carregarComFichaFalsa = () => {
        delete require.cache[empresasPath];
        require.cache[empresasPath] = {
          id: empresasPath, filename: empresasPath, loaded: true, children: [], paths: [],
          exports: { obterEmpresa: () => ({ tabelas: { devolucoes: 'devolucoes_gira' } }) },
        };
        delete require.cache[provisionarPath];
        return require(provisionarPath).provisionarEmpresa;
      };

      // 1) as 7 tabelas existem com o sufixo SIMPLES ('_gira', um underscore
      //    so). Antes do b376, a sonda montava 'devolucoes__gira' (dois
      //    underscores — `sufixoDaFicha` ja devolve o sufixo COM o '_'), que
      //    nunca bate com nenhuma tabela real, e a empresa era recusada.
      {
        const provisionar = carregarComFichaFalsa();
        const existentes = new Set(['devolucoes_gira', 'espreita_notas_gira', 'recados_gira',
          'pecas_retiradas_gira', 'sku_depara_gira', 'defeito_comentarios_gira', 'defeito_pedidos_gira']);
        const cliente = {
          rpc: async () => ({ data: [{ resultado: 'OK' }], error: null }),
          from: (nome) => ({
            select: async () => (existentes.has(nome)
              ? { data: [], error: null }
              : { data: null, error: { message: `relation "${nome}" does not exist`, code: '42P01' } }),
          }),
        };
        const r = await provisionar('girateste', cliente);
        ok(r.ok === true,
           'confere as 7 tabelas com o sufixo simples, sem underscore duplicado');
      }

      // 2) a rotina instalada no banco e a ANTIGA (5 tabelas): as 2 de
      //    defeito faltam, e o PostgREST denuncia isso pelo `code`
      //    (PGRST205), com uma `message` que so bate no padrao de `code`.
      //    Antes do b376, `message || code` nunca chegava a olhar o `code`.
      {
        const provisionar = carregarComFichaFalsa();
        const cliente = {
          rpc: async () => ({ data: [{ resultado: 'OK' }], error: null }),
          from: (nome) => ({
            select: async () => (/^defeito_/.test(nome)
              ? { data: null, error: { message: 'Could not find the table in the schema cache', code: 'PGRST205' } }
              : { data: [], error: null }),
          }),
        };
        const r = await provisionar('girateste', cliente);
        ok(r.ok === false && (r.tabelas_faltando || []).length === 2,
           'acusa falta quando so o `code` (PGRST205) denuncia, sem a frase no `message`');
      }

      delete require.cache[provisionarPath];
      delete require.cache[empresasPath];
      if (empresasReal) require.cache[empresasPath] = empresasReal;
    }

    console.log('');
    console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
    process.exit(falhas ? 1 : 0);
  })();
}
