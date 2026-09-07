// Roda com: node test/busca-nome-120-dias.test.js
//
// [stated] "vc não entendeu, não tá pegando 120 dias" — ele insistiu DUAS
// vezes, e estava certo nas duas.
//
// Eu tinha olhado `nf_mais_antiga: 2026-05-07` no JSON e concluido que
// estava resolvido. Mas isso e o que entra no INDICE; a BUSCA cortava
// antes:
//
//   1. a varredura aproximada parava nas primeiras 24 e SO DEPOIS ordenava
//      por data. Como o mapa e montado do mais recente pro mais antigo,
//      essas 24 eram todas do mes atual.
//   2. e o corte final em 8 escondia o resto: com muitos homonimos, os 8
//      mais recentes sao todos de setembro.
//
// O Correios reverso leva MESES — a caixa na mao pode ser de maio. Por isso
// a janela de 120 dias existe.

const criar = require('../lib/nf-nomes.js');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

// 400 NFs de homonimos, 100 por mes: setembro, agosto, julho, maio
function indiceDeQuatroMeses() {
  let pg = 0;
  return criar({
    chamarBling: async () => {
      pg++;
      if (pg > 4) return { ok: true, data: { data: [] } };
      // b251 - ⚠️ DATA RELATIVA, nao fixa. Este teste nasceu em 04/09 com
      // as paginas em 09, 08, 07 e 05 — e a de MAIO ficou a 117 dias da
      // janela de 120. Em 07/09 ela cruzou o limite e o teste ficou
      // VERMELHO sozinho, sem ninguem mexer no codigo.
      //
      // Teste com data fixa tem prazo de validade. Agora as paginas sao
      // 10, 45, 80 e 110 dias atras: sempre dentro da janela, sempre com
      // 4 meses distintos representados.
      const diasAtras = [null, 10, 45, 80, 110][pg];
      const d = new Date(Date.now() - diasAtras * 864e5);
      const iso = d.toISOString().slice(0, 10) + ' 10:00:00';
      return { ok: true, data: { data: Array.from({ length: 100 }, (_, i) => ({
        id: pg * 1000 + i,
        numero: String(pg * 100 + i),
        dataEmissao: iso,
        contato: { nome: 'Rafael Sobrenome' + (pg * 100 + i) },
      })) } };
    },
  });
}

// a data da NF mais antiga que casou com a busca
function hitsOrdenados(r) {
  return r.candidatos.map((c) => String(c.dataEmissao)).sort()[0];
}

(async () => {
  const nf = indiceDeQuatroMeses();
  await nf.construirIndice();

  const st = nf.statusIndice();
  ok(st.total_nfs === 400, 'o indice pega as 400 NFs dos 4 meses');
  {
    const dias = Math.round((Date.now() - Date.parse(String(st.nf_mais_antiga).replace(' ', 'T'))) / 864e5);
    ok(dias >= 100 && dias <= 120, '  ate ~110 dias atras (dentro da janela, sem data fixa)');
  }

  const r = await nf.buscarPorNome('RAFAEL');
  const meses = [...new Set(r.candidatos.map((c) => String(c.dataEmissao).slice(0, 7)))].sort();

  ok(r.total_encontrados === 400, 'a busca CONSIDERA os 400 (nao para nos 24 primeiros)');
  {
    // o mais ANTIGO tem que aparecer — era o bug: so o mes atual chegava
    const maisAntigo = [...r.candidatos].sort((a, b) =>
      String(a.dataEmissao).localeCompare(String(b.dataEmissao)))[0];
    const dias = Math.round((Date.now() - Date.parse(String(maisAntigo.dataEmissao).replace(' ', 'T'))) / 864e5);
    ok(dias >= 100, 'e o mais ANTIGO (~110 dias) aparece — era o bug: so o mes atual chegava');
  }
  ok(meses.length >= 3, '  com varios meses representados (' + meses.join(', ') + ')');
  ok(r.candidatos.some((c) => c._antigo), 'os antigos vem marcados, pro estoquista saber');
  ok(r.candidatos.filter((c) => !c._antigo).length === 8,
     'os 8 mais recentes continuam vindo primeiro, sem perder ninguem');

  // b235.1: a MAIS ANTIGA nunca fica de fora (era inalcancavel: sem
  // paginacao na tela, o que nao vem aqui o estoquista nunca ve)
  const maisAntigaDoIndice = hitsOrdenados(r);
  ok(r.candidatos.some((c) => String(c.dataEmissao) === maisAntigaDoIndice),
     'a NF mais ANTIGA de todas esta entre os candidatos');

  // sem duplicata: o mesmo id nao pode aparecer duas vezes
  const ids = r.candidatos.map((c) => String(c.id));
  ok(new Set(ids).size === ids.length, 'sem candidato repetido');

  // nome que so existe em MAIO tem que ser achado.
  // (⚠️ `colapsar` tira numeros e acentos: "Sobrenome400" vira
  // "SOBRENOME". Meu primeiro teste usava nomes numerados e todos viravam a
  // MESMA chave — a premissa estava errada, nao o codigo. Aqui uso um nome
  // de letras, que e o caso real.)
  let pg2 = 0;
  const nf2 = criar({
    chamarBling: async () => {
      pg2++;
      if (pg2 > 4) return { ok: true, data: { data: [] } };
      // b251: relativa aqui tambem — mesma armadilha do bloco de cima
      const diasAtras2 = [null, 10, 45, 80, 110][pg2];
      const iso2 = new Date(Date.now() - diasAtras2 * 864e5).toISOString().slice(0, 10) + ' 10:00:00';
      // so a pagina 4 (a mais antiga) tem a "Zuleica"
      return { ok: true, data: { data: Array.from({ length: 100 }, (_, i) => ({
        id: pg2 * 1000 + i,
        numero: String(pg2 * 100 + i),
        dataEmissao: iso2,
        contato: { nome: (pg2 === 4 && i === 0) ? 'Zuleica Ferreira Antiga' : 'Fulano Comum' },
      })) } };
    },
  });
  await nf2.construirIndice();
  const r2 = await nf2.buscarPorNome('ZULEICAFERREIRA');
  {
    const achou = r2.candidatos.length > 0;
    const dias = achou
      ? Math.round((Date.now() - Date.parse(String(r2.candidatos[0].dataEmissao).replace(' ', 'T'))) / 864e5)
      : -1;
    ok(achou && dias >= 100,
       'busca por nome que so existe na pagina MAIS ANTIGA acha a NF de la');
  }

  console.log('');
  console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
  process.exit(falhas ? 1 : 0);
})();
