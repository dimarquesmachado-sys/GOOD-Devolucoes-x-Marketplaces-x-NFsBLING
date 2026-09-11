// ════════════════════════════════════════════════════════════════════════
//  lancar-defeito.js — o modal "Lançar produto com defeito", COMPARTILHADO
//  ----------------------------------------------------------------------
//  ⚠️ POR QUE ESTE ARQUIVO EXISTE
//
//  O modal vivia inline no `index.html` (a tela de Triagem). O painel admin
//  (`painel-devolucoes.html`) carrega a MESMA caixa de Estoque de Defeitos,
//  mas nao tinha o modal — entao quem buscasse um SKU sem defeito ali
//  ficava sem caminho, ou era JOGADO pra outra tela.
//
//  [stated 11/09] "me tirou da tela do painel ADMIN qdo cliquei pra
//  adicionar produto e me jogou na tela de triagem. me deixa na mesma tela."
//
//  ⚠️ E NASCE MULTI-EMPRESA (regra da casa): o prefixo das rotas e
//  PARAMETRO, nao constante. A GOOD usa `/api/...`; a AMB usa `/amb/api/...`.
//  Empresa nova pluga passando o prefixo — sem copiar arquivo.
//
//  COMO USAR, em qualquer tela:
//    <script src="js/lancar-defeito.js?v=N"></script>
//    <script>LancarDefeito.instalar({ prefixo: '' });       // GOOD
//            LancarDefeito.instalar({ prefixo: '/amb' });   // AMB
//    </script>
//
//  O `instalar()` injeta o HTML do modal no fim do <body> se ele ainda nao
//  existir, e expoe `window.abrirModalDefeito(sku)` — que e o que a caixa
//  de Estoque de Defeitos procura pra decidir se mostra o botao.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ⚠️ o prefixo vive aqui e e lido por TODAS as chamadas. Sem ele, este
  // arquivo seria uma copia por empresa — o que a regra da casa manda evitar.
  // ⚠️ b290 - O ID `defBusca` COLIDIA, E A BUSCA DA CAIXA LIA O CAMPO ERRADO.
  //
  // CASO REAL (11/09): o dono buscou LV-ASH-4 no painel e a caixa devolveu
  // 45 pecas de SKUs variados — ignorando o termo.
  //
  // A causa: a caixa de Estoque de Defeitos procura `#defBusca` pro SEU
  // campo, e o modal injetado trazia um `#defBusca` proprio. Com os dois na
  // mesma pagina, `getElementById` devolve o PRIMEIRO — o do modal, vazio.
  // Busca vazia devolve tudo.
  //
  // ⚠️ ISSO SO APARECEU AGORA porque antes o modal vivia no index.html e a
  // caixa nunca dividia pagina com ele... exceto que dividia, e o index
  // funcionava por ORDEM no DOM. Sorte, nao desenho.
  //
  // Os ids do modal ganharam prefixo `lancDef`. Renomeei SO o que colide —
  // alteracao minima.
  var PREFIXO = '';
  var instalado = false;

  // b290 (revisao Codex #242) - ⚠️ O ESTADO E DO MODULO, NAO DO HOST.
  //
  // Isto era `_defProdutoEscolhido = null;` (SEM `var`) dentro de
  // `abrirModalDefeito`. No index.html funcionava por acidente: a tela
  // ainda declara `var _defProdutoEscolhido` no proprio inline script, e
  // essa var global e quem a atribuicao implicita encontrava.
  //
  // No painel-devolucoes.html essa declaracao nao existe em lugar nenhum.
  // Em modo estrito, atribuir a um identificador nunca declarado lanca
  // `ReferenceError` — e o lancamento morria ali, no primeiro clique.
  var _defProdutoEscolhido = null;

  var HTML_MODAL = "<div class=\"modal-bg\" id=\"modalDefeito\">\n    <div class=\"modal modal-defeito\" style=\"max-width: 940px;\">\n      <h3>\u2795 Lan\u00e7ar produto com defeito</h3>\n      <p style=\"font-size:13px; color:#666; margin-bottom:10px;\">Busca por <b>parte do nome</b>, SKU ou EAN e escolhe o produto certo na lista.</p>\n\n      <div style=\"display:flex; gap:8px;\">\n        <input type=\"text\" id=\"lancDefBusca\" placeholder=\"Ex: arandela 60, KJDD-E-187, 7898...\" style=\"flex:1; padding:11px; border:1px solid #ccc; border-radius:8px; font-size:15px;\" onkeydown=\"if(event.key==='Enter'){event.preventDefault();buscarProdutoDefeito();}\">\n        <button type=\"button\" onclick=\"buscarProdutoDefeito()\" style=\"background:#1565c0; color:#fff; border:none; border-radius:8px; padding:11px 18px; font-weight:700; cursor:pointer;\">\ud83d\udd0d</button>\n      </div>\n      <div id=\"defResultados\" style=\"margin-top:10px;\"></div>\n\n      <div id=\"defEscolhido\" style=\"display:none; margin-top:12px; background:#fff5f5; border:2px solid #ef9a9a; border-radius:10px; padding:12px;\">\n        <div style=\"display:flex; gap:10px; align-items:flex-start;\">\n          <div id=\"defImg\"></div>\n          <div style=\"flex:1; min-width:0;\">\n        <div style=\"font-size:14px;\"><b>Produto:</b> <span id=\"defNome\">-</span></div>\n        <div style=\"font-size:12px; color:#666; margin-top:3px;\">SKU <code id=\"defSku\">-</code> <span id=\"defEan\"></span></div>\n        <!-- v4.66 - os campos ficam AO LADO da foto, nao abaixo dela. Com a\n             foto de 260px, empilhado o quadro passava da tela e obrigava a\n             rolar (mesma correcao que a AMB ja tinha). -->\n        <div style=\"display:flex; gap:10px; margin-top:10px;\">\n          <div style=\"flex:2;\">\n            <label style=\"font-size:12px; color:#555; font-weight:600;\">Qual o defeito?</label>\n            <input type=\"text\" id=\"defProblema\" placeholder=\"Ex: globo trincado, n\u00e3o acende, falta pe\u00e7a\" style=\"width:100%; box-sizing:border-box; padding:9px; border:1px solid #ccc; border-radius:8px; font-size:14px;\">\n          </div>\n          <div style=\"width:90px;\">\n            <label style=\"font-size:12px; color:#555; font-weight:600;\">Qtd</label>\n            <input type=\"number\" id=\"defQtd\" value=\"1\" min=\"1\" max=\"999\" style=\"width:100%; box-sizing:border-box; padding:9px; border:1px solid #ccc; border-radius:8px; font-size:14px;\">\n          </div>\n        </div>\n        <!-- v4.51 - FOTOS no lancamento. Antes so a triagem do pacote gerava\n             foto e a peca lancada a mao ficava sem prova do estado. Vao pra\n             mesma coluna, entao a ficha mostra tudo junto. -->\n        <div style=\"margin-top:10px;\">\n          <label style=\"font-size:12px; color:#555; font-weight:600;\">\ud83d\udcf7 Fotos do defeito <span style=\"color:#888;font-weight:400;\">(opcional)</span></label>\n          <input type=\"file\" id=\"defFotos\" accept=\"image/*\" multiple capture=\"environment\"\n                 onchange=\"previewFotosDefeito()\"\n                 style=\"width:100%; box-sizing:border-box; padding:8px; border:1px dashed #ccc; border-radius:8px; font-size:13px; background:#fff;\">\n          <div id=\"defFotosPreview\" style=\"display:flex; gap:6px; flex-wrap:wrap; margin-top:7px;\"></div>\n        </div>\n        <div style=\"margin-top:8px;\">\n          <label style=\"font-size:12px; color:#555; font-weight:600;\">\ud83d\udccd Onde vai guardar <span style=\"color:#c62828;\">*obrigat\u00f3rio</span></label>\n          <input type=\"text\" id=\"defLocal\" placeholder=\"Ex: DEF-A3, prateleira 12...\" style=\"width:100%; box-sizing:border-box; padding:9px; border:1px solid #ccc; border-radius:8px; font-size:14px;\">\n        </div>\n          </div><!-- fecha a coluna da direita -->\n        </div><!-- fecha a linha foto + coluna -->\n      </div><!-- fecha o defEscolhido -->\n\n      <p id=\"defMsg\" style=\"font-size:13px; margin:8px 0 0;\"></p>\n\n      <div class=\"modal-acoes\" style=\"margin-top:14px;\">\n        <button type=\"button\" onclick=\"fecharModalDefeito()\" style=\"background:#999; color:#fff; border:none; border-radius:10px; padding:12px 20px; font-weight:700; cursor:pointer;\">Cancelar</button>\n        <button type=\"button\" id=\"defBtnSalvar\" onclick=\"salvarDefeitoManual()\" disabled style=\"background:#c62828; color:#fff; border:none; border-radius:10px; padding:12px 20px; font-weight:800; cursor:pointer; opacity:.5;\">\ud83d\udcbe Lan\u00e7ar defeito</button>\n      </div>\n    </div>\n  </div>";


  // b283 - ⚠️ ACEITA UM SKU DE PARTIDA.
  //
  // CASO REAL (11/09): o dono foi LANCAR um defeito do SKU LV-ASH-4.
  // Buscou no Estoque de Defeitos, leu "nada encontrado" (correto — nao
  // ha defeito desse SKU ainda) e o caminho morria ali. Ele teria que
  // fechar, abrir "Lancar Defeito" e digitar o SKU de novo.
  //
  // A tela sabia o SKU e nao oferecia nada. Agora o "nada encontrado"
  // traz o botao, e ele chega aqui ja preenchido.
  // b287 - ⚠️ EXPOSTA EXPLICITAMENTE NO `window`.
  //
  // `function x() {}` num `<script>` inline JA cria `window.x` — em
  // teoria. Mas a tela do dono disse "abrirModalDefeito nao esta
  // disponivel", e o `defeitos-ficha.js` (que chama) vive dentro de uma
  // IIFE, num arquivo EXTERNO carregado ANTES deste script.
  //
  // Nao vou depender de "em teoria" pela quarta vez: exponho no fim da
  // declaracao, igual o `defeitos-ficha.js` ja faz com
  // `window.fecharCaixaDefeitos` — que, nao por acaso, e o unico dos dois
  // que estava funcionando.
  function abrirModalDefeito(skuInicial) {
    // b284 - ⚠️ O MODAL ABRE PRIMEIRO, E A LIMPEZA E A PROVA DE FALHA.
    //
    // CASO REAL (11/09): o dono clicou "➕ Lançar defeito para LV-ASH-4",
    // a caixa de Defeitos FECHOU e o modal NAO ABRIU — ficou numa tela
    // vazia, sem erro visivel e sem caminho de volta.
    //
    // A causa: a limpeza rodava ANTES de `classList.add('show')`, e
    // varias linhas faziam `getElementById(x).value = ''` SEM conferir se
    // o elemento existe. Um unico id ausente lanca TypeError, a funcao
    // morre ali — e o modal nunca abre. Como quem chamou ja tinha fechado
    // a caixa, sobra tela vazia.
    //
    // ⚠️ DUAS MUDANCAS, e a ordem importa:
    //   1. ABRIR PRIMEIRO. Se a limpeza falhar, o dono ve o modal (talvez
    //      com sujeira do uso anterior) em vez de tela vazia. Modal sujo
    //      da pra usar; tela vazia, nao.
    //   2. cada acesso protegido — `const el = (id) => document...`
    const el = (id) => document.getElementById(id);
    const valor = (id, v) => { const n = el(id); if (n) n.value = v; };
    const html = (id, v) => { const n = el(id); if (n) n.innerHTML = v; };

    const caixa = el('modalDefeito');
    if (caixa) caixa.classList.add('show');

    try { limparKitPendente(); } catch (e) { /* v4.66 */ }
    _defProdutoEscolhido = null;
    const sku = String(skuInicial || '').trim();
    valor('lancDefBusca', sku);
    html('defResultados', '');
    if (el('defEscolhido')) el('defEscolhido').style.display = 'none';
    html('defImg', '');
    valor('defProblema', '');
    valor('defFotos', '');
    html('defFotosPreview', '');
    valor('defLocal', '');
    valor('defQtd', '1');
    if (el('defMsg')) el('defMsg').textContent = '';
    const b = el('defBtnSalvar');
    if (b) { b.disabled = true; b.style.opacity = '.5'; }
    // ⚠️ b283: com SKU de partida, DISPARA a busca — preencher o campo e
    // deixar o dono apertar Enter seria fazer metade do caminho.
    if (sku) setTimeout(function () { buscarProdutoDefeito(); }, 120);
    setTimeout(function () { document.getElementById('lancDefBusca').focus(); }, 100);
  }

  // b287: a exposicao, logo apos a declaracao
  window.abrirModalDefeito = abrirModalDefeito;

  // b288 - ⚠️ RECEBE O SKU DO PAINEL E ABRE SOZINHO.
  //
  // O painel admin nao tem o modal de lançamento, entao o botao de la
  // vira link pra ca: `/index.html?lancarDefeito=SKU`. Sem isto, o dono
  // chegaria numa tela em branco e teria que digitar o SKU de novo — que
  // e exatamente o atalho que a gente veio construir.
  (function () {
    try {
      const p = new URLSearchParams(window.location.search);
      const sku = (p.get('lancarDefeito') || '').trim();
      if (!sku) return;
      // ⚠️ limpa a querystring: se ele recarregar a pagina depois, o modal
      // nao abre de novo do nada
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      // espera o DOM (este script roda no meio da pagina)
      const abre = () => { try { abrirModalDefeito(sku); } catch (e) {
        console.error('[DEFEITOS] nao consegui abrir do link:', e);
      } };
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(abre, 200);
      } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(abre, 200));
      }
    } catch (e) { /* sem querystring, segue normal */ }
  })();

  function fecharModalDefeito() {
    limparKitPendente();   // v4.66
    document.getElementById('modalDefeito').classList.remove('show');
  }

  function escDef(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function buscarProdutoDefeito() {
    limparKitPendente();   // v4.66
    var q = document.getElementById('lancDefBusca').value.trim();
    var box = document.getElementById('defResultados');
    if (q.length < 2) { box.innerHTML = '<p style="font-size:13px;color:#c62828;">Digite pelo menos 2 letras.</p>'; return; }
    box.innerHTML = '<p style="font-size:13px;color:#888;">Buscando no Bling...</p>';
    try {
      // b291 - ⚠️ CONFERE O STATUS ANTES DO .json().
      //
      // [stated 11/09] "fica travado nessa tela" — o modal abria, mostrava
      // "Buscando no Bling..." e NUNCA saia disso.
      //
      // A causa: `await r.json()` rodava sem olhar o status. Se a resposta
      // nao for JSON — sessao expirada devolvendo HTML de login, 502 do
      // Render, proxy no meio — o `.json()` LANCA, o `catch` de fora nao
      // repinta a caixa, e o "Buscando..." fica pra sempre.
      //
      // ⚠️ E E O MESMO ERRO QUE EU CONSERTEI HOJE NA BUSCA DE FOTO (b269),
      // no arquivo ao lado. Consertei um e nao varri os outros — Regra 4.2:
      // caminho novo = varrer quem o dispara.
      var r = await fetch(PREFIXO + '/api/produtos/buscar?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
      if (!r.ok) {
        box.innerHTML = '<p style="font-size:13px;color:#c62828;">'
          + 'A busca falhou (HTTP ' + r.status + ').'
          + (r.status === 401 || r.status === 403
            ? ' Sua sessao pode ter expirado — recarregue a pagina e entre de novo.'
            : ' Tente de novo em instantes.')
          + '</p>';
        return;
      }
      var d = await r.json().catch(function () { return null; });
      if (!d) {
        box.innerHTML = '<p style="font-size:13px;color:#c62828;">'
          + 'A busca respondeu algo que nao consegui ler. Recarregue a pagina.</p>';
        return;
      }
      if (!d.ok) { box.innerHTML = '<p style="font-size:13px;color:#c62828;">' + escDef(d.erro || 'erro') + '</p>'; return; }
      var lista = d.produtos || [];
      if (lista.length === 0) {
        // v4.06 - o servidor avisa quando ainda esta lendo o catalogo; antes
        // a tela ignorava e dizia "nada encontrado", parecendo que o produto
        // nao existia.
        if (d.indexando || d.dica) {
          box.innerHTML = '<p style="font-size:13px;color:#e65100;background:#fff3e0;border-radius:8px;padding:9px 11px;">⏳ ' + escDef(d.dica || 'Ainda estou lendo o catálogo. Tenta de novo em instantes.') + '</p>';
        } else {
          box.innerHTML = '<p style="font-size:13px;color:#888;">Nada encontrado pra "' + escDef(q) + '".</p>';
        }
        return;
      }
      var h = '';
      for (var i = 0; i < lista.length; i++) {
        var p = lista[i];
        // v4.66 (porte da AMB b182) - KIT ja vem DESTRINCHADO no card:
        // as pecas aparecem aqui e o estoquista clica na que quer. O kit
        // em si deixa de ser clicavel (nao existe na prateleira).
        var ehKitCard = !!p.ehKit;   // v4.67 (review do Codex) - kit CONHECIDO
        // nunca e selecionavel, mesmo sem composicao resolvida (4o kit da
        // busca, ou todas as consultas falhando): antes o card voltava a ser
        // clicavel e dava pra lancar defeito NO KIT.
        var comps = (p.componentes && p.componentes.length) ? p.componentes : null;
        h += '<div' + (ehKitCard ? '' : ' onclick="escolherProdutoDefeito(' + i + ')"') + ' data-i="' + i + '" style="border:1px solid ' + (ehKitCard ? '#e4dcf1' : '#ddd') + ';border-radius:8px;padding:9px 11px;margin-bottom:5px;' + (ehKitCard ? 'background:#faf7ff;' : 'cursor:pointer;background:#fff;') + 'display:flex;gap:10px;align-items:center;">'
          + (p.imagem
              ? '<img src="' + escDef(p.imagem) + '" onclick="event.stopPropagation();abrirZoomProduto(this.src)" onerror="this.style.display=\'none\'" class="foto-produto-lista" style="cursor:zoom-in;">'
              : '<div id="defimg-' + i + '" class="foto-produto-lista vazia">📦</div>')
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:14px;font-weight:600;line-height:1.3;">' + escDef(p.nome) + '</div>'
          + '<div style="font-size:12px;color:#666;margin-top:4px;">SKU <code>' + escDef(p.sku) + '</code>'
          + (p.ean ? ' &middot; EAN ' + escDef(p.ean) : '') + '</div>'
          // v4.51 - ninguem sabia que era pra CLICAR na linha
          + (ehKitCard
              ? '<div style="margin-top:9px;">'
                  + '<div style="font-size:12.5px;color:#561A9E;font-weight:700;margin-bottom:5px;">'
                    + (comps
                        ? 'Este kit é montado com estas peças — clique na que está com defeito:'
                        : 'É um KIT — não dá pra lançar defeito nele. Não consegui listar as peças agora;'
                          + ' tente de novo em instantes ou busque direto pelo SKU da peça.') + '</div>'
                  + (comps || []).map(function (c, j) {
                      return '<div style="display:flex;align-items:center;gap:9px;padding:6px 0;border-top:1px solid #efe8f7;">'
                        + '<div style="flex:1;min-width:0;">'
                          + '<div style="font-size:13.5px;font-weight:600;color:#241a35;">' + escDef(c.nome || c.sku) + '</div>'
                          + '<div style="font-size:11.5px;color:#71659a;">SKU <code>' + escDef(c.sku) + '</code>'
                            + (c.quantidade > 1 ? ' &middot; ' + c.quantidade + '× no kit' : '') + '</div>'
                        + '</div>'
                        + '<button type="button" onclick="event.stopPropagation();escolherComponenteKit(' + i + ',' + j + ')" '
                        + 'style="background:#116B4E;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer;white-space:nowrap;">'
                        + '&#10003; É Esta Peça</button></div>';
                    }).join('')
                  + (p.componentes_faltando
                      ? '<div style="margin-top:7px;font-size:11.5px;color:#7a5c00;background:#fff8e1;border:1px solid #ffe082;border-radius:7px;padding:6px 8px;">'
                        + '⚠ Não consegui listar ' + p.componentes_faltando + ' peça(s) deste kit agora.</div>'
                      : '')
                + '</div>'
              : '<button type="button" class="btn-escolher" onclick="event.stopPropagation();escolherProdutoDefeito(' + i + ')" '
                + 'style="margin-top:12px;background:#116B4E;color:#fff;border:none;border-radius:9px;padding:11px 20px;font-weight:700;font-size:14px;cursor:pointer;">'
                + '&#10003; É Este Produto</button>')
          + '</div></div>';
      }
      window._defLista = lista;
      // v4.51 - RESULTADO UNICO ja abre escolhido: mostrar lista de um item
      // so pra ele clicar e passo a mais sem ganho
      // v4.68 (review do Codex) - kit NUNCA auto-seleciona, nem sem
      // composicao resolvida (antes esta condicao ainda exigia
      // componentes.length e o kit sozinho na busca era escolhido)
      if (lista.length === 1 && !lista[0].ehKit) {
        box.innerHTML = '';
        escolherProdutoDefeito(0);
        var campo = document.getElementById('defProblema');
        if (campo) campo.focus();
        return;
      }
      box.innerHTML = h;
      buscarFotosDefeito(lista);   // v4.31 - preenche as fotos que faltaram
    } catch (e) {
      // b293 - mesma coisa na BUSCA: "Erro de conexao" nao diz o que houve.
      console.error("[DEFEITOS] busca de produto falhou:", e);
      box.innerHTML = '<p style="font-size:13px;color:#c62828;">'
        + 'A busca falhou: ' + escDef((e && e.message) || String(e))
        + '</p>';
    }
  }

  /**
   * v4.31 - FOTO DO PRODUTO. A busca do Bling nao devolve imagem (so o
   * detalhe de cada produto traz), entao aqui pedimos a foto DEPOIS,
   * so dos resultados que estao na tela. Uma de cada vez com pausa: e
   * chamada ao Bling, e disparar todas juntas daria 429. O servidor
   * cacheia por produto, entao a segunda busca ja vem instantanea.
   */
  async function buscarFotosDefeito(lista) {
    for (var i = 0; i < lista.length && i < 6; i++) {
      var p = lista[i];
      if (!p || p.imagem || !p.id) continue;
      try {
        var r = await fetch(PREFIXO + '/api/produto/imagem/' + encodeURIComponent(p.id), { credentials: 'same-origin' });
        // b268.1 - ⚠️ NAO CHAMAR .json() SEM OLHAR O STATUS.
        //
        // Foi ISTO que virou "Unexpected token '<', "<!DOCTYPE"" na cara
        // do estoquista: quando a busca demora demais, o Render corta por
        // timeout e devolve uma PAGINA HTML de erro. O `.json()` estoura
        // no `<` e o erro vermelho toma a tela.
        //
        // ⚠️ E aqui e foto de produto — ENFEITE. Se falhar, o card fica
        // sem foto e a devolucao segue. Nunca deve interromper nada.
        if (!r.ok) continue;
        var d = await r.json().catch(function () { return null; });
        if (d && d.ok && d.imagem) {
          p.imagem = d.imagem;                       // guarda pro "escolhido" usar
          var alvo = document.getElementById('defimg-' + i);
          if (alvo) {
            alvo.outerHTML = '<img src="' + escDef(d.imagem) + '" onclick="event.stopPropagation();abrirZoomProduto(this.src)"'
              + ' onerror="this.style.display=\'none\'" style="width:52px;height:52px;border-radius:8px;object-fit:cover;'
              + 'border:1px solid #eee;cursor:zoom-in;flex:0 0 auto;">';
          }
        }
      } catch (e) { /* sem foto nao impede lancar o defeito */ }
      await new Promise(function (r2) { setTimeout(r2, 150); });
    }
  }

  // v4.66 - o kit pendente e o aviso morrem a cada abertura/busca/escolha
  function limparKitPendente() {
    // v4.72 (review do Codex) - trocar de produto/fechar o modal NAO pode
    // zerar a guarda de um laco AINDA RODANDO: o laco velho continuava
    // gravando e a tela nova ja aceitava outro salvamento. Agora a "epoca"
    // muda, o laco velho se descobre obsoleto e para sozinho.
    window._kitEpoca = (window._kitEpoca || 0) + 1;
    window._kitPendente = null;
    var m = document.getElementById('defMsg');
    if (m) m.innerHTML = '';
  }

  function escolherProdutoDefeito(i) {
    var p = (window._defLista || [])[i];
    if (!p) return;
    selecionarProdutoDefeito(p, i);
  }

  // v4.66 - clicou na PECA de um kit: segue com o produto SIMPLES dela
  function escolherComponenteKit(i, j) {
    var kit = (window._defLista || [])[i];
    var c = kit && kit.componentes && kit.componentes[j];
    if (!c) return;
    selecionarProdutoDefeito({ sku: c.sku, nome: c.nome || c.sku, ean: '', imagem: c.imagem || null }, i);
    // v4.68 (review do Codex) - a quantidade e SEMPRE reescrita: antes,
    // escolher uma peca de 2× e depois outra de 1× deixava o campo em 2
    var campoQtd = document.getElementById('defQtd');
    if (campoQtd) campoQtd.value = c.quantidade || 1;
    var campo = document.getElementById('defProblema');
    if (campo) campo.focus();
  }

  function selecionarProdutoDefeito(p, i) {
    limparKitPendente();
    // v4.69 (review do Codex) - a quantidade volta a 1 em TODA escolha; quem
    // precisa de outro valor (peca de kit com 2×) reescreve logo depois.
    // Antes, escolher uma peca 2× e depois um produto comum lancava 2 un.
    var qtdReset = document.getElementById('defQtd');
    if (qtdReset) qtdReset.value = 1;
    _defProdutoEscolhido = p;
    var boxImg = document.getElementById('defImg');
    if (boxImg) {
      boxImg.innerHTML = p.imagem
        // v4.66 - a foto do produto ESCOLHIDO usa a classe grande (260px),
        // igual na AMB. Aqui ela ficou com o tamanho antigo de 70px porque
        // o CSS foi portado mas este trecho, nao.
        ? '<img src="' + escDef(p.imagem) + '" onclick="abrirZoomProduto(this.src)" onerror="this.style.display=\'none\'" class="foto-produto-escolhido" style="cursor:zoom-in;">'
        : '';
    }
    document.getElementById('defNome').textContent = p.nome || '-';
    document.getElementById('defSku').textContent = p.sku || '-';
    document.getElementById('defEan').textContent = p.ean ? ('\u00b7 EAN ' + p.ean) : '';
    document.getElementById('defEscolhido').style.display = '';
    document.getElementById('defResultados').innerHTML = '';
    var b = document.getElementById('defBtnSalvar');
    b.disabled = false; b.style.opacity = '1';
    setTimeout(function () { document.getElementById('defProblema').focus(); }, 80);
  }

  // v4.51 - miniatura das fotos escolhidas, pra conferir antes de salvar
  function previewFotosDefeito() {
    var inp = document.getElementById('defFotos');
    var box = document.getElementById('defFotosPreview');
    if (!inp || !box) return;
    box.innerHTML = '';
    for (var i = 0; i < inp.files.length && i < 8; i++) {
      var img = document.createElement('img');
      img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:7px;border:1px solid #ddd;';
      img.src = URL.createObjectURL(inp.files[i]);
      box.appendChild(img);
    }
    if (inp.files.length) {
      var t = document.createElement('span');
      t.style.cssText = 'font-size:11.5px;color:#777;align-self:center;';
      t.textContent = inp.files.length + ' foto(s)';
      box.appendChild(t);
    }
  }

  /** Sobe as fotos escolhidas e devolve as URLs (mesma rota da triagem). */
  async function subirFotosDefeito() {
    var inp = document.getElementById('defFotos');
    if (!inp || !inp.files.length) return [];
    var urls = [];
    for (var i = 0; i < inp.files.length && i < 8; i++) {
      var fd = new FormData();
      fd.append('foto', inp.files[i]);
      try {
        var r = await fetch(PREFIXO + '/api/triagem/upload-foto', { method: 'POST', credentials: 'same-origin', body: fd });
        // b291 - ⚠️ status ANTES do .json() (varredura, Regra 4.2).
        // Sem isto, resposta que nao e JSON — sessao expirada, 502 do
        // Render — faz o `.json()` LANCAR e a tela fica pendurada.
        if (!r.ok) throw new Error("HTTP " + r.status + " em o envio das fotos");
        var d = await r.json();
        if (d && d.ok && d.url) urls.push(d.url);
      } catch (e) { /* uma foto que falha nao impede o lancamento */ }
    }
    return urls;
  }

  async function salvarDefeitoManual() {
    if (!_defProdutoEscolhido) return;
    var defeito = document.getElementById('defProblema').value.trim();
    var localDef = document.getElementById('defLocal').value.trim();
    var msg = document.getElementById('defMsg');
    if (!defeito) { msg.innerHTML = '<span style="color:#c62828;">Descreva o defeito.</span>'; document.getElementById('defProblema').focus(); return; }
    // v4.09 - sem localizacao o produto some do mapa: campo obrigatorio
    if (!localDef) {
      msg.innerHTML = '<span style="color:#c62828;">Informe ONDE VAI GUARDAR o produto.</span>';
      var elLoc = document.getElementById('defLocal');
      elLoc.style.borderColor = '#c62828'; elLoc.style.background = '#fff5f5'; elLoc.focus();
      return;
    }
    document.getElementById('defLocal').style.borderColor = '#ccc';
    document.getElementById('defLocal').style.background = '#fff';
    var btn = document.getElementById('defBtnSalvar');
    btn.disabled = true; btn.textContent = 'salvando...';
    // b292 - ⚠️ "subindo fotos..." aparecia MESMO SEM FOTO.
    //
    // [stated 11/09] "apareceu a mensagem Subindo fotos (embora eu nao
    // tenha subido foto alguma)". A mensagem era fixa, antes de conferir
    // se ha arquivo — entao quem lançava sem foto lia que o sistema
    // estava fazendo algo que nao ia fazer.
    var qtdFotos = (document.getElementById("defFotos") || {}).files;
    qtdFotos = qtdFotos ? qtdFotos.length : 0;
    msg.innerHTML = '<span style="color:#555;">'
      + (qtdFotos ? ('subindo ' + qtdFotos + ' foto' + (qtdFotos > 1 ? 's' : '') + '...')
        : 'gravando o defeito...')
      + '</span>';
    var fotosUrls = await subirFotosDefeito();
    var payload = {
      sku: _defProdutoEscolhido.sku,
      defeito: defeito,
      localizacao: localDef,
      qtd: parseInt(document.getElementById('defQtd').value, 10) || 1,
      fotos: fotosUrls
    };
    try {
      var r = await fetch(PREFIXO + '/api/defeitos/adicionar', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // b291 -> b303 (revisao Codex #245) - ⚠️ o `.json()` PRECISA rodar
      // antes de decidir se e erro. O servidor devolve 400 (kit, sessao
      // expirada, SKU invalido) com um corpo JSON estruturado — jogar
      // fora so pelo status fazia o `if (d.kit && ...)` logo abaixo
      // nunca rodar, e a tela SEMPRE dizia "Erro de conexao" pro
      // estoquista, mesmo quando era so um kit pra explodir.
      // O `.json()` continua dentro do try: se a resposta nao for JSON
      // de verdade (502 do Render, sessao expirada sem corpo), ele
      // lanca e cai no catch generico la embaixo - sem tela pendurada.
      // b293 - ⚠️ LE O CORPO ANTES DE DECIDIR (esta e a chamada principal
      // do lançamento).
      //
      // O 400 do kit e DADO, nao erro (o servidor devolve `componentes_det`
      // pra tela oferecer o lançamento por componente). Entao leio o JSON
      // primeiro; so trato como falha se nem JSON veio.
      var d = await r.json().catch(function () { return null; });
      if (!d) {
        throw new Error("o servidor respondeu HTTP " + r.status
          + " e nao consegui ler a resposta. Recarregue a pagina.");
      }
      // ⚠️ e sessao expirada tem ACAO PROPRIA: testei a rota sem login e
      // ela responde 401 "Sessao invalida ou expirada". Com a mensagem
      // generica, o dono ficava tentando de novo — quando o que resolve e
      // entrar de novo.
      if (r.status === 401 || r.status === 403) {
        throw new Error("sua sessão expirou. Abra outra aba, entre de novo, "
          + "e volte aqui — seus dados continuam preenchidos.");
      }
      if (!d.ok) {
        // v4.62 - kit devolvido explode em N unidades do produto simples
        if (d.kit && d.componentes_det && d.componentes_det.length) {
          btn.disabled = false; btn.textContent = '\ud83d\udcbe Lancar defeito';
          // b290 (revisao Codex #242) - ⚠️ `explodirKitDefeito` AGORA VIVE
          // AQUI, no modulo compartilhado. Antes ficava so no index.html:
          // no painel, sem a funcao, isto caia num fallback que dizia
          // "Defeito lançado" com o servidor tendo devolvido 400 e nada
          // gravado — sucesso falso. Na Triagem, a funcao chamava `escDef`
          // como global, mas `escDef` ja tinha virado privada desta IIFE —
          // ReferenceError silencioso. As duas telas agora usam a MESMA
          // implementacao, sem variante condicional.
          explodirKitDefeito(d, payload, msg);
          return;
        }
        msg.innerHTML = '<span style="color:#c62828;">' + escDef(d.erro || 'erro') + '</span>';
        btn.disabled = false; btn.textContent = '\ud83d\udcbe Lancar defeito';
        return;
      }
      msg.innerHTML = '<span style="color:#2e7d32;">\u2705 Lancado!</span>';
      // oferece a etiqueta 10x15 (mesmo fluxo do problema na triagem)
      var etq = {
        nf: null, sku: d.sku, ean: d.ean, produto: d.nome,
        defeito: defeito, qtd: payload.qtd, local: payload.localizacao || null,
        peca_id: d.peca_id || (d.registro && d.registro.id) || null   // v4.51
      };
      setTimeout(function () {
        fecharModalDefeito();
        if (typeof abrirPopupEtiquetaDefeito === 'function') abrirPopupEtiquetaDefeito(etq, function () {});
      }, 600);
    } catch (e) {
      // b293 - ⚠️ "ERRO DE CONEXAO" ESCONDIA A CAUSA.
      //
      // [stated 11/09] o dono preencheu defeito, qtd e localizacao, clicou
      // em lançar e leu "Erro de conexao." — que nao diz NADA. Pode ser
      // rede, sessao expirada, coluna inexistente no banco, kit sem
      // composicao... e cada uma tem uma acao diferente.
      //
      // ⚠️ E ELE PERDE O TRABALHO: nao sabe se gravou, e reescrever tudo
      // arrisca lançar duas vezes.
      //
      // Mostro a causa real e mando pro console, sem sumir com o que ele
      // digitou (o modal continua aberto, os campos preenchidos).
      console.error("[DEFEITOS] lançamento falhou:", e);
      msg.innerHTML = '<span style="color:#c62828;">'
        + 'Não consegui lançar: ' + escDef((e && e.message) || String(e))
        + '<br><small>Seus dados continuam aqui — corrija e tente de novo.'
        + ' Se repetir, me manda esta mensagem.</small></span>';
      btn.disabled = false; btn.textContent = '\ud83d\udcbe Lancar defeito';
    }
  }

  // b290 (revisao Codex #242) - \u26a0\ufe0f O CAMINHO DO KIT VEIO INTEIRO PRA CA.
  //
  // `explodirKitDefeito` e `lancarComponenteKit` viviam SO no index.html \u2014
  // sobraram la quando o resto do modal virou modulo compartilhado. Duas
  // telas, dois jeitos de quebrar:
  //   - painel-devolucoes.html: `explodirKitDefeito` nao existe, entao
  //     o lan\u00e7amento de um kit caia num fallback que dizia "Defeito
  //     lan\u00e7ado" \u2014 com o servidor tendo devolvido 400 e NADA gravado.
  //   - index.html (Triagem): a funcao chamava `escDef` como global, mas
  //     `escDef` ja tinha virado privada desta IIFE \u2014 `ReferenceError`
  //     silencioso, o caminho quebrava do mesmo jeito.
  //
  // Agora as duas telas chamam a MESMA implementacao, com o `PREFIXO`
  // certo em cada fetch \u2014 sem variante condicional em nenhuma delas.
  function explodirKitDefeito(d, payload, msg) {
    var lista = d.componentes_det || [];
    if (!lista.length) {
      msg.innerHTML = '<span style="color:#c62828;">' + escDef(d.erro || 'kit sem composicao') + '</span>';
      return;
    }
    window._kitPendente = { d: d, payload: payload };
    window._kitOcupado = false;
    var completa = d.composicao_completa !== false;
    var faltando = Number(d.componentes_faltando) || 0;
    var qtdBase = parseInt(payload.qtd, 10) || 1;
    var linhas = lista.map(function (c, i) {
      var qtd = qtdBase * (c.quantidade || 1);
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f0e6ef;">'
        + '<div style="flex:1;min-width:0;">'
          + '<div style="font-weight:700;font-size:13px;color:#241a35;">' + qtd + '\u00d7 <code>' + escDef(c.sku) + '</code></div>'
          + (c.nome ? '<div style="font-size:11.5px;color:#71659a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escDef(c.nome) + '</div>' : '')
        + '</div>'
        + '<button type="button" onclick="lancarComponenteKit(' + i + ')" '
          + 'style="background:#561A9E;color:#fff;border:none;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer;white-space:nowrap;">'
          + '\ud83d\udcbe Lan\u00e7ar aqui</button></div>';
    }).join('');
    msg.innerHTML = '<div style="background:#faf7ff;border:1px solid #e4dcf1;border-radius:10px;padding:11px 12px;text-align:left;">'
      + '<div style="font-size:13px;color:#241a35;margin-bottom:4px;">'
        + '\ud83d\udce6 <b>' + escDef(d.kit_sku || '') + ' \u00e9 um KIT.</b> No estoque quem existe \u00e9 o produto simples \u2014'
        + ' escolha em qual pe\u00e7a lan\u00e7ar o defeito:</div>'
      + linhas
      + (!completa
          ? '<div style="margin-top:9px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:8px 10px;font-size:12px;color:#7a5c00;">'
            + '\u26a0 N\u00e3o consegui resolver ' + faltando + ' pe\u00e7a(s) deste kit agora. Lance nas pe\u00e7as acima e'
            + ' tente de novo em instantes para as demais (ou lance pelo SKU direto).</div>'
          : '')
      + (lista.length > 1 && completa
          ? '<div style="margin-top:9px;text-align:right;"><button type="button" onclick="lancarComponenteKit(-1)" '
            + 'style="background:#0F6E56;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">'
            + '\u26a1 Lan\u00e7ar em TODAS as pe\u00e7as</button></div>'
          : '')
      + '</div>';
  }

  // v4.66 - lanca em UM componente (indice) ou em TODOS (-1)
  async function lancarComponenteKit(indice) {
    var pend = window._kitPendente;
    var msg = document.getElementById('defMsg');
    if (!pend) { if (msg) msg.innerHTML = '<span style="color:#c62828;">recomece a busca do produto.</span>'; return; }
    if (window._kitOcupado) return;      // toque duplo gravava duas vezes
    window._kitOcupado = true;
    var minhaEpoca = window._kitEpoca || 0;   // v4.72
    var botoes = document.querySelectorAll('#defMsg button');
    for (var b = 0; b < botoes.length; b++) { botoes[b].disabled = true; botoes[b].style.opacity = '.55'; }
    // v4.71 (review do Codex) - o botao PRINCIPAL de salvar tambem trava:
    // clicar nele durante os lancamentos tentaria gravar o KIT de novo
    var btnSalvar = document.getElementById('defBtnSalvar');
    if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.style.opacity = '.5'; }
    var lista = pend.d.componentes_det || [];
    var alvos = indice < 0 ? lista : [lista[indice]];
    var qtdBase = parseInt(pend.payload.qtd, 10) || 1;
    var lancados = 0, erro = '', falharam = [];
    for (var i = 0; i < alvos.length; i++) {
      var c = alvos[i];
      if (!c) continue;
      // v4.72 - o operador trocou de produto/fechou o modal? o laco para aqui
      if ((window._kitEpoca || 0) !== minhaEpoca) break;
      var qtd = qtdBase * (c.quantidade || 1);
      if (msg) msg.innerHTML = '<span style="color:#555;">lan\u00e7ando ' + qtd + '\u00d7 ' + escDef(c.sku) + '\u2026</span>';
      try {
        var r = await fetch(PREFIXO + '/api/defeitos/adicionar', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: c.sku, defeito: pend.payload.defeito, descricao: pend.payload.defeito,
            localizacao: pend.payload.localizacao, qtd: qtd, fotos: pend.payload.fotos })
        });
        // b291 -> b303 (revisao Codex #245, mesmo padrao do salvarDefeitoManual
        // acima) - o `.json()` precisa rodar mesmo com r.ok false: o 400
        // desta rota sempre vem com `erro` (e, se o componente resolvido
        // ainda assim for kit, com `kit`/`componentes_det`). Jogar fora
        // pelo status so trocava a causa real por "erro no {sku}" generico.
        // b293 - ⚠️ aqui tambem: o 400 do kit e DADO, entao leio o corpo
        // antes; e sessao expirada tem acao propria.
        var d2 = await r.json().catch(function () { return null; });
        if (!d2) {
          throw new Error("o servidor respondeu HTTP " + r.status
            + " ao lançar o componente, e nao consegui ler a resposta.");
        }
        if (r.status === 401 || r.status === 403) {
          throw new Error("sua sessão expirou — entre de novo e tente outra vez.");
        }
        if (d2 && d2.ok) lancados++;
        else { erro = (d2 && d2.erro) || ('erro no ' + c.sku); falharam.push(c); }
      } catch (e) {
        // revisao Codex #247 (P2) - o catch generico TROCAVA a mensagem
        // acionavel (sessao expirada, HTTP sem corpo) por "Erro de conexao
        // no <sku>", igualzinho ao bug que a b293 tinha acabado de corrigir
        // na chamada principal (`salvarDefeitoManual`). Quem lancava um
        // componente com sessao expirada continuava lendo "tente de novo"
        // em vez de "entre de novo" \u2014 mesmo caminho, mesmo defeito.
        erro = (e && e.message) || ('Erro de conex\u00e3o no ' + c.sku + '.');
        falharam.push(c);
      }
    }
    window._kitOcupado = false;
    if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.style.opacity = ''; }
    // v4.72 - laco obsoleto nao escreve na tela nova nem fecha o modal dela
    if ((window._kitEpoca || 0) !== minhaEpoca) return;
    if (lancados && !falharam.length && msg) {
      window._kitPendente = null;
      msg.innerHTML = '<span style="color:#2e7d32;">\u2705 ' + lancados + ' pe\u00e7a(s) lan\u00e7ada(s) no produto simples!'
        + ' Abra \ud83d\udd27 Defeitos pra ver e imprimir etiquetas.</span>';
      setTimeout(function () { fecharModalDefeito(); }, 2200);
    } else if (falharam.length && msg) {
      // v4.71 (review do Codex) - PRESERVA o estado de composicao incompleta:
      // forcar `true` escondia o aviso de peca nao resolvida e ainda
      // liberava o "lancar em TODAS" com a composicao pela metade
      pend.d = Object.assign({}, pend.d, {
        componentes_det: falharam,
        composicao_completa: pend.d.composicao_completa !== false,
        componentes_faltando: pend.d.componentes_faltando || 0,
      });
      explodirKitDefeito(pend.d, pend.payload, msg);
      msg.innerHTML = '<div style="background:#fdecea;border:1px solid #f5c6c3;border-radius:8px;padding:8px 10px;'
        + 'font-size:12.5px;color:#8C1D18;margin-bottom:8px;">'
        + (lancados ? '\u2705 ' + lancados + ' pe\u00e7a(s) lan\u00e7ada(s). ' : '')
        + '\u274c Falhou em ' + falharam.length + ': ' + escDef(erro || '') + '<br>Tente de novo s\u00f3 nas pe\u00e7as abaixo.'
        + '</div>' + msg.innerHTML;
    } else if (msg) {
      msg.innerHTML = '<span style="color:#c62828;">' + escDef(erro || 'nada lan\u00e7ado') + '</span>';
    }
  }

  // v4.66 (porte da AMB b180/b181) - A COMPOSICAO APARECE NA TELA,
  // ⚠️ as funcoes acima eram globais no inline. Exponho SO o que outras
  // telas chamam — o resto fica fechado aqui dentro.
  // ⚠️ `abrirZoomProduto` e chamada dentro de `onclick="..."` nas imagens.
  // Ela vive no index.html; no painel nao existe, e o clique na foto
  // quebraria. Instalo um fallback simples — zoom e acessorio, mas erro em
  // onclick suja o console e assusta quem esta operando.
  function instalarZoomSeFaltar() {
    if (typeof window.abrirZoomProduto === 'function') return;
    window.abrirZoomProduto = function (src) {
      if (!src) return;
      window.open(src, '_blank', 'noopener');
    };
  }

  // b290 (revisao Codex #242) - ⚠️ O MODAL LEVA A PROPRIA FOLHA DE ESTILO.
  //
  // CASO REAL: no painel-devolucoes.html, o modal injetado abria como
  // conteudo normal NO FIM DA PAGINA — visivel desde o carregamento,
  // porque `.modal-bg`/`.modal-bg.show`/`.modal` so existem em
  // `styles.css`, que o painel nao importa (tem a propria folha inline,
  // com `body`/`header`/`button` etc. no estilo do admin — importar
  // `styles.css` inteiro ia colidir com ela).
  //
  // ⚠️ Todo seletor abaixo e prefixado com `#modalDefeito`: a
  // especificidade de ID sempre vence a classe solta de `styles.css` e do
  // `<style>` inline do index.html/AMB, entao injetar aqui SEMPRE (nao so
  // "se faltar") e seguro — nas telas que ja tem a folha de estilo, os
  // valores sao os MESMOS, entao nao muda nada visualmente.
  var CSS_MODAL = ''
    + '#modalDefeito.modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center;padding:14px;}'
    + '#modalDefeito.modal-bg.show{display:flex;}'
    + '#modalDefeito .modal{background:#fff;border-radius:14px;padding:22px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;}'
    + '#modalDefeito .modal h3{font-size:18px;margin-bottom:12px;}'
    + '#modalDefeito .modal p{font-size:14px;color:#444;line-height:1.5;margin-bottom:14px;}'
    + '#modalDefeito .modal-acoes{display:flex;gap:10px;margin-top:18px;}'
    + '#modalDefeito .modal-acoes button{flex:1;padding:12px;}'
    + '#modalDefeito .modal-defeito{max-height:92vh;overflow-y:auto;}'
    + '#modalDefeito #defResultados{max-height:46vh;overflow-y:auto;}'
    + '#modalDefeito .foto-produto-lista{width:96px;height:96px;flex:0 0 auto;border-radius:9px;object-fit:contain;background:#fff;border:1px solid #e4dcf1;}'
    + '#modalDefeito .foto-produto-escolhido{width:260px;height:260px;flex:0 0 auto;border-radius:10px;object-fit:contain;background:#fff;border:1px solid #e4dcf1;}'
    + '#modalDefeito .foto-produto-lista.vazia,#modalDefeito .foto-produto-escolhido.vazia{display:flex;align-items:center;justify-content:center;background:#f2f2f7;color:#bbb;}'
    + '#modalDefeito .foto-produto-lista.vazia{font-size:30px;}'
    + '#modalDefeito .foto-produto-escolhido.vazia{font-size:46px;}'
    + '#modalDefeito #defResultados .btn-escolher{margin-top:8px !important;padding:8px 16px !important;font-size:13px !important;}'
    + '@media (max-width:700px){'
    +   '#modalDefeito #defResultados{max-height:40vh;}'
    +   '#modalDefeito #defEscolhido>div{flex-direction:column;}'
    +   '#modalDefeito .foto-produto-lista{width:72px;height:72px;}'
    +   '#modalDefeito .foto-produto-escolhido{width:150px;height:150px;}'
    + '}';

  function instalarEstilo() {
    if (document.getElementById('lancarDefeitoEstilo')) return;
    var alvo = document.head || document.body;
    if (!alvo) return;
    var tag = document.createElement('style');
    tag.id = 'lancarDefeitoEstilo';
    tag.textContent = CSS_MODAL;
    alvo.appendChild(tag);
  }

  function instalar(opcoes) {
    opcoes = opcoes || {};
    PREFIXO = String(opcoes.prefixo || '');

    if (!instalado) {
      // ⚠️ so injeta se a tela ainda nao tiver o modal: a Triagem pode
      // continuar com o dela inline sem duplicar
      if (!document.getElementById('modalDefeito')) {
        var caixa = document.createElement('div');
        caixa.innerHTML = HTML_MODAL;
        while (caixa.firstChild) document.body.appendChild(caixa.firstChild);
      }
      instalarEstilo();
      instalado = true;
    }

    instalarZoomSeFaltar();
    window.abrirModalDefeito = abrirModalDefeito;
    window.fecharModalDefeito = fecharModalDefeito;
    window.buscarProdutoDefeito = buscarProdutoDefeito;
    window.escolherProdutoDefeito = escolherProdutoDefeito;
    window.escolherComponenteKit = escolherComponenteKit;
    window.selecionarProdutoDefeito = selecionarProdutoDefeito;
    window.explodirKitDefeito = explodirKitDefeito;
    window.lancarComponenteKit = lancarComponenteKit;
    window.previewFotosDefeito = previewFotosDefeito;
    window.salvarDefeitoManual = salvarDefeitoManual;
    return true;
  }

  window.LancarDefeito = { instalar: instalar, get prefixo() { return PREFIXO; } };
})();
