// Roda com: node test/contrato-empresas.test.js
//
// O CONTRATO É A ETAPA ZERO da revisão do Codex (07/09):
//   "definir um contrato pequeno e versionado (...) teste de contrato em
//    ambos os repositórios usando o mesmo fixture JSON/schema"
//
// Por que antes de tudo: hoje o `Mover-Pedidos` chama a AMB de `amb` e este
// repo chama de `ambtotal`. Sem contrato, essa divergência só aparece
// quando alguém plugar a Girassol e o dado sair na tabela errada.
//
// ⚠️ Este arquivo confere DUAS coisas:
//   1. o contrato é internamente coerente (nenhum alias/tabela/prefixo
//      colide entre empresas)
//   2. o `lib/empresas.js` deste repo BATE com ele
//
// O Mover-Pedidos precisa de um teste espelho, com o MESMO json.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const contrato = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato-empresas.json'), 'utf8'));
const registro = require('../lib/empresas.js');

// ── 1. o contrato é coerente consigo mesmo ──────────────────────────
{
  const empresas = Object.entries(contrato.empresas);
  ok(empresas.length >= 2, 'o contrato tem as empresas (' + empresas.length + ')');

  // ⚠️ um alias em duas empresas mandaria dado da AMB pra Girassol
  const donoDoAlias = {};
  for (const [chave, e] of empresas) {
    for (const a of e.aliases) {
      ok(!donoDoAlias[a], '  alias `' + a + '` pertence so a `' + chave + '`'
         + (donoDoAlias[a] ? ' (COLIDE com ' + donoDoAlias[a] + ')' : ''));
      donoDoAlias[a] = chave;
    }
  }

  // ⚠️ duas empresas na mesma tabela = dado cruzado, sem erro no log
  for (const campo of ['sufixo_tabelas', 'prefixo_env', 'slug_http']) {
    const vistos = {};
    for (const [chave, e] of empresas) {
      const v = e[campo];
      ok(vistos[v] === undefined,
         '  `' + campo + '` de `' + chave + '` (' + JSON.stringify(v) + ') e unico'
         + (vistos[v] ? ' (COLIDE com ' + vistos[v] + ')' : ''));
      vistos[v] = chave;
    }
  }

  // ── v2: o dono do token, separado em HOJE e ALVO ──────────────────
  //
  // ⚠️ O PARECER DO MOVER-PEDIDOS CORRIGIU A v1: eu tinha escrito que o
  // Devoluções renovava Bling e ML. É falso — o Mover-Pedidos renova em
  // produção, pelos tokenManagers dele. Se alguém "obedecesse" o contrato
  // e desligasse a renovação de lá, metade da operação morreria.
  //
  // Então o contrato declara a VERDADE (`dono_hoje`) e o DESTINO
  // (`dono_alvo`), e o teste NÃO exige dono único ainda — exige que o
  // conflito esteja DECLARADO. Contrato que mente é pior que contrato
  // nenhum.
  for (const [chave, e] of empresas) {
    ok(!!e.dono_hoje && !!e.dono_alvo,
       chave + ': declara `dono_hoje` (a verdade) e `dono_alvo` (o destino)');

    for (const [integ, donos] of Object.entries(e.dono_hoje)) {
      if (integ.startsWith('_')) continue;
      ok(Array.isArray(donos) && donos.length > 0,
         '  `' + chave + '/' + integ + '` diz quem renova hoje: ' + JSON.stringify(donos));
    }
  }

  // ⚠️ e o risco tem que estar escrito, com prova — não como hipótese
  ok(!!contrato.risco_ativo && !!contrato.risco_ativo.refresh_ml_uso_unico,
     'o contrato declara o RISCO ATIVO do refresh de uso unico do ML');
  {
    const r = contrato.risco_ativo.refresh_ml_uso_unico;
    ok(typeof r.prova === 'string' && r.prova.length > 10,
       '  com prova citada (' + String(r.prova).slice(0, 40) + '...)');
    ok(/passo 2/.test(r.resolve_em || ''),
       '  e onde se resolve');
  }
}

// ── 2. o registro deste repo bate com o contrato ─────────────────────
//
// É aqui que a divergência entre repos vira teste vermelho em vez de bug
// em produção.
{
  for (const [chave, e] of Object.entries(contrato.empresas)) {
    let ficha = null;
    try { ficha = registro.obterEmpresa(chave); } catch (err) { /* ainda nao existe */ }

    // a Girassol pode estar no contrato e ainda nao no registro daqui
    const ativaAqui = !e.ativa_em || e.ativa_em.devolucoes !== false;
    if (!ficha) {
      ok(!ativaAqui,
         chave + ': ausente do registro daqui, e o contrato diz que ainda nao opera aqui');
      continue;
    }

    ok(ficha.prefixoEnv === e.prefixo_env,
       chave + ': prefixo de env bate (' + JSON.stringify(e.prefixo_env) + ')');

    // ⚠️ v2: o historico e POR SERVICO. Um campo unico nao comportava a
    // inversao — a GOOD e '' aqui e 'GOOD_' no Mover-Pedidos; a Girassol e
    // o oposto. O teste espelho de la quebraria por DESENHO do contrato.
    const hist = e.prefixo_env_historico;
    ok(hist && typeof hist === 'object',
       '  e o historico e por SERVICO, nao um valor so');
    ok(typeof hist.devolucoes === 'string',
       '  com o valor deste repo declarado (' + JSON.stringify(hist.devolucoes) + ')');
    ok(ficha.prefixoFiscal === e.prefixo_fiscal,
       '  e o prefixo fiscal (' + JSON.stringify(e.prefixo_fiscal) + ')');

    const sufixoReal = String(ficha.tabelas.devolucoes).replace(/^devolucoes/, '');
    ok(sufixoReal === e.sufixo_tabelas,
       '  e o sufixo das tabelas (' + JSON.stringify(e.sufixo_tabelas) + ')');
  }
}

// ── 3. ⚠️ o contrato não guarda segredo ──────────────────────────────
{
  // ⚠️ olho os VALORES, nao o arquivo cru: minha 1a versao pegava texto
  // longo dos comentarios e acusava segredo que nao existe. Falso positivo
  // num teste de seguranca e pior que nenhum — ensina a ignorar o vermelho.
  const valores = [];
  const varrer = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue;            // comentario, nao dado
      if (typeof v === 'string') valores.push([k, v]);
      else if (v && typeof v === 'object') varrer(v);
    }
  };
  varrer(contrato.empresas);

  const parecemSegredo = valores.filter(([k, v]) =>
    /secret|token|senha|password|key$/i.test(k) || /^[A-Za-z0-9+/=_-]{32,}$/.test(v));
  ok(parecemSegredo.length === 0,
     'o contrato NAO contem segredo (so identidade e NOMES de variavel)'
     + (parecemSegredo.length ? ' (SUSPEITO: ' + parecemSegredo.map((x) => x[0]).join(', ') + ')' : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
