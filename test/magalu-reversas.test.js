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
ok(/tem_reversa: !!\(dev && dev\.reverse_code\)/.test(DEBUG),
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
