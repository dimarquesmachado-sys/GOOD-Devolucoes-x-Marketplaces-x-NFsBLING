'use strict';
// b801 — V-17 (ensaio de CNPJ novo): A FICHA DE UMA EMPRESA NOVA NAO PODE DERRUBAR O BACKUP DAS OUTRAS.
//
// O embarque poe a ficha no registro primeiro, DESLIGADA; as tabelas vem depois (DDL, so com o OK do dono). Medido no
// ensaio, com o PostgREST 14.5 (o de producao): nesse intervalo o backup diario (que le TODAS as empresas do registro)
// recebia "tabela nao existe" nas 9 tabelas da empresa nova e a rodada INTEIRA virava falha — 9 erros e ZERO arquivo
// enviado da GOOD, da AMB e da Girassol.
//
// Aqui o `scripts/backup-tabelas.js` e a `lib/backup-rotina.js` DE PRODUCAO rodam numa copia do repo com a ficha gerada
// colada (test/_empresa-nova.js), contra PostgreSQL 16 + PostgREST de verdade com o schema de producao:
//   1. ficha desligada, sem tabela nenhuma  → a empresa e PULADA (com o motivo no manifesto) e as 3 de hoje sao salvas;
//   2. a rotina diaria termina OK e manda os arquivos — e o estado dela diz quem ficou de fora;
//   3. quem pede `--empresas=<a nova>` recebe a resposta de verdade: 9 erros (nao "pulada");
//   4. depois do provisionamento ela ENTRA no backup, mesmo ainda desligada (tabela que existe e sempre guardada);
//   5. provisionamento pela metade (uma tabela faltando) e ERRO, nao "pulada" — e falha que NAO e "tabela nao existe"
//      (sem permissao) tambem, mesmo atingindo todas as tabelas dela;
//   6. empresa LIGADA sem tabela nenhuma e ERRO (tabela sumida de quem opera e desastre, nao empresa nova).
// Roda com: node test/backup-empresa-nova-sem-tabelas.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { subirPostgres } = require('./_postgres-descartavel');
const { subirPostgrestReal } = require('./_postgrest-real');
const { copiaComEmpresaNova } = require('./_empresa-nova');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); return !!c; };
// ⚠️ Nada aqui conta "quantas empresas existem": o registro pode ja ter OUTRA empresa nova desligada (o proprio PR de
// um CNPJ de verdade) — foi o que este teste errou na 1a versao, medido colando uma ficha por cima. As conferencias
// olham a empresa do teste e as 3 de hoje pelo nome.
const DE_HOJE = ['good', 'ambtotal', 'girassol'];
const pulada = (manifesto, chave) => (manifesto.puladas || []).find((p) => p.empresa === chave) || null;
const errosDa = (manifesto, chave) => manifesto.erros.filter((e) => e.empresa === chave);

/* Storage de mentira: so o que a rotina usa (bucket, upload, listagem, remocao) */
function storageFalso() {
  const enviados = [];
  return {
    enviados,
    storage: {
      createBucket: async () => ({ data: {}, error: null }),
      from: () => ({
        upload: async (caminho) => { enviados.push(caminho); return { data: {}, error: null }; },
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  };
}

(async () => {
  let pg = null, rest = null, desligada = null, ligada = null;
  const pastas = [];
  const saidaNova = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-nova-')); pastas.push(p); return p; };
  const guardadas = {};
  try {
    desligada = copiaComEmpresaNova({ chave: 'serrana', nome: 'Comercial Serrana', ativa: false });
    {
      // na COPIA: uma empresa cujo contrato tem `ativa_em` mas nao fala do Devolucoes — nao e "desligada" (so o false explicito)
      const arq = path.join(desligada.dir, 'contrato-empresas.json');
      const c = JSON.parse(fs.readFileSync(arq, 'utf8'));
      c.empresas.ambtotal.ativa_em = { 'mover-pedidos': true };
      fs.writeFileSync(arq, JSON.stringify(c, null, 2) + '\n');
    }
    pg = await subirPostgres();
    rest = await subirPostgrestReal(pg);
    // o backup resolve a credencial como o servidor: a da empresa, senao a global. Aqui so a global existe.
    for (const k of Object.keys(process.env)) if (/SUPABASE_(URL|KEY)$/.test(k)) { guardadas[k] = process.env[k]; delete process.env[k]; }
    process.env.SUPABASE_URL = rest.url; process.env.SUPABASE_KEY = rest.chave('service_role');
    pg.sql(`insert into public.devolucoes_amb (shipment_id, tipo, status, funcionario) values ('4700000001', 'devolucao', 'aprovado', 'esto')`);

    const bk = require(path.join(desligada.dir, 'scripts', 'backup-tabelas'));
    const { desligadaNoContrato } = require(path.join(desligada.dir, 'lib', 'empresas'));
    ok(desligadaNoContrato('serrana') === true && desligadaNoContrato('girassol') === false && desligadaNoContrato('good') === false && desligadaNoContrato('ambtotal') === false && desligadaNoContrato('nao-existe') === false,
      '  o registro sabe quem entrou desligada: so a empresa nova — sem o campo, ou com `ativa_em` que nao fala do Devolucoes, NAO e desligada');

    console.log('\n── 1. ficha desligada, nenhuma tabela dela no banco');
    const linhasDoLog = [];
    const r1 = await bk.rodar({ saida: saidaNova(), log: (l) => linhasDoLog.push(l) });
    ok(r1.manifesto.erros.length === 0, '⚠️ o backup NAO falha por causa da empresa nova (' + r1.manifesto.erros.length + ' erro(s)' + (r1.manifesto.erros[0] ? ': ' + JSON.stringify(r1.manifesto.erros[0]).slice(0, 160) : '') + ')');
    const salvas = Object.keys(r1.manifesto.empresas).sort().join();
    ok(DE_HOJE.every((k) => Object.keys(r1.manifesto.empresas[k] || {}).length === 9) && !('serrana' in r1.manifesto.empresas),
      '⚠️ as 3 empresas de hoje sao salvas inteiras, 9 tabelas cada, e a nova nao entra na lista das salvas (' + salvas + ')');
    const p1 = pulada(r1.manifesto, 'serrana');
    ok(p1 && /desligada no contrato/.test(p1.motivo) && /provisionada/.test(p1.motivo) && r1.manifesto.puladas.filter((p) => p.empresa === 'serrana').length === 1 && r1.manifesto.puladas.every((p) => desligadaNoContrato(p.empresa)),
      '⚠️ a empresa nova fica em `puladas`, uma vez, com o motivo — e so empresa desligada entra ali (' + JSON.stringify(r1.manifesto.puladas) + ')');
    ok(!fs.existsSync(path.join(r1.raiz, 'serrana')) && linhasDoLog.some((l) => /serrana: PULADA/.test(l)), '  sem pasta vazia dela na saida, e o log diz que foi pulada');
    const amb = fs.readFileSync(path.join(r1.raiz, 'ambtotal', 'devolucoes_amb.jsonl'), 'utf8');
    ok(/"shipment_id":"4700000001"/.test(amb), '  e o dado das outras esta la de verdade (a devolucao da AMB saiu no arquivo)');
    ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(r1.raiz, 'manifesto.json'), 'utf8')).puladas) === JSON.stringify(r1.manifesto.puladas), '  o manifesto.json gravado traz a lista de puladas');

    console.log('\n── 2. a rotina diaria');
    const { criarRotina } = require(path.join(desligada.dir, 'lib', 'backup-rotina'));
    const st = storageFalso();
    const rotina = criarRotina({ rodarBackup: bk.rodar, obterSupabase: () => st, log: () => {} });
    const d = await rotina.executar({ motivo: 'manual' });
    const tabelasSalvas = Object.values(r1.manifesto.empresas).reduce((n, e) => n + Object.keys(e).length, 0);
    ok(d.ok === true && d.erro === null && tabelasSalvas >= 27 && d.tabelas === tabelasSalvas && st.enviados.length === tabelasSalvas + 1,
      '⚠️ a rodada termina OK e manda as ' + tabelasSalvas + ' tabelas + o manifesto (ok ' + d.ok + ', erro ' + d.erro + ', ' + st.enviados.length + ' arquivo(s)) — antes: FALHA e 0 arquivo');
    ok(DE_HOJE.every((k) => st.enviados.some((c) => c.indexOf('/' + k + '/') > 0)) && !st.enviados.some((c) => /serrana/.test(c)), '  ha arquivo de cada uma das 3 de hoje, e nenhum da empresa nova');
    ok(Array.isArray(d.puladas) && JSON.stringify(d.puladas) === JSON.stringify(r1.manifesto.puladas) && !!pulada(d, 'serrana'),
      '⚠️ e o estado da rotina (o /health e o /api/admin/backup) diz quem ficou de fora (' + JSON.stringify(d.puladas) + ')');

    console.log('\n── 3. pedida pelo nome');
    const r3 = await bk.rodar({ empresas: ['serrana'], saida: saidaNova(), log: () => {} });
    ok(r3.manifesto.erros.length === 9 && r3.manifesto.puladas.length === 0 && r3.manifesto.erros.every((e) => e.empresa === 'serrana' && /Could not find the table/.test(e.erro)),
      '⚠️ `--empresas=serrana` recebe a resposta de verdade: 9 erros de tabela que nao existe, nada pulado (' + r3.manifesto.erros.length + '/' + r3.manifesto.puladas.length + ')');
    ok(r3.manifesto.erros.every((e) => Object.keys(e).sort().join() === 'empresa,erro,tabela'), '  o erro do manifesto continua com os 3 campos de sempre (empresa, tabela, erro)');

    console.log('\n── 4. depois do provisionamento');
    pg.sql(fs.readFileSync(path.join(desligada.dir, 'sql', 'provisionar-empresa.sql'), 'utf8'));
    pg.sql("select * from public.provisionar_empresa('_serrana')");
    // no Supabase a tabela nova ja nasce liberada pro service_role (privilegio padrao do projeto); aqui o helper so deu
    // os GRANTs do que existia quando o PostgREST subiu
    pg.sql("grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; notify pgrst, 'reload schema';");
    const esperar = async (cond, oQue) => { const ate = Date.now() + 15000; for (;;) { if (await cond()) return true; if (Date.now() > ate) throw new Error('o PostgREST nao releu o schema em 15 s (' + oQue + ')'); await new Promise((r) => setTimeout(r, 200)); } };
    const responde = async (tabela) => (await fetch(rest.url + '/rest/v1/' + tabela + '?limit=0', { headers: { Authorization: 'Bearer ' + rest.chave('service_role') } })).status;
    await esperar(async () => (await responde('devolucao_tags_serrana')) === 200, 'tabelas novas');
    const r4 = await bk.rodar({ saida: saidaNova(), log: () => {} });
    ok(r4.manifesto.erros.length === 0 && !pulada(r4.manifesto, 'serrana') && Object.keys(r4.manifesto.empresas.serrana || {}).length === 9,
      '⚠️ com as tabelas criadas ela ENTRA no backup, mesmo ainda desligada (' + Object.keys(r4.manifesto.empresas.serrana || {}).length + ' tabelas, ' + r4.manifesto.erros.length + ' erro(s))');

    console.log('\n── 5. provisionamento pela metade');
    pg.sql("drop table public.sku_depara_serrana; notify pgrst, 'reload schema';");
    await esperar(async () => (await responde('sku_depara_serrana')) === 404, 'tabela apagada');
    const r5 = await bk.rodar({ saida: saidaNova(), log: () => {} });
    ok(!pulada(r5.manifesto, 'serrana') && r5.manifesto.erros.length === 1 && r5.manifesto.erros[0].tabela === 'sku_depara_serrana' && Object.keys(r5.manifesto.empresas.serrana || {}).length === 8,
      '⚠️ faltando UMA tabela: e erro, nao "pulada" — as outras 8 dela sao salvas e o manifesto acusa a que falta (' + JSON.stringify(r5.manifesto.erros.map((e) => e.tabela)) + ')');

    // todas as tabelas dela falhando, mas NAO por "nao existe": 8 sem permissao + a que foi apagada
    const oito = Object.keys(r5.manifesto.empresas.serrana);
    pg.sql(oito.map((t) => `revoke all on public.${t} from service_role;`).join(' ') + " notify pgrst, 'reload schema';");
    await esperar(async () => (await responde('devolucoes_serrana')) !== 200, 'permissao retirada');
    const r5b = await bk.rodar({ saida: saidaNova(), log: () => {} });
    ok(!pulada(r5b.manifesto, 'serrana') && r5b.manifesto.erros.length === 9 && errosDa(r5b.manifesto, 'serrana').filter((e) => /permission denied/.test(e.erro)).length === 8,
      '⚠️ as 9 tabelas dela falhando, 8 por FALTA DE PERMISSAO: erro, nao "pulada" — so "tabela nao existe" em todas conta como empresa nova (' + errosDa(r5b.manifesto, 'serrana').length + ' erro(s) dela)');

    console.log('\n── 6. empresa LIGADA sem tabela nenhuma');
    ligada = copiaComEmpresaNova({ chave: 'boreal', nome: 'Boreal Comercio', ativa: true });
    const bkLigada = require(path.join(ligada.dir, 'scripts', 'backup-tabelas'));
    const r6 = await bkLigada.rodar({ saida: saidaNova(), log: () => {} });
    ok(!pulada(r6.manifesto, 'boreal') && r6.manifesto.erros.length === 9 && r6.manifesto.erros.every((e) => e.empresa === 'boreal'),
      '⚠️ empresa ligada no contrato e sem tabela: 9 erros, e ela NAO e pulada — tabela sumida de quem opera nao passa calada (' + r6.manifesto.erros.length + ' erro(s))');
    const rotinaLigada = require(path.join(ligada.dir, 'lib', 'backup-rotina')).criarRotina({ rodarBackup: bkLigada.rodar, obterSupabase: () => storageFalso(), log: () => {} });
    const d6 = await rotinaLigada.executar({ motivo: 'manual' });
    ok(d6.ok === false && /9 falha\(s\) no backup/.test(String(d6.erro)), '  e a rotina registra a rodada como FALHA (' + String(d6.erro).slice(0, 70) + ')');
  } catch (err) {
    falhas++; console.log('FALHA ' + ((err && err.stack) || err));
  } finally {
    for (const k of Object.keys(guardadas)) process.env[k] = guardadas[k];
    if (rest) rest.parar();
    if (pg) pg.parar();
    if (desligada) desligada.apagar();
    if (ligada) ligada.apagar();
    for (const p of pastas) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* temporario */ } }
  }
  console.log(falhas ? '\n=== ' + falhas + ' FALHA(S)' : '\n=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
