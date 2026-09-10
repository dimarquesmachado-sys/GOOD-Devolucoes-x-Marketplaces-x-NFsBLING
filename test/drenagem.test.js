// Roda com: node test/drenagem.test.js
//
// ⚠️ ÚLTIMO ITEM DO PARECER DE 09/09: "locks em `Map` não cobrem deploy com
// duas instâncias. Ambas podem executar timers, receber 401 e tentar
// renovar."
//
// O caso concreto: num deploy, o Render sobe o processo novo e o velho fica
// vivo por segundos até minutos. Os dois com 8 rotinas de fundo. E o
// refresh do ML é de USO ÚNICO — se os dois renovarem, um consome o do
// outro. É a corrida que estamos matando entre serviços, acontecendo dentro
// do mesmo serviço.

const fs = require('fs');
const path = require('path');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };

const RAIZ = path.join(__dirname, '..');

// ── ⚠️ NENHUM timer de fundo pode ficar solto ────────────────────────
//
// Timer não registrado continua rodando no processo que já deveria estar
// quieto — e é exatamente o que causa a sobreposição.
{
  const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const soltos = srv.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^set(Interval|Timeout)\(/.test(l));

  ok(soltos.length === 0,
     'nenhum timer de fundo solto no server.js'
     + (soltos.length ? ' (SOLTOS nas linhas: ' + soltos.map(([n]) => n).join(', ') + ')' : ''));

  ok(/drenagem\.ligar\(\)/.test(srv), 'a drenagem esta ligada no boot');
  ok(/drenagem: drenagem\.diagnostico\(\)/.test(srv), '  e visivel no /health');
}

// ── e ela para de verdade ────────────────────────────────────────────
{
  const p = path.join(RAIZ, 'lib', 'drenagem.js');
  delete require.cache[require.resolve(p)];
  const d = require(p);
  d.ligar();

  let rodou = 0;
  d.intervalo(() => { rodou++; }, 20);

  setTimeout(() => {
    const antes = rodou;
    ok(antes > 0, 'a rotina roda normalmente antes do sinal (' + antes + 'x)');

    process.emit('SIGTERM');

    setTimeout(() => {
      ok(rodou === antes,
         '⚠️ e PARA na hora do SIGTERM (rodou ' + (rodou - antes) + 'x depois)');
      ok(d.estaDrenando() === true, '  e o modulo sabe que esta drenando');
      ok(d.diagnostico().timers_registrados === 0, '  com os timers cancelados');

      // ⚠️ e NÃO mata o processo: quem decide a hora de morrer é o Render.
      // Matar aqui derrubaria requisições em andamento — trocaria um
      // problema invisível por um visível no galpão.
      const src = fs.readFileSync(p, 'utf8');
      const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')
        && !l.trim().startsWith('*')).join('\n');
      ok(!/process\.exit\(/.test(codigo),
         '⚠️ e NAO chama process.exit (as requisicoes em voo terminam)');

      console.log('');
      console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
      process.exit(falhas ? 1 : 0);
    }, 150);
  }, 100);
}
