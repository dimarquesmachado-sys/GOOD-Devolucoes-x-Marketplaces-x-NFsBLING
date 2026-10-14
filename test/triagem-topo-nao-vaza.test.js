'use strict';
// 14/10 — dono: na triagem da Girassol o "❓ O que bipar" saia da tela. A faixa de links do topo nao quebrava linha
// (flex 0 0 auto sem wrap); com o titulo maior ("Magazine Girassol Devolucoes") ela empurrava o fim pra fora.
const fs = require('fs'); const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const h = fs.readFileSync(path.join(__dirname, '..', 'amb-devolucoes', 'public-AMB', 'index-AMB.html'), 'utf8');
// a regra PRINCIPAL do seletor (a que define o display) — a do celular (@media) vem antes no arquivo e so ajusta
const regra = (sel, marca) => { const re = new RegExp('\\n\\s*' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'g'); let m; while ((m = re.exec(h))) { if (marca.test(m[1])) return m[1]; } return ''; };
const links = regra('.links-defeitos', /display:\s*flex/);   // a regra principal (as do @media so ajustam/escondem)
ok(/flex-wrap:\s*wrap/.test(links), '⚠️ os links do topo (Defeitos, Lançar, Solicitações, O que bipar) QUEBRAM LINHA em vez de sair da tela');
ok(!/flex:\s*0 0 auto/.test(links) && /min-width:\s*0/.test(links), '  e podem encolher (nao forcam a largura da faixa)');
ok(/flex:\s*1 1 220px/.test(regra('.topo-txt', /min-width/)), '  o titulo guarda espaco: sem caber do lado, os links descem pra linha de baixo');
ok(/\.topo-faixa \{[^}]*flex-wrap:\s*wrap/.test(h), '  a faixa do topo quebra linha');
// a peca da marca e multiloja, em /lib
ok(fs.existsSync(path.join(__dirname, '..', 'lib', 'marca-empresa.js')) && !fs.existsSync(path.join(__dirname, '..', 'amb-devolucoes', 'lib-AMB', 'marca-AMB.js')), '⚠️ a marca por empresa e peca multiloja em /lib (lib/marca-empresa.js)');
console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
