'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/nf-entrada-naturezas-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F2).
//
// MOVIDO de app-AMB.js em b686, SEM EDICAO: a rota de diagnostico GET /nf/entrada/naturezas (211 linhas).
// Mostra, pra uma NF, como o Bling devolve as naturezas e o que o cache de naturezas da empresa guarda.
// O bloco vivia dentro de criarAppEmpresa e usava 8 nomes da closure, TODOS `const` (ou funcao
// declarada) e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por `deps`
// com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e usado fora.
// A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das rotas nao muda).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la tem
// que entrar em DEPS e na chamada em app-AMB.js — test/fabrica-fonte-unica acusa; e a falta de um nome
// estoura no BOOT (a empresa aparece como `falhou` no /health), nao na requisicao.

const DEPS = ['bling', 'FICHA_AMB', 'PREFIXO_ENV_EMPRESA', 'envAmb', 'VERSAO', 'admin', 'guardarNaturezaAMB', 'naturezaDoCacheAMB'];

module.exports = function registrarNfEntradaNaturezas(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('nf-entrada-naturezas-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { bling, FICHA_AMB, PREFIXO_ENV_EMPRESA, envAmb, VERSAO, admin, guardarNaturezaAMB, naturezaDoCacheAMB } = deps;

// @secao nf-entrada-naturezas
router.get('/nf/entrada/naturezas', admin, async (req, res) => {
  try {
    const tipo = String(req.query.tipo != null ? req.query.tipo : (envAmb('NF_ENTRADA_TIPO') || '0'));
    // b336 r3 (Codex #79): o padrao e 6 paginas porque e ASSIM que o painel
    // monta o indice de verdade (painel-AMB.html chama ?paginas=6). Calibrar
    // com 3 podia esconder uma natureza que so aparece nas paginas 4-6 e
    // ainda assim dizer que a leitura foi completa.
    const paginas = Math.min(Math.max(Number(req.query.paginas) || 6, 1), 10);
    // b391 (P1 Codex #326): SEM fallback pro id cravado da AMB aqui. A ficha
    // ja entrega o padrao certo pra AMB (fis() embute '15110882041') e vazio
    // pra quem nao configurou (ex.: Girassol) — repetir o literal aqui fazia
    // uma empresa sem `NATUREZAS_DEVOLUCAO_IDS` proprio classificar notas
    // usando a natureza DA AMB, em silencio.
    const idsDevolucao = String(FICHA_AMB.fiscal.naturezasDevolucaoIds() || envAmb('NATUREZA_DEVOLUCAO') || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const NFE_DESCARTAVEL = new Set([2, 9]);

    const porNatureza = new Map();   // id -> { qtd, exemplo_nf, exemplo_id, exemplo_contato, descricao }
    let lidas = 0, descartadas = 0, falhaLista = false;
    for (let p = 1; p <= paginas; p++) {
      const r = await bling.chamarBling(`/nfe?tipo=${tipo}&pagina=${p}&limite=100`);
      if (!r.ok) { falhaLista = true; break; }
      const lista = r.data?.data || [];
      if (!lista.length) break;
      for (const n of lista) {
        if (NFE_DESCARTAVEL.has(Number(n.situacao))) { descartadas++; continue; }
        lidas++;
        const id = String(n.naturezaOperacao?.id != null ? n.naturezaOperacao.id : 'sem_natureza');
        const at = porNatureza.get(id) || { qtd: 0, exemplo_nf: n.numero, exemplo_id: n.id, exemplo_contato: n.contato?.nome || null, descricao: n.naturezaOperacao?.descricao || null, ids_sem_natureza: [] };
        at.qtd++;
        // b336 r3 (Codex #79): a listagem as vezes vem SEM naturezaOperacao,
        // mas o indice de verdade tira a natureza do DETALHE — ou seja, essas
        // notas podem ser devolucao e entrar no aviso. Guardamos os ids pra
        // abrir uma por uma no passe seguinte, em vez de despachar todas como
        // "sem_natureza" e declarar a leitura completa.
        if (id === 'sem_natureza') at.ids_sem_natureza.push({ id: n.id, numero: n.numero, contato: n.contato?.nome || null });
        porNatureza.set(id, at);
      }
      if (lista.length < 100) break;
    }
    // b336 r3 (Codex #79): resolve as notas que vieram SEM natureza na
    // listagem, abrindo uma a uma (teto pra nao virar a rota lenta que esta
    // veio substituir; o que passar do teto deixa a leitura incompleta).
    const TETO_SEM_NATUREZA = 40;
    // b336 r4/r5 (Codex #79): a listagem as vezes vem sem naturezaOperacao e
    // so o detalhe revela. Duas armadilhas ja pegas aqui:
    //  r4 - sem avanco, toda chamada reabria as MESMAS 40 e a leitura nunca
    //       fechava, com a rota mandando "tente de novo" como se fosse falha
    //       do Bling;
    //  r5 - com cursor (?pular=N) ela avancava mas RECOMECAVA a contagem: a
    //       ultima fatia se declarava completa mostrando so as notas dela, e
    //       uma natureza que aparecesse numa fatia anterior sumia do resultado.
    // Solucao: o que ja foi resolvido fica GUARDADO (CACHES.naturezasNf). Cada
    // rodada gasta seu orcamento abrindo notas NOVAS e soma as antigas de
    // graca, entao o resultado so cresce e a ultima rodada tem tudo. Basta
    // repetir a MESMA URL ate sem_natureza_nao_lidas chegar a zero.
    let falhaDetalhe = 0, semNaturezaNaoLidas = 0, semNaturezaTotal = 0, resolvidasDoCache = 0;
    const pendentes = porNatureza.get('sem_natureza');
    if (pendentes) {
      const fila = pendentes.ids_sem_natureza || [];
      semNaturezaTotal = fila.length;
      porNatureza.delete('sem_natureza');
      let orcamento = TETO_SEM_NATUREZA;
      for (const nota of fila) {
        let natId = null, natDesc = null, falhou = false;
        const emCache = naturezaDoCacheAMB(nota.id);
        if (emCache) {
          natId = emCache.id; natDesc = emCache.descricao; resolvidasDoCache++;
        } else if (orcamento > 0) {
          orcamento--;
          try {
            const rD = await bling.chamarBling(`/nfe/${nota.id}`);
            if (rD.ok) {
              const nat = rD.data?.data?.naturezaOperacao || null;
              natId = nat && nat.id != null ? String(nat.id) : null;
              natDesc = (nat && nat.descricao) || null;
              guardarNaturezaAMB(nota.id, natId, natDesc);
            } else falhou = true;
          } catch (e) { falhou = true; }
          if (falhou) falhaDetalhe++;
          await new Promise(r => setTimeout(r, 120));
        } else {
          semNaturezaNaoLidas++;   // fica pra proxima rodada
          continue;
        }
        const chave = natId || 'sem_natureza';
        const at = porNatureza.get(chave) || { qtd: 0, exemplo_nf: nota.numero, exemplo_id: nota.id, exemplo_contato: nota.contato, descricao: natDesc, ids_sem_natureza: [] };
        at.qtd++;
        if (!at.descricao && natDesc) at.descricao = natDesc;
        if (chave === 'sem_natureza') at.descricao_indisponivel = true;
        porNatureza.set(chave, at);
      }
    }

    // b337 r3 (Codex #80): a descricao DA NOTA continua sendo buscada no
    // detalhe (uma nota por natureza), porque e ELA que o indice le. Ao trocar
    // a fonte do NOME pelo catalogo eu apaguei este passe — e com isso uma
    // natureza cuja nota diz "devolucao" so no detalhe aparecia como excluida,
    // e a rota mandava por na env um id que ja estava valendo. O catalogo dá o
    // nome de exibicao; o detalhe diz o que o indice enxerga. Os dois convivem.
    for (const [id, at] of porNatureza) {
      if (id === 'sem_natureza' || at.descricao_nota) continue;
      if (at.descricao) { at.descricao_nota = at.descricao; continue; }   // ja veio na listagem
      try {
        const rD = await bling.chamarBling(`/nfe/${at.exemplo_id}`);
        if (rD.ok) at.descricao_nota = rD.data?.data?.naturezaOperacao?.descricao || null;
        else { falhaDetalhe++; at.descricao_indisponivel = true; }
      } catch (e) { falhaDetalhe++; at.descricao_indisponivel = true; }
      await new Promise(r => setTimeout(r, 120));
    }

    // b337 - NOME DA NATUREZA VEM DO CATALOGO, nao da nota.
    // A b336 tirava a descricao do detalhe da NF-e (naturezaOperacao.descricao)
    // e na conta da AMB isso volta SEMPRE null: rodada real de 21/08 leu 456
    // notas e as 4 naturezas sairam sem nome nenhum — a rota nao cumpria o que
    // ela existe pra fazer. O catalogo `/naturezas-operacoes` tem id+descricao
    // (a sonda da b283 ja provou: 22 itens, e la esta "Devolucao de Mercadoria
    // - Entrada"), e a lib ja sabe consultar (bling.listarNaturezas).
    let catalogoOk = false, catalogoErro = null, semNomeNoCatalogo = 0;
    try {
      const rCat = await bling.listarNaturezas(false);
      if (rCat.ok) {
        catalogoOk = true;
        const porId = new Map((rCat.naturezas || []).map(n => [String(n.id), n.descricao]));
        for (const [id, at] of porNatureza) {
          if (id === 'sem_natureza') continue;
          // b337 r2/r3 (Codex #80): a descricao da NOTA ja foi guardada no
          // passe acima — o catalogo so preenche o nome de exibicao.
          // b337 r4 (Codex #80): quando a natureza vem sem descricao, a lib
          // devolve o rotulo sintetico "natureza <id>" — que NAO identifica
          // nada. Aceita-lo como nome valido liberava a calibragem com o
          // operador sem saber o que aquilo e.
          const bruto = porId.get(String(id));
          const nome = (bruto && bruto !== ('natureza ' + id)) ? bruto : null;
          if (nome) { at.descricao = nome; at.descricao_via = 'catalogo'; }
          else if (at.descricao_nota) {
            // b337 r4 (Codex #80): faltou no catalogo mas a NOTA tem nome —
            // isso identifica a natureza, entao serve de exibicao e NAO e
            // motivo pra suspender a calibragem.
            at.descricao = at.descricao_nota; at.descricao_via = 'nota';
          } else { at.descricao_indisponivel = true; semNomeNoCatalogo++; }
        }
      } else catalogoErro = rCat.erro || ('status ' + rCat.status);
    } catch (e) { catalogoErro = String(e.message || e); }
    // catalogo fora do ar = ninguem tem nome; dizer "leitura completa" aqui
    // seria repetir o erro da b336 r2 (conselho de calibragem com cara de
    // resultado bom).
    if (!catalogoOk) {
      for (const [id, at] of porNatureza) {
        if (id === 'sem_natureza') continue;
        // b337 r4 - sem catalogo, o nome da nota ainda identifica a natureza
        if (!at.descricao && at.descricao_nota) { at.descricao = at.descricao_nota; at.descricao_via = 'nota'; }
        if (!at.descricao) at.descricao_indisponivel = true;
      }
    }

    const naturezas = [...porNatureza.entries()].map(([id, at]) => ({
      id,
      descricao: at.descricao,
      descricao_indisponivel: !!at.descricao_indisponivel,
      qtd: at.qtd,
      exemplo_nf: at.exemplo_nf,
      exemplo_contato: at.exemplo_contato,
      descricao_via: at.descricao_via || (at.descricao ? 'nota' : null),
      descricao_da_nota: at.descricao_nota || null,
      // b337 - `entra_no_aviso` continua sendo o que o INDICE faz hoje, e o
      // indice le a descricao da NOTA (que vem vazia nesta conta) — nao a do
      // catalogo. Marcar true so porque o catalogo diz "devolucao" prometeria
      // um aviso que nao acontece. O nome do catalogo serve pra DECIDIR; quem
      // liga de fato e o id na env.
      entra_no_aviso: (id !== 'sem_natureza' && idsDevolucao.indexOf(id) >= 0)
        || /devolu/i.test(String(at.descricao_nota || '')),
      parece_devolucao_pelo_nome: /devolu/i.test(String(at.descricao || '')),
      // b336 r2 (Codex #79): valor pronto POR NATUREZA. Nunca uma env com
      // TODAS as rejeitadas juntas — isso metia compra de fornecedor,
      // transferencia e conserto no aviso de uma vez. Quem decide se aquela
      // natureza e devolucao de cliente e o Diego, uma a uma.
      se_for_devolucao_de_cliente_use: (id === 'sem_natureza' || (idsDevolucao.indexOf(id) >= 0))
        ? null
        : idsDevolucao.concat([id]).join(','),
    })).sort((a, b) => b.qtd - a.qtd);

    // b337 - sem catalogo nao ha nome nenhum: isso e leitura incompleta.
    // b337 r2 (Codex #80): id que nao esta no catalogo tambem suspende — o
    // operador nao consegue identificar aquela natureza, que e exatamente a
    // situacao que esta rota existe pra evitar.
    const incompleto = falhaLista || falhaDetalhe > 0 || semNaturezaNaoLidas > 0 || !catalogoOk || semNomeNoCatalogo > 0;
    res.json({ ok: true, versao: VERSAO, tipo_lido: tipo, paginas_pedidas: paginas,
      leitura_incompleta: incompleto,
      falha_na_listagem: falhaLista, descricoes_que_falharam: falhaDetalhe,
      catalogo_de_naturezas_ok: catalogoOk, catalogo_erro: catalogoErro,
      naturezas_sem_nome_no_catalogo: semNomeNoCatalogo,
      sem_natureza_total: semNaturezaTotal,
      sem_natureza_ja_resolvidas: resolvidasDoCache,
      sem_natureza_nao_lidas: semNaturezaNaoLidas,
      notas_lidas: lidas, canceladas_ou_denegadas: descartadas,
      env_atual: idsDevolucao,
      naturezas,
      o_que_fazer: !catalogoOk
        ? 'SEM O CATALOGO DE NATUREZAS (o Bling nao respondeu /naturezas-operacoes) — as naturezas ficam sem nome e nao da pra decidir; rode de novo daqui a pouco'
        : semNomeNoCatalogo > 0
        ? `${semNomeNoCatalogo} natureza(s) usada(s) nas notas NAO estao no catalogo (descricao_indisponivel=true) — sem nome nao da pra decidir se e devolucao de cliente. Nao calibre; avise que o catalogo precisa ser lido alem da 1a pagina`
        : (falhaLista || falhaDetalhe > 0)
        ? 'LEITURA INCOMPLETA — o Bling falhou em parte das consultas; nao calibre com este resultado, rode de novo daqui a pouco'
        : (semNaturezaNaoLidas > 0
          ? `FALTA LER ${semNaturezaNaoLidas} nota(s) (nao e erro do Bling): abra ESTA MESMA URL de novo — cada rodada avanca e SOMA com as anteriores. Calibre so quando sem_natureza_nao_lidas chegar a 0`
          : `olhe as naturezas com entra_no_aviso=false: se ALGUMA delas for devolucao de cliente (o exemplo_contato ajuda a reconhecer), cole o campo se_for_devolucao_de_cliente_use dela em ${PREFIXO_ENV_EMPRESA}NATUREZAS_DEVOLUCAO_IDS no Render. Uma de cada vez — nao junte todas`) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});
// @fim-secao
};
module.exports.DEPS = DEPS;
