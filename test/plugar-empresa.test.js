'use strict';
// ⚠️ O ASSISTENTE SEPARA O QUE A MÁQUINA RESOLVE DO QUE SÓ A PESSOA TEM.
//
// O dono olhou a lista de 9 envs + 3 ids fiscais + 7 tabelas e perguntou se
// não dava para facilitar. Dá — para a maior parte. Este teste guarda a
// separação, porque errar para qualquer lado custa:
//
//   prometer demais  -> ele confia num id que o script não tinha como saber
//   prometer de menos -> ele caça no DevTools algo que a API entrega

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { plugar, segredoForte, lerDescoberta } = require('../scripts/plugar-empresa');

// ── o segredo gerado serve de verdade ───────────────────────────────
{
  const s = segredoForte();
  ok(s.length >= 32, `⚠️ o segredo passa do minimo de 16 do auth (${s.length})`);
  ok(!/[+/=]/.test(s), '  e nao tem caractere que atrapalhe no painel do Render');
  ok(segredoForte() !== segredoForte(), '⚠️ e cada chamada da um diferente');
}

// ── e o resto, em sequência ─────────────────────────────────────────
(async () => {
  const reg = require('../lib/empresas');

  // recusa empresa que não está no registro
  const r0 = await plugar('nao-existe-mesmo', { registro: reg });
  ok(!r0.ok, '  recusa empresa fora do registro');
  ok(/nova-empresa/.test(r0.erro || ''),
     '  e aponta o gerador de ficha como passo anterior');

  // ── sem credencial, ainda entrega o que dá ────────────────────────
  const r = await plugar('girassol', { registro: reg, chamarBling: null });
  ok(r.ok, 'roda sem credencial do Bling');
  ok(!!r.segredo, '  e ainda assim gera o segredo');
  ok(/provisionar_empresa\('_girassol'\)/.test(r.sqlProvisionar),
     '  e monta o SQL com o sufixo certo');
  ok(r.descoberto === null, '⚠️ e nao inventa o que so o Bling sabe');

  // ⚠️ o que ele NÃO pode prometer
  ok((r.conf.fiscalSemValor || []).includes('idEmpresaControl'),
     '⚠️ `idEmpresaControl` continua na lista do que falta');

  // ── ⚠️ os valores descobertos vêm ANINHADOS ──────────────────────
  //
  // Eu lia `d.depositoGeral`, e o `descobrirFicha` devolve em
  // `d.descoberto.depositoGeral`. Sempre undefined: o caminho de SUCESSO não
  // mostrava nada. Não apareceu no teste porque lá o Bling não responde —
  // então o teste passava e o script não servia.
  const fakeDescoberta = async () => ({
    ok: true,
    descoberto: {
      depositoGeral: { id: '999', nome: 'Geral' },
      naturezaDevolucao: { id: '777' },
    },
    problemas: [],
  });
  const reg2 = Object.assign({}, reg, { descobrirFicha: fakeDescoberta });
  const rd = await plugar('girassol', { registro: reg2, chamarBling: () => {} });
  // ⚠️ exercita a LEITURA de produção — foi ali que o erro morava, e meu
  // primeiro teste olhava o retorno de `plugar()`, passando verde à toa.
  const lido = lerDescoberta(rd.descoberto);
  ok(lido.deposito && lido.deposito.id === '999',
     '⚠️ a leitura pega o deposito de `.descoberto` (aninhado)');
  ok(lido.natureza && lido.natureza.id === '777',
     '  e a natureza tambem');
  ok(lerDescoberta({ depositoGeral: { id: 'X' } }).deposito === null,
     '⚠️ e NAO pega de `d` solto — era o bug');

  // ── ⚠️ e o script NÃO pode usar o cliente que renova token ────────
  //
  // O cliente de produção renova sozinho ao tomar 401, e o Bling INVALIDA o
  // refresh antigo. Num script de leitura isso queimaria o refresh que está
  // no Render — o serviço no ar perderia o Bling daquela empresa.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
  const semCom = src.split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/bling-AMB'\)\.criar/.test(semCom),
     '⚠️ NAO usa o cliente de producao (ele rotaciona o refresh)');
  ok(/BLING_ACCESS_TOKEN/.test(semCom),
     '  so consulta com ACCESS token pronto, nunca com o refresh');

  // ── ⚠️ o cliente de leitura aceita URL ABSOLUTA ──────────────────
  //
  // O `descobrirFicha` monta a URL completa antes de chamar. Eu concatenava a
  // base outra vez: `/Api/v3https://api.bling.com.br/Api/v3/depositos`. Toda
  // consulta daria 404, e o script diria "não descobri" — parecendo falta de
  // permissão quando era erro meu de montagem.
  {
    const src2 = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
    const semC2 = src2.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/\^https\?:/.test(semC2),
       '⚠️ o cliente de leitura detecta URL absoluta');
    ok(!/fetch\('https:\/\/api\.bling\.com\.br\/Api\/v3' \+ caminho/.test(semC2),
       '  e nao concatena a base as cegas');

    // e a montagem, exercitada
    const monta = (c) => (/^https?:\/\//.test(String(c))
      ? c : 'https://api.bling.com.br/Api/v3' + c);
    ok(monta('https://api.bling.com.br/Api/v3/depositos?limite=100')
         === 'https://api.bling.com.br/Api/v3/depositos?limite=100',
       '⚠️ URL absoluta passa intacta (era o bug)');
    ok(monta('/depositos') === 'https://api.bling.com.br/Api/v3/depositos',
       '  e caminho relativo ainda ganha a base');
  }

  // ── ⚠️ e o rótulo do campo fiscal ────────────────────────────────
  //
  // O `descobrirFicha` resolve a natureza de ENTRADA (emitir). Rotular como
  // `NATUREZAS_DEVOLUCAO_IDS` (buscar) mandaria colar no campo errado.
  //
  // 📌 Eu já errei esses dois hoje, no b402 — na direção oposta.
  {
    const src3 = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
    const semC3 = src3.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/ID_NATUREZA_DEVOLUCAO_ENTRADA = /.test(semC3),
       '⚠️ o rotulo da natureza descoberta e o de ENTRADA');
    ok(!/NATUREZAS_DEVOLUCAO_IDS = \$\{nat/.test(semC3),
       '  e nao o de busca (sao campos diferentes)');
  }

  // ── ⚠️ os CAMPOS FISCAIS entram na lista, não só as envs ─────────
  //
  // Eu imprimia só `envsFaltando`. Os 3 fiscais vivem em `fiscalSemValor` e
  // nunca apareciam — quem seguisse a lista acharia que terminou, e o
  // `conferirEmpresa` continuaria dizendo `pronta: false` sem dizer por quê.
  //
  // ⚠️ E na rodada anterior eu troquei o rótulo da natureza de busca pela de
  // entrada: com isso o campo de BUSCA sumiu da tela de vez.
  {
    const src4 = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
    const semC4 = src4.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/fiscalSemValor/.test(semC4),
       '⚠️ o script LE `fiscalSemValor` (nao so as envs)');
    ok(/NOME_ENV_FISCAL/.test(semC4),
       '  e traduz o campo pro nome da env');

    // ⚠️ e os 2 parecidos continuam AMBOS citados
    ok(/ID_NATUREZA_DEVOLUCAO_ENTRADA/.test(semC4)
       && /NATUREZAS_DEVOLUCAO_IDS/.test(semC4),
       '⚠️ e os 2 campos de natureza (emitir e buscar) continuam citados');
  }

  // ── ⚠️ o prefixo FISCAL é separado do de credencial ──────────────
  //
  // O registro guarda os dois de propósito. Hoje as 3 empresas coincidem —
  // então usar o de credencial "funciona" e esconde o erro até a primeira que
  // divergir. Foi assim que a pasta do checkout me enganou: seguia a chave em
  // 2 de 3.
  {
    const src5 = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
    const semC5 = src5.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/PREF_FISCAL/.test(semC5), '⚠️ usa o prefixo FISCAL nos campos fiscais');
    // ⚠️ (Codex, P2) - nullish, nao `||`: fiscal com prefixo INTENCIONALMENTE
    // vazio ('') nao pode cair no de credencial, porque '' e falsy pro `||`.
    ok(/e\.prefixoFiscal != null.*e\.prefixoEnv/.test(semC5),
       '  com o de credencial so quando o fiscal e null/undefined (nao so vazio)');

    const r5 = await plugar('girassol', { registro: reg, chamarBling: null });
    ok(r5.PREF_FISCAL === 'GIRASSOL_', '  e entrega o valor da ficha');

    // ⚠️ e a natureza de EMISSÃO é citada mesmo fora do `fiscalSemValor`
    ok(/naturezaDevolucao/.test(semC5) && /opcional/.test(semC5),
       '⚠️ a natureza de EMISSAO e citada, marcada como opcional');

    // ⚠️ prefixo fiscal '' (vazio de proposito) nao pode virar o de credencial
    const empresaFiscalVazio = {
      chave: 'x', nome: 'X', chaveDados: 'x',
      prefixoEnv: 'X_', prefixoFiscal: '', fiscal: {},
    };
    const regFiscalVazio = {
      obterEmpresa: (k) => (k === 'x' ? empresaFiscalVazio : reg.obterEmpresa(k)),
      conferirEmpresa: () => ({ envsFaltando: [], fiscalSemValor: [] }),
      descobrirFicha: reg.descobrirFicha,
    };
    const rFiscalVazio = await plugar('x', { registro: regFiscalVazio, chamarBling: null });
    ok(rFiscalVazio.PREF_FISCAL === '',
       '⚠️ prefixoFiscal vazio de proposito NAO cai no de credencial (era o bug)');
  }

  // ── ⚠️ natureza JÁ configurada não entra como faltando ────────────
  //
  // (Codex, P2) `jaDescobriu` só enxerga o achado DESTA execução do Bling.
  // Quando a env já está preenchida mas não há access token pra consultar de
  // novo, o script marcava a natureza como faltando mesmo assim — a pessoa
  // via um campo "faltando" que já estava resolvido.
  {
    const empresaComNatureza = {
      chave: 'y', nome: 'Y', chaveDados: 'y',
      prefixoEnv: 'Y_', prefixoFiscal: 'Y_',
      fiscal: { naturezaDevolucao: () => '12345' },
    };
    const regComNatureza = {
      obterEmpresa: (k) => (k === 'y' ? empresaComNatureza : reg.obterEmpresa(k)),
      conferirEmpresa: () => ({ envsFaltando: [], fiscalSemValor: [] }),
      descobrirFicha: reg.descobrirFicha,
    };
    const rComNatureza = await plugar('y', { registro: regComNatureza, chamarBling: null });
    ok(rComNatureza.naturezaJaConfigurada === true,
       '⚠️ `plugar()` expõe que a natureza já está configurada na ficha');

    const empresaSemNatureza = Object.assign({}, empresaComNatureza,
      { fiscal: { naturezaDevolucao: () => '' } });
    const regSemNatureza = Object.assign({}, regComNatureza,
      { obterEmpresa: (k) => (k === 'y' ? empresaSemNatureza : reg.obterEmpresa(k)) });
    const rSemNatureza = await plugar('y', { registro: regSemNatureza, chamarBling: null });
    ok(rSemNatureza.naturezaJaConfigurada === false,
       '  e diz false quando a env está mesmo vazia');

    // ⚠️ e o CLI de fato consulta o campo antes de acusar "faltando"
    const src6 = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'plugar-empresa.js'), 'utf8');
    const semC6 = src6.split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(/!jaDescobriu && !r\.naturezaJaConfigurada/.test(semC6),
       '⚠️ o CLI só acusa a natureza como faltando quando NEM a descoberta '
       + 'NEM a ficha já resolveram');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA ' + e.message); process.exit(1); });
