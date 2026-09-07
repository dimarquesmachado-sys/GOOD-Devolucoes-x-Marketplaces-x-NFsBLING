'use strict';

/**
 * lib/migrar-envs.js — copia as env vars pro nome novo, sozinho.
 * ---------------------------------------------------------------------
 * [stated 05/09] "não tem como fazer ser preenchida essas env var no bling
 * não? eu crio só a key, e vc faz algum sisteminha que pega e já preenche o
 * value lá dentro do render não?"
 *
 * Dá — e melhor: ele não precisa nem criar a chave. O `atualizarTokensNoRender`
 * faz GET de todas as vars e PUT do conjunto inteiro; a var que não existe é
 * ACRESCENTADA (`else todas.push(u)` no render-tokens). O sistema já cria
 * variável nova toda vez que rotaciona um token.
 *
 * Então esta peça só precisa: ler o valor que já está em `process.env` sob o
 * nome antigo, e gravar sob o nome novo. Zero digitação.
 *
 * ---------------------------------------------------------------------
 * ⚠️ OS CUIDADOS — isto escreve CREDENCIAL no Render
 *
 * 1. NÃO SOBRESCREVE o que já existe. Se ele já criou `GOOD_BLING_CLIENT_ID`
 *    à mão, o valor dele manda — eu não passo por cima.
 * 2. NÃO INVENTA valor. Se a var antiga não existe, aquela entrada é pulada
 *    e reportada; não gravo string vazia, que quebraria a integração de um
 *    jeito pior que não ter a var.
 * 3. LISTA O QUE FEZ, sem mostrar o valor. Ele confere pelo nome e pela
 *    contagem, não pelo segredo.
 * 4. É IDEMPOTENTE: rodar duas vezes não muda nada na segunda.
 */

/**
 * O de-para da migração da GOOD: nome histórico → nome no padrão.
 *
 * ⚠️ São só as que pertencem à EMPRESA. `EMAIL_*`, `QZ_*` e `RENDER` são do
 * SERVIÇO (o servidor de email é o mesmo para tudo, a impressora é a do
 * galpão) — essas não migram, e incluí-las aqui seria criar variável
 * duplicada à toa.
 */
const DE_PARA_GOOD = [
  'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'BLING_ACCESS_TOKEN', 'BLING_REFRESH_TOKEN',
  'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_ACCESS_TOKEN', 'ML_REFRESH_TOKEN', 'ML_USER_ID',
  'USERS', 'ADMIN_USER',
];

/**
 * Copia as vars da GOOD para o nome com prefixo.
 *
 * @param {function} atualizarTokensNoRender  o escritor do render-tokens
 * @param {object}   opcoes.simular  true = só diz o que faria, não grava
 */
async function migrarEnvsDaGood(atualizarTokensNoRender, opcoes = {}) {
  if (typeof atualizarTokensNoRender !== 'function') {
    return { ok: false, erro: 'sem o escritor do Render' };
  }

  const plano = [];
  for (const nome of DE_PARA_GOOD) {
    const novo = 'GOOD_' + nome;
    const valorAntigo = process.env[nome];
    const valorNovo = process.env[novo];

    if (valorNovo != null && valorNovo !== '') {
      plano.push({ de: nome, para: novo, acao: 'ja existe (nao toquei)' });
      continue;
    }
    if (valorAntigo == null || valorAntigo === '') {
      // ⚠️ não gravo vazio: uma var vazia é pior que ausente, porque o
      // fallback do código para de funcionar (ele testa `!== ''`)
      plano.push({ de: nome, para: novo, acao: 'PULADA: a antiga nao existe' });
      continue;
    }
    plano.push({ de: nome, para: novo, acao: 'copiar', valor: valorAntigo });
  }

  const aCopiar = plano.filter((p) => p.acao === 'copiar');
  const relatorio = plano.map((p) => ({ de: p.de, para: p.para, acao: p.acao }));

  if (opcoes.simular) {
    return { ok: true, simulacao: true, copiaria: aCopiar.length, plano: relatorio };
  }
  if (aCopiar.length === 0) {
    return { ok: true, copiadas: 0, plano: relatorio, aviso: 'nada a copiar' };
  }

  const r = await atualizarTokensNoRender(
    aCopiar.map((p) => ({ key: p.para, value: p.valor })),
  );
  if (r === false) {
    return { ok: false, erro: 'o Render recusou a gravacao — ver o log do servico', plano: relatorio };
  }

  // ⚠️ o Render REINICIA o serviço ao mudar env var. Quem chamou precisa
  // saber disso, senão parece que a rota travou.
  return {
    ok: true,
    copiadas: aCopiar.length,
    plano: relatorio,
    aviso: 'o Render vai REINICIAR o servico agora (e o normal ao mudar env var)',
  };
}

module.exports = { migrarEnvsDaGood, DE_PARA_GOOD };
