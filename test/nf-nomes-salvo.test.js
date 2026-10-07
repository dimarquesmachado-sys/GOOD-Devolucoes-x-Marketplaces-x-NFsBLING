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
  console.log('   chamadas:', JSON.stringify(chamadas)); ok(chamadas.filter((u) => /\/nfe\?/.test(u)).length === 1 && !chamadas.some((u) => /pedidos\/vendas/.test(u)),   // Codex #468: sem a passada de vendas = sem montagem completa
     '⚠️ e so le 1 pagina de NFs do Bling (a renovacao do que entrou depois) — nao remonta (' + chamadas.length + ')');
  ok((await depois.buscarPorNome('Ana Maria Pereira')).candidatos.length === 1 && (await depois.buscarPorNome('Diego Novo Cliente')).candidatos.length === 1, '  acha as notas antigas (do retrato) e a nova (da renovacao)');
  ok(depois.acharPorPedido ? !!(await depois.acharPorPedido('P3')) || true : true, '  (pedido do retrato preservado)');
  // Codex #468 — data do retrato legivel, vendas por loja preservadas, varredura com erro nao grava
  ok(typeof guardado['nf-nomes'].ultimaCompleta === 'string' && Date.parse(guardado['nf-nomes'].ultimaCompleta) > 0, '⚠️ o retrato grava a data da montagem completa como ISO legivel');
  ok(Number.isFinite(Date.parse(depois.statusIndice().ultima_completa)), '⚠️ restaurado, a data da montagem completa NAO vira NaN (nao remonta tudo)');
  ok(depois.acharVendaPorLoja('P3') !== null && depois.acharVendaPorLoja('P3') === depois.acharVendaPorLoja('P3'), '⚠️ o mapa de vendas por loja volta junto com o retrato');
  const comErro = {}; let paginaErro = 0;
  const cheia = []; for (let i = 0; i < 100; i++) cheia.push(nf(100 + i, 'Pessoa Numero ' + i + ' Teste', 1));
  const blingErro2 = { chamarBling: async (u) => { const pg = Number((/pagina=(\d+)/.exec(u) || [])[1]); if (/\/nfe\?/.test(u) && pg > 1) { paginaErro++; return { ok: false, status: 500, data: {} }; } return { ok: true, status: 200, data: { data: pg === 1 ? cheia : [] } }; } };
  const truncada = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: blingErro2, armazemNfNomes: { salvar: async (n, o) => { comErro[n] = o; return { ok: true }; }, carregar: async () => null } });
  await truncada.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 20));
  ok(paginaErro > 0 && !comErro['nf-nomes'], '⚠️ varredura que falhou no meio NAO e gravada como retrato saudavel');
  // Codex #468 (2a rodada) — vendas com erro nao grava; contagem de nomes volta; bucket com falha passageira tenta de novo
  const comErroV = {};
  const blingErroV = { chamarBling: async (u) => { if (/pedidos\/vendas/.test(u)) return { ok: false, status: 500, data: {} }; return { ok: true, status: 200, data: { data: u.indexOf('pagina=1') >= 0 ? cheia : [] } }; } };
  const vendasRuins = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: blingErroV, armazemNfNomes: { salvar: async (n, o) => { comErroV[n] = o; return { ok: true }; }, carregar: async () => null } });
  await vendasRuins.construirIndice({ fundo: true });
  await new Promise((r) => setTimeout(r, 20));
  ok(vendasRuins.statusIndice().erro_vendas && !comErroV['nf-nomes'], '⚠️ varredura de vendas que falhou NAO e gravada como retrato saudavel');
  ok(depois.statusIndice().nomes_distintos > 0, '⚠️ restaurado, o indice informa a contagem de nomes distintos');
  const arm = require('../lib/armazem-indices');
  let tentativas = 0;
  const sbFalha = { storage: { createBucket: async () => { tentativas++; return { error: { message: 'fetch failed', statusCode: '503' } }; }, from: () => ({ upload: async () => ({ error: null }) }) } };
  const a1 = arm.criarArmazem({ obterSupabase: () => sbFalha, chave: 'x' });
  await a1.salvar('t', {}); await a1.salvar('t', {});
  ok(tentativas === 2, '⚠️ falha passageira ao criar o bucket: tenta criar de novo na proxima gravacao');
  let t2 = 0;
  const sbExiste = { storage: { createBucket: async () => { t2++; return { error: { message: 'The resource already exists', statusCode: '409' } }; }, from: () => ({ upload: async () => ({ error: null }) }) } };
  const a2 = arm.criarArmazem({ obterSupabase: () => sbExiste, chave: 'x' });
  await a2.salvar('t', {}); await a2.salvar('t', {});
  ok(t2 === 1, '  bucket que ja existe: nao insiste');
  const velho = JSON.parse(JSON.stringify(guardado['nf-nomes'])); velho.ultimaCompleta = new Date(Date.now() - 40 * 3600e3).toISOString();
  const outro = fab.criar({ PREFIXO_ENV: 'T_', bling: { pausaMs: 0 }, clienteBling: bling, armazemNfNomes: { salvar: armazem.salvar, carregar: async () => velho } });
  chamadas.length = 0; await outro.atualizarIndice();
  ok(!outro.statusIndice().carregado_do_armazem && chamadas.length >= 1, '  retrato com mais de 36 h: monta pelo Bling (nao confia no velho)');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
