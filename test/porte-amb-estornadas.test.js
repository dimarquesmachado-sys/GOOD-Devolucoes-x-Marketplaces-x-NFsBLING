// Roda com: node test/porte-amb-estornadas.test.js
//
// [stated] Pedido dele (30/08): "tinha q ser lib, pra não precisar portar né.
// pra sempre 1 ajuste pegar todas empresas."
//
// Este teste guarda essa promessa: a LOGICA vive em ../lib/ e recebe a
// empresa por parametro; cada servidor so faz FIACAO. Se alguem duplicar
// regra de negocio na AMB, isto quebra.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
// b192.3 (Codex): o painel SERVIDO por /amb/painel e o painel-AMB.html.
// Eu tinha portado so pro painel2, que so e alcancavel pelo endereco
// direto — na pratica o card nao apareceria pra ele.
const PAINEL_AMB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel-AMB.html'), 'utf8');
const PAINEL_AMB2 = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'public-AMB', 'painel2-AMB.html'), 'utf8');
const PAINEL_GOOD = fs.readFileSync(path.join(RAIZ, 'public', 'painel-devolucoes.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// ── a AMB usa a MESMA lib, nao uma copia ─────────────────────────────
{
  ok(/require\('\.\.\/lib\/magalu-cancelados'\)/.test(AMB),
     'a AMB importa ../lib/magalu-cancelados — a MESMA peca da GOOD');
  ok(!fs.existsSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'magalu-cancelados-AMB.js')),
     '  e NAO ha copia em lib-AMB (era o erro que ele quer evitar)');
  ok(/magaluCancelados\.buscar\(EMPRESA/.test(AMB),
     'e chama a lib passando a EMPRESA — o que torna a peca unica');
}

// ── a empresa e FIXA nos dois servidores ─────────────────────────────
{
  ok(/const EMPRESA = 'amb';/.test(AMB),
     'a AMB fixa a empresa: aceitar ?empresa= deixaria uma ver os dados da outra');
  ok(/const empresa = 'good';/.test(SERVER), '  e a GOOD faz o mesmo');
  ok(!/req\.query\.empresa/.test(AMB.slice(AMB.indexOf('sem-retorno'), AMB.indexOf('sem-retorno') + 3000)),
     '  sem parametro de empresa na querystring');
}

// ── as regras FISCAIS sao as mesmas nos dois ─────────────────────────
{
  const rotaAmb = AMB.slice(AMB.indexOf("'/api/admin/sem-retorno'"), AMB.indexOf("'/api/admin/sem-retorno'") + 7000);

  ok(/const jaVoltou = !!d\.tem_devolucao_registrada;/.test(rotaAmb),
     'quem ja voltou nao cancela — houve circulacao de mercadoria');
  // b195.4: o Magalu cancela SO em `nf_sem_saida` — a classe e a prova de
  // que o pedido nunca foi despachado. Nas outras, houve circulacao.
  ok(/d\.marketplace === 'magalu' && d\.classe !== 'nf_sem_saida'/.test(rotaAmb),
     'e o Magalu so cancela onde ha prova de que a mercadoria nao saiu');
  ok(/diasDesde <= 20/.test(rotaAmb), 'o prazo da SEFAZ e o mesmo: 20 dias');
  ok(/baseOrigem = 'data_emissao'/.test(rotaAmb) && /baseOrigem = 'chave_nfe'/.test(rotaAmb),
     'e a hierarquia da data tambem: exata > mes da chave > devolucao');

  ok(/nao consegui conferir quais ja foram triados/.test(rotaAmb),
     'falha na checagem de triados e ERRO, nao lista incompleta');
  ok(/senao seriam duas portas pra mesma nota/.test(rotaAmb),
     '  porque duas portas = duas NFs de devolucao emitidas sem perceber');
}

// ── o card e o mesmo dos dois lados ──────────────────────────────────
{
  ok(/id="secaoSemRetorno"/.test(PAINEL_AMB), 'a AMB tem a secao');
  ok(/async function carregarSemRetorno/.test(PAINEL_AMB), '  e a funcao que carrega');
  ok(/carregarSemRetorno\(\); \/\/ b19/.test(PAINEL_AMB), '  chamada no carregamento');
  ok(/carregarSemRetorno\(\);   \/\/ b19/.test(PAINEL_AMB), '  e no timer');

  // ACIMA do espreita, como ele pediu na GOOD
  const iSR = PAINEL_AMB.indexOf('id="secaoSemRetorno"');
  const iESP = PAINEL_AMB.indexOf('id="secaoEspreita"');
  ok(iSR !== -1 && iESP !== -1 && iSR < iESP, '  no mesmo lugar da GOOD: acima do "a espreita"');

  // b192.3: e nos DOIS paineis da AMB — o servido por /amb/painel e o
  // painel-AMB.html; o painel2 so e alcancavel pelo endereco direto
  ok(/id="secaoSemRetorno"/.test(PAINEL_AMB2) && /carregarSemRetorno/.test(PAINEL_AMB2),
     'o card existe TAMBEM no painel2 (quem usa o endereco direto)');

  // os avisos que importam existem nos DOIS
  for (const [nome, txt] of [['prejuizo integral', 'PREJUÍZO INTEGRAL'],
                             ['entrada de estoque', 'SEM entrada de estoque'],
                             ['conferir antes', 'Confira se houve devolução física'],
                             ['falha do Magalu', 'Os casos do Magalu NÃO entraram']]) {
    ok(PAINEL_AMB.indexOf(txt) !== -1 && PAINEL_GOOD.indexOf(txt) !== -1,
       `o aviso de ${nome} existe nos DOIS paineis`);
  }
}

// ── e o cliente do banco foi exposto sem abrir demais ────────────────
{
  const SB = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'supabase-AMB.js'), 'utf8');
  ok(/cliente: \(\) => conectar\(\)/.test(SB),
     'o cliente do banco e exposto pra consulta pontual');
  ok(/As funcoes acima continuam sendo o caminho/.test(SB),
     '  com a ressalva de que as funcoes do modulo sao o caminho preferido');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
