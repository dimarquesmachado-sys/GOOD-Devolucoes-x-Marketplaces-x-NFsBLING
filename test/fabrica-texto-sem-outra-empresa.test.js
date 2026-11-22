'use strict';
require('./_fonte-fabrica');   // docs/MODULARIZACAO.md: le a fabrica (app-AMB.js) com os blocos de lib-AMB de volta no lugar
// b800 — V-17 (ensaio de CNPJ novo, 22/11): A 7a FORMA DE VAZAMENTO — O NOME DE OUTRA EMPRESA NO TEXTO DA TELA.
//
// docs/ESTADO-MULTILOJA.md listava 6 formas de a AMB vazar pra dentro das outras empresas (env, tabela, config,
// instancia, rotulo de log, link) e avisava: "se for declarar pronto de novo, varra as seis — e procure uma setima".
// O ensaio de uma empresa nova achou: a tela e de todas, mas o TEXTO dizia "da AMB" / "da GOOD" pra qualquer uma —
//   - painel:   "Magalu: desligada — falta consentimento OAuth da conta Magalu da AMB"  (na Girassol e numa empresa nova)
//   - conexao:  "abra seller.magaluentregas.com.br logado na AMB"  e  "saia da conta da GOOD"
//   - bipe:     "NF 123 achada pelo indice da AMB"
// No dia de ligar um CNPJ, o dono leria que e a conta de OUTRA empresa que falta autorizar.
//
// 1 e 2 EXECUTAM as pecas de producao; 3 e a varredura (o padrao da casa pras outras 6 formas).
// A pagina de defeitos e o resto das telas sao provados no servidor de verdade: test/empresa-nova-de-ponta-a-ponta.
// Roda com: node test/fabrica-texto-sem-outra-empresa.test.js
const fs = require('fs');
const path = require('path');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const OUTRA = /\bAMB\b|AMBTotal|\bGOOD\b|Girassol/;
const NOME = 'Comercial Serrana';

(async () => {
  // ── 1. Magalu: o que falta e da conta DESTA empresa ──────────────────
  {
    const magaluMod = require('../amb-devolucoes/lib-AMB/magalu-AMB');
    const daNova = magaluMod.criar({ PREFIXO_ENV: 'SERRANA_', NOME_EMPRESA: NOME, magalu: {} });
    const r = daNova.resumoEspreita();
    ok(r && r.desligada === true && r.falta === 'consentimento OAuth da conta Magalu da ' + NOME, '⚠️ Magalu sem token: o painel diz que falta a conta DESTA empresa ("' + (r && r.falta) + '")');
    const idx = await daNova.construirIndiceDevolucoes();
    ok(idx && idx.erro === 'sem token Magalu da ' + NOME, '⚠️ e o indice do Magalu tambem ("' + (idx && idx.erro) + '")');
    const semNome = magaluMod.criar({ PREFIXO_ENV: 'SEMNOME_', magalu: {} });
    const s = semNome.resumoEspreita();
    ok(s && s.falta === 'consentimento OAuth da conta Magalu desta empresa' && !OUTRA.test(s.falta), '  peca criada sem o nome: "desta empresa" — nunca o nome de outra ("' + (s && s.falta) + '")');
    const semNada = magaluMod.criar({ PREFIXO_ENV: 'SEMNOME2_', NOME_EMPRESA: '   ', magalu: {} }).resumoEspreita();
    ok(semNada && /desta empresa$/.test(semNada.falta), '  nome em branco vale como sem nome');
  }

  // ── 2. a volta do OAuth do Magalu SEM tenant: a instrucao fala da conta desta empresa ──
  {
    const registrar = require('../amb-devolucoes/lib-AMB/oauth-callback-AMB');
    let volta = null;
    registrar({ get: (rota, h) => { if (rota === '/oauth/callback') volta = h; } }, {
      BASE: '/serrana', bling: {}, ml: {}, mlReturns: {},
      magalu: { trocarCodePorToken: async () => ({ persistiu: true }), temTenant: () => false, preAquecer() {} },
      NOME_EMPRESA: NOME, PREFIXO_ENV_EMPRESA: 'SERRANA_', consumirState: () => ({ servico: 'magalu' }),
      redirectOAuth: () => 'https://exemplo.test/serrana/oauth/callback', pagina: (titulo, corpo) => '<title>' + titulo + '</title>' + corpo, jaPreAquecidoPeloOAuth: {},
    });
    ok(typeof volta === 'function', '  a peca registrou a rota /oauth/callback');
    const res = { codigo: 200, html: '', status(c) { this.codigo = c; return this; }, send(h) { this.html = String(h); return this; }, set() { return this; } };
    await volta({ query: { code: 'abc', state: 'estado-de-teste' } }, res);
    const texto = res.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    ok(/Magalu da Comercial Serrana conectado/.test(texto) && /Falta o tenant/.test(texto), '  a pagina e a de "Magalu conectado", com o aviso do tenant que falta');
    ok(/logado na conta da Comercial Serrana, F12/.test(texto) && /SERRANA_MAGALU_TENANT_ID/.test(texto), '⚠️ a instrucao do tenant manda logar na conta DESTA empresa e gravar na env dela');
    ok(!OUTRA.test(texto), '⚠️ e nao cita outra empresa' + (OUTRA.test(texto) ? ' — "' + (texto.match(new RegExp('.{0,40}(?:' + OUTRA.source + ').{0,40}')) || [''])[0] + '"' : ''));
  }

  // ── 3. varredura: nenhum texto da fabrica nem das telas dela chama outra empresa pelo nome ──
  {
    const pastaLib = path.join(RAIZ, 'amb-devolucoes', 'lib-AMB');
    const pastaTela = path.join(RAIZ, 'amb-devolucoes', 'public-AMB');
    const arquivos = [path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js')]
      .concat(fs.readdirSync(pastaLib).filter((f) => f.endsWith('.js')).map((f) => path.join(pastaLib, f)))
      .concat(fs.readdirSync(pastaTela).filter((f) => f.endsWith('.html')).map((f) => path.join(pastaTela, f)))
      .concat(fs.readdirSync(path.join(pastaTela, 'js-AMB')).filter((f) => f.endsWith('.js')).map((f) => path.join(pastaTela, 'js-AMB', f)));
    ok(arquivos.length >= 30, '  a varredura enxerga a fabrica, as pecas dela e as telas (' + arquivos.length + ' arquivos)');
    // "da AMB", "na GOOD", "pela Girassol"...: e assim que o nome de uma empresa aparece numa frase. Vale pra QUALQUER
    // linha que nao seja comentario — o texto de uma pagina mora em template de varias linhas, sem aspas na linha.
    const FRASE = /\b(?:d[aeo]|n[ao]|pel[ao])\s+(?:AMBTotal|AMB|GOOD|Girassol)\b/;
    // O que pode citar uma empresa pelo nome (a linha INTEIRA, pra uma frase nova nao passar de carona):
    //   - mensagem de quem PROGRAMA, nao de quem usa: excecao no boot quando uma peca e criada sem o cliente da empresa;
    //   - historia: a dica de permissao do ML conta ONDE o caso aconteceu ("foi a causa na GOOD em 14/11") — nao diz
    //     que a conta de agora e a da GOOD;
    //   - a tela de "falta credencial do Magalu" avisa de quem sao as variaveis SEM prefixo, pra ninguem copia-las.
    const PODE_CITAR = new Set([
      "+ 'sem ele eu usaria o cliente da AMBTotal.');",
      "+ 'empresa — sem ele eu usaria o Bling da AMBTotal.');",
      "+ 'para usar os padroes da AMB.'",
      "+ ' AUTORIZE DE NOVO — o token antigo nao ganha a permissao sozinho. Foi a causa na GOOD em 14/11/2026;'",
      '(client PROPRIO desta empresa — nao use as da GOOD, sem prefixo).</div>`));',
    ]);
    const achados = [];
    for (const arq of arquivos) {
      let emBloco = false;
      const html = arq.endsWith('.html');
      const linhas = (html ? fs.readFileSync(arq, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, '')) : fs.readFileSync(arq, 'utf8')).split('\n');
      linhas.forEach((bruta, i) => {
        const l = bruta.trim();
        if (emBloco) { if (l.indexOf('*/') >= 0) emBloco = false; return; }
        if (l.startsWith('/*')) { if (l.indexOf('*/') < 0) emBloco = true; return; }
        if (l.startsWith('//') || l.startsWith('*')) return;                    // comentario de linha
        if (/console\.(?:log|warn|error|info)\(/.test(l)) return;               // log: a 5a forma tem a varredura dela
        const semComentario = l.replace(/\/\*.*?\*\//g, ' ').replace(/\s\/\/\s.*$/, '');   // `codigo /* nota */` e `codigo;   // nota`
        if (!FRASE.test(semComentario)) return;
        if (PODE_CITAR.has(l)) return;
        achados.push(path.relative(RAIZ, arq) + ':' + (i + 1) + '  ' + l.slice(0, 150));
      });
    }
    ok(achados.length === 0, '⚠️ nenhum texto da fabrica chama outra empresa pelo nome' + (achados.length ? ' — ' + achados.length + ':\n        ' + achados.join('\n        ') : ''));
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA ' + ((e && e.stack) || e)); process.exit(1); });
