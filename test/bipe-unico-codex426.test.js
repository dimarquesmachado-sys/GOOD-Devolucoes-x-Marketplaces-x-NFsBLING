// b517 — apontamentos do Codex no #426: --escuro na GOOD, serie da nf_chave, produtoId na foto da GOOD.
const fs = require('fs');
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FALHA ') + m); if (!c) falhas++; };
const idx = fs.readFileSync('public/index.html', 'utf8');
const srv = fs.readFileSync('server.js', 'utf8');
const amb = fs.readFileSync('amb-devolucoes/lib-AMB/identificar-AMB.js', 'utf8');
const rota = fs.readFileSync('lib/rotas-admin-good-extra.js', 'utf8');
ok(/:root\s*\{[^}]*--escuro:/.test(idx), 'GOOD define --escuro (busca.js usa var(--escuro))');
ok(/nf_serie, nf_chave, created_at/.test(srv) && /confrontar\.serieDaChave\(r\.nf_chave\)/.test(srv), 'GOOD: JA TRIADA recupera a serie da nf_chave');
ok(/nf_serie, nf_chave, criado_em/.test(amb) && /slice\(22, 25\)/.test(amb), 'AMB: JA TRIADA recupera a serie da nf_chave');
ok(/req\.query\.produtoId/.test(rota) && /produtos\/\$\{encodeURIComponent\(idNota\)\}/.test(rota), 'GOOD: rota de imagem honra produtoId');
ok(!/IMG_CACHE\.set\(chave,/.test(rota), 'GOOD: cache da foto sempre pela chaveCache (id da NF quando houver)');

// comportamento: a serie 002 dentro da chave e lida na posicao 22-25
const confrontar = require('../lib/confrontar-nf');
const chave = '35' + '2401' + '12345678000199' + '55' + '002' + '000078425' + '1' + '12345678' + '0';
ok(chave.length === 44 && confrontar.serieDaChave(chave) === '002', 'serieDaChave le a posicao 22-25');
process.exit(falhas ? 1 : 0);
