// b658 - A LISTA DAS INSTANCIAS (AMB/Girassol) CORRIGE O CANAL PELO PEDIDO,
// como a GOOD ja fazia desde 31/10 (nivelar por cima). Registro antigo sem
// canal (ou com o chute 'mercadolivre') e pedido no padrao ML tem que sair
// da rota DE PRODUCAO com marketplace 'ml' e marketplace_corrigido — e canal
// preenchido de outro marketplace tem que sair INTACTO.
const assert = require('assert');
const express = require('express');
const { criar } = require('../amb-devolucoes/lib-AMB/compat-AMB');

// O desenho da peca (igual na GOOD): corrige quando o detector AFIRMA outro
// canal; pedido de ML (ou formato que ele nao afirma) fica como esta — o
// rotulo ML a lista/relatorio ja unificam.
const REGS = [
  { id: 1, marketplace: 'mercadolivre', order_id: '702-1234567-1234567', problema_descricao: null },  // chute antigo em cima de AMAZON
  { id: 2, marketplace: 'shopee', order_id: 'BR12345ABC', problema_descricao: null },                  // preenchido: intacto
  { id: 3, marketplace: null, order_id: '2000012345678901', problema_descricao: null },                // pedido ML: fica como esta
];
const stubFn = async () => ({ ok: true, registros: [] });
const db = new Proxy({
  listarFila: async ({ status }) => ({ ok: true, registros: status === 'aprovado' ? REGS : [] }),
  conectar: null,            // cruzamento parcial cai no catch e segue
  tabelas: { devolucoes: 'devolucoes_girassol' },
}, { get: (t, k) => (k in t ? t[k] : stubFn) });
const auth = new Proxy({
  requerLogin: (req, res, next) => next(),
  validarSessao: () => ({ usuario: 'teste', nivel: 'admin' }),
  tokenDaRequisicao: () => 't',
}, { get: (t, k) => (k in t ? t[k] : ((req, res, next) => (typeof next === 'function' ? next() : null))) });

// deps que o montar() toca no REGISTRO das rotas (multer, etc) ganham um stub
// camaleao: chamavel e com qualquer propriedade — as rotas registram, e so a
// que o teste chama precisa de comportamento real (db/auth acima).
const camaleao = new Proxy(function () {}, {
  get: (t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : camaleao),
  apply: () => camaleao,
});

(async () => {
  const compat = criar({ chave: 'girassol', nome: 'Girassol', prefixoEnv: 'GIRASSOL_' });
  const router = express.Router();
  const deps = new Proxy({ db, auth, chaveDados: 'girassol' },
    { get: (t, k) => (k in t ? t[k] : (typeof k === 'symbol' ? undefined : camaleao)) });
  compat.montar(router, deps);
  const app = express(); app.use(router);
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const porta = srv.address().port;
  const r = await fetch(`http://127.0.0.1:${porta}/api/admin/devolucoes`);
  const d = await r.json();
  srv.close();
  assert(d.ok, 'rota respondeu erro: ' + JSON.stringify(d));
  const porId = Object.fromEntries(d.aprovadas.map((x) => [x.id, x]));
  assert.strictEqual(porId[1].marketplace, 'amazon', 'chute mercadolivre em pedido Amazon devia sair corrigido, veio: ' + porId[1].marketplace);
  assert(porId[1].marketplace_corrigido === true, 'devia marcar marketplace_corrigido');
  assert.strictEqual(porId[2].marketplace, 'shopee', 'canal preenchido tinha que sair INTACTO');
  assert.strictEqual(porId[3].marketplace, null, 'pedido de ML fica como esta (paridade com a GOOD)');
  console.log('instancias-lista-corrige-canal: OK');
})().catch((e) => { console.error(e); process.exit(1); });
