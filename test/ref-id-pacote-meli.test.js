'use strict';
// b789 — "PACOTE MELI": o Ref. ID da etiqueta de volta do Mercado Livre (venda que NAO foi entregue e voltou).
//
// O caso (AMB, 21/11): a etiqueta vem com remetente "MELI #0", sem cliente e sem NF. O codigo de barras e o QR
// ({"id":"48133297953","t":"lm"}) sao o envio DE VOLTA — o ML responde 404 e nem o app dele acha a venda por esse
// numero. O que acha e o "Ref. ID" impresso (48126024340 = o envio original): digitado na triagem, a venda aparece
// (medido pelo dono). Este teste cobre a LEITURA do Ref. ID no texto que o leitor de imagem devolve; a tela (cartao,
// botao "pacote MELI", foto → Ref. ID → venda) esta em test/ref-id-navegador.test.js, no Chromium de verdade.
//
// As funcoes sao as de PRODUCAO: o trecho puro do public/js/colar-imagem.js (sem DOM), recortado entre dois marcadores
// estaveis — o mesmo jeito do test/leitor-etiqueta.test.js, que e como o arquivo (um script de navegador, sem modulo)
// deixa executar fora do navegador.
// Roda com: node test/ref-id-pacote-meli.test.js
const fs = require('fs');
const path = require('path');
const { entreMarcadores } = require('./_recorte');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const SRC = ler('public/js/colar-imagem.js');
const api = new Function(entreMarcadores(SRC, 'var PADROES = [', '  // ── a area visivel') + '; return { candidatos, candidatosRefId, conferirComNaoEntregues };')();
const refs = (texto, jaTentado) => api.candidatosRefId(texto, jaTentado).map((c) => c.valor + (c.rotulado ? '*' : ''));   // * = leu o rotulo

const BARRAS = '48133297953', REF = '48126024340';
// O texto que o leitor de VERDADE (tesseract.js 5.1.1, idioma 'por', a mesma lista de caracteres e o mesmo preparo da
// imagem que a tela usa) devolveu pra foto da etiqueta da AMB em 21/11 — sem as linhas de endereco, que nao interessam.
const OCR_REAL = 'G MELI AO\nR. 1D: 48126024340\nXSP16\n481332 97953\nJE SSP57 -- 7\nXSP16  SSP57 49 7\nSEX 02/10/2026 NF:';

console.log('── 1. o Ref. ID no texto da etiqueta');
ok(refs(OCR_REAL, BARRAS).join() === REF + '*', '⚠️ o texto MEDIDO na foto real ("R. 1D: 48126024340"): acha o Ref. ID pelo rotulo — ' + refs(OCR_REAL, BARRAS).join());
for (const [nome, texto] of [
  ['rotulo inteiro', 'REF. ID: 48126024340\n48133297953'],
  ['sem os dois pontos', 'REF ID 48126024340'],
  ['I lido como L e D como 0', 'RE. L0: 48126024340'],
  ['rotulo colado, com os dois pontos', 'RID:48126024340'],
  ['numero partido em dois pelo negrito do fim', 'R. 1D: 481260 24340\n481332 97953'],
  ['minusculas (leitor sem a lista de caracteres)', 'Ref. ID: 48126024340'],
]) ok(refs(texto, BARRAS).join() === REF + '*', '  ' + nome + ' → ' + refs(texto, BARRAS).join());
ok(refs('R. 1D: 48126024340 481332 97953', BARRAS).join() === REF + '*', '⚠️ outro numero na MESMA linha, depois do Ref. ID, nao gruda nele');
ok(refs('R. 1D: 48126024340\n48133297953 123', BARRAS).join() === REF + '*', '  e o numero da linha de baixo nao entra (o Ref. ID nao continua na outra linha)');
ok(refs('R. 1D: 48126024340123', '').length === 0 && refs('R. 1D: 481260243', '').length === 0, '⚠️ so vale numero de envio (10 a 13 digitos): 14 e 9 digitos nao sao Ref. ID');
ok(refs('RIO 21999998888', '').join() === '21999998888', '⚠️ "RIO 21999998888" NAO e lido como rotulo (sem nada separando o R do "ID" e sem os dois pontos)');
ok(refs('BAIRRO 1D: 48126024340', '').join() === REF, '  nem um "R" no meio de outra palavra');

console.log('\n── 1b. (b791, Codex #638) o numero pode ter sido lido pela METADE: so o lido INTEIRO e SOZINHO e "certo"');
{
  // * = leu o rotulo; ? = NAO e certo (a tela pergunta em vez de buscar sozinha)
  const lidos = (texto, ja) => api.candidatosRefId(texto, ja).map((c) => c.valor + (c.rotulado ? '*' : '') + (c.certo === true ? '' : '?')).join(' ');
  ok(lidos(OCR_REAL, BARRAS) === REF + '*', '⚠️ o texto MEDIDO na foto real: uma leitura, certa — ' + lidos(OCR_REAL, BARRAS));
  ok(lidos('REF. ID: 481260 24340') === REF + '*', '  partido no meio (6 + 5): so pode ser o de 11 digitos — uma leitura, certa');
  ok(lidos('REF. ID: 48126 0243 40') === REF + '*', '  partido em TRES pedacos: idem (antes nem achava)');
  ok(lidos('REF. ID: 4812602434 0') === '4812602434*? 48126024340*?',
    '⚠️ partido depois do 10o digito ("4812602434 0"): DUAS leituras, nenhuma certa — o ultimo digito nao e jogado fora (antes: buscava 4812602434, OUTRO envio) — ' + lidos('REF. ID: 4812602434 0'));
  ok(lidos('REF. ID: 48126024340 12') === '48126024340*? 4812602434012*?', '⚠️ e o contrario (numero inteiro + um pedaco curto ao lado): tambem duas leituras — nao gruda sozinho');
  ok(lidos('REF. ID: 1 48126024340') === '148126024340*? 48126024340*?', '  um digito solto ANTES do numero (os dois pontos lidos como 1): duas leituras');
  ok(lidos('REF. ID: 48126024340 12345') === REF + '*' && lidos('REF. ID: 48126024340 123456789') === REF + '*',
    '⚠️ vizinho que nao cabe num numero de envio (daria 16 ou 20 digitos) nao cria duvida — e o pedaco vizinho nunca e cortado no meio');
  ok(lidos('REF. ID: 481  260  243  405555') === '', '  (o leitor de numero para num pedaco INTEIRO: nao corta "405555" em "405" pra fechar um numero de 12 digitos que nao existe)');
  ok(lidos('R. 1D: 4812602434O') === '4812602434*?', '⚠️ letra GRUDADA no fim do numero (um digito que o leitor trocou por letra?): nao e certo — ' + lidos('R. 1D: 4812602434O'));
  ok(lidos('R. 1D: 48126024340 SP') === REF + '*' && lidos('R. 1D: 48126024340.') === REF + '*', '  letra separada por espaco, ou pontuacao no fim: certo');
  ok(lidos('MELI\n48126024340\n481332 97953', BARRAS) === REF, '⚠️ numero solto, sozinho na linha: certo (pelo cartao, continua indo direto)');
  ok(lidos('MELI\n48126024340\n481332 97953') === REF, '⚠️ numero partido que nao tem NENHUM pedaco com tamanho de envio (o do codigo de barras, "481332 97953") nao e oferecido — como antes');
  ok(lidos('MELI\n4812602434 0') === '4812602434? 48126024340?', '⚠️ solto e partido depois do 10o digito: as duas leituras, nenhuma certa');
  ok(lidos('MELI\n4 8126024340') === '48126024340? 8126024340?', '  solto e partido no comeco: idem');
  ok(lidos('BR264131066541Q') === '264131066541?' && lidos('X48126024340') === '48126024340?', '⚠️ numero com letra grudada (um rastreio da Shopee, por exemplo): nao e certo');
  ok(lidos('MELI\n481332 97953\n48133297953 7\n48126024340', BARRAS) === REF, '⚠️ o codigo ja tentado nao volta — nem inteiro, nem partido, nem com um pedaco grudado nele');
  ok(lidos('48126024340 48133297958') === '48126024340 48133297958', '  dois numeros inteiros na mesma linha: os dois, cada um certo (a tela pergunta porque sao DOIS)');
  ok(api.candidatosRefId('REF. ID: 48126024340', '').every((c) => c.certo === true) && api.candidatosRefId('MELI\n48126024340', '').every((c) => c.certo === true), '  `certo` vem sempre como verdadeiro/falso (a tela trata "falso" como duvida)');
  const geral = api.candidatos('G MELI AO\nREF. ID: 4812602434 0\nXSP16');
  ok(geral.length === 2 && geral.every((c) => c.certo === false), '⚠️ na leitura geral da foto entram as DUAS leituras do numero partido (sao duas: a tela pergunta)');
}

console.log('\n── 1c. (b796) a lista das vendas NAO ENTREGUES confere a leitura: um, e so um, dos numeros lidos esta nela → e ele');
{
  // a lista que o cartao carrega (busca.js): o numero do envio de cada venda nao entregue da empresa
  const naLista = (refs) => (n) => refs.includes(n);
  const conferido = (texto, refs, ja) => { const c = api.conferirComNaoEntregues(api.candidatosRefId(texto, ja), refs ? naLista(refs) : null); return c ? c.valor : null; };
  const LISTA_AMB = ['48445471734', '48414606123', REF];
  ok(conferido('REF. ID: 4812602434 0', LISTA_AMB) === REF, '⚠️ numero partido depois do 10o digito (duas leituras, nenhuma "certa"): a de 11 digitos e uma venda nao entregue → e ela');
  ok(conferido('G MELI AO\n48126024340\n48133297958\nXSP16', LISTA_AMB) === REF, '⚠️ dois numeros soltos, sem rotulo: o que esta na lista e o Ref. ID');
  ok(conferido(OCR_REAL, LISTA_AMB, BARRAS) === REF, '  o texto medido na foto real: confere (e ja seria buscado de qualquer jeito)');
  ok(conferido('REF. ID: 4812602434 0', ['48445471734']) === null, '⚠️ nenhuma das leituras esta na lista: nao confere — vale a regra de antes (pergunta)');
  ok(conferido('G MELI AO\n48126024340\n48445471734', LISTA_AMB) === null, '⚠️ DOIS numeros lidos estao na lista: a lista nao decide — pergunta');
  ok(conferido('REF. ID: 4812602434O', LISTA_AMB) === null, '⚠️ digito trocado por letra ("4812602434O"): o numero lido (10 digitos) nao e venda nenhuma — nao confere, pergunta');
  ok(conferido('REF. ID: 4812602434 0', null) === null && api.conferirComNaoEntregues(api.candidatosRefId('REF. ID: 48126024340'), undefined) === null, '  sem a lista (nao carregou): nao confere nada');
  // candidato que nao e Ref. ID (Shopee, rastreio — sem `rotulado`) nunca e conferido como venda nao entregue
  ok(api.conferirComNaoEntregues([{ valor: REF, tipo: 'outro', peso: 1 }], naLista(LISTA_AMB)) === null, '  candidato que nao veio da leitura do Ref. ID nao entra na conferencia');
  const c = api.conferirComNaoEntregues(api.candidatosRefId('REF. ID: 4812602434 0'), naLista(LISTA_AMB));
  ok(c && c.rotulado === true && c.certo === false, '  devolve o candidato como veio (quem decide buscar e a tela)');
}

console.log('\n── 2. sem o rotulo: os numeros soltos, menos o codigo que ja foi tentado');
ok(refs('MELI\n48126024340\n481332 97953', BARRAS).join() === REF, '⚠️ rotulo ilegivel e UM numero de envio na etiqueta → e ele');
ok(refs('MELI\n48126024340\n48133297953', BARRAS).join() === REF, '⚠️ o codigo de barras ja tentado (aqui lido inteiro) NAO volta como candidato');
ok(refs('MELI\n48126024340\n48133297953', '{"id":"48133297953","t":"lm"}').join() === REF, '  o "ja tentado" vale mesmo vindo como o texto do QR');
ok(refs('MELI\n48126024340\n48133297958', BARRAS).join() === REF + ',48133297958', '  dois numeros diferentes do tentado → os DOIS (a tela pergunta qual; nao chuta)');
ok(refs('REF. ID: 48133297953', BARRAS).length === 0, '  rotulo apontando o proprio codigo ja tentado: nada (nao busca o mesmo numero de novo)');
ok(refs('MELI SSP57 CEP 02147040 SEX 02/10/2026', '').length === 0 && refs('', '').length === 0 && refs(null, null).length === 0, '  etiqueta sem numero de envio, texto vazio, nulo: lista vazia');

console.log('\n── 3. na leitura geral da foto (quando nao ha codigo de barras/QR legivel)');
{
  const c = api.candidatos(OCR_REAL);
  ok(c.length === 1 && c[0].valor === REF && /Ref\. ID/.test(c[0].tipo), '⚠️ foto do pacote MELI sem QR legivel: o Ref. ID e oferecido (antes: "nao achei codigo nem texto reconhecivel")');
  const semRotulo = api.candidatos('MELI\n48126024340\nXSP16');
  ok(!semRotulo.some((x) => x.valor === REF), '⚠️ na leitura geral so entra o Ref. ID ROTULADO — numero solto de qualquer etiqueta nao vira candidato');
  const magalu = api.candidatos('MAGALU ENTREGAS AGENCIA MAGALU\nPEDIDO: 1500000000000001\nR. 1D: 48126024340');
  ok(magalu[0].valor === '1500000000000001' && !magalu.some((x) => x.valor === REF), '  etiqueta reconhecida como Magalu segue as regras dela (sem Ref. ID)');
  // o que ja funcionava continua igual
  ok(api.candidatos('SHOPEE BR260514290476K PEDIDO 260807PBTHEWQG').map((x) => x.valor).join() === 'BR260514290476K,260807PBTHEWQG', '  Shopee: rastreio e pedido, como antes');
  ok(api.candidatos('CORREIOS AD123456789BR')[0].valor === 'AD123456789BR' && api.candidatos('CORREIOS AD123456789BR').length === 1, '  Correios reverso, como antes');
  ok(api.candidatos('CHAVE 35260832461988000182550010000773211336345892')[0].valor === '35260832461988000182550010000773211336345892', '  chave da DANFE segue no topo');
  ok(api.candidatos('REF. ID: 48126024340 CHAVE 35260832461988000182550010000773211336345892')[0].valor.length === 44, '  havendo chave da NF na mesma foto, ela vem primeiro (peso maior)');
}

console.log('\n── 4. o que a tela precisa do servidor, nas duas copias da rota de busca');
// A tela so oferece o Ref. ID quando o ML RESPONDEU 404 pro envio: ela le `tentativas[].tipo === 'shipment_id'` com o
// `status` do ML, e usa `codigo_limpo` pra nao oferecer de volta o numero que acabou de falhar. A rota tem duas copias
// (GOOD no server.js; fabrica em identificar-AMB.js) e nenhuma roda sem o ML de verdade — entao aqui o contrato e
// conferido no fonte, entre marcadores estaveis.
for (const [arq, nome] of [['server.js', 'GOOD'], ['amb-devolucoes/lib-AMB/identificar-AMB.js', 'fabrica (AMB/Girassol)']]) {
  const fonte = ler(arq);
  const t1 = entreMarcadores(fonte, '// ML T1: shipment_id', '// ML T2: pack_id');
  ok(/tipo: 'shipment_id', codigo: codigoLimpo,\s*\n\s*ok: r\.ok, status: r\.status,/.test(t1), '⚠️ ' + nome + ': a tentativa do envio sai com tipo "shipment_id" e o status que o ML devolveu');
  const res = entreMarcadores(fonte, 'const resultado = {', 'tentativas: [],');
  ok(/codigo_limpo: codigoLimpo,/.test(res), '  ' + nome + ': a resposta leva `codigo_limpo` (o numero que de fato foi buscado)');
  // e a mensagem do "QR do ML que nao achou" — a primeira coisa que o estoquista le — nao manda mais so pro codigo de
  // barras e pro Pack ID (no pacote MELI os dois sao beco sem saida): aponta o Ref. ID
  const qr = entreMarcadores(fonte, '// ===== QR-ML sem shipment', 'resultado.qr_ml_sem_shipment = true;');
  const naoAchou = qr.split('\n').find((l) => /resultado\.erro = `QR do ML lido[^`]*não achou esse envio/.test(l)) || '';
  ok(/SEM nome de cliente \(remetente MELI\)/.test(naoAchou) && /Ref\. ID impresso no alto da etiqueta/.test(naoAchou) && /Pack ID impresso/.test(naoAchou),
    '⚠️ ' + nome + ': o erro do QR do ML que nao achou aponta o Ref. ID pro pacote MELI (e mantem os caminhos das outras etiquetas)');
  ok(/stShip === 403/.test(qr) && /RECUSOU o acesso \(403\)/.test(qr), '  ' + nome + ': a mensagem do 403 (token/permissao) continua separada');
}

console.log('\n── 5. a tela nova chega no navegador (as 3 empresas carregam os mesmos dois arquivos)');
{
  const good = ler('public/index.html'), fab = ler('amb-devolucoes/public-AMB/index-AMB.html');
  const n = (re, s) => Number((s.match(re) || [])[1]) || 0;
  ok(n(/js\/busca\.js\?v=(\d+)/, good) >= 4798 && n(/js\/colar-imagem\.js\?v=(\d+)/, good) >= 4798, '⚠️ GOOD: ?v= do busca.js e do colar-imagem.js bumpados (o navegador pega os arquivos novos; os dois mudaram no b796 e o busca.js de novo no b798)');
  ok(n(/js-AMB\/busca\.js\?v=b(\d+)/, fab) >= 798 && n(/js-AMB\/colar-imagem\.js\?v=b(\d+)/, fab) >= 796, '⚠️ fabrica: idem');
  for (const [nome, html] of [['GOOD', good], ['fabrica', fab]]) {
    const cola = entreMarcadores(html, 'id="modalColaBipe"', 'SHOPEE</div>');
    ok(/SEM nome de cliente/.test(cola) && /Ref\. ID/.test(cola) && /pacote MELI/.test(cola), '  ' + nome + ': a colinha "O que bipar" explica o pacote MELI e o Ref. ID');
  }
  ok(!fs.existsSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'busca.js')) && !fs.existsSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'js-AMB', 'colar-imagem.js')),
    '  e a fabrica NAO ganhou copia dos dois arquivos (serve os da GOOD: tela unica)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
