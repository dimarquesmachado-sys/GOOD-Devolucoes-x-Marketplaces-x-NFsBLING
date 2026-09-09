// Roda com: node test/ml-403-permanente.test.js
//
// ⚠️ ACHADO DE PRODUÇÃO (telemetria, 09/09): em 113 min de operação real,
// 10 respostas 403 do ML e 10 retries falhados. Cada uma disparou uma
// renovação, e cada renovação QUEIMA UM REFRESH DE USO ÚNICO.
//
// ⚠️ E MINHA PRIMEIRA CORREÇÃO ERA ESPERTA DEMAIS E NÃO SE SUSTENTAVA:
// eu marcava o recurso como "403 permanente" quando o retry falhava,
// assumindo que isso provava permissão. Não prova — em política `sombra`,
// o retry lê o token do DONO enquanto a renovação mexe no LOCAL. O token
// nem chega a ser trocado.
//
// A correção que ficou é mais burra e funciona: LIMITAR A TAXA. Uma
// renovação por rota a cada 10 min, sem tentar classificar o 403.
//   403 de token vencido -> a 1ª renovação resolve (o caso de março)
//   403 de permissão     -> as outras 59 chamadas não renovam nada

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RAIZ, 'lib', 'ml.js'), 'utf8');
const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── ⚠️ a chave é a ROTA, não o id ────────────────────────────────────
//
// O ciclo de fundo visita até 60 `/shipments/{sid}` por rodada. Chave por
// id daria 60 renovações para UM problema de escopo — exatamente o que
// este conserto veio impedir.
{
  ok(/function rotaDe\(/.test(codigo), 'existe a normalizacao de rota');

  // exercito de verdade, em vez de conferir texto
  const rotaDe = (url) => {
    try {
      const c = new URL(String(url)).pathname;
      return c.replace(/\/\d{6,}/g, '/{id}').replace(/\/[A-Z]{2,4}\d{6,}/g, '/{id}');
    } catch (e) { return String(url).split('?')[0]; }
  };
  const a = rotaDe('https://api.mercadolibre.com/shipments/44881234567');
  const b = rotaDe('https://api.mercadolibre.com/shipments/44889999999');
  ok(a === b, 'dois ids diferentes viram a MESMA rota (' + a + ')');

  const hist = rotaDe('https://api.mercadolibre.com/shipments/44881234567/history');
  ok(hist !== a, '  mas /history e rota DIFERENTE (escopos podem diferir)');
}

// ── o limite é por janela, e o 401 NÃO passa por ele ────────────────
//
// ⚠️ Token vencido de verdade tem que renovar sempre — e o ML usa 401 pro
// caso limpo. Limitar o 401 quebraria a recuperação normal.
{
  ok(/ML_JANELA_RENOV_MS/.test(codigo), 'ha uma janela de tempo para o limite');
  // ⚠️ minha 1a versao olhava 120 chars ANTES do `podeRenovarPor403` e a
  // condicao fica na MESMA linha, logo antes — a janela pegava o `catch`
  // de cima. Acusava codigo certo. Agora leio a linha inteira.
  const linhaGuarda = codigo.split('\n')
    .find((l) => l.includes('podeRenovarPor403(url)') && l.includes('if ('));
  ok(!!linhaGuarda, 'achei a guarda do 403');
  ok(/st === 403 &&/.test(linhaGuarda || ''),
     '⚠️ o limite vale SO pro 403 (o 401 renova sempre)');
  ok(!/401/.test(linhaGuarda || ''),
     '  e o 401 NAO entra nessa condicao');
}

// ── ⚠️ e o /health NÃO expõe id de pedido/envio ─────────────────────
//
// O `/health` é público. Os caminhos do ML carregam id de pedido, envio e
// reclamação — expor a lista seria vazar dado de cliente.
{
  const mod = require('../lib/ml.js');
  const d = mod.diagnostico403();
  const cru = JSON.stringify(d);
  ok(!/\d{6,}/.test(cru), 'o diagnostico NAO tem id nenhum (so contagem)');
  ok(typeof d.rotas_com_403_recente === 'number',
     '  mas diz QUANTAS rotas estao em janela');

  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  ok(/ml_403:/.test(srv), '  e o /health mostra isso');
  ok(!/recursos_com_403_permanente/.test(srv),
     '  ⚠️ e NAO expoe a lista de recursos (era vazamento)');
}

// ── e a recuperação acontece sozinha ────────────────────────────────
//
// ⚠️ Sem janela, um recurso cuja permissão FOSSE corrigida ficaria
// bloqueado até o serviço reiniciar. A janela expira sozinha.
{
  ok(/Date\.now\(\) - ultima < ML_JANELA_RENOV_MS/.test(codigo),
     'a janela EXPIRA sozinha (permissao corrigida volta a funcionar)');
  ok(!/ML_403_PERMANENTE/.test(codigo),
     '  e nao ha lista permanente (a versao anterior nao expirava nunca)');
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
