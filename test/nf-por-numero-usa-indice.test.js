'use strict';
// ⚠️ A BUSCA POR NUMERO USA O INDICE DE NOMES ANTES DE VARRER O BLING.
//
// Girassol, 01/10: clicar no candidato por nome disparava a busca por numero,
// que saia sondando o Bling dia a dia (12 ancoras + bissecao + paginas —
// dezenas de chamadas), cada uma esperando a fila em pausa de 429. MINUTOS pra
// NF 126421, que estava no indice com id. Agora: indice tem o numero -> id
// direto, UMA chamada. Varredura so quando o indice nao tem, ou ha AMBIGUIDADE
// (mesmo numero em series diferentes — serie 2 do Full) — numero errado e pior
// que ausente.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

(async () => {
  // ── os DOIS indices (GOOD e AMB) exportam acharPorNumero e marcam colisao ──
  // exercito a funcao DE PRODUCAO: construo o indice com um Bling simulado que
  // devolve 3 NFs: 126421/1, 126421/2 (colide) e 127796/1.
  const nfs = [
    { id: 11, numero: '126421', serie: '1', contato: { nome: 'Celma Ribeiro Albeche' }, dataEmissao: '2026-09-30 10:00:00', valorNota: 195.97, chaveAcesso: '3526092754845600014755001' + '0001264211' + '46709322' + '5' },
    { id: 12, numero: '126421', serie: '', contato: { nome: 'Fulano Full' }, dataEmissao: '2026-09-30 10:00:00', valorNota: 10, chaveAcesso: '3526092754845600014755002' + '0001264211' + '46709322' + '5' },
    { id: 13, numero: '127796', serie: '', contato: { nome: 'Jacson Froes Yn' }, dataEmissao: '2026-09-30 11:00:00', valorNota: 27.9, chaveAcesso: '3526092754845600014755001' + '0001277961' + '46709322' + '5' },
  ];
  let pagina = 0;
  const chamarBling = async () => (++pagina === 1 ? { ok: true, status: 200, data: { data: nfs } } : { ok: true, status: 200, data: { data: [] } });

  for (const [nome, caminho, opts] of [
    ['GOOD', '../lib/nf-nomes', { chamarBling }],
    ['AMB/Girassol', '../amb-devolucoes/lib-AMB/nf-nomes-AMB', null],
  ]) {
    let nfNomes;
    if (opts) nfNomes = require(caminho)(opts);
    else {
      // o da AMB e fabrica por empresa: tento as assinaturas conhecidas
      const mod = require(caminho);
      // a AMB e fabrica por empresa: cfg.clienteBling e o cliente (com chamarBling) e PREFIXO_ENV o rotulo
      try { nfNomes = mod.criar({ PREFIXO_ENV: 'TESTE_', clienteBling: { chamarBling } }); }
      catch (e) { nfNomes = null; console.log('  (AMB: nao consegui instanciar: ' + e.message.slice(0, 60) + ')'); }
    }
    if (!nfNomes) { ok(false, `${nome}: nao instanciou o indice`); continue; }
    pagina = 0;
    ok(typeof nfNomes.acharPorNumero === 'function', `${nome}: exporta acharPorNumero`);
    try { await nfNomes.construirIndice({ maxPaginas: 2 }); } catch (e) { /* o parcial basta */ }
    const r1 = nfNomes.acharPorNumero('127796');
    ok(r1 && String(r1.id) === '13' && !r1._series_colidem, `  ${nome}: 127796 -> id 13, SEM colisao (uma serie so)`);
    const r2 = nfNomes.acharPorNumero('126421');
    ok(r2 && r2._series_colidem === true, `⚠️ ${nome}: 126421 existe nas series 1 e 2 -> marcado _series_colidem (o atalho NAO pode usar)`);
    ok(nfNomes.acharPorNumero('000127796') && String(nfNomes.acharPorNumero('000127796').id) === '13', `  ${nome}: zeros a esquerda nao atrapalham`);
    ok(r1 && r1.serie === '1', `⚠️ ${nome}: nf.serie vazio na listagem -> a serie vem da chave de acesso (b474, Codex P1)`);
    ok(nfNomes.acharPorNumero('999999') === null, `  ${nome}: numero que nao esta no indice -> null (cai na varredura)`);
  }

  // ── os identificar (GOOD e AMB) consultam o indice ANTES de buscarNFsPorNumero ──
  const semCom = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const [p, nome] of [['server.js', 'GOOD'], ['amb-devolucoes/lib-AMB/identificar-AMB.js', 'AMB/Girassol']]) {
    const s = semCom(p);
    const i = s.indexOf('nfNomes.acharPorNumero(numeroDaChave)');
    const j = s.indexOf('achadas = await buscarNFsPorNumero(numeroDaChave, serieDaChave)');
    ok(i > 0 && j > 0 && i < j, `⚠️ identificar ${nome}: consulta o indice ANTES da varredura`);
    ok(/!reg\._series_colidem/.test(s), `  identificar ${nome}: NAO usa o atalho quando as series colidem`);
    // b474 (Codex, P1): sem serie o indice NAO prova unicidade (parcial, 120d, nomes curtos fora) — o atalho EXIGE serie
    ok(/&& serieDaChave && String\(reg\.serie \|\| ''\) === String\(serieDaChave\)/.test(s), `⚠️ identificar ${nome}: o atalho EXIGE serie e ela tem que bater (so numero digitado vai pela varredura)`);
    ok(!/\(!serieDaChave \|\| String\(reg\.serie/.test(s), `  identificar ${nome}: nao ha mais o "ou sem serie"`);
    ok(/nf_via_indice_numero/.test(s), `  identificar ${nome}: avisa que veio do indice (auditavel)`);
    // e a varredura esta no ELSE (nao roda quando o indice resolveu)
    const bloco = s.slice(i, j);
    ok(/\} else \{\s*try \{\s*achadas = await buscarNFsPorNumero/.test(s.slice(i, j + 80)), `  identificar ${nome}: a varredura so roda no else`);
  }

  // b474 (Codex, P2): o checkpoint PARCIAL da AMB publica porNumero (antes so no fim)
  {
    const amb = semCom('amb-devolucoes/lib-AMB/nf-nomes-AMB.js');
    const iP = amb.indexOf('IDX.mapa = { ...mapa };');
    ok(iP > 0 && /IDX\.porNumero = \{ \.\.\.porNumero \};/.test(amb.slice(iP, iP + 300)), '  nf-nomes-AMB: o parcial publica porNumero junto com mapa/mapaCurto');
    const good = semCom('lib/nf-nomes.js');
    const iG = good.indexOf('IDX.mapa = { ...mapa };');
    ok(iG > 0 && /IDX\.porNumero = \{ \.\.\.porNumero \};/.test(good.slice(iG, iG + 300)), '  nf-nomes (GOOD): idem');
  }

  // ── o front manda numero/serie SEMPRE no clique do candidato ──
  // ⚠️ b478: a AMB/Girassol tem o PROPRIO js-AMB/busca.js — o b473 so chegou na GOOD
  // e o clique na Girassol continuou sem serie (o atalho exige serie: 30s de varredura).
  // Os DOIS fronts, sempre.
  for (const [p, nome] of [[['public', 'js', 'busca.js'], 'GOOD'], [['amb-devolucoes', 'public-AMB', 'js-AMB', 'busca.js'], 'AMB/Girassol']]) {
    const front = fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    ok(/const alvo = c\.serie \? \(c\.numero \+ '\/' \+ c\.serie\) : c\.numero;/.test(front),
       `⚠️ front ${nome}: o clique no candidato manda numero/serie sempre (antes omitia a serie 1)`);
    ok(!/c\.serie !== '1'/.test(front), `  front ${nome}: nao ha mais a excecao da serie 1`);
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
