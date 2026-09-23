'use strict';
// ⚠️ O ASSISTENTE SEPARA O QUE A MÁQUINA RESOLVE DO QUE SÓ A PESSOA TEM.
//
// O dono olhou a lista de 9 envs + 3 ids fiscais + 7 tabelas e perguntou se
// não dava para facilitar. Dá — para a maior parte. Este teste guarda a
// separação, porque errar para qualquer lado custa:
//
//   prometer demais  -> ele confia num id que o script não tinha como saber
//   prometer de menos -> ele caça no DevTools algo que a API entrega

const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const { plugar, segredoForte } = require('../scripts/plugar-empresa');

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

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA ' + e.message); process.exit(1); });
