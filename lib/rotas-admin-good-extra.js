'use strict';
/* b545 - UNIFICACAO DAS ROTAS DE ADMIN, passo 2: as rotas SO DA GOOD — a imagem do produto (pelo indice de produtos
   da GOOD) e a lista de depositos. Todo o resto das rotas de admin da GOOD vem agora da copia UNICA
   (amb-devolucoes/lib-AMB/rotas-admin-AMB.js), a mesma da AMB/Girassol. Codigo movido sem mudanca de lib/rotas-admin-nf.js. */
module.exports = function registrarRotasGoodExtra(app, deps) {
  const { chamarBling, sleep, requerAdmin, adminOk } = deps;
  const IMG_CACHE = new Map();      // idProduto -> url|null

  // b300 - ⚠️ ORCAMENTO DE CHAMADAS PRA FOTO.
  //
  // A lista de defeitos pede foto de ate 12 produtos DE UMA VEZ, e cada um
  // tenta ate 4 caminhos no Bling. Sao ~50 chamadas simultaneas — e quando
  // acrescentei a 5a tentativa (o pai da variacao), a cota estourou e o
  // Bling recusou TODAS. O dono viu "sumiram todas as imagens": eu tornei
  // pior o que vim consertar.
  //
  // ⚠️ FOTO E ENFEITE E NAO PODE ATROPELAR A BIPAGEM, que divide a mesma
  // cota. Entao a tentativa EXTRA (a do pai) so roda se sobrou orcamento na
  // janela: no maximo 6 por minuto, o resto fica sem foto e pronto.
  //
  // 📌 As 3 tentativas originais seguem sem limite — elas ja existiam e nao
  // foram o que quebrou.
  let _gastoFoto = { min: 0, n: 0 };
  const TETO_FOTO_POR_MIN = Number(process.env.FOTO_EXTRA_POR_MIN || 6);
  function podeGastarNaFoto() {
    const agora = Math.floor(Date.now() / 60000);
    if (_gastoFoto.min !== agora) _gastoFoto = { min: agora, n: 0 };
    if (_gastoFoto.n >= TETO_FOTO_POR_MIN) return false;
    _gastoFoto.n += 1;
    return true;
  }

  // v4.32 - COPIADO DO CHECKOUT OFFLINE (produtos.js/primeiraImagem), que
  // ja busca imagem do Bling ha meses. O extrator anterior exigia que a
  // URL terminasse em .jpg/.png — e as do Bling nem sempre tem extensao;
  // e nao olhava midia.imagens.imagensURL[].
  function primeiraImagem(prod) {
    if (!prod) return null;
    if (prod.imagemURL) return prod.imagemURL;
    const ext = prod.midia && prod.midia.imagens && prod.midia.imagens.externas;
    if (ext && ext[0] && ext[0].link) return ext[0].link;
    const url = prod.midia && prod.midia.imagens && prod.midia.imagens.imagensURL;
    if (url && url[0] && (url[0].link || url[0])) return url[0].link || url[0];
    const int = prod.midia && prod.midia.imagens && prod.midia.imagens.internas;
    if (int && int[0] && int[0].link) return int[0].link;
    return null;
  }

  app.get('/api/produto/imagem/:id', async (req, res) => {
    // trava leve: precisa estar logado (admin OU estoquista). So devolve
    // a URL de uma foto de produto - o mesmo dado que a busca ja mostra.
    const logado = adminOk(req) || !!(req.cookies && req.cookies.sessao);
    if (!logado) return res.status(401).json({ ok: false, erro: 'faca login' });

    const chave = String(req.params.id || '').trim();
    if (!chave) return res.status(400).json({ ok: false, erro: 'informe o sku ou o id' });
    // b517 (Codex #426): o produtoId da NF vale mais que o SKU (pode ter sido renomeado/reaproveitado);
    // o cache tambem e por id, senao a 2a devolucao com o mesmo SKU herdaria a foto da 1a
    const idNota = String(req.query.produtoId || '').replace(/\D/g, '');
    const chaveCache = idNota ? ('id:' + idNota) : chave;
    if (IMG_CACHE.has(chaveCache)) return res.json({ ok: true, id: chave, imagem: IMG_CACHE.get(chaveCache), cache: true });

    // b315 - ⚠️ O INDICE LOCAL VEM ANTES DO BLING.
    //
    // [stated 13/09] "a foto dos produtos na tela com defeitos não tá
    // aparecendo"
    //
    // Esta rota ia no Bling SEMPRE, e o /health mostra a conta com
    // `pausa_ativa: true`. Com a pausa, toda chamada de foto falha — e a
    // lista pede ate 12 de uma vez.
    //
    // O indice ja tem as imagens (1091 produtos). Consulto ele primeiro;
    // o Bling fica pro que o indice nao tiver.
    // b517: com o id da NF o indice (por SKU) nao e confiavel — a foto vem do detalhe por id, mais abaixo
    if (!idNota && typeof deps.fotoDoIndice === 'function') {
      var doIndice = deps.fotoDoIndice(chave);
      if (doIndice) {
        IMG_CACHE.set(chaveCache, doIndice);
        return res.json({ ok: true, id: chave, imagem: doIndice, via: 'indice' });
      }
    }

    // revisao Codex #278 (P1): a tela de defeitos agora pede foto de ATE 60
    // itens (b320, antes eram 12) - e quem nao esta no indice cai no bloco
    // de baixo, que faz ATE 4 chamadas SEM limite ao Bling (listar por
    // codigo, EAN, nome, detalhe). 60 pedidos "frios" de uma vez = ate ~240
    // chamadas Bling, disputando a MESMA cota da bipagem.
    //
    // ⚠️ apontamento do Codex: este corte tem que vir ANTES do
    // anotarFotoPedida/espera abaixo. anotarFotoPedida poe o SKU na fila
    // PRIORITARIA do passo de detalhe (server.js) — ou seja, mesmo sem
    // cair no fallback sincrono, o pedido ainda furava a fila e gastava
    // cota em BACKGROUND pros 34 itens que o semBling deveria poupar.
    //
    // Quem pedir com `semBling=1` aceita ficar so com o que o indice ja tem
    // - sem essa flag nada muda, o fallback completo (e a prioridade de
    // fila) continua igual pras outras chamadas desta rota
    // (lancar-defeito.js, busca.js).
    if (req.query.semBling) {
      // ⚠️ b321 - PRIORIZA O WORKER ANTES DE RESPONDER.
      //
      // Sem isto, o `semBling` respondia vazio e NINGUEM produzia a foto:
      // a tela voltava em rodadas e recebia vazio pra sempre.
      //
      // ⚠️ Isto NAO abre chamada ao Bling — so muda a ORDEM da fila do
      // worker, que ja percorreria o catalogo inteiro de qualquer jeito,
      // no ritmo de um detalhe por vez. A bipagem nao perde cota.
      if (typeof deps.anotarFotoPedida === 'function') deps.anotarFotoPedida(chave);
      // ⚠️ b321.2 (Codex, P2) - A VARIACAO ORFA NAO TEM COMO GANHAR FOTO.
      //
      // O `fotoDoIndice` ja tenta o pai — mas SO se o pai estiver no
      // indice. Quando nao esta (catalogo grande, pai inativo), a variacao
      // fica sem foto em TODAS as 12 rodadas: o worker vai buscar o detalhe
      // DELA, e o detalhe da variacao nao tem imagem propria.
      //
      // Entao respondo dizendo que o indice nao resolve este caso. A tela
      // usa isso pra parar de insistir nele — e quem quiser a foto pede sem
      // `semBling` (o modal de lançar defeito faz isso).
      return res.json({
        ok: true, id: chave, imagem: null,
        via: 'sem_indice_sem_bling',
        // ⚠️ a tela le isto pra nao gastar 11 rodadas com quem nao vai vir
        definitivo: !!(typeof deps.indiceTemProduto === 'function'
          && deps.indiceTemProduto(chave)),
      });
    }

    // b316 - ⚠️ registra o pedido: quem a TELA pediu vai pra FRENTE da
    // fila do passo de detalhes.
    //
    // A listagem do Bling nao traz imagem — so o detalhe. Sao 1091
    // produtos a 350ms = 6,4 min de varredura, e o Render reinicia antes
    // de terminar. Sem prioridade, as poucas chamadas que passam sao
    // gastas em produtos que ninguem esta olhando.
    //
    // revisao Codex #272 (P2): so registra AQUI, depois que o indice ja
    // disse que nao tem a foto agora. Registrar antes (como a 1a versao
    // fazia) furava a fila de detalhe com produtos que o indice ja tinha
    // imagem pronta pra devolver — gastando cota de Bling com quem nao
    // precisava.
    if (typeof deps.anotarFotoPedida === 'function') {
      deps.anotarFotoPedida(chave);

      // revisao Codex #272 (P1): SO REGISTRAR NAO ENTREGAVA a foto pra
      // ESTA tela. O passo de detalhe (agora priorizado) so atualiza o
      // indice em BACKGROUND, e esta rota responde uma vez so — sem essa
      // espera curta, a tela so ganharia a foto num recarregamento
      // manual, mesmo com a prioridade funcionando certinho. Como o item
      // acabou de furar a fila, ele e o PROXIMO a ser processado (ritmo
      // de ~350ms, v4.67); espero 2 rodadas antes de cair no caminho
      // sincrono de baixo (que TAMBEM chama o Bling e tambem falha
      // quando a conta esta em pausa — o cenario que esta prioridade
      // veio resolver).
      if (!idNota && typeof deps.fotoDoIndice === 'function') {
        for (let tentativa = 0; tentativa < 2; tentativa++) {
          await sleep(300);
          const doIndicePriorizado = deps.fotoDoIndice(chave);
          if (doIndicePriorizado) {
            IMG_CACHE.set(chaveCache, doIndicePriorizado);
            return res.json({ ok: true, id: chave, imagem: doIndicePriorizado, via: 'indice_priorizado' });
          }
        }
      }
    }

    try {
      // b517 (Codex #426): com o id da NF, o detalhe vem POR ID — sem passar por SKU/EAN/nome (que podem
      // apontar outro produto). Sem foto/erro, segue pelo SKU (comportamento de antes).
      // b590.1 (Codex #473): sem cota, o id da NF NAO cai no SKU (o filtro do Bling pode ser ignorado e o porCodigo[0]
      // viraria outro produto); responde sem foto e sem cachear — a proxima bipagem tenta de novo.
      if (idNota && !podeGastarNaFoto()) {
        return res.json({ ok: true, id: chave, imagem: null, via: null, motivo: 'sem cota de foto agora; o id da NF nao cai no SKU', produto_id: idNota });
      }
      if (idNota) {
        const rId = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(idNota)}`);
        if (rId.ok) {
          const det = (rId.data && rId.data.data) || null;
          let u = primeiraImagem(det);
          let viaId = 'detalhe_por_id';
          const paiDaNota = det && det.produtoPai && det.produtoPai.id;
          if (!u && paiDaNota && podeGastarNaFoto()) {
            const rPai = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(paiDaNota)}`);
            if (rPai.ok) { u =primeiraImagem((rPai.data && rPai.data.data) || null); viaId = 'pai_da_variacao'; }
          }
          if (u) {
            IMG_CACHE.set(chaveCache, u);
            return res.json({ ok: true, id: chave, imagem: u, via: viaId, produto_id: idNota });
          }
        }
      }
      // v4.31 - a tela do resultado pede pelo SKU (e o que ela tem do item
      // da NF); o modal de defeito pede pelo id. Aceita os dois.
      // mesmo caminho do checkout offline: lista por codigo (que ja pode
      // trazer imagemURL) e, se precisar, abre o detalhe do produto
      // v4.50 - NUMERO NAO E ID. Existe SKU so de digitos (ex: 3933398010054);
      // assumindo que numero = id, a rota pedia /produtos/<sku>, nao achava e a
      // foto vinha vazia. Tenta pelo CODIGO primeiro, depois EAN, e so entao id.
      // ═══════════════════════════════════════════════════════════════
      // v4.52 - MESMO CAMINHO DO CHECKOUT OFFLINE, que funciona:
      //   1. lista por codigo (a lista ja costuma trazer imagemURL)
      //   2. se nao veio, busca o DETALHE do produto pelo id
      //   3. ainda nada? tenta por EAN e por nome
      // E devolve o MOTIVO quando nao acha - sem isso, "imagem: null"
      // pode ser produto inexistente, falta de escopo no token do Bling
      // ou produto sem foto, e nao da pra saber qual.
      // ═══════════════════════════════════════════════════════════════
      let id = null;
      let url = null;
      let via = null;
      let motivo = null;

      const listar = async (filtro) => {
        const r = await chamarBling(`https://api.bling.com.br/Api/v3/produtos?${filtro}&limite=3`);
        if (!r.ok) { motivo = motivo || ('bling recusou a listagem (' + (r.status || '?') + ')'); return []; }
        return (r.data && r.data.data) || [];
      };

      // 1) pelo codigo
      const porCodigo = await listar(`codigo=${encodeURIComponent(chave)}`);
      let prod = porCodigo.find(p => String(p.codigo || '').toUpperCase() === chave.toUpperCase())
        || porCodigo[0] || null;
      if (prod) { url = primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_codigo'; }

      // 2) EAN, quando o termo tem cara de codigo de barras
      if (!prod && /^\d{8,14}$/.test(chave)) {
        const porEan = await listar(`gtin=${encodeURIComponent(chave)}`);
        prod = porEan[0] || null;
        if (prod) { url = url || primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_ean'; }
      }

      // 3) pelo nome - o SKU da triagem as vezes nao e o codigo do Bling
      if (!prod) {
        const porNome = await listar(`pesquisa=${encodeURIComponent(chave)}`);
        prod = porNome[0] || null;
        if (prod) { url = url || primeiraImagem(prod); id = prod.id || null; if (url) via = 'lista_nome'; }
      }

      if (!prod && !id && /^\d{6,}$/.test(chave)) id = chave;   // era um id mesmo

      // 4) o DETALHE do proprio produto, que e onde a foto quase sempre esta
      let detalhe = null;
      if (!url && id) {
        const rD = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(id)}`);
        if (!rD.ok) {
          motivo = 'o Bling recusou o detalhe do produto (' + (rD.status || '?')
            + ') - se for 401/403, e falta do escopo Produtos no token';
        } else {
          detalhe = (rD.data && rD.data.data) || null;
          url = primeiraImagem(detalhe);
          if (url) via = 'detalhe';
        }
      }

      // b299 - ⚠️ 5) O PRODUTO PAI DA VARIACAO.
      //
      // CASO REAL (11/09): varios defeitos sem foto, e o padrao saltou no
      // print — `288-VAR`, `801s-BP`, `RA-45-GOLD-ASH`. Todos VARIACOES.
      // No Bling a foto da variacao costuma estar no PAI.
      //
      // ⚠️ NO BLING, A FOTO DA VARIACAO COSTUMA ESTAR NO PAI. A variacao
      // herda visualmente, mas o registro dela vem sem imagem propria — e
      // as tentativas acima (lista + detalhe do PROPRIO produto) procuravam
      // so por ela.
      //
      // v8.3.2 (revisao do Codex no #254) - a 1a versao ADIVINHAVA o pai
      // cortando o sufixo da SKU no texto (`288-VAR` -> `288`), rodava ANTES
      // do detalhe do proprio produto (podia esconder a foto de verdade da
      // variacao) e aceitava o 1o item da listagem por esse codigo
      // adivinhado sem checar se batia (`porPai[0]`) — pra um SKU comum
      // como `ABC-RED`, um produto `ABC` qualquer no cadastro virava "o pai"
      // e a foto errada ficava fixa no cache. Agora: so entra aqui depois
      // que lista + detalhe do proprio produto ja procuraram e nao acharam
      // foto, e o pai vem do campo `produtoPai` que o proprio Bling devolve
      // (lista ou detalhe) — nunca de um palpite em cima do texto da SKU.
      // E busca o DETALHE do pai (a listagem nao traz imagem).
      if (!url) {
        const idPai = (detalhe && detalhe.produtoPai && detalhe.produtoPai.id)
          || (prod && prod.produtoPai && prod.produtoPai.id)
          || null;
        // ⚠️ b301.2: junto o ORCAMENTO ao conserto do robo.
        //
        // A abordagem dele e melhor que a minha — o Bling DIZ quem e o pai
        // (`produtoPai.id`), em vez de eu adivinhar cortando o sufixo da SKU
        // (que faria `ABC-RED` herdar foto de um `ABC` sem parentesco).
        //
        // Mas ela ainda gasta UMA chamada por produto sem foto, e a lista
        // pede 12 de uma vez. Foi assim que a cota estourou e TODAS as fotos
        // sumiram. Entao mantenho o teto: foto e enfeite e nao pode
        // atropelar a bipagem, que divide a mesma cota.
        if (idPai && podeGastarNaFoto()) {
          const rPai = await chamarBling(`https://api.bling.com.br/Api/v3/produtos/${encodeURIComponent(idPai)}`);
          if (rPai.ok) {
            const u = primeiraImagem((rPai.data && rPai.data.data) || null);
            if (u) { url = u; via = 'pai_da_variacao'; if (!id) id = idPai; }
          }
        }
      }

      if (!url && (prod || detalhe)) motivo = motivo || 'produto encontrado, mas sem foto cadastrada no Bling';
      if (!prod && !url) motivo = motivo || 'nenhum produto com esse codigo, EAN ou nome no Bling desta empresa';

      // so cacheia SUCESSO - falha passageira nao pode fixar o vazio
      if (url) IMG_CACHE.set(chaveCache, url);
      res.json({ ok: true, id: chave, imagem: url, via, motivo, produto_id: id || null });

    } catch (e) {
      res.status(500).json({ ok: false, erro: String(e.message || e) });
    }
  });

  let _depCacheGood = { ts: 0, lista: [] };
  async function _listarDepositosGood(forcar) {
    if (!forcar && _depCacheGood.ts && (Date.now() - _depCacheGood.ts) < 10 * 60 * 1000) {
      return { ok: true, depositos: _depCacheGood.lista, cache: true };
    }
    // Codex #405 (P2): paginado — conta com mais de 100 depositos nao pode ter a lista cortada na 1a pagina
    const brutos = [];
    for (let pg = 1; pg <= 10; pg++) {
      const r = await chamarBling('https://api.bling.com.br/Api/v3/depositos?limite=100&pagina=' + pg);
      if (!r.ok) return { ok: false, status: r.status, erro: 'Bling nao devolveu os depositos (pagina ' + pg + ')' };
      const pag = (r.data && r.data.data) || [];
      brutos.push(...pag);
      if (pag.length < 100) break;
    }
    const lista = brutos.map(d => ({
      id: String(d.id), descricao: d.descricao || ('deposito ' + d.id), padrao: !!d.padrao, situacao: d.situacao != null ? d.situacao : null,
    }));
    _depCacheGood = { ts: Date.now(), lista };
    return { ok: true, depositos: lista };
  }
  app.get('/api/depositos', requerAdmin, async (req, res) => {
    try { res.json(Object.assign({ ok: true }, await _listarDepositosGood(req.query.refresh === '1'))); }
    catch (e) { res.status(500).json({ ok: false, erro: e.message || 'erro interno' }); }
  });
  // a lista viva de depositos da GOOD, pra copia unica das rotas (mesmo contrato do bling-AMB.listarDepositos)
  return { listarDepositos: _listarDepositosGood };
};
