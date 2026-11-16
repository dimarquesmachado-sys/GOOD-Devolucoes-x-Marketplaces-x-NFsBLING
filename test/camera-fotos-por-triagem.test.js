'use strict';
// b716 — P1-07 do ROTEIRO-LIQUIDACAO-2026-11 (auditoria do Codex, 15/11): FOTO DE UM PACOTE NAO CONTAMINA O SEGUINTE.
//
// public/js/camera.js (tela de bipe UNICA — a fabrica serve o mesmo arquivo em js-AMB/camera.js) escrevia o resultado do
// upload em `fotosUploadadas[idx]`. Se o estoquista fechasse a triagem e abrisse outra enquanto a foto subia (o array e
// trocado em 9 pontos do triagem.js), a resposta antiga entrava no pacote NOVO: foto de A no card de B, e um upload
// fantasma que nunca saia de "subindo" (a UI contava 0 pendentes e deixava finalizar).
//
// Aqui as duas funcoes de producao (registrarFotoPendente / concluirUploadDeFoto) rodam num `window` simulado, com a
// cena exata da auditoria: inicia A → troca de fluxo → inicia B → termina A.
// Roda com: node test/camera-fotos-por-triagem.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const ok = (c, o) => { if (!c) falhas++; console.log((c ? 'ok  ' : 'FALHA ') + o); };
const RAIZ = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RAIZ, 'public', 'js', 'camera.js'), 'utf8');

function fonte(nome) {
  const i = SRC.search(new RegExp('function ' + nome + '\\s*\\('));
  if (i < 0) return '';
  let j = SRC.indexOf('{', i), p = 0, k = j;
  for (; k < SRC.length; k++) { if (SRC[k] === '{') p++; else if (SRC[k] === '}') { p--; if (p === 0) break; } }
  return SRC.slice(i, k + 1);
}
const ctx = { window: { fotosUploadadas: [] }, Date };
vm.createContext(ctx);
vm.runInContext('let _seqFotoCamera = 0;\n' + fonte('registrarFotoPendente') + '\n' + fonte('concluirUploadDeFoto'), ctx);
const { registrarFotoPendente, concluirUploadDeFoto } = ctx;
ok(typeof registrarFotoPendente === 'function' && typeof concluirUploadDeFoto === 'function', 'camera.js tem registrarFotoPendente e concluirUploadDeFoto');

// ── a cena da auditoria: inicia A → outro fluxo → inicia B → termina A ──
{
  const w = ctx.window;
  w.fotosUploadadas = [];
  const A = registrarFotoPendente(w.fotosUploadadas, 'blobA');
  ok(A.uploading === true && A.url === null && /^foto-\d+-/.test(A.id), 'foto A registrada pendente, com id proprio');
  w.fotosUploadadas = [];                                   // o estoquista fechou e abriu OUTRA triagem
  const B = registrarFotoPendente(w.fotosUploadadas, 'blobB');
  const estadoA = concluirUploadDeFoto(A, { ok: true, url: 'https://x/fotos-problema/a.jpg' });
  ok(estadoA === 'descartado', '⚠️ a resposta de A chega depois da troca: DESCARTADA (' + estadoA + ')');
  ok(w.fotosUploadadas.length === 1 && w.fotosUploadadas[0] === B && B.uploading === true && B.url === null,
     '  o fluxo B continua com UMA foto, a dele, ainda subindo (antes: a foto de A aparecia em B e B virava fantasma)');
  const pendentes = w.fotosUploadadas.filter((f) => f.uploading).length;
  ok(pendentes === 1, '  pendentes calculados pela UI: 1 (antes: zero — deixava finalizar com upload em voo)');
  const estadoB = concluirUploadDeFoto(B, { ok: true, url: 'https://x/fotos-problema/b.jpg' });
  ok(estadoB === 'ok' && B.url === 'https://x/fotos-problema/b.jpg' && B.uploading === false, '  B termina e e a foto de B que fica');
}

// ── remover uma foto enquanto outra sobe nao troca a posicao ──
{
  const w = ctx.window;
  w.fotosUploadadas = [];
  const f1 = registrarFotoPendente(w.fotosUploadadas, 'b1'); concluirUploadDeFoto(f1, { ok: true, url: 'u1' });
  const f2 = registrarFotoPendente(w.fotosUploadadas, 'b2');                  // subindo
  const f3 = registrarFotoPendente(w.fotosUploadadas, 'b3'); concluirUploadDeFoto(f3, { ok: true, url: 'u3' });
  w.fotosUploadadas.splice(0, 1);                                              // estoquista removeu a 1a (indice 0)
  const e2 = concluirUploadDeFoto(f2, { ok: true, url: 'u2' });
  ok(e2 === 'ok' && w.fotosUploadadas.map((f) => f.url).join(',') === 'u2,u3', '⚠️ remover a 1a foto durante o upload da 2a: a 2a termina NA 2a (antes: escrevia no indice antigo e sobrescrevia a 3a)');
  // removida ENQUANTO subia: a resposta nao a ressuscita
  const f4 = registrarFotoPendente(w.fotosUploadadas, 'b4');
  w.fotosUploadadas.splice(w.fotosUploadadas.indexOf(f4), 1);
  ok(concluirUploadDeFoto(f4, { ok: true, url: 'u4' }) === 'descartado' && w.fotosUploadadas.length === 2, '  foto removida enquanto subia: a resposta e descartada, nao volta');
}

// ── falha de upload tira SO a entrada dela ──
{
  const w = ctx.window;
  w.fotosUploadadas = [];
  const f1 = registrarFotoPendente(w.fotosUploadadas, 'b1');
  const f2 = registrarFotoPendente(w.fotosUploadadas, 'b2');
  ok(concluirUploadDeFoto(f1, { ok: false, erro: 'grande demais' }) === 'falhou' && w.fotosUploadadas.length === 1 && w.fotosUploadadas[0] === f2, 'falha de upload remove so a entrada que falhou');
  ok(concluirUploadDeFoto(f2, null) === 'falhou' && w.fotosUploadadas.length === 0, '  erro de rede (sem resposta): idem');
  ok(w.fotosUploadadas.filter((f) => f.uploading).length === 0, '  sem fantasma: nenhuma entrada fica "subindo" pra sempre');
}

// ── o tirarFoto usa as duas funcoes e nao escreve mais por indice; o HTML pede o ?v= novo ──
const tirar = fonte('capturarFoto');
ok(/const entrada = registrarFotoPendente\(window\.fotosUploadadas, blob\);/.test(tirar) && /const estado = concluirUploadDeFoto\(entrada, resultado\);/.test(tirar), 'capturarFoto registra a entrada e conclui por identidade');
ok(!/fotosUploadadas\[idx\]/.test(SRC) && !/const idx = window\.fotosUploadadas\.length/.test(SRC), '⚠️ nenhuma escrita por indice sobrou no camera.js');
ok(/if \(estado !== 'descartado'\) atualizarCameraUI\(\);/.test(tirar), '  resposta descartada nao redesenha o fluxo atual');
for (const arq of ['public/index.html', 'amb-devolucoes/public-AMB/index-AMB.html']) {
  const m = fs.readFileSync(path.join(RAIZ, arq), 'utf8').match(/camera\.js\?v=b(\d+)/);
  ok(m && Number(m[1]) >= 716, `  ${arq}: camera.js?v=b${m ? m[1] : '?'} (>= b716)`);
}

console.log('');
console.log(falhas === 0 ? '=== TODOS OS CASOS PASSARAM' : '=== ' + falhas + ' FALHA(S)');
process.exit(falhas ? 1 : 0);
