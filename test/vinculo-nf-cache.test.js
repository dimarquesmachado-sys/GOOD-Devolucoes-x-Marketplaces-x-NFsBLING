// Roda com: node test/vinculo-nf-cache.test.js
//
// O PROBLEMA DE FUNDO: a rota re-buscava a NF de TODOS os casos a cada
// carregamento, contra ~10s e o limite de 3 req/s do Bling. Com 26 casos
// nunca dava tempo — e como o painel atualiza a cada 4 minutos, o trabalho
// era jogado fora e refeito, sempre incompleto.
//
// Mas o vinculo e ESTAVEL: a NF de um pedido de janeiro nao muda.

const fs = require('fs');
const path = require('path');
const c = require('../lib/vinculo-nf-cache');

let falhas = 0;
const ok = (cond, o) => { if (!cond) falhas++; console.log((cond ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── a chave do cache prefere o identificador mais forte ─────────────
{
  // b204.1: a chave leva o NAMESPACE da empresa (contas Bling diferentes)
  ok(c.chaveDe({ nf_chave: '3'.repeat(44), nf_numero: '1', pedido: 'X' }, 'good') === 'good|chave:' + '3'.repeat(44),
     'com chave de 44 digitos, ela e a chave do cache (a mais forte)');
  ok(c.chaveDe({ nf_numero: '065999' }, 'good') === 'good|num:65999',
     'sem chave, o numero — normalizado sem zeros a esquerda');
  ok(c.chaveDe({ pedido: 'P1' }, 'amb') === 'amb|ped:P1', 'e o pedido como ultimo recurso');
  ok(c.chaveDe({}) === null, 'sem nada identificavel, nao guarda');
}

// ── o que ja foi achado nao gasta orcamento de novo ─────────────────
{
  const itens = [
    { nf_numero: '65999', nf_chave: '3'.repeat(44) },
    { nf_numero: '66556' },
    { pedido: '583529996785714778' },
  ];
  ok(c.aplicar(itens).length === 3, 'primeira carga: todos precisam ser buscados');

  c.guardar(itens[0], '111', 'numero');
  c.guardar(itens[1], '222', 'numero');

  const outraCarga = itens.map((x) => ({ ...x, nf_id_bling: undefined }));
  const faltam = c.aplicar(outraCarga);
  ok(faltam.length === 1, 'segunda carga: so o que faltava e buscado');
  ok(outraCarga[0].nf_id_bling === '111', '  e o achado antes volta pronto');
  ok(outraCarga[0].nf_achada_por === 'numero', '  com o caminho por onde veio');
}

// ── nao vaza memoria nem guarda pra sempre ──────────────────────────
{
  const e = c.estado();
  ok(e.teto === 5000, 'ha teto de tamanho — o excedente sai pelo mais antigo');
  ok(e.ttl_horas === 12, 'e prazo de validade: 12h, nao pra sempre');
}

// ── a chave AUSENTE nao vale como confirmacao ───────────────────────
//
// A listagem do /nfe pode voltar SEM `chaveAcesso` (documentado no proprio
// repo, b166.4). Tratar isso como "conferiu" aceitava nota de outra SERIE.
{
  const decidir = (chaveItem, chaveAchada) => (chaveItem ? (chaveAchada === chaveItem) : true);
  ok(decidir('AAA', 'AAA') === true, 'chave que bate: aceita');
  ok(decidir('AAA', 'BBB') === false, 'chave de outra serie: recusa');
  ok(decidir('AAA', '') === false,
     'resposta SEM chave e o item COM chave: NAO confirma (ia aceitar antes)');
  ok(decidir('', 'AAA') === true, 'item sem chave: o numero e o que ha');

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/chaveItem\s*\n?\s*\?\s*\(chaveAchada === chaveItem\)/.test(src),
       nome + ': exige que a chave BATA quando o item tem uma');
    ok(/vinculoCache\.aplicar\(itens, /.test(src),
       nome + ': aplica o cache (com a empresa) antes de gastar orcamento');
    ok(/vinculoCache\.guardar/.test(src), nome + ': e guarda o que acha');
    ok(/INICIO_BUSCA > 6000/.test(src),
       nome + ': a fase do numero para aos 6s, reservando tempo pra fase da CHAVE');
  }
}

// ── b204.1: as quatro consequencias que a revisao pegou ─────────────
{
  // 1. NAMESPACE: os dois servidores partilham o processo, mas autenticam
  //    em CONTAS BLING diferentes
  c._CACHE.clear();
  c.guardar({ nf_numero: '65999' }, 'DA-GOOD', 'numero', {}, 'good');
  ok(c.ler({ nf_numero: '65999' }, 'amb') === null,
     'a AMB NAO recebe o vinculo guardado pela GOOD — contas Bling diferentes');
  ok(c.ler({ nf_numero: '65999' }, 'good').id === 'DA-GOOD',
     '  e a GOOD recebe o seu');

  // 2. IDENTIDADE ESTAVEL: guardar com a chave de ANTES do enriquecimento
  c._CACHE.clear();
  const item = { pedido: 'P9' };
  const idAntes = c.chaveDe(item, 'good');
  item.nf_chave = '3'.repeat(44);          // a busca enriqueceu depois
  item.nf_numero = '99999';
  c.guardar(item, 'ACHADO', 'pedido', {}, 'good', idAntes);
  ok(c.ler({ pedido: 'P9' }, 'good') !== null,
     'o refresh seguinte acha pelo identificador CRU (so o pedido)');
  ok(c.ler({ pedido: 'P9' }, 'good').id === 'ACHADO',
     '  senao o cache guardaria por `chave:` e nunca mais seria encontrado');

  // 3. e 4. o cache roda ANTES de montar as filas
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf("'/api/admin/sem-retorno'");
    const rota = src.slice(i, i + 40000);
    const iCache = rota.indexOf('vinculoCache.aplicar');
    const iFila = Math.min(
      ...['const comNumero =', 'const semVinculoAMB =']
        .map((t) => rota.indexOf(t)).filter((n) => n > 0)
    );
    // b204.2: antes de TODAS as filas, nao so da primeira que eu olhei
    const posFilas = ['const semVinculo =', 'const doMagalu =', 'const dosOutros =',
                      'const comNumero =', 'const semNota =', 'const semVinculoAMB =']
      .map((t) => rota.indexOf(t)).filter((n) => n > 0);
    ok(iCache > 0 && posFilas.every((pos) => iCache < pos),
       nome + ': o cache roda antes de TODAS as ' + posFilas.length + ' filas');

    // e TODA fase que acha guarda — inclusive a da chave, que e a mais cara
    const fases = (rota.match(/const idCache = /g) || []).length;
    const guardas = (rota.match(/vinculoCache\.guardar/g) || []).length;
    ok(fases > 0 && fases === guardas,
       nome + ': as ' + fases + ' fases guardam o que acham (a da chave PAGINA o Bling)');
    ok(rota.split('vinculoCache.aplicar').length === 2,
       nome + ': uma aplicacao so — nao duas em pontos diferentes');
    ok(/const idCache = vinculoCache\.chaveDe\(item, /.test(rota),
       nome + ': e guarda com a identidade de antes do enriquecimento');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
