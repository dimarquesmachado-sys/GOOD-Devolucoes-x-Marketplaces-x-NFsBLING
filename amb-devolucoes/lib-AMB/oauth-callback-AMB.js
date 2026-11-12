'use strict';   // o bloco rodava DENTRO de criarAppEmpresa, que e modo estrito — aqui tambem
// amb-devolucoes/lib-AMB/oauth-callback-AMB.js — peca da FABRICA (docs/MODULARIZACAO.md, fatia F3).
//
// MOVIDO de app-AMB.js em b688, SEM EDICAO: a volta do OAuth — GET /oauth/callback (Bling, ML e Magalu):
//   confere o state, troca o code pelo token da conta DESTA empresa e mostra a pagina de resultado.
//   `jaPreAquecidoPeloOAuth` continua declarada na fabrica (o pre-aquecimento la embaixo tambem le);
//   aqui chega a MESMA referencia.
// O bloco vivia dentro de criarAppEmpresa e usava 11 nomes da closure, TODOS `const` (ou funcao
// declarada) e nenhum reatribuido aqui (analise de escopo com acorn + eslint-scope): chegam por `deps`
// com o MESMO nome, entao o texto do bloco nao muda uma letra. Nada do que o bloco declara e usado fora.
// A fabrica chama este registrador NO MESMO PONTO em que o bloco estava (a ordem das rotas nao muda).
//
// ⚠️ QUEM EDITAR AQUI: este arquivo NAO enxerga mais a closure da fabrica. Nome novo que venha de la tem
// que entrar em DEPS e na chamada em app-AMB.js — test/fabrica-fonte-unica acusa; e a falta de um nome
// estoura no BOOT (a empresa aparece como `falhou` no /health), nao na requisicao.

const DEPS = ['BASE', 'bling', 'ml', 'mlReturns', 'magalu', 'NOME_EMPRESA', 'PREFIXO_ENV_EMPRESA', 'consumirState', 'redirectOAuth', 'pagina', 'jaPreAquecidoPeloOAuth'];

module.exports = function registrarOauthCallback(router, deps) {
  for (const nome of DEPS) {
    if (!deps || deps[nome] === undefined) throw new Error('oauth-callback-AMB: a fabrica nao passou a dependencia `' + nome + '`');
  }
  const { BASE, bling, ml, mlReturns, magalu, NOME_EMPRESA, PREFIXO_ENV_EMPRESA, consumirState, redirectOAuth, pagina, jaPreAquecidoPeloOAuth } = deps;

// @secao oauth-callback
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(200).send(pagina('Autorizacao negada',
      `<h1 class="erro">Autorizacao nao concluida</h1>
       <div class="card">${String(error_description || error)}</div>`, '#da3633'));
  }

  const reg = consumirState(String(state || ''));
  if (!reg) {
    return res.status(400).send(pagina('Link invalido',
      `<h1 class="erro">Link invalido ou expirado</h1>
       <div class="card">Este endereco so vale por 10 minutos depois de voce clicar no botao.
       Volte para a tela de conexao e clique de novo.</div>`, '#da3633'));
  }

  if (!code) {
    return res.status(400).send(pagina('Sem code',
      `<h1 class="erro">O marketplace nao devolveu o code</h1>
       <div class="card">Tente novamente pela tela de conexao.</div>`, '#da3633'));
  }

  try {
    if (reg.servico === 'bling') {
      const r = await bling.trocarCodePorToken(String(code));
      const teste = await bling.testeDeVida();
      return res.send(pagina('Bling conectado', `
        <h1 class="ok">Bling da ${NOME_EMPRESA} conectado</h1>
        <div class="card"><table>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Escopos</td><td>${(r.dados && r.dados.scope) || '-'}</td></tr>
          <tr><td>Teste de leitura</td><td>${teste.ok ? 'respondeu' : 'falhou'}</td></tr>
        </table></div>`));
    }

    if (reg.servico === 'ml') {
      const r = await ml.trocarCodePorToken(String(code), redirectOAuth());
      const teste = await ml.testeDeVida();
      // Com o ML recem-conectado, ja vale montar o indice.
      jaPreAquecidoPeloOAuth.ml = true;   // b415: a fila nao repete
      mlReturns.preAquecer(5000);
      return res.send(pagina('Mercado Livre conectado', `
        <h1 class="ok">Mercado Livre da ${NOME_EMPRESA} conectado</h1>
        <div class="card"><table>
          <tr><td>Conta</td><td>${teste.conta || '-'}</td></tr>
          <tr><td>user_id descoberto</td><td>${r.user_id || '-'}</td></tr>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Validade do acesso</td><td>${r.expira_em_s ? Math.round(r.expira_em_s / 3600) + 'h (renova sozinho)' : '-'}</td></tr>
        </table></div>
        <div class="aviso">O indice de devolucoes comecou a ser montado agora e leva alguns minutos.
        Acompanhe em <code>${BASE}/ml/indice?k=SUA_CHAVE</code>.</div>`));
    }

    if (reg.servico === 'magalu') {
      const r = await magalu.trocarCodePorToken(String(code), redirectOAuth());
      // ⚠️ b417 (Codex, P2): mesmo caso do ML — se o OAuth do Magalu for
      // concluido durante a espera da fila, ela dispararia de novo ao
      // acordar. Eu tratei o ML e deixei o Magalu de fora, com o mesmo bug
      // no mesmo arquivo, 20 linhas abaixo.
      //
      // ⚠️ b418 (Codex, PR #361): faltava o `5000` daqui. Sem atraso, o
      // `preAquecer()` do magalu usa o padrao de 3 MINUTOS pros tickets —
      // contra os 5s do ML (linha acima). A fila (`esperarTerminar`) so
      // olha `statusIndice().ocupado`, e ele so vira `true` quando a
      // construcao COMECA. Com 3 minutos de atraso, a 1ª conferencia da
      // fila (5s depois) achava `ocupado: false`, seguia pro Shopee, e a
      // construcao do magalu (que so comecaria 3min depois) sobrava pra
      // rodar por cima dele — a serializacao que a fila existe pra evitar.
      jaPreAquecidoPeloOAuth.magalu = true;
      magalu.preAquecer(5000);
      return res.send(pagina('Magalu conectado', `
        <h1 class="ok">Magalu da ${NOME_EMPRESA} conectado</h1>
        <div class="card"><table>
          <tr><td>Token gravado no Render</td><td>${r.persistiu ? 'sim' : 'NAO'}</td></tr>
          <tr><td>Tenant configurado</td><td>${magalu.temTenant() ? 'sim' : `<b>FALTA ${PREFIXO_ENV_EMPRESA}MAGALU_TENANT_ID</b>`}</td></tr>
        </table></div>
        <div class="aviso">⚠️ Confira que o login foi feito na conta Magalu <b>da ${NOME_EMPRESA}</b> —
        e a conta logada que fica autorizada, nao o app.
        ${magalu.temTenant() ? '' : `<br><br>Falta o tenant: abra seller.magaluentregas.com.br logado na AMB, F12 → Network → qualquer chamada ao seller-devolution-bff → header <code>x-tenant-id</code>. Grave em <code>${PREFIXO_ENV_EMPRESA}MAGALU_TENANT_ID</code> no Render.`}</div>`));
    }

    res.status(400).json({ ok: false, erro: 'servico desconhecido no state' });
  } catch (erro) {
    const detalhe = (erro.response && JSON.stringify(erro.response.data)) || erro.message;
    res.status(200).send(pagina('Falhou',
      `<h1 class="erro">Nao consegui concluir</h1><div class="card"><code>${detalhe}</code></div>`, '#da3633'));
  }
});
// @fim-secao
};
module.exports.DEPS = DEPS;
