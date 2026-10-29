'use strict';
/* b580 - ARMAZEM PRIVADO DOS INDICES (dono, 06/10: "faz o indice salvar ai sim... senao atola o Bling"). Guarda um
   indice (JSON comprimido) no Supabase Storage, num bucket PRIVADO proprio — o indice tem nome de cliente e numero de
   NF, e o bucket das fotos ('fotos-problema') e publico. O bucket e criado pelo proprio servidor na 1a gravacao (a
   chave de servico pode); se ja existir, segue. Um arquivo por empresa: <chave>/<nome>.json.gz.
   Falha em qualquer ponto = devolve { ok:false } / null — quem usa cai no caminho de sempre (montar pelo Bling). */
const zlib = require('zlib');

const BUCKET = process.env.INDICES_BUCKET || 'indices-privados';

function criarArmazem({ obterSupabase, chave }) {
  let garantido = false;
  async function garantir(sb) {
    if (garantido) return;
    let falhou = false;
    try {
      const r = await sb.storage.createBucket(BUCKET, { public: false });
      const er = r && r.error;   // o supabase-js devolve a falha em .error, nao rejeita
      if (er && !(String(er.statusCode || er.status) === '409' || /already exists|duplicate/i.test(String(er.message || '')))) falhou = true;
    } catch (e) { falhou = true; }
    if (!falhou) garantido = true;   // falha passageira: tenta de novo na proxima gravacao (o upload diz se o bucket nao existe)
  }
  async function salvar(nome, objeto) {
    try {
      const sb = obterSupabase && obterSupabase();
      if (!sb || !sb.storage) return { ok: false, erro: 'sem banco' };
      await garantir(sb);
      const buf = zlib.gzipSync(Buffer.from(JSON.stringify(objeto), 'utf8'));
      const { error } = await sb.storage.from(BUCKET).upload(`${chave}/${nome}.json.gz`, buf, { upsert: true, contentType: 'application/gzip' });
      return error ? { ok: false, erro: error.message } : { ok: true, bytes: buf.length };
    } catch (e) { return { ok: false, erro: e.message }; }
  }
  async function carregar(nome) {
    try {
      const sb = obterSupabase && obterSupabase();
      if (!sb || !sb.storage) return null;
      const { data, error } = await sb.storage.from(BUCKET).download(`${chave}/${nome}.json.gz`);
      if (error || !data) return null;
      const buf = Buffer.from(await data.arrayBuffer());
      return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    } catch (e) { return null; }
  }
  // 29/10 (Codex #509): o `carregar` devolve null tanto pra 'nao existe' quanto pra 'falhou a leitura'. Quem vai
  // REGRAVAR o arquivo precisa saber a diferenca — senao uma falha passageira vira 'vazio' e a gravacao apaga tudo.
  // { ok:true, obj } (obj null = o arquivo ainda nao existe) | { ok:false, erro } (nao deu pra saber)
  async function carregarComEstado(nome) {
    try {
      const sb = obterSupabase && obterSupabase();
      if (!sb || !sb.storage) return { ok: false, erro: 'sem banco' };
      const { data, error } = await sb.storage.from(BUCKET).download(`${chave}/${nome}.json.gz`);
      if (error) {
        const txt = String((error && (error.message || error.error)) || '') + ' ' + String((error && (error.statusCode || error.status)) || '');
        if (/not.?found|404|no such|does not exist/i.test(txt)) return { ok: true, obj: null };
        return { ok: false, erro: txt.trim() || 'erro na leitura' };
      }
      if (!data) return { ok: false, erro: 'leitura vazia' };
      const buf = Buffer.from(await data.arrayBuffer());
      return { ok: true, obj: JSON.parse(zlib.gunzipSync(buf).toString('utf8')) };
    } catch (e) { return { ok: false, erro: e.message }; }
  }
  return { salvar, carregar, carregarComEstado, BUCKET };
}

module.exports = { criarArmazem, BUCKET };
