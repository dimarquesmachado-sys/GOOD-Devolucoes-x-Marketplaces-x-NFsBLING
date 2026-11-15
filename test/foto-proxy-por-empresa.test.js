'use strict';
require('./_fonte-fabrica');   // le a fabrica com os modulos lib-AMB embutidos
// b710 — P1-09 + P2-12 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): O PROXY DE FOTOS SO ENTREGA FOTO DESTA EMPRESA.
//
// GET /api/admin/foto/<chave> exigia admin mas aceitava QUALQUER chave do bucket: um admin da Girassol pedia `amb/...` e
// o handler baixava. Agora, antes de qualquer download, a rota confere no banco DESTA empresa (tabela de devolucoes
// dela) se alguma devolucao referencia a foto em `problema_fotos`; sem vinculo = 404, sem tocar no Storage.
// P2-12 na mesma rota: o fallback pela URL publica usava `SUPABASE_URL`, nome que NAO existe no modulo (ReferenceError
// em toda falha do Storage); agora a URL vem por injecao (`supabaseUrl`).
//
// O registrador REAL roda com app, Supabase e fetch simulados — vale, por construcao, pras 3 empresas.
// Roda com: node test/foto-proxy-por-empresa.test.js

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const registrar = require(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'));

const URL_SB = 'https://sldnteste.supabase.co';
const CHAVE = 'amb/diego/1763200000000-ab12cd34.jpg';
const URL_FOTO = URL_SB + '/storage/v1/object/public/fotos-problema/' + CHAVE;

function montar({ linhas, erroConsulta, erroJsonbNaForma, download }) {
  const chamadas = { consultas: [], downloads: [], fetch: [] };
  const supabase = {
    supabaseUrl: URL_SB,
    from(tab) {
      return {
        select() {
          return {
            contains(col, v) {
              chamadas.consultas.push({ tab, col, v });
              return {
                limit: async () => {
                  if (erroConsulta) return { data: null, error: { message: erroConsulta } };
                  // simula jsonb: a forma "lista" falha, a forma JSON-texto passa
                  if (erroJsonbNaForma === 'lista' && Array.isArray(v)) return { data: null, error: { message: 'invalid input syntax for type json' } };
                  const alvo = Array.isArray(v) ? v[0] : JSON.parse(v)[0];
                  return { data: (linhas || []).filter((l) => (l.problema_fotos || []).includes(alvo)).map((l) => ({ id: l.id })), error: null };
                },
              };
            },
          };
        },
      };
    },
    storage: { from(bucket) { return { download: async (arq) => { chamadas.downloads.push({ bucket, arq }); return download ? download(arq) : { data: null, error: { message: 'Object not found' } }; } }; } },
  };
  let handler = null;
  const app = { get(rota, ...fns) { if (rota === '/api/admin/foto/*') handler = fns[fns.length - 1]; }, post() {}, put() {}, delete() {}, use() {} };
  const deps = {
    supabase, supabaseUrl: URL_SB, requerAdmin: (q, s, n) => n(), adminOk: () => true, sleep: async () => {},
    chamarBling: async () => ({}), chamarML: async () => ({}), buscarNFnoML: async () => ({}),
    buscarNFePorId: async () => null, buscarNFBlindada: async () => null, naturezaDevolucaoDaEmpresa: async () => null,
    resolverIdNFPorChave: async () => null, mapItensNF: () => [], tabelaDevolucoes: 'devolucoes_girassol', colunaCriadoEm: 'criado_em',
    buscarNFsPorNumero: async () => [], buscarNFnoBlingPorNumero: async () => null, buscarNfDevolucaoBling: async () => null,
    nomesBatemNf: () => false, listarDepositos: async () => [],
  };
  registrar(app, deps);
  if (!handler) throw new Error('rotas-admin nao registrou /api/admin/foto/*');
  async function pedir(chave) {
    let status = 200, corpo = null; const headers = {};
    const res = { status(s) { status = s; return this; }, send(b) { corpo = b; return this; }, set(k, v) { headers[k] = v; return this; } };
    await handler({ params: { 0: chave } }, res);
    return { status, corpo, headers };
  }
  return { pedir, chamadas };
}

(async () => {
  const fetchOriginal = global.fetch;

  // 1. foto de uma devolucao DESTA empresa: baixa e entrega
  {
    const t = montar({ linhas: [{ id: 7, problema_fotos: [URL_FOTO] }], download: async () => ({ data: { type: 'image/jpeg', arrayBuffer: async () => Buffer.from('JPEGDATA') }, error: null }) });
    const r = await t.pedir(CHAVE);
    ok(r.status === 200 && Buffer.isBuffer(r.corpo) && r.corpo.toString() === 'JPEGDATA' && r.headers['Content-Type'] === 'image/jpeg', 'foto vinculada a uma devolucao desta empresa: 200 com a imagem');
    ok(t.chamadas.consultas.length === 1 && t.chamadas.consultas[0].tab === 'devolucoes_girassol' && t.chamadas.consultas[0].col === 'problema_fotos',
       '  conferiu na TABELA DESTA EMPRESA (devolucoes_girassol), coluna problema_fotos');
    ok(t.chamadas.downloads.length === 1 && t.chamadas.downloads[0].arq === CHAVE, '  e so entao baixou do Storage');
  }
  // 2. chave que existe no bucket mas NAO e de devolucao desta empresa: 404 sem tocar no Storage
  {
    const t = montar({ linhas: [{ id: 7, problema_fotos: [URL_SB + '/storage/v1/object/public/fotos-problema/amb/outra/1.jpg'] }], download: async () => ({ data: { type: 'image/jpeg', arrayBuffer: async () => Buffer.from('X') }, error: null }) });
    const r = await t.pedir(CHAVE);
    ok(r.status === 404 && /nao pertence|nao encontrada/i.test(String(r.corpo)), '⚠️ admin de A pedindo foto de B: 404 (' + r.status + ')');
    ok(t.chamadas.downloads.length === 0, '  ⚠️ e NENHUM download foi tentado (nem Storage nem URL publica)');
  }
  // 3. banco falhou: 500 honesto, nada baixado (erro nunca vira "pode")
  {
    const t = montar({ linhas: [], erroConsulta: 'connection refused' });
    const r = await t.pedir(CHAVE);
    ok(r.status === 500 && t.chamadas.downloads.length === 0, '  banco indisponivel: 500, sem download (' + r.status + ')');
  }
  // 4. coluna jsonb: a forma "lista" e recusada pelo PostgREST, a forma JSON-texto responde — e a rota tenta as duas
  {
    const t = montar({ linhas: [{ id: 1, problema_fotos: [URL_FOTO] }], erroJsonbNaForma: 'lista', download: async () => ({ data: { type: 'image/jpeg', arrayBuffer: async () => Buffer.from('J') }, error: null }) });
    const r = await t.pedir(CHAVE);
    ok(r.status === 200 && t.chamadas.consultas.length === 2 && Array.isArray(t.chamadas.consultas[0].v) && typeof t.chamadas.consultas[1].v === 'string',
       '  coluna jsonb (forma de lista da 400): tenta a forma JSON-texto e entrega (' + t.chamadas.consultas.length + ' consultas)');
  }
  // 5. P2-12: Storage falhou → fallback pela URL publica usa a URL INJETADA (antes: ReferenceError SUPABASE_URL)
  {
    const t = montar({ linhas: [{ id: 1, problema_fotos: [URL_FOTO] }] });
    const chamadasFetch = [];
    global.fetch = async (u) => { chamadasFetch.push(String(u)); return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('PNG') }; };
    const r = await t.pedir(CHAVE);
    global.fetch = fetchOriginal;
    ok(r.status === 200 && r.corpo.toString() === 'PNG' && chamadasFetch.length === 1 && chamadasFetch[0] === URL_FOTO,
       '⚠️ P2-12: Storage falhou → busca pela URL publica do Supabase INJETADO (sem ReferenceError): ' + (chamadasFetch[0] || '(nenhum fetch)'));
  }
  // 6. chave torta nao vira consulta
  {
    const t = montar({ linhas: [] });
    const r = await t.pedir('../../../etc/passwd');
    ok(r.status === 400 || (r.status === 404 && t.chamadas.downloads.length === 0), '  chave com travessia: ' + r.status + ', sem download');
  }

  // ── as duas pontas injetam supabaseUrl; a fabrica grava a foto nova na pasta DA EMPRESA (nao mais `amb/` pra todas) ──
  const SRV = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const APP = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'app-AMB.js'), 'utf8');
  const COMPAT = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'compat-AMB.js'), 'utf8');
  const ROTAS = fs.readFileSync(path.join(RAIZ, 'amb-devolucoes', 'lib-AMB', 'rotas-admin-AMB.js'), 'utf8');
  {
    const i = SRV.indexOf("require('./amb-devolucoes/lib-AMB/rotas-admin-AMB.js')(app, Object.assign({}, DEPS_ADMIN_NF, {"); const f = SRV.indexOf('}));', i);
    ok(i >= 0 && f > i && /supabaseUrl: SUPABASE_URL,/.test(SRV.slice(i, f)), 'GOOD injeta supabaseUrl no rotas-admin');
    const j = APP.indexOf('registrarRotasAdminNF(router, {'); const g = APP.indexOf('});', j);
    ok(j >= 0 && g > j && /supabaseUrl: CFG_EMPRESA\.supabase\.url,/.test(APP.slice(j, g)), 'fabrica injeta supabaseUrl (da ficha da empresa) no rotas-admin');
  }
  ok(!/\$\{SUPABASE_URL\}/.test(ROTAS) && /\$\{SUPABASE_URL_BASE\}/.test(ROTAS), '  rotas-admin: o nome inexistente `SUPABASE_URL` sumiu; usa a URL injetada');
  ok(/const nome = `\$\{PASTA_FOTOS\}\/\$\{nomeDePastaSeguro\(req\.usuario\)\}\//.test(COMPAT) || /const nome = `\$\{PASTA_FOTOS\}\/\$\{req\.usuario\}\//.test(COMPAT),
     'fabrica: foto nova vai pra pasta da EMPRESA (chave do registro), nao mais `amb/` pra AMB e Girassol');
  ok(/const PASTA_FOTOS = String\(\(cfgEmpresa && cfgEmpresa\.CHAVE_REGISTRO\) \|\| SEM_EMPRESA\)/.test(COMPAT), '  sem chave nao cai em `amb/` (vai pra `sem-empresa/`); as antigas em `amb/` seguem autorizadas pelo vinculo no banco');

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('FALHA (o teste estourou): ' + (e && e.stack || e)); process.exit(1); });
