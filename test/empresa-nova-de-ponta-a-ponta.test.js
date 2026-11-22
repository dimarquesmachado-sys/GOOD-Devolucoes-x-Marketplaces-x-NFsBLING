'use strict';
// b800 — V-17 (dono, 22/11: "se ligar CNPJ hoje vai rodar na hora 100%? é só eu te passar o CNPJ?"):
// O ENSAIO DE UM CNPJ NOVO, DE PONTA A PONTA, COM AS PECAS DE VERDADE.
//
//   gerador (scripts/nova-empresa.js) → ficha + contrato colados numa COPIA do repo (test/_empresa-nova.js)
//   → provisionar_empresa('_<sufixo>') num PostgreSQL 16 com o schema de producao → PostgREST de verdade
//   → server.js DA COPIA (as 3 de hoje + a nova) → tela, login, triagem e recado, pela rota da empresa nova.
//
// O que ele prova — e o que acusa quando alguem quebrar:
//   - com SO o que o gerador manda criar (usuarios, admin, segredo da sessao; os ids fiscais) a empresa MONTA;
//   - a tela dela abre sem arquivo faltando: o logo que ainda nao foi subido cai no padrao (era imagem quebrada);
//   - nenhuma tela dela mostra o NOME DE OUTRA EMPRESA (titulo da pagina de defeitos, aviso do Magalu, instrucao
//     de conexao) — a 7a forma de vazamento, a que so aparece quando uma empresa de verdade entra;
//   - estoquista e admin entram; a sessao dela nao abre outra empresa;
//   - aprovar, problema, consertado e recado gravam nas tabelas DELA, e em nenhuma outra;
//   - as 3 empresas de hoje continuam de pe.
// O que ele NAO prova (so com a empresa de verdade): credenciais do Bling/ML/Magalu/Shopee, a NF de devolucao na conta
// dela e a extensao — o checklist esta em docs/PLUGAR-EMPRESA-NOVA.md.
// Precisa do PostgreSQL 16 e baixa o PostgREST fixado (como test/postgrest-real-triagem.test.js). Roda com:
//   node test/empresa-nova-de-ponta-a-ponta.test.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { subirPostgres } = require('./_postgres-descartavel');
const { subirPostgrestReal } = require('./_postgrest-real');
const { copiaComEmpresaNova } = require('./_empresa-nova');
let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); return !!c; };
const json = (r) => { try { return JSON.parse(r.corpo); } catch (e) { return null; } };

// nome que nenhuma empresa de hoje tem, nem pedaco dele
const NOVA = { chave: 'serrana', nome: 'Comercial Serrana', cookie: 'sessao_serrana' };
const DE_HOJE = [
  { nome: 'GOOD', rota: '', cookie: 'sessao' },
  { nome: 'AMB', rota: '/amb', prefixo: 'AMB_', cookie: 'sessao_amb' },
  { nome: 'Girassol', rota: '/girassol', prefixo: 'GIRASSOL_', cookie: 'sessao_girassol' },
];
// o nome de OUTRA empresa num texto que a empresa nova mostra (maiusculas de proposito: `amb-devolucoes`, o nome
// tecnico do modulo, nao e marca; nomes de ARQUIVO como manifest-AMB.json saem antes de procurar)
const OUTRA_EMPRESA = /\bAMB\b|AMBTotal|\bGOOD\b|Girassol|GIRASSOL/;
const semArquivos = (t) => String(t).replace(/[\w./-]*-AMB\.(?:json|html|js|png|css)\b/g, '').replace(/\b(?:js|css|lib|public)-AMB\b/g, '');
const textoVisivel = (html) => semArquivos(String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '));
const achados = (texto) => { const m = []; const re = new RegExp('.{0,50}(?:' + OUTRA_EMPRESA.source + ').{0,50}', 'g'); let x; while ((x = re.exec(texto)) && m.length < 4) m.push(x[0].trim()); return m; };
const semOutraEmpresa = (texto, onde) => { const a = achados(texto); return ok(a.length === 0, '⚠️ ' + onde + ': nenhum nome de outra empresa no que a tela mostra' + (a.length ? ' — ' + JSON.stringify(a) : '')); };

(async () => {
  let pg = null, rest = null, s = null, copia = null;
  try {
    copia = copiaComEmpresaNova({ chave: NOVA.chave, nome: NOVA.nome });
    ok(copia.sufixo === '_serrana' && copia.prefixo === 'SERRANA_' && copia.envs.includes('SERRANA_SESSION_SECRET'),
      '  o gerador entregou ficha, contrato e a lista de envs (' + copia.envs.length + ') da empresa nova');

    // ── o passo do dono no SQL Editor: colar a funcao e provisionar
    pg = await subirPostgres();
    pg.sql(fs.readFileSync(path.join(copia.dir, 'sql', 'provisionar-empresa.sql'), 'utf8'));
    pg.sql(`select * from public.provisionar_empresa('${copia.sufixo}')`);
    const tabelas = pg.sql(`select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public' and table_name like '%\\${copia.sufixo}'`).split(',').filter(Boolean);
    ok(tabelas.length === 9, '⚠️ provisionar_empresa criou as 9 tabelas da empresa nova (' + tabelas.length + ': ' + tabelas.join(', ') + ')');
    rest = await subirPostgrestReal(pg);
    const chaveBanco = rest.chave('service_role');

    // ── as envs: as das 3 de hoje (como no T-02) e, pra nova, SO o que o gerador manda — sem par proprio de Supabase
    // e sem token de marketplace (e o estado do dia 1, antes de clicar em "conectar")
    const env = {
      SUPABASE_URL: rest.url, SUPABASE_KEY: chaveBanco, GOOD_SUPABASE_URL: rest.url, GOOD_SUPABASE_KEY: chaveBanco,
      USERS: 'esto:s1:Estoquista,dono:s2:Dono', ADMIN_USER: 'dono', GOOD_USERS: 'esto:s1:Estoquista,dono:s2:Dono', GOOD_ADMIN_USER: 'dono',
      SESSION_SECRET: 'segredo-da-good-so-pra-teste-0123456789', ADMIN_SESSION_SECRET: 'segredo-fixo-de-teste-com-40-caracteres!!',
      ADMIN_KEY: 'chave-admin-so-pra-teste',
    };
    for (const e of DE_HOJE.slice(1)) {
      env[e.prefixo + 'USERS'] = 'esto:s1,dono:s2'; env[e.prefixo + 'ADMIN_USER'] = 'dono';
      env[e.prefixo + 'SESSION_SECRET'] = 'segredo-da-' + e.nome.toLowerCase() + '-so-pra-teste-0123456789';
    }
    const daNova = {
      USERS: 'esto:s1,dono:s2', ADMIN_USER: 'dono', SESSION_SECRET: 'segredo-da-serrana-so-pra-teste-0123456789',
      BLING_CLIENT_ID: 'bling-id-de-teste', BLING_CLIENT_SECRET: 'bling-segredo-de-teste', ML_CLIENT_ID: '1234567890', ML_CLIENT_SECRET: 'ml-segredo-de-teste',
      ID_EMPRESA_CONTROL: '900000001', DEPOSITO_GERAL: '900000002', NATUREZAS_DEVOLUCAO_IDS: '900000003',
      // b801: os canais, com os nomes que o gerador lista (sem token: nenhum deles liga pra fora)
      MAGALU_CLIENT_ID: 'magalu-id-de-teste', MAGALU_CLIENT_SECRET: 'magalu-segredo-de-teste', MAGALU_TENANT_ID: 'tenant-de-teste', SHOPEE_LOJA_KEY: 'loja-da-serrana',
    };
    for (const [k, v] of Object.entries(daNova)) env[copia.prefixo + k] = v;
    const dosCanais = copia.canais.flatMap((c) => c.envs);
    const foraDaLista = Object.keys(daNova).filter((k) => !copia.envs.includes(copia.prefixo + k) && !dosCanais.includes(copia.prefixo + k) && !/^(ID_EMPRESA_CONTROL|DEPOSITO_GERAL|NATUREZAS_DEVOLUCAO_IDS)$/.test(k));
    ok(foraDaLista.length === 0, '  o ensaio so usa env que o gerador manda criar (fora da lista: ' + (foraDaLista.join(', ') || 'nenhuma') + ')');

    // ── o server.js DA COPIA
    const { subir } = require(path.join(copia.dir, 'test', '_boot-real'));
    s = await subir({ env, tetoMs: 60000 });
    if (!ok(s.subiu, '⚠️ o server.js sobe com a empresa nova ao lado das 3 de hoje' + (!s.subiu ? ' — ' + s.motivo + '\n' + s.fimDoLog() : ''))) throw new Error('nao subiu');
    const pedirComChave = (caminho) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: s.porta, path: caminho, headers: { 'x-admin-key': env.ADMIN_KEY } }, (res) => {
        let c = ''; res.on('data', (x) => { c += x; }); res.on('end', () => resolve({ status: res.statusCode, corpo: c }));
      });
      req.on('error', () => resolve({ status: 0, corpo: '' })); req.setTimeout(8000, () => { req.destroy(); });
    });
    const montagem = ((json(await s.pedir('/health')) || {}).coordenacao || {}).montagem_empresas || [];
    const estadoDa = (c) => (montagem.find((m) => m.chave === c) || {}).estado;
    ok(estadoDa(NOVA.chave) === 'montada', '⚠️ /health: a empresa nova esta "montada" em ' + copia.rota + ' (' + JSON.stringify(montagem) + ')');
    ok(estadoDa('ambtotal') === 'montada' && estadoDa('girassol') === 'montada', '  e a AMB e a Girassol continuam montadas');
    const avisoMarca = s.log().split('\n').filter((l) => /SERRANA\/MARCA/.test(l));
    ok(avisoMarca.length === 1 && /marcas\/serrana\/icone-192\.png/.test(avisoMarca[0]), '  o boot avisa UMA vez que o logo ainda nao foi subido (' + (avisoMarca[0] || 'sem aviso').slice(0, 160) + ')');

    // ── a tela de entrada: abre, tem a marca dela e nada falta
    const entrada = await s.pedir(copia.rota + '/');
    const titulo = (h) => ((String(h).match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    ok(entrada.status === 200 && titulo(entrada.corpo).indexOf(NOVA.nome) === 0, '⚠️ a tela de entrada abre com o nome dela no titulo ("' + titulo(entrada.corpo) + '")');
    // so as referencias do HTML: o miolo dos scripts embutidos sai antes (la dentro ha `<img src="' + ... + '">` montado em JS)
    const soHtml = entrada.corpo.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>');
    const refs = Array.from(new Set(Array.from(soHtml.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/gi)).map((m) => m[1])
      .filter((u) => u && !/^(https?:|data:|#|\/\/)/.test(u))));
    const quebradas = [];
    for (const u of refs) { const r = await s.pedir(u.startsWith('/') ? u : copia.rota + '/' + u); if (r.status !== 200) quebradas.push(u + ' → ' + r.status); }
    ok(refs.length >= 10 && quebradas.length === 0, '⚠️ os ' + refs.length + ' arquivos que a tela pede (scripts, estilos, logo, icones) respondem 200' + (quebradas.length ? ' — FALTAM: ' + quebradas.join(' | ') : ''));
    semOutraEmpresa(textoVisivel(entrada.corpo), 'tela de entrada');
    // b801: o tema padrao do gerador (azul medio, texto branco) — o "+" do Lancar Defeito usa a cor do texto, nao o ambar
    // (2,3:1 na ponta clara do cabecalho); a AMB continua no ambar
    const destaque = (h) => ((String(h).match(/--destaque-sobre-marca:([^;]+);/) || [])[1] || '').trim();
    const destaqueAmb = destaque((await s.pedir('/amb/')).corpo);
    ok(destaque(entrada.corpo) === 'var(--sobre-marca)' && destaqueAmb === '#FFD54F', '⚠️ o destaque do cabecalho: a empresa nova (tema do gerador) usa a cor do texto; a AMB continua ambar ("' + destaque(entrada.corpo) + '" / "' + destaqueAmb + '")');
    const manifesto = json(await s.pedir(copia.rota + '/manifest-AMB.json')) || {};
    const icones = (manifesto.icons || []).map((i) => i.src);
    const iconesRuins = [];
    for (const u of icones) { const r = await s.pedir(copia.rota + '/' + u); if (r.status !== 200 || !/^image\//.test(String(r.headers['content-type']))) iconesRuins.push(u + ' → ' + r.status); }
    ok(String(manifesto.name || '').indexOf(NOVA.nome) === 0 && icones.length >= 1 && iconesRuins.length === 0,
      '⚠️ o atalho do celular (manifesto) tem o nome dela e icone que existe (' + JSON.stringify({ nome: manifesto.name, icones }) + (iconesRuins.length ? ' FALTAM ' + iconesRuins.join(',') : '') + ')');

    // ── gente: estoquista e admin entram; a sessao dela nao vale em outra empresa
    const login = async (e, u, p) => {
      const r = await s.pedir(e.rota + '/api/auth/login', { metodo: 'POST', corpo: { usuario: u, senha: p } });
      return ((r.headers['set-cookie'] || []).find((x) => x.startsWith(e.cookie + '=')) || '').split(';')[0];
    };
    const eNova = { rota: copia.rota, cookie: NOVA.cookie };
    const esto = await login(eNova, 'esto', 's1'), dono = await login(eNova, 'dono', 's2');
    const quem = async (rota, cookie) => json(await s.pedir(rota + '/api/auth/me', { cookie })) || {};
    ok(esto && dono && (await quem(copia.rota, dono)).tipo === 'admin' && (await quem(copia.rota, esto)).tipo !== 'admin', '⚠️ o estoquista e o admin da empresa nova entram, cada um com o seu papel');
    ok(!(await quem('/amb', dono)).usuario && !(await quem('/girassol', dono)).usuario && !(await quem('', dono)).usuario, '⚠️ a sessao dela NAO abre a AMB, a Girassol nem a GOOD');

    // ── as outras telas dela: nome dela, nenhum nome de outra
    const defeitos = await s.pedir(copia.rota + '/defeitos-AMB.html', { cookie: dono });
    ok(defeitos.status === 200 && titulo(defeitos.corpo).indexOf(NOVA.nome) === 0, '⚠️ a pagina de defeitos tem o nome dela no titulo ("' + titulo(defeitos.corpo) + '")');
    semOutraEmpresa(titulo(defeitos.corpo) + ' ' + textoVisivel(defeitos.corpo), 'pagina de defeitos');
    const painel = await s.pedir(copia.rota + '/painel', { cookie: dono });
    ok(painel.status === 200 && titulo(painel.corpo).indexOf(NOVA.nome) === 0, '  o painel admin abre com o nome dela no titulo ("' + titulo(painel.corpo) + '")');
    semOutraEmpresa(textoVisivel(painel.corpo), 'painel admin');
    ok((await s.pedir(copia.rota + '/painel', { cookie: esto })).status !== 200, '  e o estoquista dela nao abre o painel admin');
    const conectar = await pedirComChave(copia.rota + '/conectar');
    ok(conectar.status === 200 && textoVisivel(conectar.corpo).indexOf('Conectar o Bling da ' + NOVA.nome) >= 0, '  a tela de conectar e a dela (' + conectar.status + ')');
    semOutraEmpresa(textoVisivel(conectar.corpo), 'tela de conectar');
    const espreita = await s.pedir(copia.rota + '/api/espreita', { cookie: dono, timeoutMs: 20000 });
    const faltaMagalu = (((json(espreita) || {}).fontes || {}).magalu || {}).falta;
    ok(espreita.status === 200 && typeof faltaMagalu === 'string' && faltaMagalu.indexOf(NOVA.nome) >= 0, '⚠️ o aviso de "Magalu desligada" fala da conta DELA ("' + faltaMagalu + '")');
    semOutraEmpresa(semArquivos(espreita.corpo), 'resposta da espreita (o que o painel escreve)');
    semOutraEmpresa(semArquivos((await s.pedir(copia.rota + '/status')).corpo), 'status');

    // ── b801: os canais que o gerador lista sao os que o servidor LE (o diagnostico da propria empresa responde)
    const cfg = json(await pedirComChave(copia.rota + '/config')) || {};
    const lido = (cfg.configurado || {});
    ok(lido.magalu && lido.magalu.client_id === true && lido.magalu.tenant === 'tenant-de-teste' && lido.shopee && lido.shopee.loja === 'loja-da-serrana',
      '⚠️ as envs de canal do gerador chegam no servidor: Magalu (client e tenant) e a loja da Shopee (' + JSON.stringify({ magalu: lido.magalu, shopee: lido.shopee }) + ')');
    const doEmail = (copia.canais.find((c) => c.nome === 'E-mail') || { envs: [] }).envs;
    const pedidasNoEmail = String((cfg.email || {}).falta || '').match(/SERRANA_EMAIL_[A-Z]+/g) || [];
    ok(pedidasNoEmail.length >= 3 && pedidasNoEmail.every((e) => doEmail.includes(e)), '⚠️ e as do e-mail que o servidor diz que faltam estao TODAS na lista do gerador (' + pedidasNoEmail.join(', ') + ')');

    // ── a triagem grava nas tabelas DELA
    const T = 'devolucoes' + copia.sufixo;
    const base = (n) => ({
      marketplace: 'mercadolivre', order_id: '2000090000000' + n, shipment_id: '49000000000' + n, tracking: 'TRKSERRANA' + n, buyer_nome: 'Cliente Serrana',
      produto_sku: 'SKU-SERRANA', produto_titulo: 'Produto Serrana', produto_qtd: 1, nf_numero: '9234' + n, nf_serie: '1',
    });
    const linha = (n) => JSON.parse(pg.sql(`select row_to_json(t) from public.${T} t where shipment_id = '${base(n).shipment_id}' limit 1`) || 'null');
    const desde = rest.pedidos.length;
    const r1 = await s.pedir(copia.rota + '/api/triagem/aprovar', { metodo: 'POST', cookie: esto, corpo: Object.assign(base(1), { fotos: [] }) });
    const l1 = linha(1);
    ok(r1.status === 200 && (json(r1) || {}).ok === true && l1 && l1.produto_sku === 'SKU-SERRANA' && l1.funcionario === 'esto', '⚠️ APROVAR (estoquista) grava em ' + T + ' (' + r1.status + ' ' + String(r1.corpo).slice(0, 140) + ')');
    const r2 = await s.pedir(copia.rota + '/api/triagem/problema', { metodo: 'POST', cookie: dono, corpo: Object.assign(base(2), { descricao: 'tampa amassada', localizacao: 'DEF-A3', defeito_qtd: 2, fotos: [], sem_fotos: true }) });
    const l2 = linha(2);
    ok(r2.status === 200 && (json(r2) || {}).ok === true && l2 && l2.localizacao === 'DEF-A3' && Number(l2.defeito_qtd) === 2, '⚠️ PROBLEMA (admin) grava com local e quantidade (' + r2.status + ' ' + String(r2.corpo).slice(0, 140) + ')');
    const r3 = await s.pedir(copia.rota + '/api/triagem/consertado', { metodo: 'POST', cookie: esto, corpo: Object.assign(base(3), { descricao: 'fio solto', peca: 'soquete', fotos: [] }) });
    ok(r3.status === 200 && (json(r3) || {}).ok === true && !!linha(3), '⚠️ CONSERTADO grava (' + r3.status + ' ' + String(r3.corpo).slice(0, 140) + ')');
    const txt = 'conferir a tampa Serrana';
    const rc = await s.pedir(copia.rota + '/api/admin/recado', { metodo: 'POST', cookie: dono, corpo: { chave: 'PEDRECSERRANA', identificador: 'PEDRECSERRANA', texto: txt } });
    const idRec = pg.sql(`select id from public.recados${copia.sufixo} where texto = '${txt}' limit 1`);
    const rk = /^\d+$/.test(idRec) ? await s.pedir(copia.rota + '/api/recado/' + idRec + '/ciente', { metodo: 'POST', cookie: esto, corpo: {} }) : { status: 0, corpo: 'recado nao gravado' };
    const cientePor = /^\d+$/.test(idRec) ? pg.sql(`select coalesce(ciente_por, '') from public.recados${copia.sufixo} where id = ${idRec}`) : '';
    ok(rc.status === 200 && rk.status === 200 && cientePor === 'esto', '⚠️ RECADO: o admin cria e o estoquista da ciente, na tabela dela (' + rc.status + '/' + rk.status + ', ciente_por "' + cientePor + '")');
    const recusadas = rest.pedidos.slice(desde).filter((p) => /POST|PATCH|PUT|DELETE/.test(p.metodo) && p.status >= 400);
    ok(recusadas.length === 0, '⚠️ nenhuma escrita recusada pelo banco (coluna que falta, tipo, constraint)' + (recusadas.length ? ': ' + recusadas.map((p) => p.metodo + ' ' + p.caminho.slice(0, 80) + ' → ' + p.status + ' ' + p.erro).join(' | ') : ''));
    const cont = (t) => Number(pg.sql(`select count(*) from public.${t}`));
    const contagem = [cont(T), cont('devolucoes'), cont('devolucoes_amb'), cont('devolucoes_girassol'), cont('recados' + copia.sufixo), cont('recados'), cont('recados_amb'), cont('recados_girassol')];
    ok(contagem.join('/') === '3/0/0/0/1/0/0/0', '⚠️ as 3 devolucoes e o recado estao SO nas tabelas dela — nada caiu na GOOD, na AMB ou na Girassol (' + contagem.join('/') + ')');
    const painelLista = json(await s.pedir(copia.rota + '/api/admin/devolucoes?limit=10', { cookie: dono })) || {};
    ok(JSON.stringify(painelLista).indexOf('SKU-SERRANA') > 0, '  e o painel dela enxerga o que foi triado');

    // ── as 3 de hoje continuam de pe
    const outras = [];
    for (const e of DE_HOJE) outras.push(e.nome + (await login(e, 'dono', 's2') ? ' ok' : ' NAO LOGA'));
    ok(outras.every((x) => / ok$/.test(x)), '⚠️ as empresas de hoje continuam logando com a nova no ar (' + outras.join(', ') + ')');
    const entradaGira = (await s.pedir('/girassol/')).corpo;
    ok(/src="marcas\/girassol\/icone-192\.png"/.test(entradaGira) && !s.log().split('\n').some((l) => /(?:GIRASSOL|AMB)\/MARCA/.test(l)),
      '⚠️ a Girassol continua com o logo DELA, sem aviso de arquivo faltando (conferir a existencia nao derruba quem ja tem)');
    const tituloDefeitos = async (rota) => titulo((await s.pedir(rota + '/defeitos-AMB.html')).corpo);
    const tGira = await tituloDefeitos('/girassol'), tAmb = await tituloDefeitos('/amb');
    ok(tGira === 'Magazine Girassol - Estoque de defeitos' && tAmb === 'AMBTotal - Estoque de defeitos', '⚠️ pagina de defeitos: a Girassol ganha o nome dela (dizia "AMBTotal") e a AMB continua igual ("' + tGira + '" / "' + tAmb + '")');
  } catch (err) {
    falhas++; console.log('FALHA ' + ((err && err.stack) || err));
    if (s && s.fimDoLog) console.log(s.fimDoLog());
  } finally {
    if (s) await s.matar();
    if (rest) rest.parar();
    if (pg) pg.parar();
    if (copia) copia.apagar();
  }
  console.log(falhas ? '=== ' + falhas + ' FALHA(S)' : '=== todos passaram');
  process.exit(falhas ? 1 : 0);
})();
