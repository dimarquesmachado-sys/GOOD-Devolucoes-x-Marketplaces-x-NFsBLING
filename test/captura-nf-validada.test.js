'use strict';
// 30/10 — de 04/10 ao #507 a espreita da Girassol/AMB gravava na captura o PALPITE da NF pelo nome (a tosquiadeira
// 2609069UWS4UFX, venda 126747, guardada como 126807). No card 'Achei no que foi GUARDADO' a NF vira toque que abre
// a triagem dela. Agora so vale se o indice confirmar que e a NF DAQUELE pedido. Roda a funcao de PRODUCAO.
const fs = require('fs'); const path = require('path');
const { validarNfGuardada } = require('../amb-devolucoes/lib-AMB/identificar-AMB');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const idx = { acharPorPedido: (p) => ({ '2609069UWS4UFX': { numero: '126747' }, 'P2': { numero: '000555' } })[p] || null };
const errada = validarNfGuardada({ marketplace: 'shopee', pedido: '2609069UWS4UFX', nf_numero: '126807' }, idx);
ok(errada.nf_numero === null && errada.nf_guardada_nao_confirmada === true, '⚠️ NF guardada que NAO e a do pedido (palpite 126807) deixa de virar toque');
ok(validarNfGuardada({ marketplace: 'shopee', pedido: '2609069UWS4UFX', nf_numero: '126747' }, idx).nf_numero === '126747', '  NF guardada confirmada pelo indice continua (126747)');
ok(validarNfGuardada({ marketplace: 'ml', pedido: 'P2', nf_numero: '555' }, idx).nf_numero === '555', '  zeros a esquerda nao atrapalham (555 = 000555)');
ok(validarNfGuardada({ marketplace: 'ml', pedido: 'SEMINDICE', nf_numero: '999' }, idx).nf_numero === null, '  pedido que o indice nao conhece: nao confirma -> sem toque (ausente e melhor que errado)');
ok(validarNfGuardada({ marketplace: 'tiktok', pedido: 'X', nf_numero: '777' }, idx).nf_numero === '777', '  TikTok (vem da API dele) fica como esta');
ok(validarNfGuardada({ marketplace: 'shopee', pedido: 'P', nf_numero: '1' }, null).nf_numero === null, '  sem indice: nao confirma');
const src = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'identificar-AMB.js'), 'utf8');
ok(/resultado\.capturadas = lista\.map\(\(c\) => validarNfGuardada\(c, nfNomes\)\)/.test(src), '⚠️ a busca da Girassol/AMB passa toda sugestao guardada pela validacao');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
