/* ============================================================
   CANCELAMENTO DE NF-e EM LOTE — Bling (AMBTotal)
   Cole ESTE arquivo inteiro no Console da aba do Bling LOGADA.

   Fluxo em 2 passos, de proposito:
     1) lote.conferir('003233,003232,003229')   -> SO LE e mostra a tabela
     2) lote.cancelar('JUSTIFICATIVA AQUI')     -> cancela o que foi conferido

   Descoberto na captura de 25/08:
     getEnvelopeCancelamento(idNota, justificativa) -> XML assinado
     cancelarNFe(idNota, XMLbase64)                 -> resultado da SEFAZ
   O certificado fica no Bling; nao precisa de nada local.
   ============================================================ */
(function () {
  const BASE = 'https://www.bling.com.br/services/notas.fiscais.server.php?f=';

  function xajax(func, args) {
    const corpo = new URLSearchParams();
    corpo.set('xajax', func);
    corpo.set('xajaxr', String(Date.now()));
    (args || []).forEach(a => corpo.append('xajaxargs[]', a == null ? '' : String(a)));
    return fetch(BASE + func, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
    }).then(r => r.text());
  }

  const dorme = ms => new Promise(r => setTimeout(r, ms));
  const soDigitos = s => String(s || '').replace(/\D/g, '');

  // "003233, 3232; 003229" -> ['003233','003232','003229'] (sem repetir)
  function parseNumeros(txt) {
    const brutos = String(txt || '').split(/[\s,;]+/).map(soDigitos).filter(Boolean);
    const vistos = new Set(); const saida = [];
    for (const b of brutos) {
      const n = b.padStart(6, '0');          // o Bling usa 6 digitos
      if (!vistos.has(n)) { vistos.add(n); saida.push(n); }
    }
    return saida;
  }

  function dataBR(d) {
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  // Puxa UMA pagina da listagem de notas de SAIDA no periodo.
  // Medido em 25/08: a listagem devolve 100 por vez e o argumento de indice 3
  // e o numero da PAGINA (a tela do Bling estava pedindo a pagina 5 quando a
  // captura foi feita). As paginas NAO vem ordenadas por numero de nota, entao
  // nao da pra parar cedo por faixa — varremos ate achar todos os alvos ou
  // acabar a lista.
  async function listarPagina(deBR, ateBR, pagina) {
    const txt = await xajax('listarNotasFiscais', [
      'S', '', 'periodo', pagina, '', deBR, ateBR, 0, 'false', '', 0, '', '', '', '',
      '<xjxobj></xjxobj>', '', '', '',
    ]);
    let json = null;
    try { json = JSON.parse(txt); } catch (e) { /* veio XML/html */ }
    return (json && Array.isArray(json.data)) ? json.data : null;
  }

  // Varre as paginas ate achar TODOS os numeros pedidos (ou acabar/estourar o teto).
  async function coletar(deBR, ateBR, alvos, tetoPaginas) {
    const teto = tetoPaginas || 60;          // 60 x 100 = 6.000 notas
    const porNumero = new Map();
    const faltam = new Set(alvos);
    let paginas = 0, lidas = 0;
    for (let p = 1; p <= teto; p++) {
      const lista = await listarPagina(deBR, ateBR, p);
      if (lista === null) return { erro: 'leitura falhou na pagina ' + p };
      paginas = p; lidas += lista.length;
      for (const n of lista) {
        const k = soDigitos(n.numero).padStart(6, '0');
        if (!porNumero.has(k)) porNumero.set(k, []);
        porNumero.get(k).push(n);
        faltam.delete(k);
      }
      console.log('   pagina ' + p + ': ' + lista.length + ' nota(s)' + (faltam.size ? ' — faltam ' + faltam.size : ' — achei todas (sigo ate o fim pra checar serie repetida)'));
      // rev2 (Codex): NAO parar quando "achou todas". O numero da NF se
      // repete entre SERIES, a listagem nao vem ordenada, e a entrada aqui
      // e so o numero. Parar cedo faria o mesmo numero em outra serie, numa
      // pagina adiante, passar por UNICO — e o cancelamento e irreversivel.
      // So o fim real da listagem encerra a varredura.
      if (lista.length < 100) break;         // acabou a lista
      await dorme(300);
    }
    return { porNumero, paginas, lidas, faltam };
  }

  const estado = { conferidas: [], problemas: [], periodo: null, rodando: false };

  async function conferir(numerosTxt, opcoes) {
    const op = opcoes || {};

    // rev2 (Codex): a PRIMEIRA coisa de toda conferencia e apagar o lote
    // anterior. Antes, se a segunda conferencia falhasse na leitura, o
    // `estado.conferidas` da primeira continuava de pe — e um cancelar()
    // seguinte oferecia pra cancelar, irreversivelmente, as notas ERRADAS,
    // com a tela dizendo que a leitura tinha falhado.
    estado.conferidas = [];
    estado.problemas = [];
    estado.periodo = null;

    if (estado.rodando) {
      console.log('%cTem um cancelamento RODANDO agora. Espere terminar antes de conferir outro lote.', 'color:#c00;font-weight:bold');
      return;
    }

    const numeros = parseNumeros(numerosTxt);
    if (!numeros.length) { console.log('%cNenhum numero valido reconhecido.', 'color:#c00'); return; }

    // periodo: por padrao o mes de agosto/2026 inteiro; da pra passar outro
    const de = op.de || '01/08/2026';
    const ate = op.ate || dataBR(new Date());
    estado.periodo = de + ' a ' + ate;

    console.log('Buscando notas de ' + de + ' a ' + ate + ' (100 por pagina) ...');
    const col = await coletar(de, ate, numeros, op.paginas);
    if (col.erro) {
      console.log('%cNAO CONSEGUI LER A LISTAGEM do Bling: ' + col.erro + '. Nada foi cancelado.', 'color:#c00;font-weight:bold');
      return;
    }
    const porNumero = col.porNumero;
    console.log('Li ' + col.lidas + ' nota(s) em ' + col.paginas + ' pagina(s).');

    const ok = []; const ruins = [];
    for (const num of numeros) {
      const achadas = porNumero.get(num) || [];
      if (!achadas.length) { ruins.push({ numero: num, motivo: 'NAO ENCONTRADA no periodo' }); continue; }
      if (achadas.length > 1) {
        const series = achadas.map(a => 'serie ' + a.serie).join(' / ');
        ruins.push({ numero: num, motivo: 'AMBIGUA — ' + achadas.length + ' notas (' + series + ')' });
        continue;                                  // nunca escolhe sozinho
      }
      const n = achadas[0];
      // Regra ajustada a pedido do Diego (25/08): "Emitida DANFE" e nota
      // AUTORIZADA cuja DANFE ja foi impressa — cancela igual. So ficam de fora
      // as que nao tem o que cancelar: ja cancelada, denegada, inutilizada,
      // rejeitada ou ainda em rascunho/pendente.
      const sit = String(n.strSituacao || '');
      const naoCancelavel = /cancelad|denegad|inutilizad|rejeitad|rascunho|pendente|aguardando/i.test(sit);
      const cancelavel = /autorizada|emitida danfe/i.test(sit) && !naoCancelavel;
      if (!cancelavel) { ruins.push({ numero: num, motivo: 'situacao "' + sit + '" (nao da pra cancelar)' }); continue; }
      ok.push({
        numero: num, serie: n.serie, idNota: n.idNota || n.id, cliente: n.strNome || n.nome,
        valor: n.valor, data: n.data, situacao: sit, chave: n.chaveAcesso,
      });
    }

    estado.conferidas = ok; estado.problemas = ruins;

    if (ok.length) { console.log('%cVAO SER CANCELADAS (' + ok.length + '):', 'color:#060;font-weight:bold'); console.table(ok); }
    if (ruins.length) { console.log('%cFICAM DE FORA (' + ruins.length + '):', 'color:#c60;font-weight:bold'); console.table(ruins); }
    if (!ok.length) { console.log('%cNada elegivel. Nada a fazer.', 'color:#c00'); return; }

    console.log('%cCONFIRA A TABELA ACIMA. Se estiver certa, rode:', 'font-weight:bold');
    console.log("   lote.cancelar('SUA JUSTIFICATIVA COM 15+ CARACTERES')");
  }

  // Desfaz os escapes de um literal JavaScript ('\'' -> "'", '\\' -> '\',
  // '\n' -> quebra de linha, '\uXXXX' -> caractere). Feito na mao, sem
  // JSON.parse nem eval: o texto vem do Bling e nao pode virar codigo.
  function desescaparLiteralJS(txt) {
    return String(txt).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (todo, dep) => {
      const c = dep[0];
      if (c === 'u' || c === 'x') {
        const cod = parseInt(dep.slice(1), 16);
        return Number.isFinite(cod) ? String.fromCharCode(cod) : todo;
      }
      if (c === 'n') return '\n';
      if (c === 'r') return '\r';
      if (c === 't') return '\t';
      if (c === 'b') return '\b';
      if (c === 'f') return '\f';
      if (c === 'v') return '\v';
      if (c === '0') return '\0';
      return c;   // \' \" \\ \/ e qualquer outro: fica o proprio caractere
    });
  }

  async function cancelarUma(item, justificativa) {
    // 1) pede o envelope assinado
    const env = await xajax('getEnvelopeCancelamento', [item.idNota, justificativa]);
    // MEDIDO em 25/08: a chamada tem TRES argumentos —
    //   callbackJaAssinadoCancelamento(id, '<evento>...</evento>', '', false)
    // A primeira versao exigia ")" logo depois do XML e nunca casava, o que
    // fazia toda nota "falhar" ANTES de qualquer envio a SEFAZ.
    const m = env.match(/callbackJaAssinadoCancelamento\(\s*\d+\s*,\s*'([\s\S]*?)'\s*,/);
    if (!m || m[1].indexOf('<evento') !== 0) {
      return { ok: false, erro: 'nao veio o XML assinado', bruto: env.slice(0, 300) };
    }
    // rev2 (Codex): m[1] e o conteudo de um literal JavaScript, entao vem
    // ESCAPADO. Uma justificativa com apostrofo chega como \' e, se a gente
    // codificasse assim, o XML mudaria DEPOIS de assinado — e a SEFAZ
    // recusaria um cancelamento que era valido.
    const xmlAssinado = desescaparLiteralJS(m[1]);
    const xmlB64 = btoa(unescape(encodeURIComponent(xmlAssinado)));

    // 2) manda cancelar
    const txt = await xajax('cancelarNFe', [item.idNota, xmlB64]);
    let r = null; try { r = JSON.parse(txt); } catch (e) { return { ok: false, erro: 'resposta ilegivel', bruto: txt.slice(0, 300) }; }
    const motivo = (String(r.xml || '').match(/<xMotivo>([^<]*)<\/xMotivo>/) || [])[1] || '';
    const cStat = (String(r.xml || '').match(/<cStat>([^<]*)<\/cStat>/) || [])[1] || '';
    // MEDIDO em 25/08: `erros` NEM SEMPRE e array — pode vir objeto ou texto.
    // A versao anterior chamava .join direto e explodia DEPOIS de a SEFAZ ja ter
    // respondido, marcando como "falha" uma nota que podia ter sido cancelada.
    let erros = '';
    try {
      if (Array.isArray(r.erros)) erros = r.erros.join('; ');
      else if (r.erros && typeof r.erros === 'object') erros = Object.values(r.erros).join('; ');
      else if (r.erros) erros = String(r.erros);
    } catch (e) { erros = String(r.erros); }
    return { ok: r.sucesso === true, cStat, motivo, erros };
  }

  async function cancelar(justificativa, opcoes) {
    const op = opcoes || {};
    const just = String(justificativa || '').trim();
    if (!estado.conferidas.length) { console.log('%cRode lote.conferir(...) primeiro.', 'color:#c00'); return; }
    if (just.length < 15) { console.log('%cA SEFAZ exige justificativa com 15+ caracteres.', 'color:#c00'); return; }

    const total = estado.conferidas.length;
    if (!op.jaConfirmei) {
      console.log('%cVOCE VAI CANCELAR ' + total + ' NOTA(S). ISSO NAO TEM VOLTA.', 'color:#c00;font-size:14px;font-weight:bold');
      console.log('Justificativa: "' + just + '"');
      console.log("Se e isso mesmo, rode:  lote.cancelar('" + just.replace(/'/g, "\\'") + "', { jaConfirmei: true })");
      return;
    }

    // rev2 (Codex): CONGELA a lista aqui, no momento em que o operador
    // confirmou. O lote leva minutos e, enquanto ele roda, um
    // lote.conferir(...) novo trocaria o estado.conferidas por baixo — e o
    // laco passaria a cancelar notas de um lote que NINGUEM confirmou.
    // A partir daqui so existe esta copia; e a trava impede o segundo lote.
    if (estado.rodando) {
      console.log('%cJa tem um cancelamento rodando. Espere terminar.', 'color:#c00;font-weight:bold');
      return;
    }
    estado.rodando = true;
    const fila = estado.conferidas.slice();

    const resultados = []; let falhasSeguidas = 0;
    try {
    for (let i = 0; i < fila.length; i++) {
      const it = fila[i];
      console.log('(' + (i + 1) + '/' + total + ') NF ' + it.numero + ' — ' + it.cliente + ' ...');
      let r;
      try { r = await cancelarUma(it, just); }
      catch (e) { r = { ok: false, erro: String(e && e.message || e) }; }

      resultados.push(Object.assign({ numero: it.numero, cliente: it.cliente }, r));
      if (r.ok) { falhasSeguidas = 0; console.log('   OK — ' + (r.cStat ? r.cStat + ' ' : '') + r.motivo); }
      else {
        falhasSeguidas++;
        console.log('%c   FALHOU — ' + (r.erro || r.erros || r.motivo || '?'), 'color:#c00');
        // 2 falhas seguidas = para. Se a SEFAZ comecou a recusar, insistir nas
        // outras 40 so suja o log e gasta tempo.
        if (falhasSeguidas >= 2) { console.log('%cPAREI: 2 falhas seguidas. Resolva a causa e rode de novo.', 'color:#c00;font-weight:bold'); break; }
      }
      await dorme(1500);   // respiro entre notas
    }

    console.log('%cRESULTADO FINAL:', 'font-weight:bold');
    console.table(resultados);
    const bons = resultados.filter(r => r.ok).length;
    console.log('Canceladas: ' + bons + ' | Falhas: ' + (resultados.length - bons) + ' | Nao tentadas: ' + (total - resultados.length));
    // tira do lote so as que DERAM CERTO; as que falharam ficam pra retentar
    estado.conferidas = fila.filter(it => !resultados.find(r => r.numero === it.numero && r.ok));
    } finally {
      estado.rodando = false;   // libera mesmo se algo estourar no meio
    }
  }

  window.lote = { conferir, cancelar, estado };
  console.log('%cPronto. Passo 1:  lote.conferir("003233,003232,003229")', 'color:#060;font-weight:bold');
  console.log('Periodo padrao: 01/08/2026 ate hoje. Pra mudar: lote.conferir("...", { de:"01/07/2026", ate:"31/07/2026" })');
})();
