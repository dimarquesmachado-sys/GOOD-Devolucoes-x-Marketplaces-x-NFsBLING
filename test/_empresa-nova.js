'use strict';
// b800 — V-17 (ensaio de CNPJ novo). Monta, numa pasta temporaria, uma COPIA deste repositorio com uma empresa NOVA
// colada do jeito que o gerador (`scripts/nova-empresa.js`) manda: a ficha dentro de EMPRESAS, em `lib/empresas.js`, e a
// entrada em `contrato-empresas.json`. E o "PR da empresa nova" sem PR — pra provar com o `server.js` DE VERDADE o que
// um CNPJ novo encontra no dia de ligar, em vez de confiar que "o codigo esta pronto".
//
// ⚠️ A copia existe porque a lista de empresas e CODIGO (escolha registrada em docs/ESTADO-MULTILOJA.md): nao da pra
// "cadastrar" uma empresa num processo que ja subiu. Nada do repositorio de verdade e alterado.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const FORA_DA_COPIA = new Set(['node_modules', '.git']);   // pesados e desnecessarios: as dependencias entram por atalho

function colarFicha(arquivo, ficha, chave) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
  // dois marcadores estaveis: a abertura do registro e o fecho dele (a 1a linha `};` depois da abertura)
  const inicio = linhas.findIndex((l) => l.startsWith('const EMPRESAS = {'));
  const fim = inicio < 0 ? -1 : linhas.findIndex((l, i) => i > inicio && l === '};');
  if (inicio < 0 || fim < 0) throw new Error('nao achei o registro EMPRESAS em lib/empresas.js (abertura ' + inicio + ', fecho ' + fim + ')');
  if (linhas.slice(inicio, fim).some((l) => l.trim() === chave + ': {')) throw new Error('a chave "' + chave + '" ja esta em EMPRESAS');
  linhas.splice(fim, 0, ...String(ficha).replace(/\n+$/, '').split('\n'));
  fs.writeFileSync(arquivo, linhas.join('\n'));
}

function colarContrato(arquivo, contratoJson, chave, ativa) {
  const contrato = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const novo = JSON.parse(contratoJson);
  if (!novo[chave]) throw new Error('o gerador nao devolveu a entrada "' + chave + '" do contrato');
  if (contrato.empresas[chave]) throw new Error('a chave "' + chave + '" ja esta no contrato');
  // o gerador entrega a empresa DESLIGADA (ativar e o ultimo passo do embarque) — o ensaio liga, como o dono ligaria
  novo[chave].ativa_em = Object.assign({}, novo[chave].ativa_em, { devolucoes: !!ativa });
  contrato.empresas[chave] = novo[chave];
  fs.writeFileSync(arquivo, JSON.stringify(contrato, null, 2) + '\n');
}

/* Devolve { dir, chave, nome, rota, prefixo, sufixo, envs, apagar }. `envs` e a lista que o gerador manda criar. */
function copiaComEmpresaNova({ chave, nome, ativa = true }) {
  const { gerar } = require('../scripts/nova-empresa');
  const g = gerar(chave, nome);
  if (!g.ok) throw new Error('o gerador recusou "' + chave + '": ' + g.erros.join('; '));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-nova-'));
  const apagar = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temporario */ } };
  try {
    fs.cpSync(RAIZ, dir, {
      recursive: true,
      filter: (de) => { const rel = path.relative(RAIZ, de); return !rel || !FORA_DA_COPIA.has(rel.split(path.sep)[0]); },
    });
    fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    colarFicha(path.join(dir, 'lib', 'empresas.js'), g.ficha, chave);
    colarContrato(path.join(dir, 'contrato-empresas.json'), g.contrato, chave, ativa);
  } catch (e) { apagar(); throw e; }
  return { dir, chave, nome, rota: '/' + chave, prefixo: g.PREF, sufixo: '_' + g.suf, envs: g.envs.slice(), apagar };
}

module.exports = { copiaComEmpresaNova };
