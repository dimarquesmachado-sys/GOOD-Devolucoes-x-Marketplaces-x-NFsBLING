'use strict';
// b777 — T-02: um PostgreSQL 16 DE VERDADE, descartavel, com o SCHEMA DE PRODUCAO.
//
// O PostgREST falso (test/_postgrest-falso.js) imita o protocolo, mas nao tem constraint, FK, sequencia, RLS nem
// DDL — e foi assim que dois problemas reais passaram: 7 tabelas sem coluna `id` (achadas so no ensaio do backup no
// Render, b774) e as tabelas da Girassol numerando com a sequencia da AMB (achadas no export do schema, 20/11).
//
// Este harness sobe um Postgres numa pasta temporaria (initdb + pg_ctl, porta livre, socket proprio), cria os papeis
// do Supabase (anon, authenticated, service_role) e carrega `sql/schema-producao-2026-11-20.json` — o export do
// SQL Editor do projeto real (colunas na ordem, defaults, constraints, FKs, indices, RLS, dono de cada sequencia).
// O DDL e GERADO desse JSON aqui (uma fonte so: quando o schema mudar, exporta de novo e troca o arquivo).
//
// Uso:  const pg = await subirPostgres();  pg.sql('select 1')  → stdout do psql;  pg.parar()
// Precisa dos binarios do PostgreSQL 16 (o runner ubuntu do GitHub ja tem; aqui em /usr/lib/postgresql/16/bin).
// Rodando como root (container), o servidor sobe como o usuario `postgres` (o initdb recusa root).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync, spawnSync } = require('child_process');

const SCHEMA = path.join(__dirname, '..', 'sql', 'schema-producao-2026-11-20.json');

function binarios() {
  const candidatos = [];
  try { candidatos.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()); } catch (e) { /* sem pg_config */ }
  try { for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) candidatos.push('/usr/lib/postgresql/' + v + '/bin'); } catch (e) { /* sem a pasta */ }
  const dir = candidatos.find((d) => fs.existsSync(path.join(d, 'initdb')) && fs.existsSync(path.join(d, 'pg_ctl')));
  if (!dir) throw new Error('PostgreSQL nao encontrado (initdb/pg_ctl) — o teste precisa do Postgres 16 instalado');
  return { initdb: path.join(dir, 'initdb'), pgctl: path.join(dir, 'pg_ctl'), psql: fs.existsSync(path.join(dir, 'psql')) ? path.join(dir, 'psql') : 'psql' };
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

/* gera o DDL do export: sequencias → tabelas (colunas) → PK/UNIQUE/CHECK → FKs → indices → RLS → dono das sequencias */
function ddlDoSchema(lista) {
  const seqs = new Set(), tabelas = [], cons = [], fks = [], idxs = [], rls = [], donos = [];
  for (const t of lista) {
    const linhas = String(t.estrutura).split('\n');
    const nomesCon = new Set();
    const cols = [];
    for (const l of linhas) {
      const [k, ...resto] = l.split(' '); const r = resto.join(' ');
      if (k === 'col') {
        cols.push('  ' + r);
        for (const m of r.matchAll(/nextval\('([^']+)'::regclass\)/g)) seqs.add(m[1]);
      } else if (k === 'con') {
        const nome = resto[0]; const def = resto.slice(1).join(' '); nomesCon.add(nome);
        (/^FOREIGN KEY/.test(def) ? fks : cons).push(`alter table public.${t.tabela} add constraint ${nome} ${def};`);
      } else if (k === 'idx') {
        const m = /^CREATE (?:UNIQUE )?INDEX (\S+) ON/.exec(r);
        if (m && !nomesCon.has(m[1])) idxs.push({ nome: m[1], sql: r + ';' });
      } else if (k === 'rls') {
        if (r === 'ligado') rls.push(`alter table public.${t.tabela} enable row level security;`);
      } else if (k === 'seq') {
        const m = /^(\S+) pertence a (\S+)\.(\S+)$/.exec(r);
        if (m) donos.push(`alter sequence public.${m[1]} owned by public.${m[2]}.${m[3]};`);
      }
    }
    tabelas.push({ nome: t.tabela, sql: `create table public.${t.tabela} (\n${cols.join(',\n')}\n);`, nomesCon });
  }
  // indice com o mesmo nome de uma constraint de OUTRA linha (pkey/unique) ja nasce com a constraint
  const todasCons = new Set(); for (const t of tabelas) for (const n of t.nomesCon) todasCons.add(n);
  return [
    ...[...seqs].sort().map((s) => `create sequence public.${s};`),
    ...tabelas.map((t) => t.sql),
    ...cons, ...fks,
    ...idxs.filter((i) => !todasCons.has(i.nome)).map((i) => i.sql),
    ...rls, ...donos,
  ].join('\n');
}

async function subirPostgres({ comSchema = true } = {}) {
  const b = binarios();
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-descartavel-'));
  const dados = path.join(base, 'dados'), sock = path.join(base, 'sock');
  fs.mkdirSync(dados); fs.mkdirSync(sock);
  if (root) { fs.chmodSync(base, 0o755); execFileSync('chown', ['-R', 'postgres:postgres', base]); }
  const como = (cmd, args, opts = {}) => (root
    ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], Object.assign({ encoding: 'utf8' }, opts))
    : spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts)));
  const porta = await portaLivre();
  let r = como(b.initdb, ['-D', dados, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  if (r.status !== 0) throw new Error('initdb falhou: ' + (r.stderr || r.stdout));
  r = como(b.pgctl, ['-D', dados, '-w', '-t', '30', '-l', path.join(base, 'log'), '-o', `-p ${porta} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start']);
  if (r.status !== 0) throw new Error('pg_ctl start falhou: ' + (r.stderr || r.stdout) + '\n' + (fs.existsSync(path.join(base, 'log')) ? fs.readFileSync(path.join(base, 'log'), 'utf8') : ''));

  /* roda SQL; erro do Postgres = exception com a mensagem (ON_ERROR_STOP). `tudo` devolve stdout+stderr (NOTICEs) */
  const sql = (texto, { tudo = false, semErro = false } = {}) => {
    const x = spawnSync(b.psql, ['-h', sock, '-p', String(porta), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: texto, encoding: 'utf8' });
    if (x.status !== 0 && !semErro) throw new Error('psql: ' + (x.stderr || x.stdout).trim());
    return semErro ? { ok: x.status === 0, saida: x.stdout, erro: x.stderr } : (tudo ? x.stdout + x.stderr : x.stdout.trim());
  };
  const parar = () => {
    como(b.pgctl, ['-D', dados, '-m', 'immediate', 'stop']);
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* temporario */ }
  };
  try {
    sql(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
    if (comSchema) sql(ddlDoSchema(JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))));
  } catch (e) { parar(); throw e; }
  return { sql, parar, porta, ddlDoSchema };
}

module.exports = { subirPostgres, ddlDoSchema, SCHEMA };
