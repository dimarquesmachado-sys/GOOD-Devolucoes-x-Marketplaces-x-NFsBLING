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

// 40x25mm @ 203dpi = 320x200 dots. v3.20.2 (calibragem = checkout b84):
// esquerda 3mm · DIREITA ~4,5mm (compensa offset fisico da impressora) ·
// SKU auto-encolhe pra sempre caber · barras mais altas (56 dots ~7mm) ·
// numero centralizado · margem inferior ~1,5mm.
function montarZplEtiqueta(p, copias) {
  const clean = s => String(s || '').replace(/[\^~]/g, ' ');
  const titulo = clean(p.nome).slice(0, 120);
  const sku = clean(p.sku);
  const ean = String(p.ean || '').replace(/\D/g, '');
  const dados = ean || sku.replace(/[^\x20-\x7E]/g, ''); // barras: EAN; sem EAN, o SKU
  if (!dados) return null;
  const LARG = 260; // 320 - 24(esq) - 36(dir)
  // SKU auto-encolhe: fonte proporcional ao tamanho, entre 12 e 21
  let hSku = Math.floor(LARG / (Math.max(sku.length, 1) * 0.68));
  hSku = Math.max(12, Math.min(21, hSku));
  const z = ['^XA', '^CI28', '^PW320', '^LL200', '^LH0,0',
    '^FO24,22^A0N,16,16^FB' + LARG + ',3,2,L^FD' + titulo + '^FS',   // titulo (3 linhas)
    '^FO24,82^A0N,' + hSku + ',' + hSku + '^FD' + sku + '^FS',       // SKU (auto-fit)
    '^FO28,110^BY2,2^BCN,56,N,N,N^FD' + dados + '^FS',               // barras altas
    '^FO24,170^A0N,18,18^FB' + LARG + ',1,0,C^FD' + dados + '^FS'];  // numero centralizado
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
