'use strict';
// b563 — a GOOD usa a copia UNICA do indice de nomes (fabrica da AMB/Girassol), com o Bling dela, nome minimo de 5 e
// o pre-aquecimento no formato certo. Roda a fabrica de producao com a configuracao da GOOD.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const R = path.join(__dirname, '..');
const s = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
ok(/const nfNomes = require\('\.\/amb-devolucoes\/lib-AMB\/nf-nomes-AMB'\)\.criar\(\{/.test(s) && !/require\('\.\/lib\/nf-nomes'\)/.test(s), '⚠️ a GOOD usa a fabrica UNICA do indice de nomes');
ok(!/nfNomes\.preAquecer\(\)/.test(s) && /nfNomes\.preAquecer\(\{ maxPaginas: PAGINAS_PASSE_CURTO \}\)/.test(s), '⚠️ pre-aquecimento: (0) = agora; { maxPaginas } = passe curto do boot (nunca a varredura inteira no boot)');
(async () => {
  const urls = []; const NFS = [{ id: 1, numero: '1', serie: '1', dataEmissao: '2026-09-01 10:00:00', chaveAcesso: '35260900000000000000550010000000011000000001', contato: { nome: 'Leandro Augusto Fernandes' } }];
  const fab = require(path.join(R, 'amb-devolucoes', 'lib-AMB', 'nf-nomes-AMB.js'));
  const good = fab.criar({ PREFIXO_ENV: 'GOOD_', bling: { pausaMs: 0 }, nomeMinimo: 5, clienteBling: { chamarBling: async (u, o) => { urls.push([u, o]); return { ok: true, status: 200, data: { data: /pagina=1(\D|$)/.test(u) ? NFS : [] } }; } } });
  await good.construirIndice({ fundo: true, maxPaginas: 3 });
  ok(urls.length > 0 && urls.every(([u, o]) => o && o.fundo === true), '  montagem com { fundo: true } passa o fundo a TODA chamada ao Bling');
  ok((await good.buscarPorNome('Ana')).candidatos.length === 0, '  nome com menos de 5 letras: vazio (como a GOOD fazia)');
  const r = await good.buscarPorNome('Leandro Augusto Fernandes');
  ok(r.candidatos.length === 1 && r.montando === false && 'indiceParcial' in r, '  acha a nota e devolve montando/indiceParcial (a rota da GOOD le os dois)');
  const st = good.statusIndice();
  ok(['erro', 'idade_min', 'janela_dias', 'nf_mais_antiga', 'total_nfs'].every((k) => k in st), '  status tem os 5 campos que a tela da GOOD le');
  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (excecao):', e && e.stack); process.exit(1); });
