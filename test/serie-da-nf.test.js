// Roda com: node test/serie-da-nf.test.js
//
// O CASO REAL que o dono achou: a NF 637 do card e a NF 637 que a busca
// devolvia sao notas DIFERENTES.
//
//   card:   35260564289091000100550010000006371757802116  -> serie 001, mai/26
//   achada: 35260864289091000100550030000006371448079669  -> serie 003, ago/26
//
// Mesmo numero, series diferentes. A busca por numero devolvia a mais
// recente (a errada), minha checagem de chave recusava, e o caso ficava sem
// vinculo — sem explicar por que.
//
// [stated] "pq vc não coloca no card pra eu escolher qual das NFs seguir
// pro caso? ou será q não teria como confrontar então os nomes dos
// clientes?"
//
// A serie ja esta DENTRO da chave que temos, entao da pra filtrar exato —
// sem pedir escolha e sem depender do nome do cliente (que vem null em
// varios casos).

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── a serie sai da chave ────────────────────────────────────────────
{
  const serie = (ch) => {
    const d = String(ch || '').replace(/\D/g, '');
    return d.length === 44 ? d.slice(22, 25).replace(/^0+/, '') : null;
  };
  ok(serie('35260564289091000100550010000006371757802116') === '1',
     'a chave do card diz serie 001');
  ok(serie('35260864289091000100550030000006371448079669') === '3',
     'e a que a busca achava, serie 003 — notas diferentes');
  ok(serie('123') === null, 'chave curta nao vira serie inventada');
  ok(serie(null) === null, 'nem nula');
}

// ── a busca filtra por serie ────────────────────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'lib/bling.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/admin-helpers-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const i = src.indexOf('async function buscarNFnoBlingPorNumero');
    const fn = src.slice(i, i + 5000);
    ok(/const serieDaChave = /.test(fn), nome + ': extrai a serie da chave');
    ok(/'&serie=' \+ encodeURIComponent\(serieDaChave\)/.test(fn),
       nome + '  e passa no filtro — a busca ja vem certa');
    ok(/sao notas DIFERENTES com o mesmo numero/.test(fn),
       nome + ': com o caso real registrado');
  }

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/chave: item\.nf_chave/.test(src),
       nome + ': a rota passa a chave, de onde a serie sai');
  }
}

// ── e quando nao acha, o card DIZ por que ───────────────────────────
{
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/nf_motivo_sem_vinculo/.test(src),
       nome + ': o item carrega o MOTIVO de nao ter vinculo');
    // b210.1: o texto ficou mais honesto — "nao achei", nao "nao existe"
    ok(/pode estar cancelada, fora do alcance da busca/.test(src),
       nome + '  explicando a hipotese, em vez de so "nao localizada"');
  }

  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/x\.nf_motivo_sem_vinculo/.test(html), nome + ': e a tela mostra o motivo');
  }
}

// ── b216: QUALQUER serie != 1 e Full, nao so a 2 ────────────────────
//
// [stated] "vendas normais da matriz tudo série 1. daí cada marketplace com
// operação fullfilment vai ter 1 série específica"
//
// `ehSerie2` nasceu quando so existia a serie 2 (ML Full). A serie 3 da AMB
// era classificada como nota COMUM — e o painel oferecia o fluxo de geracao
// normal pra uma nota que o MARKETPLACE emitiu.
{
  const eh = (d) => {
    const direto = String(d.nf_serie || '').trim().replace(/^0+/, '');
    if (direto) return direto !== '1';
    const ch = String(d.nf_chave || '').replace(/\D/g, '');
    if (ch.length === 44) {
      const s = ch.substr(22, 3).replace(/^0+/, '');
      return s !== '1' && s !== '';
    }
    return false;
  };
  ok(eh({ nf_serie: '1' }) === false, 'serie 1 (matriz) NAO e Full');
  ok(eh({ nf_serie: '2' }) === true, 'serie 2 (ML Full) e Full');
  ok(eh({ nf_serie: '3' }) === true, 'serie 3 (AMB) tambem — era o buraco');
  ok(eh({ nf_serie: '005' }) === true, 'e qualquer outra, com zeros a esquerda');
  ok(eh({}) === false, 'sem serie conhecida, nao afirmo que e Full');
  ok(eh({ nf_chave: '35260864289091000100550030000006371448079669' }) === true,
     'e a serie sai da chave quando nao vem direto');

  for (const [nome, rel] of [
    ['GOOD', 'public/painel-devolucoes.html'],
    ['AMB (servido)', 'amb-devolucoes/public-AMB/painel-AMB.html'],
    ['AMB (direto)', 'amb-devolucoes/public-AMB/painel2-AMB.html'],
  ]) {
    const html = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/QUALQUER serie != 1 e Full/.test(html),
       nome + ': o painel trata serie != 1 como Full');
    ok(/nf_serie: x\.nf_serie/.test(html),
       nome + ': e a serie vai no payload (o caso resolvido AUTOMATICO perdia)');
  }

  for (const [nome, rel] of [['GOOD', 'lib/rotas-admin-nf.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/rotas-admin-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/const ehFull = !!serieReg && serieReg !== '1'/.test(src),
       nome + ': a rota full-vincular aceita qualquer serie de Full');
    ok(!/=== '2' \|\|/.test(src),
       nome + '  sem a checagem antiga que so via a serie 2');
  }

  // a serie sobrevive ao refresh, pelo cache
  const cache = fs.readFileSync(path.join(RAIZ, 'lib', 'vinculo-nf-cache.js'), 'utf8');
  ok(/if \(!item\.nf_serie && v\.serie\) item\.nf_serie = v\.serie/.test(cache),
     'o cache devolve a serie no refresh seguinte');

  // e busca truncada so decide pela CHAVE
  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/const decidiuPelaChave = /.test(src) && /!buscaCompleta && !decidiuPelaChave/.test(src),
       nome + ': lista truncada so aceita escolha pela chave, nao por 2 sinais fracos');
  }
}

// ── b216.1: os dois da rodada ───────────────────────────────────────
{
  // a serie da DEVOLUCAO tem que ser a mesma da VENDA
  const ok2 = (sNF, serieReg) => !!sNF && sNF !== '1' && (!serieReg || sNF === serieReg);
  ok(ok2('2', '2') === true, 'entrada da mesma serie de Full: aceita');
  ok(ok2('5', '2') === false,
     'entrada de OUTRO canal Full: recusa — se a conta tem varias series, meu '
     + '"qualquer != 1" pegaria a nota errada');
  ok(ok2('1', '2') === false, 'e a da matriz continua fora');
  ok(ok2('3', null) === true, 'card sem serie conhecida: aceita qualquer Full');

  for (const [nome, rel] of [['GOOD', 'lib/rotas-admin-nf.js'],
                             ['AMB', 'amb-devolucoes/lib-AMB/rotas-admin-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/sNF !== '1' && \(!serieReg \|\| sNF === serieReg\)/.test(src),
       nome + ': a serie da devolucao tem que bater com a da venda');
  }

  // o decorador recalcula quando a serie veio do CACHE sem o resto
  const decora = (i) => !(i.nf_serie && i.nf_do_full !== undefined);
  ok(decora({ nf_serie: '003' }) === true,
     'serie restaurada do cache SEM canal: recalcula (o aviso de Full sumia)');
  ok(decora({ nf_serie: '003', nf_do_full: true }) === false,
     '  e o que ja esta completo nao e refeito');

  for (const [nome, rel] of [['GOOD', 'server.js'], ['AMB', 'amb-devolucoes/app-AMB.js']]) {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    ok(/if \(item\.nf_serie && item\.nf_do_full !== undefined\) continue;/.test(src),
       nome + ': o decorador so pula quem tem serie E canal');
    ok(/const serie = item\.nf_serie \|\| confrontar\.serieDaChave/.test(src),
       nome + '  e aproveita a serie que veio do cache');
  }
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
