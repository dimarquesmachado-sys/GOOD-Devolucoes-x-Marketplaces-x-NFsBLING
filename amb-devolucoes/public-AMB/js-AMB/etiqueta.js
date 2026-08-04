// ============================================================
// etiqueta.js (v3.19.0) - Etiqueta de produto 4x2,5cm na Zebra
// Portado do Checkout Offline: mesmo ZPL (320x200 dots @203dpi),
// mesma engrenagem QZ Tray, impressora salva por computador.
// Uso: botao 🏷️ em cada item da conferencia de bipagem.
// ============================================================

const ETQ_PRINTER_KEY = 'gdev_printer_etq';

function qzDisponivel() {
  return typeof qz !== 'undefined';
}

async function conectarQZ() {
  if (!qzDisponivel()) {
    throw new Error('QZ Tray nao carregou nesta pagina (recarregue com Ctrl+Shift+R)');
  }
  if (qz.websocket.isActive()) return;

  // v3.19.3 - MODO ASSINADO: o servidor entrega o certificado (o mesmo do
  // checkout, ja confiado no QZ Tray do notebook) e assina cada pedido.
  // Resultado: impressao SILENCIOSA, sem popup de Allow.
  let certTxt = null;
  try {
    const r = await fetch('/api/qz/cert');
    if (r.ok) {
      const t = await r.text();
      if (t.includes('BEGIN CERTIFICATE')) certTxt = t;
    }
  } catch (e) { /* sem certificado configurado */ }

  if (certTxt) {
    qz.security.setCertificatePromise(function (resolve) { resolve(certTxt); });
    try { qz.security.setSignatureAlgorithm('SHA512'); } catch (e) { /* qz antigo */ }
    qz.security.setSignaturePromise(function (toSign) {
      return function (resolve, reject) {
        fetch('/api/qz/sign?request=' + encodeURIComponent(toSign))
          .then(function (r) {
            if (!r.ok) throw new Error('assinatura falhou (HTTP ' + r.status + ')');
            return r.text();
          })
          .then(resolve)
          .catch(reject);
      };
    });
  } else {
    // Sem QZ_CERT/QZ_PRIVKEY no Render: modo antigo (popup Allow 1x)
    try { qz.security.setCertificatePromise(function (resolve) { resolve(); }); } catch (e) { /* ok */ }
    try { qz.security.setSignaturePromise(function () { return function (resolve) { resolve(); }; }); } catch (e) { /* ok */ }
  }
  await qz.websocket.connect();
}

function getImpressoraEtiqueta() {
  return localStorage.getItem(ETQ_PRINTER_KEY) || '';
}

async function escolherImpressoraEtiqueta() {
  try {
    await conectarQZ();
    const lista = await qz.printers.find();
    const arr = Array.isArray(lista) ? lista : [lista];
    if (arr.length === 0) {
      toast('Nenhuma impressora encontrada no QZ Tray', 'err');
      return;
    }
    const atual = getImpressoraEtiqueta();
    const msg = 'Escolha a impressora da ETIQUETA DE PRODUTO (Zebra):\n\n' +
      arr.map((p, i) => `${i + 1}. ${p}${p === atual ? '  <- atual' : ''}`).join('\n') +
      '\n\nDigite o numero:';
    const r = prompt(msg, atual && arr.indexOf(atual) >= 0 ? String(arr.indexOf(atual) + 1) : '1');
    if (r === null) return;
    const ix = parseInt(r, 10) - 1;
    if (isNaN(ix) || ix < 0 || ix >= arr.length) {
      toast('Numero invalido', 'err');
      return;
    }
    localStorage.setItem(ETQ_PRINTER_KEY, arr[ix]);
    toast('🖨 Zebra da etiqueta: ' + arr[ix], 'ok');
  } catch (e) {
    toast('Erro ao listar impressoras: ' + (e.message || e) + ' — o QZ Tray esta aberto?', 'err');
  }
}

// 40x25mm @ 203dpi = 320x200 dots. v3.20.4 (barras CENTRALIZADAS na largura):
// - BARRAS EM MODO A (compacto): sem o ,A o Code128 sai no modo "gordo"
//   (1 simbolo por digito) e um EAN-13 fica ~356 dots — MAIOR que a etiqueta
//   (320) — vazando pela borda direita. Com ,A cai pra ~246 dots e bipa igual.
// - TITULO: fonte 14 e max 72 chars — se o texto precisar de 4a linha, o ZPL
//   imprime o excesso POR CIMA da 3a (embola). 72 chars = no max 3 linhas.
// - Conteudo em x=20, textos com 284 de largura → ~2mm de folga na direita.
// - SKU auto-encolhe (altura 24 fixa, largura proporcional) pra sempre caber.
function montarZplEtiqueta(p, copias) {
  const clean = s => String(s || '').replace(/[\^~]/g, ' ');
  const titulo = clean(p.nome).slice(0, 72);
  const sku = clean(p.sku);
  const ean = String(p.ean || '').replace(/\D/g, '');
  const dados = ean || sku.replace(/[^\x20-\x7E]/g, ''); // barras: EAN; sem EAN, o SKU
  if (!dados) return null;
  const wSku = Math.max(10, Math.min(24, Math.floor(370 / Math.max(sku.length, 1))));
  // Barras CENTRALIZADAS: Code128 nao estica (so degraus de 50%), entao estima
  // a largura real e centraliza na faixa util (20..304). Numero centraliza junto.
  const digitos = /^\d+$/.test(dados);
  const simbolos = digitos ? (Math.floor(dados.length / 2) + (dados.length % 2 ? 2 : 0) + 2) : (dados.length + 2);
  const wBar = (11 * simbolos + 13) * 2;                             // largura estimada das barras (dots)
  const xBar = Math.max(20, 20 + Math.floor((284 - wBar) / 2));
  const z = ['^XA', '^CI28', '^PW320', '^LL200', '^LH0,0',
    '^FO20,24^A0N,14,14^FB284,3,2,L^FD' + titulo + '^FS',            // titulo (3 linhas)
    '^FO20,80^A0N,24,' + wSku + '^FD' + sku + '^FS',                 // SKU (auto-fit)
    '^FO' + xBar + ',112^BY2,2^BCN,56,N,N,N,A^FD' + dados + '^FS',   // barras (modo A, centralizadas)
    '^FO20,172^A0N,17,17^FB284,1,0,C^FD' + dados + '^FS'];           // numero centralizado
  if (copias && copias > 1) z.push('^PQ' + copias + ',0,0,N');
  z.push('^XZ');
  return z.join('');
}

// ============================================================
// v3.20 - IMPRESSAO REMOTA: aparelho sem QZ (celular)? A etiqueta
// vai pra FILA do servidor e sai na Zebra da ESTACAO (o notebook
// com esta pagina aberta). Zero configuracao no celular.
let _qzLocalStatus = null; // null = nao testado | true | false

async function conectarQZComTimeout(ms) {
  try {
    return await Promise.race([
      conectarQZ().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
  } catch (e) {
    return false;
  }
}

async function temQZLocal() {
  if (_qzLocalStatus !== null) return _qzLocalStatus;
  if (!qzDisponivel()) { _qzLocalStatus = false; return false; }
  if (qz.websocket.isActive()) { _qzLocalStatus = true; return true; }
  _qzLocalStatus = await conectarQZComTimeout(3500);
  return _qzLocalStatus;
}

async function enviarPraFila(zpl, resumo) {
  const r = await fetch('/api/etiqueta/fila', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zpl, resumo }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.erro || 'falha ao enfileirar');
  return d;
}

async function imprimirEtiquetaProduto(prod, copias) {
  if (!prod) return;
  if (copias == null) {
    const r = prompt('Quantas etiquetas?', String(prod.quantidade || 1));
    if (r === null) return;
    copias = Math.max(1, Math.min(50, parseInt(r, 10) || 1));
  }
  const zpl = montarZplEtiqueta(prod, copias);
  if (!zpl) {
    toast('Produto sem EAN nem SKU pra etiqueta', 'err');
    return;
  }
  try {
    const local = await temQZLocal();
    if (!local) {
      // Sem QZ aqui (celular): manda pra estacao
      const resumo = (copias + 'x ' + (prod.sku || prod.nome || 'etiqueta')).slice(0, 100);
      const d = await enviarPraFila(zpl, resumo);
      if (d.estacao_online) {
        toast('📱→🖨️ ' + copias + ' etiqueta(s) enviada(s) pra ESTACAO (sai na Zebra do notebook)', 'ok');
      } else {
        toast('⏳ ' + copias + ' etiqueta(s) na fila — a estacao esta OFFLINE. Abra a pagina do Devolucoes no notebook da Zebra que sai na hora.', 'err');
      }
      return;
    }
    let printer = getImpressoraEtiqueta();
    if (!printer) {
      await escolherImpressoraEtiqueta();
      printer = getImpressoraEtiqueta();
    }
    if (!printer) return;
    const cfg = qz.configs.create(printer);
    await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'plain', data: zpl }]);
    toast('🏷️ ' + copias + ' etiqueta(s) enviada(s) → ' + printer, 'ok');
  } catch (e) {
    toast('Erro na impressao: ' + (e.message || e) + ' — QZ Tray aberto? Zebra ligada?', 'err');
  }
}

// Botao 🏷️ da linha do item na conferencia de bipagem
function imprimirEtiquetaItemBipagem(idx) {
  const it = (typeof bipagemEstado !== 'undefined' && bipagemEstado.itensEsperados)
    ? bipagemEstado.itensEsperados[idx]
    : null;
  if (!it) {
    toast('Item nao encontrado no estado da bipagem', 'err');
    return;
  }
  imprimirEtiquetaProduto({
    nome: it.titulo,
    sku: it.sku,
    ean: it.ean && it.ean !== '-' ? it.ean : '',
    quantidade: it.quantidade,
  });
}

// ============================================================
// v3.20 - MODO ESTACAO: o notebook com QZ + certificado vira a
// estacao de impressao SOZINHO ao abrir a pagina (long-poll na
// fila; imprime o que o celular mandar). Badge fixo indica.
let _estacaoAtiva = false;

function badgeEstacao(texto) {
  let el = document.getElementById('estacaoBadge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'estacaoBadge';
    el.style.cssText = 'position:fixed;left:10px;bottom:10px;background:#263238;color:#fff;padding:6px 12px;border-radius:16px;font-size:12px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.92;';
    document.body.appendChild(el);
  }
  el.textContent = texto;
}

async function loopEstacao() {
  while (_estacaoAtiva) {
    try {
      const r = await fetch('/api/etiqueta/fila/proximo?espera=25');
      const d = await r.json();
      if (d && d.job) {
        badgeEstacao('🖨️ Estacao: imprimindo... (' + (d.restam || 0) + ' na fila)');
        try {
          await conectarQZ();
          let printer = getImpressoraEtiqueta();
          if (!printer) {
            // devolve o job pra fila e pausa ate escolherem a Zebra
            await enviarPraFila(d.job.zpl, d.job.resumo);
            _estacaoAtiva = false;
            badgeEstacao('⏸ Estacao PAUSADA: escolha a Zebra no 🖨 e recarregue a pagina');
            toast('Estacao sem impressora escolhida — job devolvido pra fila. Clique em 🖨 Zebra etiqueta, escolha, e recarregue.', 'err');
            return;
          }
          const cfg = qz.configs.create(printer);
          await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'plain', data: d.job.zpl }]);
          toast('🖨️ Estacao imprimiu: ' + (d.job.resumo || 'etiqueta') + ' (pedido de ' + (d.job.por || '?') + ')', 'ok');
        } catch (e) {
          toast('Estacao: erro ao imprimir — ' + (e.message || e), 'err');
        }
        badgeEstacao('🖨️ Estacao de impressao ATIVA');
      }
    } catch (e) {
      // rede piscou: respira e tenta de novo
      await new Promise(res => setTimeout(res, 3000));
    }
    await new Promise(res => setTimeout(res, 400));
  }
}

async function iniciarEstacaoSePossivel() {
  try {
    // So auto-conecta quando ha certificado (conexao SILENCIOSA garantida
    // pelo QZ assinado) - sem cert, nao incomoda ninguem com popup no load.
    const r = await fetch('/api/qz/cert');
    const t = r.ok ? await r.text() : '';
    if (!t.includes('BEGIN CERTIFICATE')) return;
    if (!(await temQZLocal())) return; // celular / PC sem QZ: nao e estacao
    _estacaoAtiva = true;
    badgeEstacao('🖨️ Estacao de impressao ATIVA');
    loopEstacao();
  } catch (e) { /* segue sem estacao */ }
}

window.addEventListener('load', iniciarEstacaoSePossivel);

// ============================================================
// v3.89 - ETIQUETA DE DEFEITO 10x15cm (ZPL). Grita "DEFEITO" pra
// colar na caixa: NF de venda, defeito digitado, SKU, EAN, qtd e
// localizacao. Reusa o pipeline fila-local<->estacao ja existente.
// 10x15cm @203dpi = 812x1218 dots.
// ============================================================
function _zplLinhasDefeito(texto, maxChars, maxLinhas) {
  const palavras = String(texto || '').split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length <= maxChars) {
      atual = (atual + ' ' + p).trim();
    } else {
      if (atual) linhas.push(atual);
      atual = p.length > maxChars ? p.slice(0, maxChars) : p;
    }
    if (linhas.length >= maxLinhas) break;
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  return linhas;
}

function montarZplDefeito(etq) {
  const sku = String(etq.sku || '-').toUpperCase();
  const ean = String(etq.ean || '').replace(/\D/g, '');
  const nf = String(etq.nf || '-');
  const qtd = String(etq.qtd || 1);
  const local = String(etq.local || '-').toUpperCase();
  const z = ['^XA', '^CI28', '^PW812', '^LL1218', '^LH0,0'];
  // Faixa preta no topo com "DEFEITO" invertido (impossivel nao ver)
  z.push('^FO0,0^GB812,150,150^FS');                                   // bloco preto
  z.push('^FO0,35^A0N,90,90^FR^FB812,1,0,C^FDDEFEITO^FS');             // texto branco (invertido)
  // Produto (titulo)
  let y = 175;
  const tit = _zplLinhasDefeito(etq.produto || '-', 34, 2);
  for (const ln of tit) { z.push('^FO20,' + y + '^A0N,34,34^FD' + ln + '^FS'); y += 40; }
  y += 8;
  // SKU grande
  z.push('^FO20,' + y + '^A0N,60,60^FDSKU ' + sku + '^FS'); y += 74;
  // Barras do EAN (se houver)
  if (ean) {
    z.push('^FO20,' + y + '^BY3,2^BEN,90,Y,N^FD' + ean + '^FS'); y += 150;
  } else {
    z.push('^FO20,' + y + '^A0N,34,34^FDEAN: -^FS'); y += 44;
  }
  // Linha separadora
  z.push('^FO20,' + y + '^GB772,3,3^FS'); y += 20;
  // O DEFEITO (o texto que o estoquista digitou), destacado
  z.push('^FO20,' + y + '^A0N,40,40^FDPROBLEMA:^FS'); y += 48;
  const defL = _zplLinhasDefeito(etq.defeito || '-', 30, 4);
  for (const ln of defL) { z.push('^FO20,' + y + '^A0N,44,44^FD' + ln + '^FS'); y += 52; }
  y += 10;
  // Rodape: NF, qtd, localizacao
  z.push('^FO20,' + y + '^GB772,3,3^FS'); y += 16;
  z.push('^FO20,' + y + '^A0N,40,40^FDNF venda: ' + nf + '^FS'); y += 48;
  z.push('^FO20,' + y + '^A0N,40,40^FDQtd com defeito: ' + qtd + '^FS'); y += 48;
  z.push('^FO20,' + y + '^A0N,44,44^FDLocal: ' + local + '^FS');
  if (etq.seq) { y += 52; z.push('^FO20,' + y + '^A0N,40,40^FDEtiqueta ' + etq.seq + '^FS'); }
  z.push('^XZ');
  return z.join('');
}

async function imprimirEtiquetaDefeito(etq) {
  // v3.98 - UMA ETIQUETA POR UNIDADE: 3 pecas com defeito = 3 etiquetas, pra
  // colar em cada caixa. Cada uma leva "1 de 3", "2 de 3"...
  const total = Math.max(1, parseInt(etq.qtd, 10) || 1);
  const zpls = [];
  for (let i = 1; i <= total; i++) {
    zpls.push(montarZplDefeito(Object.assign({}, etq, { seq: total > 1 ? (i + ' de ' + total) : null })));
  }
  const zpl = zpls.join('');
  const resumo = ('DEFEITO ' + (etq.sku || '') + ' NF' + (etq.nf || '') + ' x' + total).slice(0, 100);
  try {
    const local = await temQZLocal();
    if (!local) {
      const d = await enviarPraFila(zpl, resumo);
      if (d.estacao_online) toast('📱→🖨️ ' + total + ' etiqueta(s) de DEFEITO enviada(s) pra ESTACAO (Zebra do notebook)', 'ok');
      else toast('⏳ Etiqueta na fila — a estacao esta OFFLINE. Abra o Devolucoes no notebook da Zebra.', 'err');
      return;
    }
    let printer = getImpressoraEtiqueta();
    if (!printer) { await escolherImpressoraEtiqueta(); printer = getImpressoraEtiqueta(); }
    if (!printer) return;
    const cfg = qz.configs.create(printer);
    await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'plain', data: zpl }]);
    toast('🏷️ ' + total + ' etiqueta(s) de DEFEITO impressa(s) → ' + printer, 'ok');
  } catch (e) {
    toast('Erro na impressao: ' + (e.message || e) + ' — QZ Tray aberto? Zebra ligada?', 'err');
  }
}

// Popup mostrado ao finalizar um PROBLEMA: imprimir a etiqueta 10x15?
function abrirPopupEtiquetaDefeito(etq, aoFechar) {
  const jaExiste = document.getElementById('popupEtqDefeito');
  if (jaExiste) jaExiste.remove();
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ov = document.createElement('div');
  ov.id = 'popupEtqDefeito';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML =
    '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,0.3);">'
    + '<div style="font-size:20px;font-weight:800;color:#c62828;text-align:center;">🏷️ Imprimir etiqueta de DEFEITO?</div>'
    + '<div style="font-size:13px;color:#666;text-align:center;margin:6px 0 14px;">Cola na caixa pra identificar fácil no estoque (10×15cm).</div>'
    + '<div style="background:#fff5f5;border:2px solid #ef9a9a;border-radius:10px;padding:12px;font-size:13px;line-height:1.5;">'
    + '<b>DEFEITO:</b> ' + esc(etq.defeito) + '<br>'
    + '<b>SKU:</b> ' + esc(etq.sku || '-') + (etq.ean ? ' · <b>EAN:</b> ' + esc(etq.ean) : '') + '<br>'
    + '<b>NF venda:</b> ' + esc(etq.nf || '-') + ' · <b>Qtd:</b> ' + esc(etq.qtd) + (etq.local ? ' · <b>Local:</b> ' + esc(etq.local) : '')
    + '</div>'
    + '<div style="display:flex;gap:10px;margin-top:16px;">'
    // b121 - INVERTIDO: quem fecha e o botao grande. Na maioria das vezes
    // o estoquista so quer sair daqui; imprimir e a excecao, entao ela
    // fica no botao pequeno e discreto, do lado.
    + '<button id="popupEtqSim" style="flex:1;background:#fff;color:#c62828;border:1px solid #c62828;border-radius:10px;padding:12px;font-size:13.5px;font-weight:700;cursor:pointer;">🖨️ Imprimir ' + (Number(etq.qtd) > 1 ? (etq.qtd + ' Etiquetas') : 'Etiqueta') + '</button>'
    + '<button id="popupEtqNao" style="flex:2;background:#561A9E;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;">Fechar</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  const fechar = () => { ov.remove(); if (typeof aoFechar === 'function') aoFechar(); };
  document.getElementById('popupEtqNao').onclick = fechar;
  document.getElementById('popupEtqSim').onclick = async () => {
    document.getElementById('popupEtqSim').disabled = true;
    document.getElementById('popupEtqSim').textContent = 'imprimindo...';
    await imprimirEtiquetaDefeito(etq);
    fechar();
  };
}
