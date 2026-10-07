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
    try { await sb.storage.createBucket(BUCKET, { public: false }); } catch (e) { /* ja existe ou sem permissao: o upload diz */ }
    garantido = true;
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
  return { salvar, carregar, BUCKET };
}

module.exports = { criarArmazem, BUCKET };
