// Roda com: node test/magalu-reversas.test.js
//
// A conversa do Checkout mapeou os cancelamentos do Magalu e achou 14 casos
// na GOOD com NF emitida e sem devolucao registrada — R$ 12.704 nas tres
// empresas. Mas o dado deles nao diz se o produto chegou a SAIR:
//
//   "esses 14 podem ser duas coisas bem diferentes: cancelou antes de
//    postar (so cancelar a NF) ou postou e o cliente ficou com o produto
//    (ai voce perdeu o produto tambem)"
//
// O cruzamento precisa das duas pontas. Eles dizem se SAIU (etiqueta do
// checkout); esta rota diz se VOLTOU (remessa reversa).

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const DEBUG = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rotas-debug.js'), 'utf8');

// ── a rota existe, nos dois metodos ──────────────────────────────────
ok(/app\.get\('\/api\/magalu\/reversas-por-pedido'/.test(DEBUG), 'ha rota GET');
ok(/app\.post\('\/api\/magalu\/reversas-por-pedido'/.test(DEBUG),
   'e POST — eles pediram POST mas disseram que GET tambem serve');
ok(/if \(adminOk\(req\)\) return next\(\);/.test(DEBUG.slice(DEBUG.indexOf('reversas-por-pedido'))),
   'aceitando ?k=ADMIN_KEY, que e como o outro servidor vai chamar');

// ── tem_reversa exige PACOTE, nao ticket ─────────────────────────────
ok(/tem_reversa: !!\(dev && dev\.reverse_code &&/.test(DEBUG),
   'tem_reversa exige reverse_code: ticket aberto NAO e pacote voltando');
ok(/tem_ticket: !!dev/.test(DEBUG),
   '  e `tem_ticket` diz se o cliente ao menos abriu protocolo');
ok(/protocolo aberto e pacote a caminho[\s\S]{0,60}sao coisas diferentes/.test(DEBUG),
   '  com a diferenca escrita, que e o que separa os 14 casos deles');

// ── a licao do ticket fechado ────────────────────────────────────────
ok(/o Magalu FECHA o ticket com o pacote/.test(DEBUG),
   'a rota registra que NAO filtramos por ticket aberto');
ok(/nao filtramos por ticket aberto de proposito/.test(DEBUG),
   '  e avisa isso na resposta, pra eles nao refazerem o erro');

// ── limites e entrada ────────────────────────────────────────────────
ok(/\.slice\(0, 200\)/.test(DEBUG), 'teto de 200 pedidos por chamada');
ok(/req\.body && \(req\.body\.codes \|\| req\.body\.pedidos\)/.test(DEBUG),
   'aceita `codes` ou `pedidos` no corpo');
ok(/status\(400\)/.test(DEBUG), 'e sem pedidos responde 400 explicando o formato');

// ── falha em UM pedido nao derruba os outros ─────────────────────────
ok(/linhas\.push\(\{ code, erro:/.test(DEBUG),
   'falha num pedido vira erro NAQUELA linha, sem derrubar a consulta toda');

// ── b190: o caso que ESCAPOU, e as duas causas ──────────────────────
//
// GOOD, pedido 1540670112009168 (lustre R$ 1.299,90): a Magalu agendou
// coleta nos Correios, objeto DA597697016BR. A cliente reclamou que ninguem
// foi buscar, a coleta foi REAGENDADA, e so aconteceu dias depois —
// coletado 05/08, entregue no galpao 06/08. Nossa consulta dizia
// tem_reversa:false, e o pacote ficou tres semanas sem ninguem esperando.
{
  const MAGALU = fs.readFileSync(path.join(__dirname, '..', 'lib', 'magalu.js'), 'utf8');

  ok(/CAMPOS_CODIGO = \['reverse_code'/.test(MAGALU),
     'o codigo e procurado em VARIOS campos, nao so `reverse_code`');
  ok(/ordenadas = res\.slice\(\)\.sort/.test(MAGALU),
     'e entre VARIAS remessas pego a mais recente — com reagendamento, a ultima e a que valeu');

  // a segunda fonte: o texto do SAC
  ok(/async function mensagensDoTicket/.test(MAGALU),
     'ha segunda fonte: as mensagens do protocolo');

  // b190.1: o codigo da MAIS RECENTE e o que vale
  ok(/const rcMaisRecente = ordenadas\.length \? codigoDe\(ordenadas\[0\]\)/.test(MAGALU),
     'o codigo vem da remessa MAIS RECENTE — a reagendada, que aconteceu');
  ok(/dev\.codigo_possivelmente_obsoleto = true/.test(MAGALU),
     '  e o codigo de tentativa ANTERIOR e ultimo recurso, marcado como suspeito');
  // b190.6: e esse marcador tem que CHEGAR na resposta
  ok(/tem_reversa: !!\(dev && dev\.reverse_code && !dev\.codigo_possivelmente_obsoleto\)/.test(DEBUG),
     'codigo de tentativa que FALHOU nao conta como reversa viva');
  ok(/codigo_obsoleto: \(dev && dev\.codigo_possivelmente_obsoleto\)/.test(DEBUG),
     '  mas vai na resposta, pra consulta');
  ok(/NAO conta como reversa viva/.test(DEBUG),
     '  com a explicacao — senao eles concluiriam que o produto voltou');

  // b190.1: o indice precisa casar com a busca, que limpa o codigo
  ok(/const soNum = String\(rc\)\.replace\(\/\\D\/g, ''\);/.test(MAGALU),
     'o codigo e indexado TAMBEM so com digitos');
  ok(/acharDevolucao\(\) LIMPA o codigo/.test(MAGALU),
     '  porque a busca limpa antes de procurar — senao o caso continuaria escapando');
  // b190.3: dois codigos podem colidir quando reduzidos a digitos
  ok(/&& !IDX\.mapa\['R:' \+ soNum\]/.test(MAGALU),
     '  e a chave so-digitos nao SOBRESCREVE: DA597697016BR e XY597697016ZW colidiriam');
  // b190.3: a mensagem mais recente, pelo mesmo motivo da remessa
  ok(/const porData = msgs\.slice\(\)\.sort/.test(MAGALU),
     'entre as mensagens, a MAIS RECENTE manda — o SAC escreve o objeto da coleta que falhou antes da que valeu');
  ok(/if \(!rc\) \{[\s\S]{0,200}mensagensDoTicket/.test(MAGALU),
     '  consultada SO quando o /returns nao deu codigo (uma chamada a mais, so onde precisa)');

  // o garimpo no texto livre
  const fn = new Function('return ' + MAGALU.match(/function codigoNoTexto[\s\S]*?\n  \}/)[0])();
  ok(fn('O número da coleta a ser realizado é 4667981503 - Nº do objeto: DA597697016BR') === 'DA597697016BR',
     'acha o objeto no texto do SAC (o caso real)');
  ok(fn('Prezado, segue AP268276786BR para devolucao') === 'AP268276786BR',
     '  e em outros formatos de mensagem');
  ok(fn('coleta 466.798.1503 sem objeto') === null,
     'NAO confunde o numero da coleta com o do objeto');
  ok(fn('objeto BR266361368249N') === null,
     '  nem pega codigo que nao siga o formato dos Correios (2 letras + 9 digitos + 2 letras)');
  ok(fn('') === null && fn(null) === null, '  e texto vazio nao quebra');
  // b190.4: o SAC nem sempre escreve em maiuscula
  ok(fn('objeto: da597697016br') === 'DA597697016BR',
     'aceita o codigo em minuscula e devolve em MAIUSCULA (como o resto indexa)');
}

// ── a resposta em si ─────────────────────────────────────────────────
{
  const app = express();
  app.use(express.json());

  // dublê do modulo do Magalu, com os tres casos que importam
  const magaluFalso = {
    async acharDevolucao(code) {
      if (code === 'COM-PACOTE') {
        return { reverse_code: 'BR123456789BR', ticket_id: 'T1', protocolo: '2026080100001',
                 status: 'closed', fechado: true, motivo: 'produto com defeito' };
      }
      if (code === 'SO-TICKET') {
        // ticket aberto MAS sem remessa: o cliente reclamou e nao postou
        return { reverse_code: null, ticket_id: 'T2', protocolo: '2026080100002',
                 status: 'open', fechado: false, motivo: 'arrependimento' };
      }
      return null;   // nem ticket houve
    },
  };

  // reproduz a rota
  app.get('/api/magalu/reversas-por-pedido', async (req, res) => {
    const codes = String(req.query.codes || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 200);
    if (!codes.length) return res.status(400).json({ ok: false, erro: 'passe os pedidos' });
    const linhas = [];
    for (const code of codes) {
      const dev = await magaluFalso.acharDevolucao(code);
      linhas.push({
        code,
        tem_reversa: !!(dev && dev.reverse_code),
        reverse_code: (dev && dev.reverse_code) || null,
        ticket_id: (dev && dev.ticket_id) || null,
        ticket_fechado: dev ? !!dev.fechado : null,
        tem_ticket: !!dev,
      });
    }
    const com = linhas.filter((l) => l.tem_reversa).length;
    res.json({ ok: true, total: linhas.length, com_reversa: com, sem_reversa: linhas.length - com, linhas });
  });

  const srv = http.createServer(app);
  srv.listen(0, '127.0.0.1', () => {
    http.get({ host: '127.0.0.1', port: srv.address().port,
      path: '/api/magalu/reversas-por-pedido?codes=COM-PACOTE,SO-TICKET,SEM-NADA' }, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => {
        const d = JSON.parse(b);
        ok(d.total === 3, 'responde as 3 linhas pedidas');
        ok(d.com_reversa === 1, '  contando 1 com pacote voltando');

        const comPacote = d.linhas.find((l) => l.code === 'COM-PACOTE');
        ok(comPacote.tem_reversa === true && comPacote.reverse_code === 'BR123456789BR',
           'pedido COM remessa: tem_reversa e o rastreio do pacote');
        ok(comPacote.ticket_fechado === true,
           '  mesmo com o ticket FECHADO — o Magalu fecha com o pacote na rua');

        const soTicket = d.linhas.find((l) => l.code === 'SO-TICKET');
        ok(soTicket.tem_reversa === false, 'ticket ABERTO sem remessa: tem_reversa FALSE');
        ok(soTicket.tem_ticket === true,
           '  mas tem_ticket true — o cliente reclamou, so nao postou');

        const semNada = d.linhas.find((l) => l.code === 'SEM-NADA');
        ok(semNada.tem_reversa === false && semNada.tem_ticket === false,
           'pedido sem ticket nenhum: os dois false (nem protocolo houve)');

        console.log('');
        console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
        srv.close();
        process.exit(falhas ? 1 : 0);
      });
    });
  });
}
