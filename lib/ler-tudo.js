'use strict';
// b728 — V-01 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): LER TUDO DO POSTGREST, PAGINA A PAGINA.
//
// O Supabase/PostgREST corta toda consulta em `max-rows` (1000 por padrao) SEM avisar: `select` sem range devolve as
// 1000 primeiras linhas e `error: null`. Relatorio e mapa de pedidos do ciclo liam assim — acima de 1000 linhas o
// relatorio somava menos do que existe e o mapa classificava peca recuperada como "com defeito".
//
// Uso: lerTudo(() => sb.from(T).select('...').eq(...).order('id'), { tamanho: 1000, maximo: 50000 })
//   - `montar` devolve uma consulta NOVA a cada chamada (o builder e mutavel); a ORDEM tem que ser estavel
//     (inclua uma coluna unica, ex.: id), senao paginas por offset podem repetir ou pular linhas;
//   - `tamanho` e o tamanho da pagina (1000 = o teto padrao; os testes usam pequeno pra provar a 2a pagina);
//   - `maximo` e o teto de seguranca (estoura em vez de ler sem fim);
//   - erro em QUALQUER pagina e lancado: parcial silencioso e pior que nada.
async function lerTudo(montar, { tamanho = 1000, maximo = 50000 } = {}) {
  if (typeof montar !== 'function') throw new TypeError('lerTudo: montar precisa ser uma funcao que devolve a consulta');
  const linhas = [];
  for (let de = 0; de < maximo; de += tamanho) {
    const r = await montar().range(de, de + tamanho - 1);
    if (r && r.error) throw Object.assign(new Error(r.error.message || 'erro na leitura'), { causa: r.error, pagina: de / tamanho });
    const pagina = (r && r.data) || [];
    linhas.push(...pagina);
    if (pagina.length < tamanho) return linhas;
  }
  throw new Error('lerTudo: passou de ' + maximo + ' linhas — a consulta precisa de filtro');
}

module.exports = { lerTudo };
