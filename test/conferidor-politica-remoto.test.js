'use strict';
// ⚠️ O CONFERIDOR PRECISA ENTENDER A POLÍTICA DE TOKEN.
//
// O refresh do Bling e do ML é de USO ÚNICO. O desenho eleito é UM dono (o
// Mover-Pedidos) renovando e os outros LENDO. Copiar o refresh para cá criaria
// um segundo escritor — a corrida que já deu `403 ... o do ML é de uso único`
// no log do dono.
//
// 📌 Então em `remoto` o conferidor:
//   - NÃO exige o refresh local (vem do dono)
//   - PASSA A EXIGIR a chave de leitura (sem ela nenhuma chamada sai)
//
// ⚠️ Os dois juntos. Dispensar o refresh sem exigir a chave seria trocar um
// pedido por um buraco: `pronta: true` e nenhuma chamada funcionando.

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const limpo = () => {
  for (const k of Object.keys(require.cache)) {
    if (/lib[/\\](empresas|token-leitor)\.js$/.test(k)) delete require.cache[k];
  }
  return require('../lib/empresas');
};
const guardadas = {};
const por = (envs) => {
  for (const k of ['TOKEN_POLITICA_GIRASSOL_BLING', 'TOKEN_POLITICA_GIRASSOL_ML',
                   'ADMIN_TOKEN_LEITURA_KEY', 'SUPABASE_URL', 'SUPABASE_KEY']) {
    if (!(k in guardadas)) guardadas[k] = process.env[k];
    if (envs[k] === undefined) delete process.env[k];
    else process.env[k] = envs[k];
  }
  return limpo();
};
const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' };

// ── em `sombra` (o padrão), o refresh CONTINUA obrigatório ──────────
{
  const { conferirEmpresa } = por({ ...base });
  const r = conferirEmpresa('girassol');
  ok(r.envsFaltando.some((e) => /BLING_REFRESH_TOKEN/.test(e)),
     '⚠️ em `sombra` o refresh do Bling CONTINUA obrigatorio');
  ok(r.envsFaltando.some((e) => /ML_REFRESH_TOKEN/.test(e)),
     '  e o do ML tambem (a empresa renova ela mesma)');
  ok(!r.envsFaltando.some((e) => /LEITURA/.test(e)),
     '  e a chave de leitura NAO e exigida (ninguem le do dono)');
}

// ── em `remoto`, o refresh sai e a chave entra ──────────────────────
{
  const { conferirEmpresa } = por({
    ...base,
    TOKEN_POLITICA_GIRASSOL_BLING: 'remoto',
    TOKEN_POLITICA_GIRASSOL_ML: 'remoto',
  });
  const r = conferirEmpresa('girassol');
  ok(!r.envsFaltando.some((e) => /REFRESH_TOKEN/.test(e)),
     '⚠️ em `remoto` o refresh NAO e exigido (vem do dono)');
  ok(r.envsFaltando.some((e) => /ADMIN_TOKEN_LEITURA_KEY/.test(e)),
     '⚠️ mas a CHAVE DE LEITURA passa a ser (senao nenhuma chamada sai)');

  // os client id/secret continuam: sao da APLICACAO, não do token rotativo
  ok(r.envsFaltando.some((e) => /BLING_CLIENT_ID/.test(e)),
     '  e os client id/secret continuam obrigatorios');
}

// ── ⚠️ um eixo em remoto e o outro não ──────────────────────────────
//
// Dispensar o refresh dos DOIS quando só um está remoto deixaria a empresa
// sem o refresh de que ela ainda precisa.
{
  const { conferirEmpresa } = por({
    ...base,
    TOKEN_POLITICA_GIRASSOL_BLING: 'remoto',
    ADMIN_TOKEN_LEITURA_KEY: 'chave',
  });
  const r = conferirEmpresa('girassol');
  ok(!r.envsFaltando.some((e) => /BLING_REFRESH_TOKEN/.test(e)),
     '⚠️ so o eixo REMOTO dispensa o refresh');
  ok(r.envsFaltando.some((e) => /ML_REFRESH_TOKEN/.test(e)),
     '⚠️ o eixo em sombra CONTINUA exigindo o dele');
}

// ── e a AMB não é afetada ───────────────────────────────────────────
{
  const { conferirEmpresa } = por({ ...base });
  const r = conferirEmpresa('ambtotal');
  ok(Array.isArray(r.envsFaltando), '  o conferidor da AMB segue respondendo');
}

for (const [k, v] of Object.entries(guardadas)) {
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
