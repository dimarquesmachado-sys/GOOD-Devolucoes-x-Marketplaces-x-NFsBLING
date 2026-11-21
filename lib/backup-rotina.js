'use strict';
/* b775 — BACKUP LOGICO DIARIO, PELO SISTEMA (V-04 do roteiro de liquidacao; dono, 20/11: "segue").

   Ate aqui o backup logico (scripts/backup-tabelas.js) so rodava na mao, pelo Shell do Render — e ficava no /tmp do
   Render, que some no deploy seguinte. Esta rotina:
     · roda o MESMO script (rodar() exportado — uma implementacao so), uma vez por dia, na hora configurada
       (BACKUP_HORA, hora de Brasilia, padrao 03:30 — fora do horario do galpao e longe das rotinas pesadas);
     · manda cada tabela (.jsonl.gz) e o manifesto.json pro Supabase Storage, bucket PRIVADO proprio
       (BACKUP_BUCKET, padrao 'backups-privados'), pasta <carimbo>/<empresa>/ — o mesmo desenho do armazem dos indices
       (lib/armazem-indices.js): o bucket nasce na 1a gravacao, 409 = ja existe;
     · guarda os ultimos BACKUP_RETER dias (padrao 14) e apaga os mais velhos;
     · pode ser disparada pelo admin (GET /api/admin/backup?rodar=1) e mostra o estado em /api/admin/backup e no /health.

   O que isto cobre: DDL errado, delete errado, tabela derrubada — volta pelo scripts/restaurar-tabelas.js a partir
   do dia anterior (RPO 1 dia, como o runbook). O que NAO cobre: perder o projeto do Supabase inteiro (o bucket mora
   nele) — isso e a camada 1 (backup diario do proprio Supabase; PITR, se o dono quiser). docs/BACKUP-E-RESTORE.md.

   Regras: uma rodada por vez (a segunda e recusada, nao enfileirada); erro em qualquer tabela = a rodada fica
   registrada como FALHA (o manifesto diz qual), nunca "ok" parcial; nada aqui converte falha em sucesso vazio. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const CARIMBO = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?$/;

function criarRotina({ rodarBackup, obterSupabase, bucket, hora, reter, agora = () => new Date(), log = console.log, fusoMin = -180 } = {}) {
  if (typeof rodarBackup !== 'function') throw new Error('backup-rotina: rodarBackup e obrigatorio');
  const BUCKET = bucket || process.env.BACKUP_BUCKET || 'backups-privados';
  const HORA = String(hora || process.env.BACKUP_HORA || '03:30');
  const RETER = Math.max(1, Number(reter || process.env.BACKUP_RETER || 14));
  const estado = { rodando: false, inicio: null, ultimo: null, ultimoDia: null, bucket: BUCKET, hora: HORA, reter: RETER };
  let garantido = false;

  async function garantirBucket(sb) {
    if (garantido) return;
    const r = await sb.storage.createBucket(BUCKET, { public: false });
    const er = r && r.error;
    if (er && !(String(er.statusCode || er.status) === '409' || /already exists|duplicate/i.test(String(er.message || '')))) throw new Error('bucket: ' + (er.message || er));
    garantido = true;
  }

  /* hora local (Brasilia) a partir do relogio, sem depender do TZ do servidor */
  function local(d) {
    const t = new Date(d.getTime() + fusoMin * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return { dia: t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()), hm: p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) };
  }

  async function enviarPasta(sb, pasta, carimbo) {
    let enviados = 0, bytes = 0;
    const empresas = fs.readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const emp of empresas) {
      for (const arq of fs.readdirSync(path.join(pasta, emp))) {
        if (!/\.jsonl$/.test(arq)) continue;
        const buf = zlib.gzipSync(fs.readFileSync(path.join(pasta, emp, arq)));
        const { error } = await sb.storage.from(BUCKET).upload(carimbo + '/' + emp + '/' + arq + '.gz', buf, { upsert: true, contentType: 'application/gzip' });
        if (error) throw new Error('upload ' + emp + '/' + arq + ': ' + (error.message || error));
        enviados++; bytes += buf.length;
      }
    }
    const manifesto = fs.readFileSync(path.join(pasta, 'manifesto.json'));
    const { error } = await sb.storage.from(BUCKET).upload(carimbo + '/manifesto.json', manifesto, { upsert: true, contentType: 'application/json' });
    if (error) throw new Error('upload manifesto: ' + (error.message || error));
    return { enviados: enviados + 1, bytes: bytes + manifesto.length };
  }

  async function caminhosDaPasta(sb, p) {
    const caminhos = [];
    const { data: nivel1 } = await sb.storage.from(BUCKET).list(p, { limit: 1000 });
    for (const x of (nivel1 || [])) {
      if (x.id) { caminhos.push(p + '/' + x.name); continue; }   // arquivo direto (manifesto.json)
      const { data: nivel2 } = await sb.storage.from(BUCKET).list(p + '/' + x.name, { limit: 1000 });
      for (const y of (nivel2 || [])) caminhos.push(p + '/' + x.name + '/' + y.name);
    }
    return caminhos;
  }

  /* carimbo ('2026-11-21T06-30-00', UTC) -> dia local (Brasilia) */
  function diaDoCarimbo(c) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(c);
    return m ? local(new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + 'Z')).dia : null;
  }

  /* pastas do bucket com carimbo, ordenadas; "completa" = tem o manifesto.json (e o ULTIMO arquivo enviado) */
  async function pastasDoBucket(sb) {
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
    if (error) throw new Error('listar: ' + (error.message || error));
    const nomes = (data || []).map((x) => x.name).filter((n) => CARIMBO.test(n)).sort();
    const pastas = [];
    for (const n of nomes) {
      const { data: d1, error: e1 } = await sb.storage.from(BUCKET).list(n, { limit: 1000 });
      if (e1) throw new Error('listar ' + n + ': ' + (e1.message || e1));
      pastas.push({ nome: n, completa: (d1 || []).some((x) => x.name === 'manifesto.json') });
    }
    return pastas;
  }

  /* o marcador "ja fiz hoje" some quando o processo reinicia; o Storage e a memoria duravel (Codex #628) */
  async function jaTemBackupDeHoje(sb) {
    const hoje = local(agora()).dia;
    return (await pastasDoBucket(sb)).some((p) => p.completa && diaDoCarimbo(p.nome) === hoje);
  }

  /* Retencao conta SO rodadas completas; pasta sem manifesto e lixo de upload que falhou — apagada, nunca conta (Codex #628) */
  async function apagarVelhos(sb) {
    const pastas = await pastasDoBucket(sb);
    const completas = pastas.filter((p) => p.completa).map((p) => p.nome);
    const velhas = completas.slice(0, Math.max(0, completas.length - RETER));
    const incompletas = pastas.filter((p) => !p.completa).map((p) => p.nome);
    let apagados = 0;
    for (const p of velhas.concat(incompletas)) {
      const caminhos = await caminhosDaPasta(sb, p);
      if (caminhos.length) {
        const { error: er } = await sb.storage.from(BUCKET).remove(caminhos);
        if (er) throw new Error('apagar ' + p + ': ' + (er.message || er));
      }
      apagados++;
    }
    return { apagados, incompletas_apagadas: incompletas.length, mantidos: completas.length - velhas.length };
  }

  async function executar({ motivo = 'manual' } = {}) {
    if (estado.rodando) return { ok: false, erro: 'ja esta rodando desde ' + estado.inicio };
    const sb = obterSupabase && obterSupabase();
    if (!sb || !sb.storage) return { ok: false, erro: 'sem Supabase' };
    estado.rodando = true; estado.inicio = agora().toISOString();
    let base = null;
    const resultado = { ok: false, motivo, inicio: estado.inicio, fim: null, carimbo: null, tabelas: 0, linhas: 0, erros: [], enviados: 0, bytes: 0, retencao: null, erro: null };
    try {
      if (motivo === 'diario') {
        // Storage fora do ar na checagem = NAO SEI, nao "nao fiz": rodar as cegas e exatamente o que o apontamento
        // evitava (duas rodadas no dia, uma vaga da retencao a menos). Falha registrada; o tick tenta de novo em 1 min.
        const feito = await jaTemBackupDeHoje(sb);
        if (feito) { estado.ultimoDia = local(agora()).dia; resultado.ok = true; resultado.pulado = 'ja existe backup completo de hoje no Storage'; log('[backup] diario: ' + resultado.pulado); return resultado; }
      }
      base = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-devolucoes-'));
      const r = await rodarBackup({ saida: base, agora, log: () => {} });   // { raiz, manifesto } do scripts/backup-tabelas.js
      resultado.carimbo = path.basename(r.raiz);
      resultado.erros = r.manifesto.erros || [];
      resultado.erros = resultado.erros.map((e) => ({ empresa: e.empresa, tabela: e.tabela || null, erro: e.erro }));
      for (const emp of Object.keys(r.manifesto.empresas || {})) for (const t of Object.values(r.manifesto.empresas[emp])) { resultado.tabelas++; resultado.linhas += Number(t.linhas || 0); }
      if (resultado.erros.length) throw new Error(resultado.erros.length + ' falha(s) no backup: ' + resultado.erros.map((e) => e.empresa + (e.tabela ? '/' + e.tabela : '')).join(', '));
      await garantirBucket(sb);
      Object.assign(resultado, await enviarPasta(sb, r.raiz, resultado.carimbo));
      resultado.retencao = await apagarVelhos(sb);
      resultado.ok = true;
      estado.ultimoDia = local(agora()).dia;
      log('[backup] ' + motivo + ': ' + resultado.tabelas + ' tabela(s), ' + resultado.linhas + ' linha(s), ' + resultado.enviados + ' arquivo(s) em ' + BUCKET + '/' + resultado.carimbo + ' — ' + resultado.retencao.mantidos + ' rodada(s) mantida(s)');
    } catch (e) {
      resultado.erro = e.message;
      log('[backup] ' + motivo + ' FALHOU: ' + e.message);
    } finally {
      if (base) { try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* temporario */ } }
      resultado.fim = agora().toISOString();
      estado.rodando = false; estado.ultimo = resultado;
    }
    return resultado;
  }

  /* chamado a cada minuto pelo timer: dispara UMA vez por dia, na hora certa (ou depois dela, se o servidor estava fora) */
  function tick() {
    const { dia, hm } = local(agora());
    if (estado.rodando || estado.ultimoDia === dia) return false;
    if (hm < HORA) return false;
    executar({ motivo: 'diario' }).catch((e) => log('[backup] diario: ' + e.message));
    return true;
  }

  function ligar(drenagem) { return drenagem.intervalo(tick, 60 * 1000); }
  function diagnostico() { return { rodando: estado.rodando, inicio: estado.inicio, hora: HORA, reter: RETER, bucket: BUCKET, ultimo_dia: estado.ultimoDia, ultimo: estado.ultimo }; }

  return { executar, tick, ligar, diagnostico };
}

module.exports = { criarRotina, CARIMBO };
