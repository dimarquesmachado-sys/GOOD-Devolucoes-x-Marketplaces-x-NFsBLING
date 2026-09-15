'use strict';
// ⚠️ 403 NO ML TEM DOIS SIGNIFICADOS, e só um tem conserto pelo token.
//
// Contrato v7: o ML responde 403 com **token vencido**.
// Contrato v10: 403 de **rota restrita ao dono do recurso** NÃO indica token —
// e renovar não cura (o /health já expõe `ml_403` com essa nota).
//
// Os dois chegam ao veredito como "invalidação sem retry", e o dono não
// distingue. Sem isso, um eixo pode ficar bloqueado para sempre por 403 de
// permissão, que nenhuma renovação vai resolver.
//
// 📌 O veredito NÃO foi afrouxado: o bloqueio continua. O que muda é dizer
// QUAL é o saldo, para a decisão ser informada em vez de adivinhada.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'token-leitor.js'), 'utf8');

// ── o veredito separa 401 de 403 ────────────────────────────────────
{
  ok(/const so403 = m\.invalidacoes\.por_403 > 0 && m\.invalidacoes\.por_401 === 0;/.test(src),
     'o veredito detecta o caso "so 403"');
  ok(/TODAS por 403/.test(src),
     '⚠️ e avisa que pode ser rota restrita (renovacao nao cura)');
  ok(/por_401=\$\{m\.invalidacoes\.por_401\}/.test(src),
     '  e no caso misto, mostra os dois numeros');
}

// ── ⚠️ e NÃO afrouxou: o bloqueio continua ──────────────────────────
//
// Este é o ponto que importa. Se o saldo passar a não bloquear, o veredito
// diria "pronto" para um eixo que está tomando 401 o dia todo — e o corte
// seguiria o conselho errado.
{
  ok(/if \(invTotal > retryTotal\) \{/.test(src),
     '⚠️ a condicao de bloqueio e a MESMA (saldo de invalidacao sem retry)');
  ok(/motivos\.push\(`\$\{invTotal - retryTotal\} invalidacao/.test(src),
     '  e continua entrando em `motivos` (que e o que bloqueia)');
}

// ── a mensagem, exercitada com o caso real do ML ────────────────────
{
  const monta = (inv, retry) => {
    const invTotal = inv.por_401 + inv.por_403 + (inv.outras || 0);
    const retryTotal = retry.ok + retry.falhou;
    if (invTotal <= retryTotal) return null;
    const so403 = inv.por_403 > 0 && inv.por_401 === 0;
    return `${invTotal - retryTotal} invalidacao(oes) sem retry conhecido`
      + (so403 ? ' — TODAS por 403' : ` — por_401=${inv.por_401}, por_403=${inv.por_403}`);
  };

  // o caso medido hoje no ML da GOOD
  const ml = monta({ por_401: 0, por_403: 12, outras: 0 }, { ok: 0, falhou: 2 });
  ok(/TODAS por 403/.test(ml || ''),
     '⚠️ o caso real do ML (0x401, 12x403) aponta rota restrita');

  // e um caso de token de verdade não pode dizer isso
  const token = monta({ por_401: 8, por_403: 0, outras: 0 }, { ok: 0, falhou: 1 });
  ok(!/TODAS por 403/.test(token || '') && /por_401=8/.test(token || ''),
     '  ⚠️ e 401 puro NAO e confundido com permissao');

  // e sem saldo, não bloqueia
  ok(monta({ por_401: 2, por_403: 0, outras: 0 }, { ok: 2, falhou: 0 }) === null,
     '  e retry cobrindo as invalidacoes nao gera motivo');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
