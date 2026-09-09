// Roda com: node test/contrato-empresas.test.js
//
// O CONTRATO É A ETAPA ZERO da revisão do Codex (07/09):
//   "definir um contrato pequeno e versionado (...) teste de contrato em
//    ambos os repositórios usando o mesmo fixture JSON/schema"
//
// Por que antes de tudo: hoje o `Mover-Pedidos` chama a AMB de `amb` e este
// repo chama de `ambtotal`. Sem contrato, essa divergência só aparece
// quando alguém plugar a Girassol e o dado sair na tabela errada.
//
// ⚠️ Este arquivo confere DUAS coisas:
//   1. o contrato é internamente coerente (nenhum alias/tabela/prefixo
//      colide entre empresas)
//   2. o `lib/empresas.js` deste repo BATE com ele
//
// O Mover-Pedidos precisa de um teste espelho, com o MESMO json.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');
const contrato = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato-empresas.json'), 'utf8'));
const registro = require('../lib/empresas.js');

// ── 1. o contrato é coerente consigo mesmo ──────────────────────────
{
  const empresas = Object.entries(contrato.empresas);
  ok(empresas.length >= 2, 'o contrato tem as empresas (' + empresas.length + ')');

  // ⚠️ um alias em duas empresas mandaria dado da AMB pra Girassol
  const donoDoAlias = {};
  for (const [chave, e] of empresas) {
    for (const a of e.aliases) {
      ok(!donoDoAlias[a], '  alias `' + a + '` pertence so a `' + chave + '`'
         + (donoDoAlias[a] ? ' (COLIDE com ' + donoDoAlias[a] + ')' : ''));
      donoDoAlias[a] = chave;
    }
  }

  // ⚠️ duas empresas na mesma tabela = dado cruzado, sem erro no log
  for (const campo of ['sufixo_tabelas', 'prefixo_env', 'slug_http']) {
    const vistos = {};
    for (const [chave, e] of empresas) {
      const v = e[campo];
      ok(vistos[v] === undefined,
         '  `' + campo + '` de `' + chave + '` (' + JSON.stringify(v) + ') e unico'
         + (vistos[v] ? ' (COLIDE com ' + vistos[v] + ')' : ''));
      vistos[v] = chave;
    }
  }

  // ── v2: o dono do token, separado em HOJE e ALVO ──────────────────
  //
  // ⚠️ O PARECER DO MOVER-PEDIDOS CORRIGIU A v1: eu tinha escrito que o
  // Devoluções renovava Bling e ML. É falso — o Mover-Pedidos renova em
  // produção, pelos tokenManagers dele. Se alguém "obedecesse" o contrato
  // e desligasse a renovação de lá, metade da operação morreria.
  //
  // Então o contrato declara a VERDADE (`dono_hoje`) e o DESTINO
  // (`dono_alvo`), e o teste NÃO exige dono único ainda — exige que o
  // conflito esteja DECLARADO. Contrato que mente é pior que contrato
  // nenhum.
  for (const [chave, e] of empresas) {
    ok(!!e.dono_hoje && !!e.dono_alvo,
       chave + ': declara `dono_hoje` (a verdade) e `dono_alvo` (o destino)');

    for (const [integ, donos] of Object.entries(e.dono_hoje)) {
      if (integ.startsWith('_')) continue;
      ok(Array.isArray(donos) && donos.length > 0,
         '  `' + chave + '/' + integ + '` diz quem renova hoje: ' + JSON.stringify(donos));
    }
  }

  // ── v3: o que eu declarei sobre ESTE repo tem que ser VERDADE ─────
  //
  // ⚠️ As três versões do contrato saíram de correção externa: eu escrevi
  // errado sobre o outro serviço duas vezes. A lição é não afirmar o que
  // não medi — então o que eu afirmo sobre ESTE repo vira teste.
  {
    const fsv = require('fs');
    const lerTudo = (dirs) => dirs.flatMap((d) => {
      const p2 = path.join(RAIZ, d);
      if (!fsv.existsSync(p2)) return [];
      return fsv.readdirSync(p2).filter((f) => f.endsWith('.js'))
        .map((f) => fsv.readFileSync(path.join(p2, f), 'utf8'));
    }).join('\n');
    const codigo = lerTudo(['lib', 'amb-devolucoes/lib-AMB'])
      + fsv.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
    const semComentario = codigo.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    // afirmei: este repo NAO toca no 2o app do Bling (o de NF-e)
    ok(!/nfTokenManager|BLING_NFE_|NFE_CLIENT_ID/.test(semComentario),
       'este repo NAO usa credencial separada de NF-e (o `bling_nfe` e do Mover-Pedidos)');

    // afirmei: este repo NAO renova token de TikTok
    ok(!/TIKTOK_REFRESH_TOKEN|renovarTikTok|tiktok.*refresh_token/i.test(semComentario),
       'este repo NAO renova token de TikTok (fala por ponte com o Mover-Pedidos)');

    // e o contrato diz que a GOOD nao tem TikTok
    ok(contrato.empresas.good.conta_marketplace.tiktok === 'nao_se_aplica',
       'a GOOD e a unica sem TikTok (confirmado pelo Mover-Pedidos)');
    for (const c2 of ['ambtotal', 'girassol']) {
      ok(contrato.empresas[c2].conta_marketplace.tiktok === 'propria',
         '  e `' + c2 + '` tem conta propria');
    }
  }

  // ── v4: os donos só podem citar serviços declarados ──────────────
  //
  // Pedido do Mover-Pedidos: eles validavam os donos contra um conjunto
  // LOCAL. Com o campo `servicos`, a validação sai do próprio dado — e um
  // serviço novo (ou um nome digitado errado) acusa nos dois repos.
  {
    ok(!!contrato.servicos && Array.isArray(contrato.servicos.lista),
       'o contrato declara os SERVICOS que o leem');
    const conhecidos = new Set(contrato.servicos.lista);

    for (const [chave, e] of Object.entries(contrato.empresas)) {
      for (const [integ, donos] of Object.entries(e.dono_hoje)) {
        if (integ.startsWith('_')) continue;
        const fora = donos.filter((d) => !conhecidos.has(d));
        ok(fora.length === 0,
           '  `' + chave + '/' + integ + '` so cita servico declarado'
           + (fora.length ? ' (DESCONHECIDO: ' + fora.join(', ') + ')' : ''));
      }
    }
  }

  // ── v4: a prova do risco diz QUAL repo ───────────────────────────
  //
  // "lib/ml.js:43 deste repo" e ilegivel do outro lado — quem le nao sabe
  // qual repo e "este". Cada prova agora nomeia o servico.
  {
    const prova = contrato.risco_ativo.refresh_ml_uso_unico.prova;
    ok(prova && typeof prova === 'object' && !Array.isArray(prova),
       'a prova do risco e por SERVICO, nao um texto so');
    for (const s2 of contrato.servicos.lista) {
      ok(typeof prova[s2] === 'string' && prova[s2].length > 5,
         '  com a evidencia de `' + s2 + '`');
    }
  }

  // ── v4: a mecânica do passo 2, decidida ──────────────────────────
  {
    const m = contrato.passo_2_eleicao.mecanica;
    ok(!!m && !!m.leitura, 'a mecanica do passo 2 esta registrada');
    // ── v6: a auth e SO por header ────────────────────────────────
    //
    // ⚠️ A rota entrega SEGREDO VIVO. Credencial em querystring fica em log
    // de proxy, em log de acesso e em URL copiada — e este e o mesmo achado
    // do P0 nº3 da auditoria de 26/08 (`?k=ADMIN_KEY`), so que pior: la e
    // chave de admin, aqui e a chave que da acesso ao token de TODAS as
    // empresas.
    ok(/x-token-leitura/.test(m.leitura.auth || ''),
       '  a rota autentica por HEADER dedicado');
    ok(/BANIDA|banida/.test((m.leitura.auth_detalhe || {}).querystring || ''),
       '  e a querystring esta BANIDA (nao e opcional)');

    // ⚠️ e a concorrencia e resolvida NO DONO — o leitor pode martelar
    ok(/uma aquisi|UMA aquisi/i.test(m.leitura.concorrencia || ''),
       '  leituras concorrentes compartilham UMA aquisicao no dono');
    // v5: o campo virou `o_que_morre_ao_renovar` + `o_que_sobrevive` na
    // fusao das duas versoes duplicadas
    const j = m.janela_de_renovacao;
    ok(/refresh/i.test(j.o_que_morre_ao_renovar || '') && /access/i.test(j.o_que_sobrevive || ''),
       '  e diz o que desarma a janela (morre o refresh, sobrevive o access)');
    ok(/ML PRIMEIRO/.test(m.ordem_do_corte['3'] || ''),
       '  e a ordem do corte: ML primeiro (uso unico), Bling por ultimo');
  }

  // ── v5: ⚠️ NENHUMA DECISÃO EM DOIS LUGARES ───────────────────────
  //
  // Pedido do Mover-Pedidos: a v4 tinha `janela_de_renovacao` como irmã de
  // `passo_2_eleicao` E dentro de `mecanica` — 7 campos numa, 4 na outra,
  // dizendo o mesmo com palavras diferentes. E a ordem do corte com dois
  // nomes (`ordem_de_corte` / `ordem_do_corte`).
  //
  // "Duas fontes da mesma decisão no mesmo arquivo é a receita da
  // divergência interna" — e eles têm razão: uma seria atualizada e a
  // outra não, e ninguém saberia qual vale.
  //
  // Esta checagem é GENÉRICA de propósito: não lista os campos que eu
  // dupliquei, e sim procura QUALQUER chave repetida entre um nível e o
  // seu filho. Assim ela pega a próxima duplicação, não a de ontem.
  {
    const chavesReais = (o) => Object.keys(o || {}).filter((k) => !k.startsWith('_'));
    const procurar = (obj, caminho) => {
      for (const k of chavesReais(obj)) {
        const filho = obj[k];
        if (!filho || typeof filho !== 'object' || Array.isArray(filho)) continue;
        const repetidas = chavesReais(filho).filter((sub) => chavesReais(obj).includes(sub));
        ok(repetidas.length === 0,
           caminho + '.' + k + ': nenhuma chave repete o nivel de cima'
           + (repetidas.length ? ' (EM DOIS LUGARES: ' + repetidas.join(', ') + ')' : ''));
        procurar(filho, caminho + '.' + k);
      }
    };
    procurar(contrato.passo_2_eleicao, 'passo_2_eleicao');

    // e o nome da ordem do corte e UM SO (tinha `de` e `do`)
    // ⚠️ procuro nas CHAVES, nao no texto: o `_leia_me` CITA o nome antigo
    // ao explicar o que mudou, e minha 1a versao acusou isso como
    // duplicacao. Falso positivo por ler documentacao como se fosse dado.
    const chavesDoArquivo = [];
    const colher = (o) => {
      for (const [k, v2] of Object.entries(o || {})) {
        chavesDoArquivo.push(k);
        if (v2 && typeof v2 === 'object') colher(v2);
      }
    };
    colher(contrato);
    const variantes = [...new Set(chavesDoArquivo.filter((k) => /^ordem_d[eo]_corte$/.test(k)))];
    ok(variantes.length <= 1,
       'a ordem do corte tem UM nome so (' + (variantes.join(', ') || 'nenhum') + ')');
  }

  // ── v6: o cache do leitor, decidido pelo dono ────────────────────
  //
  // Quem manda no token e o dono; eu implemento. As duas regras que
  // importam sao contra-intuitivas o bastante pra virar teste:
  {
    const ca = contrato.passo_2_eleicao.mecanica.cache_no_leitor;
    ok(!!ca, 'o desenho do cache esta no contrato');
    ok(/mem[oó]ria/i.test(ca.onde || ''), '  em memoria, por (empresa, integracao)');

    // ⚠️ o TTL NAO substitui o 401: cachear 5 min e esquecer o 401 faria o
    // token revogado sobreviver a janela inteira
    ok(/OS DOIS invalidam/i.test(ca.invalidacao || ''),
       '  e OS DOIS invalidam: o TTL E o 401/403 (um nao substitui o outro)');

    // ── v7: ⚠️ o gatilho diz 401 OU 403 ────────────────────────────
    //
    // O ML responde 403 com token vencido, nao so 401 — achado do
    // Devolucoes em marco (lib/ml.js, v3.40). O Mover-Pedidos conferiu: os
    // managers de la renovam em QUALQUER nao-2xx, entao ja cobriam por
    // desenho. Mas o TEXTO do contrato dizia so 401, e quem implementasse
    // ao pe da letra deixaria o token morto no cache pela janela do TTL.
    //
    // Contrato escrito pra ser lido literalmente tem que dizer os dois.
    ok(/403/.test(ca.invalidacao || ''),
       '  ⚠️ e o 403 esta no gatilho (o ML usa ele pra token vencido)');
    const janela = contrato.passo_2_eleicao.mecanica.janela_de_renovacao;
    ok(/403/.test(janela.contrato_de_leitura || ''),
       '  no contrato de leitura tambem');

    // ⚠️ token vivo nao vai pra disco — reinicio tem que limpar
    ok(/mem[oó]ria s[oó]|nunca/i.test(ca.nunca_em_disco || ''),
       '  e NUNCA em disco (reinicio limpa)');
  }

  // ── v5: o estado REAL da rota, como o Mover-Pedidos construiu ─────
  {
    const est = contrato.passo_2_eleicao.mecanica.leitura.estado;
    ok(!!est, 'o contrato registra o estado REAL da rota (nao so o desejado)');
    ok(/404/.test(est.integracao_ausente || ''),
       '  integracao ausente = 404, nunca `access: null`');
    ok(/501/.test(est.magalu_e_tiktok || ''),
       '  magalu/tiktok = 501 declarado (rota sem consumidor e superficie a toa)');
    ok(/null/.test(est.expira_em || ''),
       '  e `expira_em` vem null HONESTO — o contrato de leitura ja cobre por 401');
  }

  // ── v3: a eleição do passo 2, já acordada ────────────────────────
  {
    const el = contrato.passo_2_eleicao;
    ok(!!el && !!el.dono_eleito, 'a eleicao do passo 2 esta registrada');
    for (const eixo of ['bling', 'ml', 'bling_nfe', 'magalu']) {
      ok(el.dono_eleito[eixo] === 'mover-pedidos',
         '  `' + eixo + '` fica com o Mover-Pedidos (menor cirurgia)');
    }
    ok(/uso unico|uso único/.test(el.inegociavel || ''),
       '  e o inegociavel do ML esta escrito');
  }

  // ── v4: a mecânica do passo 2 ────────────────────────────────────
  //
  // Definida pelo Mover-Pedidos, como dono eleito. O teste guarda os
  // pontos que, se esquecidos na implementação, causam dano real.
  {
    const el = contrato.passo_2_eleicao;
    const m = el.mecanica;

    // ⚠️ v4: os campos mudaram de forma (`m.rota` -> `m.leitura.como`,
    // `m.autenticacao` -> `m.leitura.auth`). Estas checagens ficaram da
    // versao anterior e acusavam campo que EXISTE, so com outro nome —
    // falso positivo. A checagem equivalente esta no bloco da v4 acima.
    ok(typeof m === 'object' && !!m.leitura && !!m.leitura.como,
       'a mecanica do passo 2 esta definida');

    // ⚠️ v5: ESTE BLOCO LIA A SEGUNDA FONTE (`el.janela_de_renovacao` e
    // `el.ordem_de_corte`), que a v5 removeu — era exatamente a duplicacao
    // que o Mover-Pedidos apontou. Agora le a fonte UNICA, dentro de
    // `mecanica`.
    //
    // O erro so apareceu ao rodar: `node --check` passa, porque ler campo
    // de objeto inexistente e erro de EXECUCAO.
    const j2 = m.janela_de_renovacao;
    ok(/REFRESH/i.test(j2.o_que_morre_ao_renovar || '')
       && /ACCESS/i.test(j2.o_que_sobrevive || ''),
       'a janela esta explicada: morre o refresh, o access sobrevive');
    ok(/desnecess/i.test(j2.ler_versao_anterior || ''),
       '  entao ler versao anterior NAO e necessario');

    const o = m.ordem_do_corte;
    ok(!!o && Object.keys(o).filter((k2) => /^[0-9]/.test(k2)).length >= 3,
       'a ordem do corte tem os passos');
    const passoML = Object.values(o).find((v2) => /ML PRIMEIRO/i.test(String(v2)));
    ok(!!passoML, '  e o ML sai PRIMEIRO (refresh de uso unico e o urgente)');
    const aviso = Object.entries(o).find(([k2]) => k2.includes('adendo'));
    ok(!!aviso && /corrida/i.test(String(aviso[1])),
       '  com o aviso honesto: durante a sobreposicao a corrida CONTINUA ativa');
  }

  // ⚠️ e o risco tem que estar escrito, com prova — não como hipótese
  ok(!!contrato.risco_ativo && !!contrato.risco_ativo.refresh_ml_uso_unico,
     'o contrato declara o RISCO ATIVO do refresh de uso unico do ML');
  {
    const r = contrato.risco_ativo.refresh_ml_uso_unico;
    // v4: a prova virou objeto POR SERVICO (o pedido do Mover-Pedidos:
    // "deste repo" e ilegivel do outro lado). Conferida no bloco da v4.
    ok(typeof r.prova === 'object' && Object.keys(r.prova).length >= 2,
       '  com prova citada de cada servico');
    ok(/passo 2/.test(r.resolve_em || ''),
       '  e onde se resolve');
  }
}

// ── 2. o registro deste repo bate com o contrato ─────────────────────
//
// É aqui que a divergência entre repos vira teste vermelho em vez de bug
// em produção.
{
  for (const [chave, e] of Object.entries(contrato.empresas)) {
    let ficha = null;
    try { ficha = registro.obterEmpresa(chave); } catch (err) { /* ainda nao existe */ }

    // a Girassol pode estar no contrato e ainda nao no registro daqui
    const ativaAqui = !e.ativa_em || e.ativa_em.devolucoes !== false;
    if (!ficha) {
      ok(!ativaAqui,
         chave + ': ausente do registro daqui, e o contrato diz que ainda nao opera aqui');
      continue;
    }

    ok(ficha.prefixoEnv === e.prefixo_env,
       chave + ': prefixo de env bate (' + JSON.stringify(e.prefixo_env) + ')');

    // ⚠️ v2: o historico e POR SERVICO. Um campo unico nao comportava a
    // inversao — a GOOD e '' aqui e 'GOOD_' no Mover-Pedidos; a Girassol e
    // o oposto. O teste espelho de la quebraria por DESENHO do contrato.
    const hist = e.prefixo_env_historico;
    ok(hist && typeof hist === 'object',
       '  e o historico e por SERVICO, nao um valor so');
    ok(typeof hist.devolucoes === 'string',
       '  com o valor deste repo declarado (' + JSON.stringify(hist.devolucoes) + ')');
    ok(ficha.prefixoFiscal === e.prefixo_fiscal,
       '  e o prefixo fiscal (' + JSON.stringify(e.prefixo_fiscal) + ')');

    const sufixoReal = String(ficha.tabelas.devolucoes).replace(/^devolucoes/, '');
    ok(sufixoReal === e.sufixo_tabelas,
       '  e o sufixo das tabelas (' + JSON.stringify(e.sufixo_tabelas) + ')');
  }
}

// ── 3. ⚠️ o contrato não guarda segredo ──────────────────────────────
{
  // ⚠️ olho os VALORES, nao o arquivo cru: minha 1a versao pegava texto
  // longo dos comentarios e acusava segredo que nao existe. Falso positivo
  // num teste de seguranca e pior que nenhum — ensina a ignorar o vermelho.
  const valores = [];
  const varrer = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue;            // comentario, nao dado
      if (typeof v === 'string') valores.push([k, v]);
      else if (v && typeof v === 'object') varrer(v);
    }
  };
  varrer(contrato.empresas);

  const parecemSegredo = valores.filter(([k, v]) =>
    /secret|token|senha|password|key$/i.test(k) || /^[A-Za-z0-9+/=_-]{32,}$/.test(v));
  ok(parecemSegredo.length === 0,
     'o contrato NAO contem segredo (so identidade e NOMES de variavel)'
     + (parecemSegredo.length ? ' (SUSPEITO: ' + parecemSegredo.map((x) => x[0]).join(', ') + ')' : ''));
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
