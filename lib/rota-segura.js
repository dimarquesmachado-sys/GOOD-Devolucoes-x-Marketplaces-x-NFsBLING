'use strict';
/**
 * lib/rota-segura.js  (b794, V-14)
 *
 * HANDLER `async` QUE ESTOURA NAO DERRUBA MAIS O PROCESSO.
 *
 * O Express 4 chama o handler e NAO olha a promessa que ele devolve. Um erro dentro de um handler `async`, fora de um
 * `try`, vira rejeicao sem dono — e o Node 22 ENCERRA O PROCESSO (o Render reinicia: ~1 minuto fora do ar, pras 3
 * empresas, por pedido). Medido em 21/11 com o server.js de verdade: `?campo[toString]=x` (o Express entrega um OBJETO
 * pra isso, e `String(objeto)` estoura) derrubava o processo em 46 rotas — duas delas PUBLICAS, sem sessao nenhuma.
 *
 * Consertar rota por rota deixaria a proxima rota nova com o mesmo furo. Aqui a classe fecha num ponto so:
 *
 *  - `instalar()`  — a rejeicao do handler vira `next(err)`, que e o que o Express 5 faz de fabrica. Vale pra todo app e
 *                    todo Router do processo (GOOD e fabrica), inclusive os tratadores de erro `async`.
 *  - `erroFinal()` — o ULTIMO middleware do app: o erro que sobrou vira uma resposta curta em JSON, sem pilha e sem
 *                    devolver o que o cliente mandou. Erro com status 4xx (corpo invalido, grande demais) continua 4xx.
 *
 * ⚠️ `instalar()` mexe numa peca INTERNA do Express 4 (`express/lib/router/layer`). Se um dia o Express mudar por
 * dentro, ela ESTOURA na subida (o deploy nao completa e a versao anterior segue no ar) em vez de subir sem a protecao —
 * e o test/rota-segura.test.js prova o comportamento com o Express instalado, antes de qualquer deploy.
 */
const MARCA = Symbol.for('devolucoes.rota-segura.instalada');

function instalar(Layer) {
  // eslint-disable-next-line global-require
  const L = Layer || require('express/lib/router/layer');
  const p = L && L.prototype;
  if (!p || typeof p.handle_request !== 'function' || typeof p.handle_error !== 'function') {
    throw new Error('rota-segura: o Express instalado nao tem a peca que esta protecao troca (router/layer) — confira a versao antes de subir');
  }
  if (p[MARCA]) return false;   // ja instalada neste processo
  const passar = (next) => (err) => next(err || new Error('o handler rejeitou sem dizer por que'));

  // Igual ao original do Express 4, mais a linha da promessa.
  p.handle_request = function handleSeguro(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();   // tratador de erro: nao e pra pedido comum
    try {
      const r = fn(req, res, next);
      if (r && typeof r.then === 'function') r.then(undefined, passar(next));
    } catch (err) { next(err); }
    return undefined;
  };
  p.handle_error = function handleErroSeguro(error, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(error);   // nao e tratador de erro: passa adiante
    try {
      const r = fn(error, req, res, next);
      if (r && typeof r.then === 'function') r.then(undefined, passar(next));
    } catch (err) { next(err); }
    return undefined;
  };
  p[MARCA] = true;
  return true;
}

/**
 * O ULTIMO middleware do app (depois de todas as rotas).
 * Registra UMA linha (metodo, caminho SEM a query — ela pode trazer chave —, a mensagem e de onde veio) e responde curto.
 * A MENSAGEM do erro tambem passa por `semSegredo`: erro de chamada a servico de fora costuma trazer o endereco chamado,
 * e a query desse endereco pode levar token/assinatura (`?access_token=…&sign=…`).
 */
function semSegredo(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\?[^\s'")\]]+/g, '?…')                       // a query de qualquer endereco
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 …')    // credencial de cabecalho
    .slice(0, 200);
}
function erroFinal({ registrar = console.error } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function erroDeRota(err, req, res, next) {
    if (res.headersSent) return next(err);   // a resposta ja comecou: so o Express pode encerrar a conexao
    const st = Number(err && (err.status || err.statusCode));
    const doCliente = st >= 400 && st < 500;   // corpo invalido / grande demais (body-parser) e afins
    if (!doCliente) {
      const onde = String((err && err.stack) || '').split('\n').slice(1, 3).map((l) => l.trim()).join(' | ');
      try {
        registrar('[erro-rota] ' + req.method + ' ' + String(req.baseUrl || '') + String(req.path || '') + ' — '
          + semSegredo((err && err.message) || err) + (onde ? ' — ' + onde : ''));
      } catch (e) { /* registrar nao pode impedir a resposta */ }
    }
    return res.status(doCliente ? st : 500).json({ ok: false, erro: doCliente ? 'pedido invalido' : 'erro interno — tente de novo' });
  };
}

module.exports = { instalar, erroFinal };
