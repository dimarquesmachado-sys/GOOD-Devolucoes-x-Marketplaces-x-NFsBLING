'use strict';
// ⚠️ UMA EMPRESA QUE FALHA AO MONTAR NAO PODE DERRUBAR AS OUTRAS.
//
// Antes, `criarAppAMB` lançando derrubava o boot inteiro: a GOOD e a AMB —
// que estão no ar atendendo — ficavam fora por causa de uma env faltando na
// empresa NOVA.
//
// 📌 Isso já aconteceu: em 18/09 o deploy falhou 3× por falta do
// `AMB_SESSION_SECRET` e o serviço ficou 7 versões atrasado sem ninguém
// notar. A empresa que quebra é sempre a que está sendo ligada; quem paga são
// as que já funcionavam.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const semCom = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── o contorno existe ───────────────────────────────────────────────
{
  ok(/try \{\s*app\.use\(emp\.rota, criarAppAMB/.test(semCom),
     '⚠️ cada empresa monta dentro do proprio try');
  ok(/catch \(erro\)/.test(semCom) && /NAO montou/.test(SRC),
     '  e a que falha grita no log com o motivo');
  ok(/status\(503\)/.test(semCom),
     '⚠️ a rota dela responde 503 explicando (nao 404)');
}

// ── ⚠️ mas se NENHUMA subir, o processo cai ─────────────────────────
//
// Servir um app vazio que responde 200 no health é pior que cair: o Render
// acha que está tudo bem e ninguém percebe.
{
  ok(/falhas\.length === ativas\.length/.test(semCom),
     '⚠️ se NENHUMA montar, derruba o processo');
  ok(/throw new Error\('\[devolucoes\] NENHUMA empresa montou/.test(semCom),
     '  com a lista de quem falhou e por que');
}

// ── o comportamento, exercitado ─────────────────────────────────────
{
  const montar = (ativas, criar) => {
    const montadas = []; const falhou = [];
    for (const emp of ativas) {
      try { criar(emp.chave); montadas.push(emp.chave); }
      catch (e) { falhou.push(emp.chave); }
    }
    if (ativas.length && falhou.length === ativas.length) {
      return { caiu: true, montadas, falhou };
    }
    return { caiu: false, montadas, falhou };
  };

  const duas = [{ chave: 'ambtotal' }, { chave: 'girassol' }];
  const soGirassolQuebra = (c) => { if (c === 'girassol') throw new Error('env faltando'); };

  const r1 = montar(duas, soGirassolQuebra);
  ok(!r1.caiu && r1.montadas.includes('ambtotal'),
     '⚠️ a girassol quebrada NAO derruba a ambtotal');
  ok(r1.falhou.includes('girassol'), '  e a girassol fica de fora, nomeada');

  const r2 = montar(duas, () => { throw new Error('tudo quebrado'); });
  ok(r2.caiu, '⚠️ mas se as DUAS quebram, o processo cai');

  const r3 = montar(duas, () => {});
  ok(!r3.caiu && r3.montadas.length === 2, '  e com tudo ok, as 2 sobem');

  // ⚠️ lista vazia não é falha — é contrato sem empresa ativa
  ok(!montar([], () => {}).caiu,
     '  lista vazia nao derruba (contrato sem empresa ativa)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
