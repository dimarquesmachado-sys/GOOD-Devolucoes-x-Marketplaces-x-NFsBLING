// js-AMB/painel-sem-retorno.js — modulo do painel unico (docs/MODULARIZACAO.md, fatia 3).
//
// MOVIDO de painel-AMB.html em b681, SEM EDICAO: o bloco das VENDAS ESTORNADAS SEM RETORNO —
// o estado de topo (_gerandoEstornada, _loteEstornadas), gerarLoteEstornadas, gerarDoCardEstornadas e
// carregarSemRetorno, na ordem e com a indentacao em que estavam no <script> principal.
// Carregado por <script src> ANTES do script principal; na carga so declara as duas `let`. As funcoes
// sao chamadas por clique ou pelo carregar() do painel, depois de tudo carregado.

let _gerandoEstornada = false;
let _loteEstornadas = false;

// b199 - GERAR VARIAS. [stated] "tem como selecionar todas? mais de uma?"
//
// Cada uma vira um RASCUNHO separado no Bling. Nao emito nada aqui: a
// Bridge monta a nota com os itens da NF original inteira, e o dono
// ajusta as linhas e o deposito la antes de validar.
//
// Por isso o lote e seguro, ao contrario da esteira — que manda
// `emitir: true` e por isso continua bloqueada pra estes casos.
async function gerarLoteEstornadas() {
  if (_loteEstornadas) return;
  const marcados = [...document.querySelectorAll('.chk-estornada:checked')];
  if (!marcados.length) { toast('marque pelo menos uma', 'err'); return; }

  _loteEstornadas = true;
  const btn = document.getElementById('btnLoteEstornadas');
  if (btn) btn.disabled = true;

  let feitos = 0, jaTinham = 0, falhas = 0;
  const idsGerados = [];

  try {
    for (const chk of marcados) {
      let d;
      try { d = JSON.parse(chk.dataset.caso); } catch (e) { falhas++; continue; }

      if (btn) btn.textContent = '⏳ registrando ' + (feitos + jaTinham + falhas + 1)
        + '/' + marcados.length + '...';

      try {
        const r = await fetch((window.APP_BASE || '') + '/api/admin/sem-retorno/registrar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d),
        });
        const j = await r.json();
        if (!j || !j.ok) { falhas++; continue; }
        // ja tem NF: nao entra no lote, senao emitiria a segunda
        if (j.nf_ja_emitida) { jaTinham++; continue; }
        if (j.ja_existia) jaTinham++; else feitos++;
        idsGerados.push({ id: j.id, nf: d.nf_numero, pedido: d.pedido });
      } catch (e) { falhas++; }
    }
  } finally {
    _loteEstornadas = false;
    // b199.2 (Codex): restaurar o rotulo CERTO. O finally reescrevia com o
    // texto antigo, entao do 2o uso em diante o botao voltava a prometer
    // rascunho — que ele nao gera.
    if (btn) { btn.disabled = false; btn.innerHTML = '📋 Mandar selecionadas pra fila de NF '
      + '(<span id="contaEstornadas">0</span>)'; }
  }

  const partes = [];
  if (feitos) partes.push(feitos + ' registrada(s)');
  if (jaTinham) partes.push(jaTinham + ' já estava(m) na fila');
  if (falhas) partes.push(falhas + ' falhou(ram)');
  toast(partes.join(' · ') + ' — agora gere o rascunho de cada uma na fila "Aprovadas"',
    falhas ? 'err' : 'ok');

  await carregarSemRetorno();
  if (typeof carregar === 'function') carregar();
}

async function gerarDoCardEstornadas(dadosJson) {
  let d;
  try { d = JSON.parse(dadosJson); } catch (e) { toast('dados do card ilegíveis', 'err'); return; }

  // b193 (Codex): clique duplo dispara duas vezes antes de a primeira
  // responder — a checagem "ja existe" e feita no servidor e as duas
  // passariam, criando dois registros da mesma devolucao.
  if (_gerandoEstornada) return;
  _gerandoEstornada = true;

  // b199 - SEM POPUP. [stated] "não faz pop up assim não."
  //
  // O confirm() nativo entrou por um apontamento do Codex (clicar sem
  // querer criava registro). Mas o registro e reversivel — a fila tem
  // lixeira — e o dono nao quer o popup no caminho. O aviso vai no
  // `title` do botao, e o toast conta o que aconteceu depois.

  try {
    const r = await fetch((window.APP_BASE || '') + '/api/admin/sem-retorno/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    const j = await r.json();
    if (!j || !j.ok) {
      toast('não consegui registrar: ' + ((j && j.erro) || 'erro'), 'err');
      return;
    }

    // ⚠️ ja emitida antes: aviso em vez de deixar emitir de novo. Duas
    // notas de devolucao da mesma venda e problema fiscal, nao so
    // retrabalho.
    if (j.nf_ja_emitida) {
      toast('Este pedido JÁ tem NF de devolução emitida — confira antes de gerar outra.', 'err');
      return;
    }
    if (j.ja_existia) {
      toast('Este caso já estava registrado; abrindo as opções.', 'ok');
    }

    // dai em diante e o fluxo de sempre
    // b199.1 (Codex): NAO passo `true` na 6a posicao — nesta AMB ela e
    // outro parametro (`cliente` num painel, `statusTriagem` no outro), e o
    // modal daqui nem tem modo so-rascunho. Passar assim preencheria o
    // campo errado em silencio.
    //
    // O aviso vai por toast: a Bridge monta a nota com os itens da NF
    // original INTEIRA, entao ele confere no Bling antes de validar.
    toast('Gere o RASCUNHO e confira as linhas no Bling — a nota sai com '
      + 'todos os itens da original.', 'ok');
    // b199.3 (Codex): PREENCHER os parametros que este modal usa.
    //
    // Ao parar de passar `true` na 6a posicao, deixei `cliente` e `skuItem`
    // vazios — e `checarNfDevolucaoJaEmitida` volta na hora sem eles, ou
    // seja, a trava contra NF duplicada nao roda.
    //
    // E o `statusTriagem` decide o DEPOSITO: sem ele, `ehProblema` e sempre
    // falso e o seletor cai em GERAL. Pros casos em que a mercadoria NAO
    // voltou, isso criaria saldo que nao existe no galpao — mando 'defeito'
    // quando o card diz que nao houve entrada.
    abrirModalGerarDevolucao(
      String(j.id),
      String(d.nf_id_bling || ''),
      String(d.nf_numero || ''),
      String(d.produto || ''),
      String(d.nf_chave || '').replace(/[^0-9]/g, ''),
      String(d.cliente || ''),
      String(d.sku || ''),
      String(d.nf_emitida_em || d.criado_no_mkt || ''),
      (d.entrada_estoque === true ? '' : 'defeito'),
      '',
      true   // b538 (Codex #442): o modal agora TEM modo so-rascunho (11o parametro) — a nota sai com a NF inteira
    );

    // ⚠️ mercadoria que NAO voltou: entrada no estoque geral criaria
    // saldo que nao existe fisicamente. O dono ja decidiu isto em 29/08
    // ("não integrarão o estoque normal, pois nunca recebemos d volta"),
    // e o lugar dela e o deposito de DEFEITO.
    if (d.entrada_estoque === false) {
      toast('Este produto NÃO voltou — escolha o depósito de DEFEITO no modal, '
        + 'senão entra saldo que não existe no galpão.', 'err');
    }
  } catch (e) {
    toast('falha ao registrar: ' + (e.message || e), 'err');
  } finally {
    _gerandoEstornada = false;
  }
}

async function carregarSemRetorno() {
      try {
        const r = await fetch((window.APP_BASE || '') + '/api/admin/sem-retorno');
        const d = await r.json();

        // b184 (Codex): ESCONDER quando esvazia. Antes eu so saia da funcao,
        // entao a lista velha ficava na tela depois de o dono resolver o
        // ultimo caso — parecendo que ainda havia trabalho.
        // b184.1 (Codex): FALHA e FILA VAZIA sao coisas diferentes.
        //
        // Eu escondia a secao nos dois casos — entao, se a rota quebrasse, o
        // dono veria a mesma tela de "nada pendente" e concluiria que nao ha
        // imposto a recuperar. E o silencio que a gente passou o dia matando.
        if (!d || !d.ok) {
          document.getElementById('secaoSemRetorno').style.display = '';
          document.getElementById('countSemRetorno').textContent = '!';
          document.getElementById('listaSemRetorno').innerHTML =
            '<div style="padding:12px;border-radius:8px;background:#ffebee;border:2px solid #c62828;'
            + 'color:#b71c1c;font-weight:700;">⚠️ Não consegui carregar esta lista'
            + ((d && d.erro) ? '<div style="font-weight:400;margin-top:4px;font-size:13px;">'
                + escapeHtml(String(d.erro)) + '</div>' : '')
            + '<div style="font-weight:400;margin-top:4px;font-size:13px;">'
            + 'Isto <b>não</b> quer dizer que não há casos — quer dizer que não deu para conferir.'
            + '</div></div>';
          return;
        }

        if (!Array.isArray(d.itens) || !d.itens.length) {
          document.getElementById('secaoSemRetorno').style.display = 'none';
          document.getElementById('listaSemRetorno').innerHTML = '';
          document.getElementById('countSemRetorno').textContent = '0';
          return;
        }

        document.getElementById('secaoSemRetorno').style.display = '';
        document.getElementById('countSemRetorno').textContent = d.total;

        // b188.2: se a lista veio cortada, dizer — senao ele acha que viu tudo
        const avisoCorte = d.aviso_corte
          ? '<div style="margin-bottom:10px;padding:10px;border-radius:8px;background:#fffde7;'
            + 'border:2px solid #f9a825;color:#f57f17;font-size:13px;">⚠️ '
            + escapeHtml(String(d.aviso_corte)) + '</div>'
          : '';

        // b189 - se o Magalu falhou, a lista PARECE completa e nao esta.
        // Silencio aqui esconderia os R$ 12 mil que a outra conversa mediu.
        // b205 - BUG NOSSO tem cara diferente de falha do marketplace.
        //
        // O Magalu ficou dias sem aparecer aqui porque um ReferenceError
        // virava "magalu_erro" e a tela dizia "falha do Magalu". O dono
        // esperava passar; nunca ia passar.
        const ehBugNosso = /ERRO NO NOSSO CODIGO/.test(String(d.magalu_erro || ''));
        const avisoMagalu = d.magalu_erro
          ? '<div style="margin-bottom:10px;padding:10px;border-radius:8px;background:#ffebee;'
            + 'border:2px solid #c62828;color:#b71c1c;font-weight:700;">'
            + (ehBugNosso ? '🐛 BUG NO SISTEMA — recarregar não resolve: ' : '⚠️ Os casos do Magalu NÃO entraram nesta lista: ') + escapeHtml(String(d.magalu_erro))
            + '<div style="font-weight:400;margin-top:4px;font-size:13px;">'
            + 'O que aparece abaixo está incompleto.</div></div>'
          : '';

        const cabecalho = d.podem_cancelar > 0
          ? '<div style="margin-bottom:10px;padding:10px;border-radius:8px;background:#fff3e0;'
            + 'border:2px solid #ef6c00;color:#e65100;font-weight:700;">'
            + '⏳ ' + d.podem_cancelar + ' com a NF ainda no prazo de cancelamento — essas primeiro, '
            + 'porque o relógio está correndo</div>'
          : '';

        const linhas = d.itens.map(function (x) {
          const podeCancelar = x.acao === 'cancelar_nf';
          // b184: quando a data veio da DEVOLUCAO (sem chave da NF), o prazo
          // mostrado e MAIOR que o real — a nota e anterior. Avisa, pra ele
          // conferir antes de tentar cancelar e levar um 501.
          const aprox = x.prazo_base === 'devolucao' ? ' ⚠️' : '';
          // b189 - o Magalu tem casos em que a devolucao EXISTE (classe
          // `estornado_apos_envio`): o produto voltou pelo fluxo normal.
          // Emitir NF de devolucao ali seria duplicar. Aviso em vez de
          // esconder, porque a NF pode nao ter sido emitida ainda.
          // v4.78 - o PIOR caso: entregue DEPOIS do estorno autorizado. O
          // cliente ficou com a mercadoria E com o dinheiro. Nao ha imposto a
          // recuperar aqui — ha prejuizo a contestar com o marketplace.
          const tarjaPrejuizo = x.prejuizo_integral
            ? '<span style="background:#b71c1c;color:#fff;padding:3px 8px;border-radius:10px;'
              + 'font-size:10px;font-weight:700;margin-left:6px;" '
              + 'title="Entregue DEPOIS do estorno: o cliente ficou com o produto e com o dinheiro. '
              + 'Vale contestar com o marketplace.">💸 PREJUÍZO INTEGRAL</span>'
            : '';

          // e o que a classe diz sobre a ENTRADA de estoque — errar aqui
          // duplica ou some com inventario
          // b195.4 (Codex): o `nf_sem_saida` vai COM entrada e no deposito
          // GERAL — a mercadoria esta no CD, novinha, e a entrada corrige a
          // baixa que a NF de venda ja deu. Antes ele caia no texto generico
          // de "COM entrada, confirme no galpao", que nao diz o principal.
          // b195.5 (Codex): enquanto DA PRA CANCELAR, a orientacao de estoque
          // confunde — ela descreve a NF de devolucao, que ali e o plano B.
          // O card ja diz "CANCELAR NF · Nd restantes"; falar de deposito ao
          // lado sugere que ele deveria emitir a devolucao agora.
          const dicaEstoque = x.acao === 'cancelar_nf'
            ? ''
            : x.classe === 'nf_sem_saida'
            ? '<div style="font-size:12px;color:#00695c;margin-top:4px;">'
              + '📦 Devolução <b>COM entrada</b>, depósito <b>GERAL</b> — o produto nunca saiu do CD; '
              + 'a entrada corrige a baixa que a NF de venda deu</div>'
            : x.entrada_estoque === false
            ? '<div style="font-size:12px;color:#00695c;margin-top:4px;">'
              + '📦 Devolução <b>SEM entrada de estoque</b> — a mercadoria não voltou ao CD</div>'
            : (x.entrada_estoque === true
              // b607 - porte da GOOD (b194.1, Codex): so diz 'o marketplace registrou' quando ELE registrou mesmo; no
              // `saiu_e_nao_entregou` nao ha registro de devolucao — so se sabe que saiu e nao foi entregue.
              ? '<div style="font-size:12px;color:#00695c;margin-top:4px;">'
                + (x.tem_devolucao_registrada
                  ? '📦 Devolução <b>COM entrada</b> — o marketplace registrou o retorno; '
                    + 'confirme que o pacote está no galpão</div>'
                  : '📦 Devolução <b>COM entrada</b> — não foi entregue ao cliente, '
                    + 'então <b>deve</b> ter voltado; confirme no recebimento</div>')
              : (x.classe
                ? '<div style="font-size:12px;color:#e65100;margin-top:4px;">'
                  + '❓ <b>Confira se houve devolução física</b> antes de dar baixa</div>'
                : ''));

          const jaVoltou = !!x.tem_devolucao_registrada;
          const tarjaVoltou = jaVoltou
            ? '<span style="background:#00695c;color:#fff;padding:3px 8px;border-radius:10px;'
              + 'font-size:10px;font-weight:700;margin-left:6px;" '
              + 'title="Este pedido TEM devolução registrada no marketplace — o produto voltou. '
              + 'Confira se a NF de devolução já saiu pelo fluxo normal antes de emitir outra.">'
              + '↩️ TEVE DEVOLUÇÃO</span>'
            : '';

          const tarja = podeCancelar
            ? '<span style="background:#ef6c00;color:#fff;padding:3px 8px;border-radius:10px;'
              + 'font-size:10px;font-weight:700;" title="'
              + (aprox ? 'prazo APROXIMADO: contado da devolucao, nao da nota — o real e menor'
                       : 'contado do mes da nota, pela chave da NF-e')
              + '">CANCELAR NF · ' + x.prazo_cancelamento + 'd restantes' + aprox + '</span>'
            : '<span style="background:#546e7a;color:#fff;padding:3px 8px;border-radius:10px;'
              + 'font-size:10px;font-weight:700;">NF DE DEVOLUÇÃO</span>';

          // b188 - TAG DO MARKETPLACE, igual aos outros cards do painel.
          // Sem ela o dono nao sabe de onde veio o caso, e com ML e Shopee
          // entrando na lista isso fica pior.
          const CORES_MKT = { tiktok: '#000', shopee: '#ee4d2d', magalu: '#0086ff', ml: '#ffe600', mercadolivre: '#ffe600' };   // b656 - alias antigo, mesma cor
          const mkt = String(x.marketplace || '').toLowerCase();
          const NOMES_MKT = { tiktok: 'TikTok', shopee: 'Shopee', magalu: 'Magalu', ml: 'Mercado Livre', mercadolivre: 'Mercado Livre' };   // b656 - alias antigo, mesmo rotulo
          const tagMkt = mkt
            ? '<span style="background:' + (CORES_MKT[mkt] || '#607d8b') + ';'
              + 'color:' + (mkt === 'ml' || mkt === 'mercadolivre' ? '#333' : '#fff') + ';padding:3px 8px;border-radius:10px;'
              + 'font-size:10px;font-weight:700;margin-right:6px;">'
              + escapeHtml(NOMES_MKT[mkt] || x.marketplace) + '</span>'
            : '';

          // b188.1 (Codex): O BOTAO DE GERAR NF SAIU DAQUI.
          //
          // Eu tinha reaproveitado abrirModalGerarDevolucao() achando que
          // bastava passar os mesmos parametros. Nao basta: o `devolucaoId`
          // dele e o id de uma TRIAGEM (tabela `devolucoes`), e eu passava o
          // id de um registro CAPTURADO (tabela `devolucoes_capturadas`).
          // Sao tabelas diferentes — o modal procuraria um registro que nao
          // existe.
          //
          // E a revisao apontou mais tres problemas que so apareceriam na
          // hora de emitir, que e o pior momento possivel:
          //   - a nota sairia com o pedido INTEIRO, nao so os itens
          //     reembolsados (venda de 3 produtos, 1 reembolsado → devolvia 3)
          //   - o deposito nao vinha pre-definido como DEFEITO, que e a
          //     exigencia do dono pra isso nao entrar no estoque vendavel
          //   - casos ainda CANCELAVEIS ganhariam botao de devolucao, quando
          //     o certo ali e cancelar a nota
          //
          // Botao que gera nota fiscal errada e pior que nao ter botao. O
          // caminho de emissao vira PR proprio, feito com calma.
          //
          // Por ora, o card leva pra NOTA no Bling — que e o que ele precisa
          // pra agir, e o mesmo lugar de onde partiria de qualquer forma.
          const temCandidatas = !!(x.nf_candidatas && x.nf_candidatas.length > 1);
          const podeGerar = (x.nf_id_bling || temCandidatas)
            && x.acao !== 'cancelar_nf' && !x.prejuizo_integral;
          // b199 - checkbox pra selecionar varios. [stated] "tem como
          // selecionar todas? mais de uma?"
          const checkbox = podeGerar
            ? '<label style="display:inline-flex;align-items:center;gap:5px;margin-right:8px;'
              + 'font-size:12px;color:#555;cursor:pointer;">'
              + '<input type="checkbox" class="chk-estornada" '
              + 'data-caso="' + escapeHtml(JSON.stringify({
                  pedido: x.pedido, produto: x.produto, sku: x.sku, qtd: x.qtd,
                  nf_numero: x.nf_numero, nf_chave: x.nf_chave, nf_id_bling: x.nf_id_bling,
                  marketplace: x.marketplace, classe: x.classe,
                  chave_caso: x.id, chave_caso_legado: x.id_legado,
                  // b199.5 (Codex): cliente e data vao no payload — sem eles a
                  // trava de NF duplicada volta na hora, mesmo com os
                  // parametros do modal preenchidos.
                  cliente: x.cliente, nf_emitida_em: x.nf_emitida_em,
                  // b216 (Codex): a SERIE vai no payload tambem. Quando o
                  // sistema resolve sozinho (sem o dono escolher no radio),
                  // era o unico caminho que perdia o aviso de Full.
                  nf_serie: x.nf_serie,
                  criado_no_mkt: x.criado_no_mkt,
                  chave_caso_legado2: x.id_legado2, entrada_estoque: x.entrada_estoque,
                })) + '"> selecionar</label>'
            : '';
          const botaoGerar = podeGerar
            ? '<button class="btn btn-gerar-estornada" '
              + 'style="background:#1565c0;margin-top:8px;margin-right:6px;" '
              + 'data-caso="' + escapeHtml(JSON.stringify({
                  pedido: x.pedido, produto: x.produto, sku: x.sku, qtd: x.qtd,
                  nf_numero: x.nf_numero, nf_chave: x.nf_chave, nf_id_bling: x.nf_id_bling,
                  marketplace: x.marketplace, classe: x.classe,
                  chave_caso: x.id, chave_caso_legado: x.id_legado,
                  // b199.5 (Codex): cliente e data vao no payload — sem eles a
                  // trava de NF duplicada volta na hora, mesmo com os
                  // parametros do modal preenchidos.
                  cliente: x.cliente, nf_emitida_em: x.nf_emitida_em,
                  // b216 (Codex): a SERIE vai no payload tambem. Quando o
                  // sistema resolve sozinho (sem o dono escolher no radio),
                  // era o unico caminho que perdia o aviso de Full.
                  nf_serie: x.nf_serie,
                  criado_no_mkt: x.criado_no_mkt,
                  chave_caso_legado2: x.id_legado2,
                  entrada_estoque: x.entrada_estoque,
                })) + '" '
              + 'title="Registra este caso e abre o rascunho da NF de devolução.">'
              + '🧾 Gerar NF de devolução</button>'
            : (x.prejuizo_integral
              ? '<div style="margin-top:8px;font-size:12px;color:#b71c1c;">'
                + '💸 Não emita devolução: a mercadoria <b>não voltou</b> — o cliente ficou com ela '
                + 'e com o dinheiro. O caminho é <b>contestar com o marketplace</b>.</div>'
              : (x.acao === 'cancelar_nf'
                ? '<div style="margin-top:8px;font-size:12px;color:#e65100;">'
                  + '⏳ Ainda dá para <b>cancelar a NF</b> — a devolução só depois do prazo</div>'
                : ''));
          // b208 - CANDIDATAS pro dono escolher.
          //
          // [stated] "deixa as NFs iguais q eu seleciono."
          //
          // Quando chave, serie, marketplace e cliente nao desempatam,
          // mostro as notas que sobraram com o que cada uma tem. Escolher
          // errado aqui e gerar devolucao contra outra venda, entao a
          // decisao e dele — mas com a informacao na mao.
          const listaCandidatas = (x.nf_candidatas && x.nf_candidatas.length > 1)
            ? '<div style="margin-top:8px;padding:10px;background:#fff8e1;border:2px solid #f9a825;'
              + 'border-radius:8px;">'
              + '<div style="font-size:12px;font-weight:700;color:#e65100;margin-bottom:6px;">'
              + '🔀 ' + x.nf_candidatas.length + ' notas com este número — qual é a desta venda?</div>'
              + x.nf_candidatas.map((c) =>
                  '<label style="display:block;font-size:12px;margin:4px 0;cursor:pointer;">'
                  + '<input type="radio" name="cand-' + escapeHtml(String(x.id)) + '" '
                  + 'class="chk-candidata" data-item="' + escapeHtml(String(x.id)) + '" '
                  + 'data-nfid="' + escapeHtml(String(c.id)) + '" '
                  + 'data-serie="' + escapeHtml(String(c.serie || '')) + '"> '
                  + '<b>NF ' + escapeHtml(String(c.numero || '?')) + '</b>'
                  + (c.serie ? ' · série ' + escapeHtml(String(c.serie)) : '')
                  + (c.data ? ' · ' + escapeHtml(String(c.data).slice(0, 10)) : '')
                  + (c.cliente ? ' · ' + escapeHtml(String(c.cliente)) : '')
                  + (c.marketplace ? ' · ' + escapeHtml(String(c.marketplace)) : '')
                  + (c.bate && c.bate.length
                    ? ' <span style="color:#2e7d32;">(bate: ' + escapeHtml(c.bate.join(', ')) + ')</span>'
                    : '')
                  + '</label>').join('')
              + '<div style="font-size:11px;color:#666;margin-top:6px;">'
              + 'Confira no Bling antes de escolher — a devolução sai contra a nota selecionada.</div>'
              + '</div>'
            : '';

          // vinculo FRACO: achou uma so, mas sem dois sinais concordando
          // b209 - nota do FULL foi emitida pelo MARKETPLACE, nao por nos.
          // [stated] "na good vai ter série 2 pra MercadoLivre Full. tb tem
          // amazon FULL, e Magalu FULL em outras series"
          const avisoFull = x.nf_do_full
            ? '<div style="font-size:12px;color:#4527a0;background:#ede7f6;padding:6px 8px;'
              + 'border-radius:6px;margin-top:4px;">'
              + '🏭 Série ' + escapeHtml(String(x.nf_serie)) + ' — nota emitida pelo '
              + '<b>marketplace no Full</b>, não por nós. Confira o tratamento fiscal antes '
              + 'de gerar a devolução.</div>'
            : '';

          const avisoFraco = x.nf_vinculo_fraco
            ? '<div style="font-size:11px;color:#e65100;margin-top:4px;">'
              + '⚠️ Vínculo por eliminação — confira que é a nota certa antes de emitir</div>'
            : '';

          const linkNF = x.nf_id_bling
            ? '<a class="btn" style="background:#1565c0;margin-top:8px;display:inline-block;" '
              + 'href="https://www.bling.com.br/notas.fiscais.php#edit/' + encodeURIComponent(x.nf_id_bling) + '" '
              + 'target="_blank" rel="noopener" '
              + 'title="Abre a nota de venda no Bling. Lembre do depósito de DEFEITO: '
              + 'a mercadoria nunca chegou, então não pode entrar no estoque vendável.">'
              + '🔗 Abrir NF no Bling</a>'
            : '<div style="margin-top:8px;font-size:12px;color:#999;">'
              + (x.nf_numero
                  ? (x.nf_motivo_sem_vinculo
                ? 'NF ' + escapeHtml(String(x.nf_numero)) + ': ' + escapeHtml(x.nf_motivo_sem_vinculo)
                // 29/10: na fila de segundo plano = ainda nao procurada, nao 'nao existe'
                : x.nf_vinculo_pendente
                  ? '🔄 NF ' + escapeHtml(String(x.nf_numero)) + ': procurando no Bling — recarregue em 1 ou 2 minutos'
                  : 'NF ' + escapeHtml(String(x.nf_numero)) + ' não localizada no Bling')
                  : 'sem NF vinculada a este pedido')
              + '</div>';

          return '<div class="item" style="border-left-color:' + (podeCancelar ? '#ef6c00' : '#546e7a') + ';">'
            + '<div class="item-header"><div class="item-titulo">'
            + tagMkt + escapeHtml(x.produto || '-') + ' ' + tarja + tarjaVoltou + tarjaPrejuizo + '</div></div>'
            + '<div style="font-size:13px;color:#555;margin-top:6px;">'
            + (x.nf_numero
                ? '<b>NF ' + escapeHtml(String(x.nf_numero)) + '</b>'
                  // b196 - a captura nao trouxe a nota; achei pelo PEDIDO.
                  // Vale dizer, porque o casamento por pedido e menos exato
                  // que por chave — ele confere antes de emitir.
                  + (x.nf_achada_por === 'pedido'
                    ? ' <span style="color:#e65100;font-size:11px;" title="A captura não trouxe a NF; '
                      + 'localizei pelo número do pedido. Confira que é a nota certa antes de emitir.">'
                      + '(achada pelo pedido)</span>'
                    : '')
                  + ' · '
                : '')
            + 'pedido <code>' + escapeHtml(String(x.pedido || '-')) + '</code>'
            + (x.sku ? ' · SKU <code>' + escapeHtml(String(x.sku)) + '</code>' : '')
            + (x.qtd ? ' · ' + escapeHtml(String(x.qtd)) + ' un' : '')
            + (x.valor != null
                ? ' · R$ ' + Number(x.valor).toFixed(2)
                  // b190.5 - valor rateado nao pode passar por exato
                  + (x.valor_rateado
                      ? ' <span style="color:#e65100;font-weight:700;" title="Este pedido tem '
                        + 'mais de uma nota. O valor mostrado é o do pedido dividido pelas notas, '
                        + 'não o valor exato desta.">~aprox</span>'
                      : '')
                : '')
            + (x.dias_desde != null ? ' · há ' + x.dias_desde + ' dias' : '')
            + '</div>'
            + (x.motivo ? '<div style="font-size:13px;color:#777;margin-top:4px;">'
                + '💬 ' + escapeHtml(String(x.motivo)) + '</div>' : '')
            + (x.cliente ? '<div style="font-size:12px;color:#999;margin-top:2px;">'
                + escapeHtml(String(x.cliente)) + '</div>' : '')
            + dicaEstoque
            + avisoFull + avisoFraco + listaCandidatas
            + checkbox + botaoGerar + linkNF
            + '</div>';
        }).join('');

        document.getElementById('listaSemRetorno').innerHTML = avisoCorte + cabecalho + linhas;

        // b199.1 (Codex): os controles precisam ser LIGADOS depois de montar
        // o HTML. Sem isto o botao e os checkboxes ficavam inertes na AMB —
        // o card parecia funcionar e nao fazia nada.
        document.querySelectorAll('.btn-gerar-estornada').forEach((b) => {
          b.addEventListener('click', () => {
            // b208: se ha candidatas, a escolhida manda
            const caso = JSON.parse(b.dataset.caso || '{}');
            const marcada = document.querySelector(
              '.chk-candidata[data-item="' + caso.chave_caso + '"]:checked');
            if (marcada) {
              caso.nf_id_bling = marcada.dataset.nfid;
              // b210.6 (Codex): a SERIE da escolhida vai junto. Sem ela o
              // registro perde o aviso de Full, e na fila "Aprovadas" o
              // caso aparece sem o alerta de que a nota e do marketplace.
              if (marcada.dataset.serie) caso.nf_serie = marcada.dataset.serie;
            }
            if (!caso.nf_id_bling) {
              toast('escolha qual NF é a desta venda antes de gerar', 'err');
              return;
            }
            gerarDoCardEstornadas(JSON.stringify(caso));
          });
        });

        const chks = [...document.querySelectorAll('.chk-estornada')];
        const barra = document.getElementById('barraLoteEstornadas');
        if (barra) barra.style.display = chks.length ? '' : 'none';

        const atualizarConta = () => {
          const n = document.querySelectorAll('.chk-estornada:checked').length;
          const el = document.getElementById('contaEstornadas');
          if (el) el.textContent = String(n);
          const t = document.getElementById('chkTodasEstornadas');
          if (t) t.checked = n > 0 && n === chks.length;
        };
        chks.forEach((c) => c.addEventListener('change', atualizarConta));
        const todas = document.getElementById('chkTodasEstornadas');
        if (todas) {
          todas.onchange = () => { chks.forEach((c) => { c.checked = todas.checked; }); atualizarConta(); };
        }
        atualizarConta();
      } catch (e) {
        // silencioso de proposito: e um bloco informativo, nao a fila
      }
    }
