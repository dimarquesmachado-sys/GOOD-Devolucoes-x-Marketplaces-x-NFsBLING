// b567 (Codex #460): dois codigos de postagem com os MESMOS digitos (DA597697016BR e XY597697016ZW) —
// bipar o codigo completo do segundo tem que achar o segundo, nao o primeiro.
// Roda com: node test/magalu-codigo-completo.test.js
process.env.AMB_MAGALU_ACCESS_TOKEN = 'x';
const axios = require('axios');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

axios.get = async (url) => {
  const data = (r) => ({ status: 200, data: r });
  if (/\/tickets\/T1\/returns/.test(url)) return data({ results: [{ reverse_code: 'DA597697016BR' }] });
  if (/\/tickets\/T2\/returns/.test(url)) return data({ results: [{ reverse_code: 'XY597697016ZW' }] });
  if (/\/tickets\?/.test(url)) return data({ results: [
    { id: 'T1', protocol: '2026100100000001', order: { code: 'PED1' } },
    { id: 'T2', protocol: '2026100100000002', order: { code: 'PED2' } },
  ] });
  return data({ results: [] });
};

const { criar } = require('../amb-devolucoes/lib-AMB/magalu-AMB.js');
const magalu = criar({ PREFIXO_ENV: 'AMB_' });

(async () => {
  await magalu.construirIndiceDevolucoes();
  const a = await magalu.acharDevolucao('DA597697016BR');
  const b = await magalu.acharDevolucao('XY597697016Zw');
  const soNum = await magalu.acharDevolucao('597697016');
  ok(a && a.ticket_id === 'T1', 'codigo completo do 1o acha o 1o');
  ok(b && b.ticket_id === 'T2', 'codigo completo do 2o (mesmos digitos, caixa mista) acha o 2o');
  ok(soNum && soNum.ticket_id === 'T1', 'so os digitos continua achando (o primeiro indexado)');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
