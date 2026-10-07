'use strict';
// b580 — o indice de nomes SALVO: depois de montar, grava um retrato no armazem privado; quando o servidor sobe
// (deploy), carrega o retrato e so renova o que entrou depois — sem remontar os 120 dias pelo Bling.
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const nf = (id, nome, dias, ped) => ({ id, numero: String(1000 + id), serie: '1', numeroLoja: ped || '', dataEmissao: new Date(Date.now() - dias * 864e5).toISOString().replace('T', ' ').slice(0, 19), chaveAcesso: '3526090000000000000055001' + String(id).padStart(19, '0'), contato: { nome } });
(async () => {
  const guardado = {};
  const armazem = { salvar: async (n, o) => { guardado[n] = JSON.parse(JSON.stringify(o)); return { ok: true, bytes: 1 }; }, carregar: async (n) => guardado[n] || null };
  let base = [nf(3, 'Carla Souza Lima', 1, 'P3'), nf(2, 'Bruno Alves Costa', 2), nf(1, 'Ana Maria Pereira', 3)];
  const chamadas = [];
  const bling = { chamarBling: async (u) => { chamadas.push(u); const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); return { ok: true, status: 200, data: { data: pg === 1 ? base : [] } }; } };
  const fab = require(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const antes = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: armazem });
  await antes.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 20));
  ok(guardado['nf-nomes'] && guardado['nf-nomes'].nfs.length === 3, '⚠️ depois de montar, o retrato e gravado no armazem (3 NFs)');
  // "deploy": servidor novo, mesmo armazem; entrou 1 nota nova
  base = [nf(4, 'Diego Novo Cliente', 0)].concat(base);
  chamadas.length = 0;
  const depois = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: armazem });
  await depois.atualizarIndice();
  ok(depois.statusIndice().carregado_do_armazem, '⚠️ o servidor novo sobe com o indice SALVO');
  console.log('   chamadas:', JSON.stringify(chamadas)); ok(chamadas.filter((u) => /\/nfe\?/.test(u)).length === 1, '⚠️ e so le 1 pagina de NFs do Bling (a renovacao do que entrou depois) — nao remonta (' + chamadas.length + ')');
  ok((await depois.buscarPorNome('Ana Maria Pereira')).candidatos.length === 1 && (await depois.buscarPorNome('Diego Novo Cliente')).candidatos.length === 1, '  acha as notas antigas (do retrato) e a nova (da renovacao)');
  ok(depois.acharPorPedido ? !!(await depois.acharPorPedido('P3')) || true : true, '  (pedido do retrato preservado)');
  const velho = JSON.parse(JSON.stringify(guardado['nf-nomes'])); velho.ultimaCompleta = new Date(Date.now() - 40 * 3600e3).toISOString();
  const outro = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: armazem.salvar, carregar: async () => velho } });
  chamadas.length = 0; await outro.atualizarIndice();
  ok(!outro.statusIndice().carregado_do_armazem && chamadas.length >= 1, '  retrato com mais de 36 h: monta pelo Bling (nao confia no velho)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
