'use strict';
// b775 — V-04: o backup logico passa a ser DIARIO e PELO SISTEMA (lib/backup-rotina.js), com o resultado no Storage.
// Aqui a rotina de producao roda com o scripts/backup-tabelas.js DE VERDADE contra o PostgREST falso (as 3 empresas,
// tabelas com e sem coluna id) e um Storage de mentira que registra bucket, uploads, listagens e remocoes. Prova:
//   1. uma rodada: cria o bucket privado, manda <carimbo>/<empresa>/<tabela>.jsonl.gz de cada tabela + manifesto.json,
//      e o .gz abre de volta nas MESMAS linhas; estado ok, tabelas/linhas contadas; pasta temporaria apagada;
//   2. tabela que falha = rodada FALHA (nada vai pro Storage; o erro diz qual tabela) — nunca "ok parcial";
//   3. duas rodadas ao mesmo tempo: a segunda e recusada;
//   4. retencao: com 16 carimbos no bucket e reter=14, as 2 mais velhas sao apagadas (arquivo a arquivo), as 14 ficam;
//   5. o relogio: o tick so dispara uma vez por dia, na hora (Brasilia), ou depois se o servidor estava fora; nunca
//      antes, nunca duas vezes no mesmo dia, e no dia seguinte dispara de novo;
//   6. upload que falha = rodada FALHA com o motivo.
//  10. (b802, V-18) falha que NAO passa sozinha: o diario ESPERA entre as tentativas (proximo minuto, 5, 15, 60 min) —
//      eram 1.230 rodadas num dia, cada uma lendo todas as tabelas; da certo = zera; dia novo recomeca; o manual nao espera.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { subirPostgrest } = require('./_postgrest-falso');
const { obterEmpresa } = require('../lib/empresas');
const CHAVES = ['good', 'ambtotal', 'girassol'];
const { rodar } = require('../scripts/backup-tabelas');
const { criarRotina, ESPERAS_MIN } = require('../lib/backup-rotina');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

/* Storage de mentira: o que a rotina usa do supabase-js (createBucket, upload, list, remove) */
function storageFalso({ falharUpload } = {}) {
  const objetos = new Map(); const chamadas = { createBucket: 0, upload: 0, remove: [] }; const buckets = new Set();
  const api = {
    storage: {
      async createBucket(nome) { chamadas.createBucket++; if (buckets.has(nome)) return { error: { statusCode: '409', message: 'The resource already exists' } }; buckets.add(nome); return { data: { name: nome }, error: null }; },
      from(bucket) {
        return {
          async upload(caminho, buf) { chamadas.upload++; if (falharUpload && falharUpload(caminho)) return { error: { message: 'simulado: sem espaco' } }; objetos.set(bucket + '/' + caminho, Buffer.from(buf)); return { data: { path: caminho }, error: null }; },
          async list(prefixo) {
            const p = prefixo ? prefixo.replace(/\/$/, '') + '/' : '';
            const vistos = new Map();
            for (const k of objetos.keys()) {
              if (!k.startsWith(bucket + '/' + p)) continue;
              const resto = k.slice((bucket + '/' + p).length); const primeiro = resto.split('/')[0];
              if (!vistos.has(primeiro)) vistos.set(primeiro, resto.includes('/') ? { name: primeiro, id: null } : { name: primeiro, id: 'obj-' + primeiro });
            }
            return { data: [...vistos.values()], error: null };
          },
          async remove(caminhos) { for (const c of caminhos) { chamadas.remove.push(c); objetos.delete(bucket + '/' + c); } return { data: caminhos.map((c) => ({ name: c })), error: null }; },
        };
      },
    },
  };
  return { api, objetos, chamadas, buckets };
}

(async () => {
  const colunas = {};
  for (const k of CHAVES) { const f = obterEmpresa(k); colunas[f.tabelas.skuDepara] = ['sku_antigo', 'sku_atual']; colunas[f.tabelas.devolucaoTags] = ['devolucao_id', 'tag_id']; }
  const pg = await subirPostgrest({ colunas });
  for (const k of CHAVES) {
    const f = obterEmpresa(k);
    for (let i = 1; i <= 5; i++) pg.tabela(f.tabelas.devolucoes).push({ id: i, codigo: k.toUpperCase() + '-' + i, status: 'triada' });
    pg.tabela(f.tabelas.skuDepara).push({ sku_antigo: 'V-' + k, sku_atual: 'N-' + k });
  }
  const env = { SUPABASE_URL: pg.url, SUPABASE_KEY: 'k' };
  for (const k of CHAVES) { const p = obterEmpresa(k).prefixoEnv; env[p + 'SUPABASE_URL'] = pg.url; env[p + 'SUPABASE_KEY'] = 'k-' + k; }
  const antigo = {}; for (const [k, v] of Object.entries(env)) { antigo[k] = process.env[k]; process.env[k] = v; }
  const restaurarEnv = () => { for (const k of Object.keys(env)) { if (antigo[k] === undefined) delete process.env[k]; else process.env[k] = antigo[k]; } };
  const silencio = () => {};
  const tmpAntes = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('backup-devolucoes-')).length;
  try {
    // ── 1. uma rodada de verdade ──
    let relogio = new Date('2026-11-21T06:31:00Z');   // 03:31 em Brasilia
    const st = storageFalso();
    const rot = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st.api, bucket: 'bk-teste', hora: '03:30', reter: 14, agora: () => relogio, log: silencio });
    const r1 = await rot.executar({ motivo: 'manual' });
    ok(r1.ok === true && r1.erro === null, '⚠️ a rodada termina ok (' + JSON.stringify({ ok: r1.ok, erro: r1.erro, erros: r1.erros }) + ')');
    ok(st.buckets.has('bk-teste') && st.chamadas.createBucket === 1, '  bucket privado criado na 1a rodada');
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(r1.carimbo), '  carimbo da rodada: ' + r1.carimbo);
    const chaves = [...st.objetos.keys()];
    const esperadoTabelas = CHAVES.reduce((n, k) => n + Object.keys(obterEmpresa(k).tabelas).length + 2, 0);   // + defeito_pedidos/defeito_comentarios
    ok(r1.tabelas === esperadoTabelas && r1.linhas === CHAVES.length * 6, '  ' + r1.tabelas + ' tabelas (esperado ' + esperadoTabelas + '), ' + r1.linhas + ' linhas');
    ok(r1.enviados === esperadoTabelas + 1 && chaves.length === r1.enviados, '  ' + r1.enviados + ' arquivos no Storage (tabelas + manifesto)');
        const gz = st.objetos.get('bk-teste/' + r1.carimbo + '/good/' + obterEmpresa('good').tabelas.devolucoes + '.jsonl.gz');
    const linhas = gz ? zlib.gunzipSync(gz).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
    ok(linhas.length === 5 && linhas[4].codigo === 'GOOD-5', '⚠️ o .gz da GOOD/devolucoes abre nas mesmas 5 linhas (' + linhas.length + ')');
    const man = st.objetos.get('bk-teste/' + r1.carimbo + '/manifesto.json');
    ok(man && JSON.parse(man.toString()).erros.length === 0, '  manifesto.json no Storage, sem erros');
    ok(st.objetos.has('bk-teste/' + r1.carimbo + '/girassol/' + obterEmpresa('girassol').tabelas.skuDepara + '.jsonl.gz'), '  tabela SEM id (sku_depara) tambem foi');
    ok(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('backup-devolucoes-')).length === tmpAntes, '  pasta temporaria apagada');
    ok(rot.diagnostico().ultimo_dia === '2026-11-21' && rot.diagnostico().rodando === false, '  diagnostico: ultimo_dia marcado, nao esta rodando');

    // ── 2. tabela que falha = rodada FALHA, nada no Storage ──
    const st2 = storageFalso();
    pg.ganchos.interceptar = (req) => (req.tabela === 'devolucoes_amb' ? { status: 500, corpo: { message: 'simulado' } } : null);
    const rot2 = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st2.api, bucket: 'bk2', agora: () => relogio, log: silencio });
    const r2 = await rot2.executar({ motivo: 'manual' });
    pg.ganchos.interceptar = null;
    ok(r2.ok === false && /devolucoes_amb/.test(r2.erro) && r2.erros.length === 1, '⚠️ tabela que falha = rodada FALHA dizendo qual (' + r2.erro + ')');
    ok(st2.objetos.size === 0 && st2.chamadas.upload === 0, '  e NADA foi pro Storage (sem "ok parcial")');
    ok(rot2.diagnostico().ultimo_dia === null, '  dia nao e marcado como feito — o tick tenta de novo');

    // ── 3. duas ao mesmo tempo ──
    const st3 = storageFalso();
    const rot3 = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st3.api, bucket: 'bk3', agora: () => relogio, log: silencio });
    const [a, b] = await Promise.all([rot3.executar({ motivo: 'manual' }), rot3.executar({ motivo: 'manual' })]);
    ok(a.ok === true && b.ok === false && /ja esta rodando/.test(b.erro), '⚠️ segunda rodada simultanea e recusada (' + b.erro + ')');

    // ── 4. retencao ──
    const st4 = storageFalso(); st4.buckets.add('bk4');
    for (let i = 1; i <= 16; i++) { const c = '2026-11-' + String(i).padStart(2, '0') + 'T03-30-00'; st4.objetos.set('bk4/' + c + '/manifesto.json', Buffer.from('{}')); st4.objetos.set('bk4/' + c + '/good/devolucoes.jsonl.gz', Buffer.from('x')); }
    st4.objetos.set('bk4/outra-coisa.txt', Buffer.from('nao e carimbo'));
    const rot4 = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st4.api, bucket: 'bk4', reter: 14, agora: () => relogio, log: silencio });
    const r4 = await rot4.executar({ motivo: 'manual' });
    ok(r4.ok && r4.retencao.apagados === 3 && r4.retencao.mantidos === 14, '⚠️ retencao: 16 velhas + a nova, reter 14 → 3 apagadas, 14 mantidas (' + JSON.stringify(r4.retencao) + ')');
    ok(!st4.objetos.has('bk4/2026-11-01T03-30-00/manifesto.json') && !st4.objetos.has('bk4/2026-11-03T03-30-00/good/devolucoes.jsonl.gz') && st4.objetos.has('bk4/2026-11-04T03-30-00/manifesto.json'), '  as 3 mais velhas sumiram arquivo a arquivo, a 4a ficou');
    ok(st4.objetos.has('bk4/outra-coisa.txt'), '  o que nao e carimbo nao e tocado');

    // ── 5. o relogio ──
    const st5 = storageFalso(); let rodadas = 0;
    const rot5 = criarRotina({ rodarBackup: async (o) => { rodadas++; return rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)); }, obterSupabase: () => st5.api, bucket: 'bk5', hora: '03:30', agora: () => relogio, log: silencio });
    relogio = new Date('2026-11-22T06:29:00Z'); ok(rot5.tick() === false && rodadas === 0, '  03:29 — ainda nao');
    relogio = new Date('2026-11-22T06:30:00Z'); ok(rot5.tick() === true, '⚠️ 03:30 — dispara'); await new Promise((r) => setTimeout(r, 1500));
    ok(rodadas === 1 && rot5.diagnostico().ultimo_dia === '2026-11-22', '  rodou 1x e marcou o dia');
    relogio = new Date('2026-11-22T06:31:00Z'); ok(rot5.tick() === false, '  03:31 do mesmo dia — nao repete');
    relogio = new Date('2026-11-22T23:59:00Z'); ok(rot5.tick() === false && rodadas === 1, '  23:59 do mesmo dia — nao repete');
    relogio = new Date('2026-11-23T13:10:00Z'); ok(rot5.tick() === true, '⚠️ dia seguinte, servidor so acordou as 10:10 — dispara atrasado (nao pula o dia)'); await new Promise((r) => setTimeout(r, 1500));
    ok(rodadas === 2, '  rodou de novo (' + rodadas + ')');

    // ── 6. upload que falha ──
    const st6 = storageFalso({ falharUpload: (c) => /manifesto/.test(c) });
    const rot6 = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st6.api, bucket: 'bk6', agora: () => relogio, log: silencio });
    const r6 = await rot6.executar({ motivo: 'manual' });
    ok(r6.ok === false && /upload manifesto: simulado/.test(r6.erro), '⚠️ upload que falha = rodada FALHA com o motivo (' + r6.erro + ')');
    ok(rot6.diagnostico().ultimo_dia === null, '  e o dia nao conta como feito');

    // ── 7. (Codex #628) reinicio depois das 03:30: o Storage lembra que hoje ja foi feito ──
    const st7 = storageFalso(); st7.buckets.add('bk7');
    st7.objetos.set('bk7/2026-11-24T06-30-00/manifesto.json', Buffer.from('{}'));   // 03:30 de Brasilia do dia 24
    let rodadas7 = 0;
    const rot7 = criarRotina({ rodarBackup: async () => { rodadas7++; throw new Error('nao devia rodar'); }, obterSupabase: () => st7.api, bucket: 'bk7', hora: '03:30', agora: () => relogio, log: silencio });
    relogio = new Date('2026-11-24T15:00:00Z');
    ok(rot7.tick() === true, '  processo novo as 12:00 — o tick dispara a checagem'); await new Promise((r) => setTimeout(r, 300));
    ok(rodadas7 === 0 && rot7.diagnostico().ultimo_dia === '2026-11-24', '⚠️ reinicio: ja existe backup completo de hoje no Storage — NAO roda de novo');
    ok(rot7.tick() === false, '  e o tick seguinte nem consulta mais');

    // ── 7b. Storage FORA na checagem de "ja fiz hoje" = nao sei: nao roda as cegas, tenta no proximo tick ──
    const st7b = storageFalso(); let fora7 = true; const from7 = st7b.api.storage.from;
    st7b.api.storage.from = (b) => { const f = from7(b); const listReal = f.list; return Object.assign(f, { list: async (...a) => (fora7 ? { data: null, error: { statusCode: '500', message: 'fora' } } : listReal(...a)) }); };
    let rodadas7b = 0;
    const rot7b = criarRotina({ rodarBackup: async (o) => { rodadas7b++; return rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)); }, obterSupabase: () => st7b.api, bucket: 'bk7b', hora: '03:30', agora: () => relogio, log: silencio });
    relogio = new Date('2026-11-25T06:30:00Z');
    ok(rot7b.tick() === true, '  dispara'); await new Promise((r) => setTimeout(r, 300));
    ok(rodadas7b === 0 && rot7b.diagnostico().ultimo_dia === null && /fora/.test((rot7b.diagnostico().ultimo || {}).erro || ''), '⚠️ Storage fora na checagem: NAO roda as cegas, falha registrada, dia nao marcado');
    fora7 = false; st7b.buckets.add('bk7b');
    ok(rot7b.tick() === true, '  proximo tick tenta de novo'); await new Promise((r) => setTimeout(r, 1500));
    ok(rodadas7b === 1 && rot7b.diagnostico().ultimo_dia === '2026-11-25', '  Storage voltou: rodou 1x e marcou o dia');

    // ── 8. (Codex #628) pasta sem manifesto nao conta na retencao e e apagada ──
    const st8 = storageFalso(); st8.buckets.add('bk8');
    st8.objetos.set('bk8/2026-11-01T03-30-00/manifesto.json', Buffer.from('{}')); st8.objetos.set('bk8/2026-11-01T03-30-00/good/d.jsonl.gz', Buffer.from('x'));
    for (let i = 2; i <= 15; i++) st8.objetos.set('bk8/2026-11-' + String(i).padStart(2, '0') + 'T03-30-00/good/d.jsonl.gz', Buffer.from('x'));   // 14 uploads que morreram antes do manifesto
    relogio = new Date('2026-11-21T06:31:00Z');
    const rot8 = criarRotina({ rodarBackup: (o) => rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o)), obterSupabase: () => st8.api, bucket: 'bk8', reter: 14, agora: () => relogio, log: silencio });
    const r8 = await rot8.executar({ motivo: 'manual' });
    ok(r8.ok && r8.retencao.mantidos === 2 && r8.retencao.incompletas_apagadas === 14, '⚠️ so conta rodada completa: 2 mantidas, 14 incompletas apagadas (' + JSON.stringify(r8.retencao) + ')');
    ok(st8.objetos.has('bk8/2026-11-01T03-30-00/manifesto.json') && ![...st8.objetos.keys()].some((k) => k.startsWith('bk8/2026-11-05T')), '  o backup valido antigo sobreviveu; o lixo sumiu');

    // ── 9. (Codex #628) mkdtemp falhando: nao fica "rodando" pra sempre nem derruba o processo ──
    const st9 = storageFalso();
    const rot9 = criarRotina({ rodarBackup: async () => { throw new Error('nao chega'); }, obterSupabase: () => st9.api, bucket: 'bk9', hora: '03:30', agora: () => relogio, log: silencio });
    const mk = fs.mkdtempSync; fs.mkdtempSync = () => { const e = new Error('ENOSPC: simulado'); e.code = 'ENOSPC'; throw e; };
    let r9; try { r9 = await rot9.executar({ motivo: 'manual' }); } finally { fs.mkdtempSync = mk; }
    ok(r9.ok === false && /ENOSPC/.test(r9.erro) && rot9.diagnostico().rodando === false, '⚠️ mkdtemp falha = rodada FALHA registrada e rodando=false (' + r9.erro + ')');

    // ── 10. b802 (V-18): falha que nao passa sozinha — o diario ESPERA entre as tentativas ──
    {
      console.log('── 10. o diario que falha espera antes de tentar de novo');
      const st10 = storageFalso(); st10.buckets.add('bk10');
      let quebrado = true; const horas = []; const logs10 = [];
      const brasilia = () => new Date(relogio.getTime() - 3 * 3600000).toISOString().slice(11, 16);
      const rot10 = criarRotina({
        rodarBackup: async (o) => {
          horas.push(brasilia());
          if (!quebrado) return rodar(Object.assign({ empresas: CHAVES, criar: createClient }, o));
          const raiz = path.join(o.saida, '2026-12-01T06-30-00'); fs.mkdirSync(raiz, { recursive: true });
          return { raiz, manifesto: { empresas: {}, erros: [{ empresa: 'girassol', tabela: 'devolucoes_girassol', erro: 'simulado: a tabela sumiu' }] } };
        },
        obterSupabase: () => st10.api, bucket: 'bk10', hora: '03:30', agora: () => relogio, log: (l) => logs10.push(l),
      });
      const terminar = async () => { for (let i = 0; i < 2000 && rot10.diagnostico().rodando; i++) await new Promise((r) => setTimeout(r, 5)); };
      // um tick por minuto, como o timer de producao
      const andar = async (de, minutos) => { relogio = new Date(de); for (let m = 0; m < minutos; m++) { if (rot10.tick()) await terminar(); relogio = new Date(relogio.getTime() + 60000); } };

      ok(JSON.stringify(ESPERAS_MIN) === '[0,5,15,60]', '  a escada: proximo minuto, 5, 15 e 60 min (' + JSON.stringify(ESPERAS_MIN) + ')');
      await andar('2026-12-01T06:00:00Z', 21 * 60);   // das 03:00 as 23:59 de Brasilia
      ok(horas.length === 24, '⚠️ um dia inteiro com a falha no ar: ' + horas.length + ' rodadas (eram 1.230, uma por minuto)');
      ok(horas.slice(0, 6).join(' ') === '03:30 03:31 03:36 03:51 04:51 05:51' && horas[horas.length - 1] === '23:51', '⚠️ na hora, no minuto seguinte, +5, +15 e depois de hora em hora (' + horas.slice(0, 6).join(' ') + ' … ' + horas[horas.length - 1] + ')');
      let d = rot10.diagnostico();
      ok(d.ultimo_dia === null && d.ultimo.ok === false && d.falhas_seguidas === 24 && d.proxima_tentativa === '2026-12-02T03:51:00.000Z',
        '⚠️ o estado diz quantas falhou e quando tenta de novo (' + JSON.stringify({ falhas_seguidas: d.falhas_seguidas, proxima_tentativa: d.proxima_tentativa }) + ') — e o dia NAO e marcado como feito');
      ok(st10.chamadas.upload === 0 && logs10.filter((l) => /tento de novo/.test(l)).length === 24 && /1a falha de hoje — tento de novo no proximo minuto/.test(logs10.join('\n')) && /4a falha de hoje — tento de novo em 60 min/.test(logs10.join('\n')),
        '  nada foi pro Storage, e cada falha deixa no log quando sera a proxima');

      // dia seguinte, ainda quebrado: a escada RECOMECA (uma falha passageira de hoje nao herda os 60 min de ontem)
      horas.length = 0;
      await andar('2026-12-02T06:00:00Z', 34);   // 03:00 → 03:33
      ok(horas.join(' ') === '03:30 03:31' && rot10.diagnostico().falhas_seguidas === 2, '⚠️ dia novo recomeca a escada: 03:30 e 03:31 (' + horas.join(' ') + '), e agora espera 5 min');
      // disparo manual no meio da espera: roda na hora; falhando, nao mexe na escada do relogio
      const antes = rot10.diagnostico().proxima_tentativa;
      const man1 = await rot10.executar({ motivo: 'manual' });
      ok(man1.ok === false && horas.length === 3 && rot10.diagnostico().proxima_tentativa === antes && rot10.diagnostico().falhas_seguidas === 2, '⚠️ o disparo manual NAO espera (rodou as ' + horas[2] + ') e, falhando, nao muda a espera do diario');
      // consertado: o diario so volta na hora marcada (03:36), da certo, marca o dia e zera
      quebrado = false; horas.length = 0;
      await andar(relogio.toISOString(), 2);   // 03:34 e 03:35: ainda esperando
      ok(horas.length === 0, '  03:34 e 03:35 — ainda esperando, nao roda');
      await andar(relogio.toISOString(), 3);   // 03:36 em diante
      d = rot10.diagnostico();
      ok(horas.join(' ') === '03:36' && d.ultimo.ok === true && d.ultimo_dia === '2026-12-02' && d.falhas_seguidas === 0 && d.proxima_tentativa === null && st10.chamadas.upload > 0,
        '⚠️ 03:36 — roda, da certo, marca o dia e ZERA a escada (' + JSON.stringify({ rodou: horas, falhas_seguidas: d.falhas_seguidas, proxima_tentativa: d.proxima_tentativa }) + ')');
      // dia 3: falha duas vezes e ai o dono dispara na mao com tudo consertado → o manual que da certo zera e marca o dia
      quebrado = true; horas.length = 0;
      await andar('2026-12-03T06:29:00Z', 3);   // 03:29, 03:30, 03:31
      ok(horas.join(' ') === '03:30 03:31' && rot10.diagnostico().proxima_tentativa === '2026-12-03T06:36:00.000Z', '  dia 3: falhou as 03:30 e as 03:31, espera ate 03:36');
      quebrado = false;
      const man2 = await rot10.executar({ motivo: 'manual' });
      d = rot10.diagnostico();
      ok(man2.ok === true && d.falhas_seguidas === 0 && d.proxima_tentativa === null && d.ultimo_dia === '2026-12-03', '⚠️ o manual que da certo zera a escada e marca o dia');
      horas.length = 0;
      await andar(relogio.toISOString(), 30);
      ok(horas.length === 0, '  e o relogio nao roda de novo naquele dia');
      // Codex #648: BACKUP_HORA=00:00 e falha de ontem esperando ate depois da meia-noite NAO adia o backup de hoje
      quebrado = true; horas.length = 0;
      const rot11 = criarRotina({
        rodarBackup: async (o) => { horas.push(brasilia()); const raiz = path.join(o.saida, '2026-12-05T03-00-00'); fs.mkdirSync(raiz, { recursive: true });
          return { raiz, manifesto: { empresas: {}, erros: [{ empresa: 'girassol', tabela: 'devolucoes_girassol', erro: 'simulado' }] } }; },
        obterSupabase: () => st10.api, bucket: 'bk10', hora: '00:00', agora: () => relogio, log: () => {},
      });
      const andar11 = async (de, minutos) => { relogio = new Date(de); for (let m = 0; m < minutos; m++) { if (rot11.tick()) { for (let i = 0; i < 2000 && rot11.diagnostico().rodando; i++) await new Promise((r) => setTimeout(r, 5)); } relogio = new Date(relogio.getTime() + 60000); } };
      await andar11('2026-12-05T03:00:00Z', 24 * 60);   // 00:00 → 23:59 de Brasilia, falhando o dia todo
      const d11 = rot11.diagnostico();
      ok(d11.falhas_seguidas >= 4 && new Date(d11.proxima_tentativa).getTime() > relogio.getTime(), '  dia 5 acabou com a espera passando da meia-noite (' + d11.proxima_tentativa + ')');
      horas.length = 0;
      ok(rot11.tick() === true, '⚠️ 00:00 do dia 6: a espera de ontem nao vale — o diario dispara');
      for (let i = 0; i < 2000 && rot11.diagnostico().rodando; i++) await new Promise((r) => setTimeout(r, 5));
      ok(horas.join(' ') === '00:00' && rot11.diagnostico().falhas_seguidas === 1, '  e a escada recomecou do zero (' + horas.join(' ') + ', ' + rot11.diagnostico().falhas_seguidas + ')');
    }
  } catch (err) {
    falhas++; console.log('FALHA ' + (err && err.stack || err));
  } finally {
    restaurarEnv(); await pg.parar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
