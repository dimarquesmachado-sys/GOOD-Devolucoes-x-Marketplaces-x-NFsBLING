// Roda com: node test/estados-migracao.test.js
//
// P0 do parecer de 09/09: "desligar a renovação" não pode ser apagar env
// var nem confiar que ninguém chamará uma rota. Há renovação por 401,
// batimento preventivo e rota administrativa de renovação forçada.
//
// ⚠️ Sem estado explícito, o corte é INVISÍVEL: ninguém sabe se aconteceu,
// e a corrida do refresh de uso único volta sem aviso.

const http = require('http');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const carregar = () => {
  const p = path.join(__dirname, '..', 'lib', 'token-leitor.js');
  delete require.cache[require.resolve(p)];
  return require(p);
};

(async () => {
  let resposta = { status: 200, corpo: { access: 'TOKEN', expira_em: null, versao: 1 } };
  const servidor = http.createServer((req, res) => {
    res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resposta.corpo));
  });
  await new Promise((r) => servidor.listen(0, r));
  process.env.MOVER_PEDIDOS_URL = 'http://127.0.0.1:' + servidor.address().port;
  process.env.ADMIN_TOKEN_LEITURA_KEY = 'k';

  const limpar = () => { for (const k of Object.keys(process.env)) if (k.startsWith('TOKEN_POLITICA_')) delete process.env[k]; };

  // ── o retorno é TIPADO, não `null` para tudo ──────────────────────
  //
  // ⚠️ `null` misturava 6 situações que pedem coisas diferentes depois do
  // corte: integração ausente, dono sem leitor, falha passageira,
  // configuração quebrada, chave faltando e dono fora.
  {
    limpar();
    let p = carregar();

    resposta = { status: 200, corpo: { access: 'T1', expira_em: null, versao: 1 } };
    ok((await p.lerTokenDetalhado('good', 'bling')).estado === 'ok', 'estado `ok` quando ha token');

    p = carregar();
    resposta = { status: 404, corpo: {} };
    ok((await p.lerTokenDetalhado('good', 'tiktok')).estado === 'ausente',
       '404 -> `ausente` (a empresa nao tem essa integracao)');

    p = carregar();
    resposta = { status: 501, corpo: {} };
    ok((await p.lerTokenDetalhado('ambtotal', 'magalu')).estado === 'nao_implementado',
       '501 -> `nao_implementado` (o dono ainda nao tem leitor)');

    p = carregar();
    resposta = { status: 502, corpo: {} };
    const r502 = await p.lerTokenDetalhado('good', 'ml');
    ok(r502.estado === 'indisponivel' && r502.passageiro === true,
       '502 -> `indisponivel` e marcado como PASSAGEIRO (vale re-pedir)');

    p = carregar();
    resposta = { status: 503, corpo: {} };
    ok((await p.lerTokenDetalhado('good', 'ml')).estado === 'config_invalida',
       '503 -> `config_invalida` (retry nao ajuda; e configuracao)');
  }

  // ── as quatro políticas, com decisões DIFERENTES ──────────────────
  {
    limpar();
    const p = carregar();
    resposta = { status: 502, corpo: {} };   // o dono nao entrega

    process.env.TOKEN_POLITICA_GOOD_ML = 'sombra';
    ok((await p.resolverToken('good', 'ml')).usar === 'local',
       '`sombra`: dono falhou -> usa a rede local (e mede)');

    // ⚠️ EM `remoto` NAO HA REDE. Cair no local seria ressuscitar em
    // silencio o renovador desligado, reabrindo a corrida do refresh.
    process.env.TOKEN_POLITICA_GOOD_ML = 'remoto';
    const rem = await p.resolverToken('good', 'ml');
    ok(rem.usar === 'falhar',
       '⚠️ `remoto`: dono falhou -> FALHA explicito, nunca cai no local');
    ok(/REMOTO|remoto/.test(rem.motivo || ''), '  com o motivo dizendo por que');

    process.env.TOKEN_POLITICA_GOOD_ML = 'local';
    ok((await p.resolverToken('good', 'ml')).usar === 'local',
       '`local`: nem consulta o dono');

    // ⚠️ `bloqueado` nao faz chamada destrutiva
    process.env.TOKEN_POLITICA_GOOD_ML = 'bloqueado';
    ok((await p.resolverToken('good', 'ml')).usar === 'falhar',
       '`bloqueado`: nenhuma chamada sai');
    limpar();
  }

  // ── ⚠️ a política é reversível SEM DEPLOY ─────────────────────────
  //
  // O dono não usa terminal. Se voltar atrás exigisse deploy, o rollback
  // dependeria de mim estar online.
  {
    const p = carregar();
    process.env.TOKEN_POLITICA_GOOD_BLING = 'remoto';
    ok(p.politicaDe('good', 'bling') === 'remoto', 'a env muda a politica na hora');
    process.env.TOKEN_POLITICA_GOOD_BLING = 'sombra';
    ok(p.politicaDe('good', 'bling') === 'sombra', '  e volta na hora (rollback sem deploy)');

    // ⚠️ b258 (Codex, P1): VALOR INVALIDO FALHA FECHADO, nao em `sombra`.
    //
    // Eu tinha escrito que `sombra` era o "padrao seguro". Nao e: `sombra`
    // permite fallback local E renovacao local. Um eixo que estava em
    // `remoto` e ganhou um typo (`remotto`) voltaria a renovar localmente
    // EM SILENCIO — reabrindo a corrida do refresh exatamente onde a gente
    // acabou de fecha-la.
    process.env.TOKEN_POLITICA_GOOD_BLING = 'valor-invalido';
    ok(p.politicaDe('good', 'bling') === 'bloqueado',
       '  ⚠️ valor invalido -> BLOQUEADO (typo tem que doer, nao passar batido)');

    process.env.TOKEN_POLITICA_GOOD_BLING = '  REMOTO  ';
    ok(p.politicaDe('good', 'bling') === 'remoto',
       '  mas espaco e maiuscula sao aceitos (nao e rigor a toa)');
    limpar();
  }

  // ── o desligamento é VERIFICÁVEL: a renovação local é recusada ────
  {
    const fs = require('fs');
    const RAIZ = path.join(__dirname, '..');
    for (const [arq, eixo] of [['lib/bling.js', 'good/bling'], ['lib/ml.js', 'good/ml']]) {
      const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
      ok(/politicaDe\('good', '(bling|ml)'\) === 'remoto'/.test(src),
         arq + ': a renovacao local checa a politica');
      ok(/renovacoesRecusadas\+\+/.test(src),
         '  e CONTA a recusa (o numero prova o corte, em vez de "ninguem reclamou")');
    }
  }

  // ── e o /health mostra a política efetiva ─────────────────────────
  {
    const p = carregar();
    const d = p.diagnostico();
    ok(!!d.politica && d.politica['good/ml'] === 'sombra',
       'o /health mostra a politica EFETIVA por eixo');
    ok(/refresh SABIDAMENTE vigente/.test(d.politica._atencao_rollback || ''),
       '  ⚠️ com o aviso: rollback exige refresh vigente (o do ambiente pode ter sido consumido)');
  }

  await new Promise((r) => servidor.close(r));
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
