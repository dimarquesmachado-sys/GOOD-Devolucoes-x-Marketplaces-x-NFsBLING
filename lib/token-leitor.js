'use strict';

/**
 * lib/token-leitor.js — lê o token vigente do dono (Mover-Pedidos).
 * ---------------------------------------------------------------------
 * PASSO 2 do plano multi-empresa. O Mover-Pedidos é o dono eleito da
 * renovação de Bling e ML (contrato-empresas.json, `passo_2_eleicao`), e
 * este módulo é o outro lado: aqui a gente LÊ em vez de renovar.
 *
 * ---------------------------------------------------------------------
 * ⚠️ POR QUE ISTO EXISTE, e não é organização
 *
 * O refresh token do ML é de USO ÚNICO. Enquanto os dois serviços renovam
 * as mesmas contas, um consome o refresh do outro — e o segundo só descobre
 * quando o access dele expira. Não é risco futuro: é corrida ativa hoje,
 * nas três empresas.
 *
 * Este módulo é o primeiro passo para matá-la. Ele NÃO desliga a renovação
 * local: ela continua como rede até confirmarmos um período de operação
 * normal. O corte vem depois, ML primeiro.
 *
 * ---------------------------------------------------------------------
 * O CONTRATO DE LEITURA (fechado com o dono em 08/09)
 *
 *   GET {MOVER}/interno/token/:empresa/:integracao
 *   Header: x-token-leitura: <ADMIN_TOKEN_LEITURA_KEY>
 *   → 200 { access, expira_em: null, versao }
 *
 *   404  a empresa não tem essa integração (GOOD/tiktok)
 *   501  integração ainda sem leitor (magalu, tiktok)
 *   502  falha de aquisição — re-pedir em instantes
 *   400  se mandar `?k=` (a querystring foi banida: credencial em URL fica
 *        em log de proxy e em URL copiada)
 *
 * ⚠️ `expira_em` vem `null` HONESTO: os managers do dono renovam por 401 e
 * não expõem o instante. Por isso o 401 é o sinal, não o relógio.
 *
 * ⚠️ CONCORRÊNCIA é problema do DONO: leituras simultâneas da mesma
 * (empresa, integração) compartilham uma aquisição lá dentro. Podemos
 * martelar a rota — o refresh de uso único continua único.
 */

const axios = require('axios');

const MOVER_URL = process.env.MOVER_PEDIDOS_URL
  || 'https://mover-pedidos-aguardando-x-atendido.onrender.com';
const CHAVE = process.env.ADMIN_TOKEN_LEITURA_KEY || '';

// ⚠️ CACHE: memória, por (empresa, integração). NUNCA em disco — token vivo
// não vai pra arquivo, e reinício tem que limpar.
const cache = new Map();

// ⚠️ TTL de 5 min E invalidação no 401 — OS DOIS. O TTL não substitui o
// 401: cachear 5 min e ignorar o 401 faria um token revogado sobreviver a
// janela inteira.
const TTL_MS = 5 * 60 * 1000;

const chaveCache = (empresa, integracao) => empresa + '/' + integracao;

/**
 * b257 - O QUE FAZER, dada a política do eixo e o motivo do leitor.
 *
 * Substitui o `lerToken` cru: em vez de "veio null, use o local", cada
 * combinação tem uma decisão explícita.
 *
 * @returns {{usar: 'remoto'|'local'|'falhar', access, motivo, estado}}
 */
async function resolverToken(empresa, integracao) {
  const politica = politicaDe(empresa, integracao);

  // ⚠️ `bloqueado` nao chama nada: configuracao invalida nao pode disparar
  // chamada destrutiva enquanto ninguem olha.
  if (politica === 'bloqueado') {
    return { usar: 'falhar', access: null, politica, estado: 'bloqueado',
             motivo: 'eixo BLOQUEADO por configuracao — nenhuma chamada sai' };
  }

  if (politica === 'local') {
    anotar(empresa, integracao, 'fonte', 'local');
    return { usar: 'local', access: null, politica, estado: 'local',
             motivo: 'politica local: nem consulto o dono' };
  }

  const r = await lerTokenDetalhado(empresa, integracao);

  if (r.estado === 'ok') {
    // ⚠️ separo `remoto` de `cache`: os dois "funcionaram", mas so o
    // primeiro prova que a rota do dono respondeu AGORA.
    anotar(empresa, integracao, 'fonte', r.do_cache ? 'cache' : 'remoto');
    return { usar: 'remoto', access: r.access, politica, estado: 'ok',
             versao: r.versao, do_cache: !!r.do_cache };
  }

  // ⚠️ EM `remoto` NAO EXISTE REDE. Cair no token local aqui seria
  // ressuscitar em silencio o renovador que a gente acabou de desligar — e
  // reabrir a corrida do refresh de uso unico sem ninguem perceber.
  if (politica === 'remoto') {
    anotar(empresa, integracao, 'fonte', 'falhou');
    return { usar: 'falhar', access: null, politica, estado: r.estado,
             motivo: `sem token do dono (${r.estado}) e a politica e REMOTO: `
               + 'falho explicito em vez de renovar escondido' };
  }

  // ⚠️ sombra caindo no local E O SINAL QUE DECIDE O CORTE. Se este
  // contador nao zerar, cortar transformaria cada uma dessas em falha.
  anotar(empresa, integracao, 'fonte', 'local');
  return { usar: 'local', access: null, politica, estado: r.estado,
           motivo: `sombra: dono devolveu ${r.estado}, uso a rede local` };
}

/** Compatível com quem já usa: devolve só o access, ou null. */
async function lerToken(empresa, integracao) {
  const r = await resolverToken(empresa, integracao);
  return r.usar === 'remoto' ? r.access : null;
}

/** Esquece o token guardado — chamar no primeiro 401 do marketplace. */
function invalidar(empresa, integracao) {
  cache.delete(chaveCache(empresa, integracao));
}

/**
 * Devolve o access token vigente, ou null se não der para ler.
 *
 * ⚠️ NUNCA LANÇA. Quem chama tem a renovação local como rede: se este
 * módulo falhar, o sistema continua com o token de sempre. Derrubar a
 * bipagem porque o outro serviço está fora seria trocar um problema
 * invisível por um visível.
 */
// b257 - ⚠️ O RETORNO E TIPADO. `null` misturava 6 situacoes que pedem
// coisas diferentes depois do corte:
//   ok               tem token
//   ausente          404: a empresa nao tem essa integracao
//   nao_implementado 501: o dono ainda nao tem leitor pra ela
//   indisponivel     502/timeout/DNS: passageiro, re-pedir
//   nao_configurado  falta chave aqui
//   config_invalida  503/404/400: erro de configuracao, retry nao ajuda
//
// Quem chama decide pela POLITICA + o motivo, nao por "veio null".
const R = (estado, access, extra) => ({ estado, access: access || null, ...(extra || {}) });

async function lerTokenDetalhado(empresa, integracao) {
  if (!CHAVE) return R('nao_configurado');

  const k = chaveCache(empresa, integracao);
  const guardado = cache.get(k);
  if (guardado && (Date.now() - guardado.em) < TTL_MS) {
    if (guardado.definitivo) {
      anotar(empresa, integracao, 'estado', guardado.estado || 'ausente');
      return R(guardado.estado || 'ausente');
    }
    anotar(empresa, integracao, 'estado', 'ok_cache');
    return R('ok', guardado.access, { do_cache: true, versao: guardado.versao });
  }

  const t0 = Date.now();
  try {
    const r = await axios.get(
      `${MOVER_URL}/interno/token/${encodeURIComponent(empresa)}/${encodeURIComponent(integracao)}`,
      {
        headers: { 'x-token-leitura': CHAVE },
        timeout: 8000,
        validateStatus: () => true,
      },
    );

    if (r.status === 200 && r.data && r.data.access) {
      cache.set(k, { access: r.data.access, em: Date.now(), versao: r.data.versao });
      anotar(empresa, integracao, 'latencia', Date.now() - t0);
      anotar(empresa, integracao, 'estado', 'ok');
      eixoMetrica(empresa, integracao).ultimo_sucesso = new Date().toISOString();
      return R('ok', r.data.access, { versao: r.data.versao });
    }

    // 404 = a empresa não tem a integração; 501 = ainda sem leitor lá.
    // Os dois são resposta CORRETA, não erro — e não vale re-pedir.
    // b257 - ⚠️ ERRO DE CONFIGURACAO. 503 = o dono sem chave configurada;
    // 400 = conta invalida ou credencial na URL. Retry nao ajuda em nenhum
    // — e o pior e que, misturados com `indisponivel`, uma configuracao
    // quebrada parece "o dono esta fora hoje" e ninguem investiga.
    // ⚠️ este modulo NAO tem circuito (aquilo e do `ritmo-porteiro`). Eu
    // copiei a linha de la e ela lancou `CIRCUITO_MS is not defined` — o
    // erro caia no catch generico e virava `indisponivel`, escondendo
    // justamente o caso que este bloco veio distinguir. So o teste pegou.
    if (r.status === 503 || r.status === 400) {
      console.warn(`[token-leitor] ${k}: HTTP ${r.status} — CONFIGURACAO, nao indisponibilidade`);
      anotar(empresa, integracao, 'estado', 'config_invalida');
      eixoMetrica(empresa, integracao).ultima_falha = new Date().toISOString();
      return R('config_invalida', null, { status: r.status });
    }

    if (r.status === 404 || r.status === 501) {
      // ⚠️ 404/501 sao cacheados como definitivos — mas guardo QUAL, senao
      // "empresa nao tem essa integracao" e "o dono ainda nao implementou"
      // viram a mesma coisa, e config errada parece operacao normal.
      const estado = r.status === 404 ? 'ausente' : 'nao_implementado';
      cache.set(k, { access: null, em: Date.now(), definitivo: true, estado });
      return R(estado, null, { status: r.status });
    }

    // 502 = falha de aquisição no dono. A renovação segue em background lá,
    // então re-pedir em instantes funciona. NÃO cacheio o vazio: cachear
    // uma falha passageira por 5 min é transformar um soluço em apagão.
    if (r.status === 502) {
      console.warn(`[token-leitor] ${k}: dono nao conseguiu adquirir agora (502)`);
      anotar(empresa, integracao, 'estado', 'indisponivel');
      eixoMetrica(empresa, integracao).ultima_falha = new Date().toISOString();
      return R('indisponivel', null, { status: 502, passageiro: true });
    }

    console.warn(`[token-leitor] ${k}: resposta inesperada ${r.status}`);
    return R('indisponivel', null, { status: r.status });
  } catch (e) {
    // rede fora, timeout, DNS... a rede local cobre
    // b259.2 (Codex, P2): timeout/DNS/conexao TAMBEM contam. Sem isto, o
    // dono fora do ar por rede nao aparecia em `estados` — so como
    // `fonte.local`, sem dizer por que.
    anotar(empresa, integracao, 'estado', 'indisponivel');
    eixoMetrica(empresa, integracao).ultima_falha = new Date().toISOString();
    console.warn(`[token-leitor] ${k}: ${e.message}`);
    return R('indisponivel', null, { erro: e.message, passageiro: true });
  }
}

/** Estado do cache, sem expor token. Para o /health. */
// b255 (Codex, P0) - ⚠️ QUEM REALMENTE LE DO DONO, HOJE.
//
// O parecer pegou uma coisa que o /health verde escondia: o leitor so esta
// no caminho da GOOD (`lib/bling.js` e `lib/ml.js`). A AMB usa
// `lib-AMB/bling-AMB.js` e `ml-AMB.js`, que continuam renovando LOCALMENTE
// — e a Girassol nem esta ativa aqui.
//
// Ou seja: o corte NAO e uma chave unica do servico. E por (empresa,
// integracao), e o /health precisa dizer isso, senao alguem le "ligado:
// true" e corta a AMB achando que ela le do dono.
// b257 (Codex, P0) - A POLITICA POR EIXO, e o que cada estado permite.
//
// "Desligar a renovacao" nao pode ser apagar env var nem torcer pra ninguem
// chamar uma rota: ha renovacao por 401, batimento preventivo e rota
// administrativa de renovacao forcada. Sem estado explicito, o corte e
// invisivel e irreversivel na hora errada.
//
//   local      comportamento antigo: nem chama o dono
//   sombra     LE o dono e mede, mas pode recuperar no local  <- hoje
//   remoto     nunca usa nem agenda refresh local
//   bloqueado  configuracao invalida: nao faz chamada destrutiva
//
// ⚠️ A politica vem de env var, entao o corte e REVERSIVEL sem deploy —
// que e o que ele precisa, porque nao usa terminal.
//
// ⚠️ E ROLLBACK PRA `local` NAO E REDE CONFIAVEL: o refresh que esta no
// ambiente pode ja ter sido consumido pelo dono. Voltar exige um refresh
// sabidamente vigente, nao o valor velho que sobrou la.
const POLITICA_PADRAO = 'sombra';

const POLITICAS_VALIDAS = ['local', 'sombra', 'remoto', 'bloqueado'];

function politicaDe(empresa, integracao) {
  const chaveEnv = 'TOKEN_POLITICA_' + String(empresa).toUpperCase() + '_' + String(integracao).toUpperCase();
  const cru = process.env[chaveEnv] || process.env.TOKEN_POLITICA_PADRAO;

  // nada configurado: o padrao da casa
  if (cru == null || String(cru).trim() === '') return POLITICA_PADRAO;

  const bruta = String(cru).trim().toLowerCase();
  if (POLITICAS_VALIDAS.includes(bruta)) return bruta;

  // b258 (Codex, P1) - ⚠️ VALOR INVALIDO FALHA FECHADO, nao em `sombra`.
  //
  // Eu caia em `sombra` achando que era o "padrao seguro". Nao e: `sombra`
  // permite fallback local E renovacao local. Entao um eixo que estava em
  // `remoto` e ganhou um typo (`remotto`, espaco a mais) voltaria a
  // renovar localmente EM SILENCIO — reabrindo a corrida do refresh de uso
  // unico exatamente onde a gente acabou de fecha-la.
  //
  // `bloqueado` para as chamadas e aparece na hora. Barulhento e o certo:
  // um typo tem que doer, nao passar despercebido.
  console.error(`[token-leitor] ⚠️ ${chaveEnv}="${cru}" NAO e politica valida `
    + `(${POLITICAS_VALIDAS.join('|')}) — assumindo BLOQUEADO por seguranca`);
  return 'bloqueado';
}

const EIXOS = {
  'good/bling': 'le do dono',
  'good/ml': 'le do dono',
  'ambtotal/bling': 'renova LOCAL (nao ligado ao dono)',
  'ambtotal/ml': 'renova LOCAL (nao ligado ao dono)',
  'girassol/*': 'empresa nao ativa neste servico',
};

// b259 - TELEMETRIA POR EIXO.
//
// ⚠️ O parecer foi direto: "o /health atual e inventario instantaneo, nao
// evidencia operacional". Ele diz o que ESTA configurado; nao diz se
// funcionou nas ultimas horas.
//
// E o criterio de saida da sombra depende disso: "nenhum uso inesperado de
// fallback local" nao da pra afirmar olhando um retrato. Precisa de contagem.
//
// ⚠️ MEMORIA SO, e o reinicio zera — de proposito. Persistir numero de
// operacao nao vale o risco de escrever em disco no caminho quente, e o
// contador de horas ja responde a pergunta ("esta caindo no local?").
// O `desde` diz de quando e a conta, pra ninguem ler 0 como "tudo bem"
// logo apos um deploy.
const metricas = {};
const DESDE = new Date().toISOString();

function eixoMetrica(empresa, integracao) {
  const k = empresa + '/' + integracao;
  if (!metricas[k]) {
    metricas[k] = {
      // ⚠️ A FONTE E O NUMERO QUE IMPORTA. Em `sombra`, `local > 0` diz
      // que o dono nao entregou — e e o que decide se pode cortar.
      fonte: { remoto: 0, cache: 0, local: 0, falhou: 0 },
      estados: {},              // ok, ausente, indisponivel, config_invalida...
      invalidacoes: { por_401: 0, por_403: 0, outras: 0 },
      retry_apos_invalidar: { ok: 0, falhou: 0 },
      latencia_ms: { ultima: null, pior: 0 },
      ultimo_sucesso: null,
      ultima_falha: null,
    };
  }
  return metricas[k];
}

function anotar(empresa, integracao, campo, valor) {
  const m = eixoMetrica(empresa, integracao);
  if (campo === 'fonte') m.fonte[valor] = (m.fonte[valor] || 0) + 1;
  else if (campo === 'estado') m.estados[valor] = (m.estados[valor] || 0) + 1;
  else if (campo === 'latencia') {
    m.latencia_ms.ultima = valor;
    if (valor > m.latencia_ms.pior) m.latencia_ms.pior = valor;
  }
}

/** Chamada pelos clientes quando o marketplace recusa o token. */
function anotarInvalidacao(empresa, integracao, status) {
  const m = eixoMetrica(empresa, integracao);
  if (status === 401) m.invalidacoes.por_401++;
  else if (status === 403) m.invalidacoes.por_403++;
  else m.invalidacoes.outras++;
}

/** Chamada depois do retry que se seguiu a uma invalidacao. */
function anotarRetry(empresa, integracao, deuCerto) {
  const m = eixoMetrica(empresa, integracao);
  if (deuCerto) m.retry_apos_invalidar.ok++;
  else m.retry_apos_invalidar.falhou++;
}

// b258 - os modulos registram aqui quantas renovacoes locais recusaram.
const recusasPorEixo = {};
function registrarRecusa(empresa, integracao) {
  const k = empresa + '/' + integracao;
  recusasPorEixo[k] = (recusasPorEixo[k] || 0) + 1;
}
function contadorRecusas() { return { ...recusasPorEixo }; }

/**
 * b259 - ⚠️ O VEREDITO, calculado dos numeros.
 *
 * O parecer avisou: "'cache tem dois itens' nao satisfaz nenhum criterio".
 * Entao em vez de deixar o dono (ou eu, daqui a um mes) interpretar
 * contadores, digo direto se o eixo esta pronto — e POR QUE nao, quando
 * nao esta.
 */
function vereditoDeCorte() {
  const saida = {};
  for (const eixo of ['good/bling', 'good/ml']) {
    const m = metricas[eixo];
    const [emp, integ] = eixo.split('/');
    const pol = politicaDe(emp, integ);

    if (!m) { saida[eixo] = { pronto: false, por_que: 'sem trafego medido ainda' }; continue; }
    // b259.2 (Codex, P1) - ⚠️ `remoto` NAO E AUTOMATICAMENTE "PRONTO".
    //
    // Eu devolvia "ja cortado" e parava. Mas se o dono nao entrega, o eixo
    // acumula `fonte.falhou` — e o painel diria PRONTO enquanto as
    // chamadas morrem. Um eixo cortado que esta falhando e o pior caso, e
    // era o que menos aparecia.
    if (pol === 'remoto') {
      const falhou = (m.fonte.falhou || 0);
      saida[eixo] = falhou > 0
        ? { pronto: false, cortado: true,
            por_que: `JA CORTADO mas falhando: ${falhou} chamada(s) sem token do dono` }
        : { pronto: true, cortado: true, por_que: 'cortado e funcionando' };
      continue;
    }

    const motivos = [];
    // ⚠️ o criterio central: em sombra, cair no local significa que o dono
    // nao entregou. Cortar assim transformaria cada uma dessas em falha.
    if (m.fonte.local > 0) motivos.push(`caiu no local ${m.fonte.local}x`);
    // ⚠️ exijo leitura REMOTA de verdade: so cache significa que a rota
    // pode nunca ter respondido nesta janela.
    if (m.fonte.remoto === 0) motivos.push('nunca leu do dono (so cache)');
    if (m.retry_apos_invalidar.falhou > 0) motivos.push(`retry falhou ${m.retry_apos_invalidar.falhou}x`);
    if ((m.estados.config_invalida || 0) > 0) motivos.push('houve config_invalida');

    saida[eixo] = motivos.length
      ? { pronto: false, por_que: motivos.join('; ') }
      // ⚠️ b259.2 (Codex, P2): `cache` NAO e leitura do dono. Eu somava os
      // dois e chamava tudo de "leituras do dono" — mas so `remoto` prova
      // que a rota respondeu. Um dono fora do ar por 4 min apareceria como
      // saudavel se o cache cobrisse a janela.
      : { pronto: true,
          por_que: `${m.fonte.remoto} leitura(s) do dono + ${m.fonte.cache} do cache, zero fallback local` };
  }
  return saida;
}

function diagnostico() {
  const itens = [];
  for (const [k, v] of cache.entries()) {
    itens.push({
      chave: k,
      tem_token: !!v.access,
      idade_s: Math.round((Date.now() - v.em) / 1000),
      definitivo: !!v.definitivo,
    });
  }
  return {
    configurado: !!CHAVE,
    // ⚠️ o corte e por EIXO, nao pelo servico inteiro
    eixos: EIXOS,
    // b257 - a POLITICA EFETIVA de cada eixo. E o que diz, sem adivinhacao,
    // se o corte ja aconteceu e onde.
    politica: {
      // ⚠️ b258 (Codex, P2): so os eixos que os clientes REALMENTE honram.
      //
      // Eu listava `ambtotal/*` aqui — mas os modulos da AMB nunca
      // consultam este arquivo. Se alguem setasse
      // `TOKEN_POLITICA_AMBTOTAL_ML=remoto`, o /health diria "remoto" e a
      // AMB continuaria renovando local. Painel que mente sobre o corte e
      // pior que painel nenhum.
      'good/bling': politicaDe('good', 'bling'),
      'good/ml': politicaDe('good', 'ml'),
      _ambtotal: 'NAO honra politica — os modulos lib-AMB/* nao consultam este leitor',
      _como_mudar: 'env TOKEN_POLITICA_<EMPRESA>_<INTEGRACAO> = local|sombra|remoto|bloqueado',
      // ⚠️ b258 (Codex, P2): EU PROMETI ROLLBACK SEM DEPLOY E ISSO NAO E
      // VERDADE. O processo Node le o proprio `process.env`, que so muda
      // quando o servico REINICIA — e no Render mudar env var dispara
      // restart. Entao "sem deploy" no sentido de "sem subir codigo": sim.
      // "Instantaneo, sem derrubar nada": NAO.
      //
      // Na pratica pro dono: ele muda a env no painel, o Render reinicia o
      // servico (segundos), e a politica nova vale. E aceitavel pro corte,
      // mas ele precisa SABER que reinicia — nao descobrir no meio de um
      // pico.
      _como_reverter: 'mudar a env no painel do Render; o servico REINICIA '
        + '(segundos de indisponibilidade) e a politica nova passa a valer',
      _nao_e_instantaneo: true,
      _atencao_rollback: 'voltar pra `local` exige um refresh SABIDAMENTE vigente — '
        + 'o valor no ambiente pode ja ter sido consumido pelo dono',
    },
    pronto_pra_cortar: ['good/bling', 'good/ml'],
    // ⚠️ b258 (Codex, P2): o contador de renovacoes recusadas vem dos
    // modulos. E o numero que PROVA o corte — sem ele exposto, "deu certo"
    // volta a ser opiniao.
    renovacoes_recusadas: contadorRecusas(),
    // b259 - a EVIDENCIA, nao so o inventario
    telemetria: { desde: DESDE, por_eixo: metricas },
    // ⚠️ e o VEREDITO pronto, pra ninguem precisar interpretar numero solto
    pode_cortar: vereditoDeCorte(),
    ainda_local: ['ambtotal/bling', 'ambtotal/ml'],
    dono: MOVER_URL,
    ttl_s: TTL_MS / 1000,
    em_cache: itens.length,
    itens,
  };
}

module.exports = { lerToken, lerTokenDetalhado, resolverToken, politicaDe, registrarRecusa, anotarInvalidacao, anotarRetry, vereditoDeCorte, invalidar, diagnostico, TTL_MS };
