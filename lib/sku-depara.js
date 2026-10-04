'use strict';
/* b509 - DE-PARA DE SKU, multiempresa (auditoria de 02/10: so a AMB/Girassol tinha).
   Quando um produto e RENOMEADO no Bling, a venda antiga carrega o SKU velho e o cadastro hoje tem outro
   (o Full do ML nao deixa trocar o SKU depois que tem vendas). O Bling nao guarda esse historico, entao a
   ligacao fica aqui: esbarrou no SKU antigo, ele passa a valer como o atual — inclusive na NF de devolucao.
   Mesmo comportamento das funcoes da AMB (lib-AMB/supabase-AMB.js), parametrizado pela empresa:
     criarSkuDepara({ obterDb, tabelaDepara, tabelaDevolucoes, colunaData })
   obterDb() devolve o cliente do Supabase (ou null); colunaData e a data de criacao da tabela de devolucoes
   (GOOD: created_at; AMB e empresas novas: criado_em). */
function criarSkuDepara({ obterDb, tabelaDepara, tabelaDevolucoes, colunaData = 'criado_em' }) {
  const CACHE = new Map();   // SKU_ANTIGO -> { sku_atual, produto_id, ts }
  const SEM_BANCO = 'banco nao configurado';

  async function resolverSku(skuBruto) {
    const sku = String(skuBruto || '').trim();
    if (!sku) return { sku, trocado: false };
    const c = CACHE.get(sku.toUpperCase());
    if (c && (Date.now() - c.ts) < 30 * 60 * 1000) return { sku: c.sku_atual || sku, produto_id: c.produto_id || null, trocado: !!c.sku_atual, cache: true };
    const db = obterDb();
    if (!db) return { sku, trocado: false };
    try {
      const r = await db.from(tabelaDepara).select('*').eq('sku_antigo', sku).limit(1);
      if (r.error) return { sku, trocado: false, erro: r.error.message };
      const linha = (r.data || [])[0] || null;
      if (!linha) { CACHE.set(sku.toUpperCase(), { sku_atual: null, produto_id: null, ts: Date.now() }); return { sku, trocado: false }; }
      CACHE.set(sku.toUpperCase(), { sku_atual: linha.sku_atual, produto_id: linha.produto_id, ts: Date.now() });
      return { sku: linha.sku_atual || sku, produto_id: linha.produto_id || null, trocado: !!linha.sku_atual, de: sku };
    } catch (e) { return { sku, trocado: false, erro: e.message }; }
  }

  async function salvarDepara({ sku_antigo, sku_atual, produto_id, quem }) {
    const db = obterDb();
    if (!db) return { ok: false, erro: SEM_BANCO };
    const antigo = String(sku_antigo || '').trim();
    const atual = String(sku_atual || '').trim();
    if (!antigo || !atual) return { ok: false, erro: 'informe o SKU antigo e o atual' };
    if (antigo.toUpperCase() === atual.toUpperCase()) return { ok: false, erro: 'os dois SKUs sao iguais' };
    try {
      const r = await db.from(tabelaDepara).upsert({ sku_antigo: antigo, sku_atual: atual, produto_id: produto_id || null, criado_por: quem || null, criado_em: new Date().toISOString() }, { onConflict: 'sku_antigo' }).select().limit(1);
      if (r.error) return { ok: false, erro: r.error.message };
      CACHE.delete(antigo.toUpperCase());
      return { ok: true, linha: (r.data || [])[0] || null };
    } catch (e) { return { ok: false, erro: e.message }; }
  }

  async function listarDepara() {
    const db = obterDb();
    if (!db) return { ok: false, erro: SEM_BANCO, lista: [] };
    try {
      const r = await db.from(tabelaDepara).select('*').order('criado_em', { ascending: false }).limit(200);
      if (r.error) return { ok: false, erro: r.error.message, lista: [] };
      return { ok: true, lista: r.data || [] };
    } catch (e) { return { ok: false, erro: e.message, lista: [] }; }
  }

  async function apagarDepara(skuAntigo) {
    const db = obterDb();
    if (!db) return { ok: false, erro: SEM_BANCO };
    try {
      const r = await db.from(tabelaDepara).delete().eq('sku_antigo', String(skuAntigo || '').trim());
      if (r.error) return { ok: false, erro: r.error.message };
      CACHE.delete(String(skuAntigo || '').trim().toUpperCase());
      return { ok: true };
    } catch (e) { return { ok: false, erro: e.message }; }
  }

  // Correcao RETROATIVA: troca o SKU antigo pelo atual nos registros ja gravados (previa sem aplicar=true).
  async function corrigirSkusAntigos({ aplicar = false } = {}) {
    const db = obterDb();
    if (!db) return { ok: false, erro: SEM_BANCO };
    const dp = await listarDepara();
    if (!dp.ok) return { ok: false, erro: dp.erro || 'nao consegui ler o de-para' };
    const ligacoes = (dp.lista || []).filter((x) => x && x.sku_antigo && x.sku_atual);
    if (!ligacoes.length) return { ok: true, ligacoes: 0, registros: [], total: 0 };
    try {
      const r = await db.from(tabelaDevolucoes).select('id, produto_sku, produto_titulo, ' + colunaData + ', tipo, status').in('produto_sku', ligacoes.map((x) => String(x.sku_antigo))).limit(500);
      if (r.error) return { ok: false, erro: r.error.message };
      const paraQual = {};
      for (const l of ligacoes) paraQual[String(l.sku_antigo).toUpperCase()] = l.sku_atual;
      const registros = (r.data || []).map((x) => ({ id: x.id, de: x.produto_sku, para: paraQual[String(x.produto_sku || '').toUpperCase()] || null, titulo: x.produto_titulo || null, criado_em: x[colunaData] || null })).filter((x) => x.para);
      if (!aplicar) return { ok: true, previa: true, total: registros.length, registros: registros.slice(0, 50), ligacoes: ligacoes.length };
      let trocados = 0; const falhas = []; let semColunaOrigem = false;
      for (const reg of registros) {
        let u = semColunaOrigem
          ? await db.from(tabelaDevolucoes).update({ produto_sku: reg.para }).eq('id', reg.id)
          : await db.from(tabelaDevolucoes).update({ produto_sku: reg.para, produto_sku_origem: reg.de }).eq('id', reg.id);
        if (u.error && !semColunaOrigem && /produto_sku_origem/i.test(u.error.message || '')) {
          semColunaOrigem = true;
          u = await db.from(tabelaDevolucoes).update({ produto_sku: reg.para }).eq('id', reg.id);
        }
        if (u.error) falhas.push({ id: reg.id, erro: u.error.message }); else trocados++;
      }
      return { ok: true, previa: false, total: registros.length, trocados, falhas: falhas.slice(0, 10), origem_guardada: !semColunaOrigem,
        aviso: semColunaOrigem ? 'a coluna produto_sku_origem nao existe: corrigi os registros, mas o codigo anterior nao ficou guardado' : null };
    } catch (e) { return { ok: false, erro: e.message }; }
  }

  return { resolverSku, salvarDepara, listarDepara, apagarDepara, corrigirSkusAntigos };
}

module.exports = { criarSkuDepara };
