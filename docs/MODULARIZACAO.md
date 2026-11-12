# Modularização — os arquivos acima do teto (plano medido)

> **O que é esta página.** A regra da casa é ~3.000 linhas por arquivo. Três estão
> acima. Aqui está a medição de cada um (10/11/2026, main b677), o que vale e o que
> não vale mexer, a ordem das fatias e o que segura cada fatia. É plano — nenhuma
> fatia foi executada ainda. Quem for executar: **uma fatia por PR, só movimento,
> sem melhoria junto.**

## Andamento

| fatia | o quê | build | painel (linhas) |
|---|---|---|---|
| 0 | o chão: helper dos testes, rota fechada na GOOD, meta-teste | b678 (#550) | 4.978 |
| 1 | Bridge / extensão → `js-AMB/painel-bridge.js` (118 linhas movidas) | b679 | 4.860 |
| 2 | Recados pro estoquista → `js-AMB/painel-recados.js` (334 linhas movidas, 2 blocos) | b680 | 4.526 |
| 3 | Vendas estornadas sem retorno → `js-AMB/painel-sem-retorno.js` (539 linhas movidas) | b681 | 3.987 |
| — | chão 2: a fonte dos testes volta a ter a **ordem original** (marca no lugar de onde o bloco saiu) | b682 | 3.991 |
| 4 | Esteira + geração da NF + XML → `js-AMB/painel-gerar-nf.js` (715 linhas movidas) | b683 | 3.278 |
| 5 | Índice de NF + de-para → `js-AMB/painel-nf-depara.js` (208) **e** reclamação Magalu/ML → `js-AMB/painel-reclamacao.js` (115) | b684 | **2.959** |

**O painel está abaixo do teto de 3.000 linhas** (era 4.978). As duas da fatia 5 foram no mesmo PR de propósito:
são os dois blocos contíguos que faltavam pro teto, mesmo método, e a prova cobre os dois de uma vez (a fonte
composta ficou idêntica). O que ainda dá pra tirar, pra chegar na meta de 2.500 e ter folga: a espreita (4
pedaços intercalados, ~375 linhas) e os avisos de NF de devolução (`_nfDev*`, ~150). Com folga, entra um teste
do teto (painel ≤ 3.000, módulo ≤ 1.000) — hoje, com 41 linhas de margem, ele só serviria pra travar conserto urgente.

⚠️ **O mapa por tema da seção "A medição" foi feito contando indentação e errou**: `espreitaOrdenar` tem 1 linha
(não 543) — o bloco grande ali era o das estornadas (`carregarSemRetorno`, 386 linhas, na coluna 0). O mapa
confiável sai do parser: a linha *i* é fronteira de topo quando o prefixo `[0..i)` do script compila. Com ele,
o que resta no script principal, em blocos contíguos: Magalu/ML reclamação (518–633, 116), espreita em 4 pedaços
(~375 no total, intercalados), índice de NF de devolução + de-para (~209), gerar NF/esteira (~900).

Guarda de toda fatia: `test/painel-modulos-carregam.test.js` — cada módulo referenciado pelo painel carrega
sozinho (sem depender do script principal na carga), vem antes dele com `?v=` e não repete nome de topo.

### Regra de toda fatia do painel, desde a b682: deixar a marca

Os testes do painel recortam texto entre dois marcos. Se a fonte que eles leem tivesse os blocos fora de
ordem (no topo, onde fica a tag), um recorte que cruzasse a fronteira ficaria maior sem ninguém ver. Por isso:

1. no script principal, **no lugar de onde o bloco saiu**, fica uma linha
   `// @painel-modulo js-AMB/painel-<tema>.js#<secao>`;
2. no módulo, antes do bloco, uma linha `// @secao <secao>` (um módulo pode ter várias seções);
3. `test/_fonte-painel.js` põe cada seção de volta no lugar da marca e tira a tag — o texto que os testes leem
   é o do painel **de antes das fatias** (conferido na b682: idêntico ao original, ignorando linhas em branco);
4. `test/painel-fonte-unica` acusa seção sem marca, marca sem seção e marca fora do script principal.

## A medição

| arquivo | linhas | o que é | mexer? |
|---|---|---|---|
| `server.js` | 9.364 | o código da GOOD (a hospedeira) | **não** — é o que a fusão GOOD→Girassol aposenta (`docs/FUSAO-GOOD-GIRASSOL.md`). Modularizar agora é trabalho jogado fora. |
| `amb-devolucoes/public-AMB/painel-AMB.html` | 4.978 | o painel admin **único das três** | **sim** — é a tela viva que fica |
| `amb-devolucoes/app-AMB.js` | 4.334 | a **fábrica** (uma instância por empresa) | **sim** — é o núcleo que fica |

### Anatomia do painel (`painel-AMB.html`)

- linhas 9–243: `<style>` (235)
- linhas 244–446: HTML (200)
- **linhas 447–4900: UM `<script>` inline com ~4.450 linhas e 132 funções de topo**
- o resto: scripts pequenos, `defeitos-ficha.js` e `lancar-defeito.js` (já externos), a barra do Mover-Pedidos.

Blocos do script, por tema (função → linha de início):

| tema | funções | onde | observação |
|---|---|---|---|
| espreita / "a caminho" | 11 | 635–1866 | o maior: `espreitaOrdenar` (543 linhas), `renderEspreita` (231) |
| recados | 7 | 692–1077 | `carregarRecados` (160) |
| cards / lista / render | 9 | 2097–3657 | `renderizar` (132), `itemHtmlAprovado` (105) |
| gerar NF / Bridge / vincular | 28 | 808–4833 | `abrirModalGerarDevolucao` (171), `confirmarGerarDevolucao` (182), `rodarEsteira` (184); o bloco da Bridge (4779–4900) já tem teste que o extrai |
| Magalu (protocolos/tickets) e demais | ~70 | espalhadas | |

### Anatomia da fábrica (`app-AMB.js`)

80 rotas registradas direto no arquivo. As funções grandes: `montarIndiceNFDevolucaoAMB`
(começa na 3098; o bloco do índice de NFs de devolução vai da 3078 ao fim, **~1.250
linhas**), `montarEspreitaAMB` (2153, ~220) + `preAquecerEspreitaAMB` (2398, ~180), o
miolo de login/sessão (1514–1570), as páginas `/`, `/conectar`, `/status` (786–1030).

## O que torna isto arriscado (medido, não suposto)

1. **52 arquivos de teste leem `painel-AMB.html` como texto** e procuram código lá
   dentro. Tirar JS do HTML sem cuidar disso deixa a bateria vermelha — ou pior,
   verde por não achar mais o que procurava.
2. **A GOOD não serve `public-AMB` como pasta**: ela monta o painel no boot
   (`lib/painel-unico.js`, troca tema/base) e serve cada JS por rota própria
   (`/js-AMB/base-amb.js`, `/js/defeitos-ficha.js`). Arquivo novo do painel precisa
   chegar nas três — instâncias (estático em `js-AMB/`) **e** raiz.
3. O script inline tem estado de topo (`let`/`const`) compartilhado entre os blocos.
   Em `<script>` clássico esse estado é visível entre arquivos, mas só **depois** de
   o arquivo que o declara rodar: a ordem das tags importa pro que executa no
   carregamento.
4. `onclick="..."` no HTML chama função global — `test/onclick-existe` confere; tem
   que continuar enxergando as funções onde quer que morem.

## Fatia 0 — preparar o chão (nenhuma linha de comportamento muda)

1. `test/_fonte-painel.js`: `fontePainel()` devolve o HTML **mais** o conteúdo de todo
   `js-AMB/painel-*.js` que ele referencia. Os 52 testes passam a ler por ela
   (troca mecânica do `readFileSync(...painel-AMB.html)`). Enquanto não houver
   arquivo externo, o resultado é idêntico ao de hoje.
2. Rota genérica na GOOD: `GET /js-AMB/painel-<nome>.js` servindo
   `public-AMB/js-AMB/` por **lista fechada** (regex do nome; sem caminho livre),
   `no-cache`. Nas instâncias o estático já cobre.
3. `test/tela-unica-contrato-api` e `front-chama-a-empresa-certa` passam a incluir
   `js-AMB/painel-*.js` na varredura do painel; `onclick-existe` idem.
4. Critério de pronto: bateria verde, boot real, `git diff --stat` sem nenhuma linha
   de `painel-AMB.html` alterada além das tags.

## Fatias do painel (depois da 0), da mais isolada pra menos

Cada uma: mover as funções **sem editar** para `js-AMB/painel-<tema>.js`, carregar
com `<script src="js-AMB/painel-<tema>.js?v=bNNN">` **antes** do script principal,
conferir linhas antes → depois (o HTML encolhe exatamente o que o arquivo novo
ganha), bateria + boot.

1. **Bridge / extensão** (4779–4900, ~120 linhas) — o bloco mais isolado e o único
   que já tem teste por extração (`bridge-deteccao-sem-corrida`).
2. **Recados** (692–1077, ~390).
3. **Espreita / "a caminho"** (635–1866 menos recados, ~850) — o que mais alivia.
4. **Gerar NF / vincular / esteira** (~900).
5. **Magalu (protocolos/tickets)**.
6. O que sobrar (cards/render) fica no HTML: é o miolo, e já estará abaixo do teto.

Meta: `painel-AMB.html` abaixo de 2.500 linhas; nenhum arquivo novo acima de 1.000.

## Fatias da fábrica (`app-AMB.js`)

Mesmo método (peça em `lib-AMB/` ou `lib/`, recebendo dependências; rotas montadas
pela peça). Guardas: `fabrica-nao-rouba-rota`, `tela-unica-contrato-api` (já segue
`require` e só conta peça **invocada**), `duas-empresas-juntas`, boot real.

1. **Índice de NFs de devolução** (3078–fim, ~1.250 linhas) — sozinho põe o arquivo
   abaixo do teto. Tem estado próprio e poucas entradas: é a fatia que mais rende.
2. **Espreita + pré-aquecimento** (2153–2580, ~430).
3. **Páginas e estáticos** (`/`, `/conectar`, `/status`, `/painel`, `js-AMB`, manifest:
   786–1400, ~600) — HTML de servidor, sem regra de negócio.
4. Diagnóstico (`/debug`, `/api/debug/*`, `/shopee/teste`, `/magalu/*`).

Meta: `app-AMB.js` abaixo de 2.500 linhas.

## Regras de toda fatia

- **Um PR por fatia.** Pedido novo no meio = PR novo.
- **Só movimento.** O diff de uma fatia é: bloco sai de A, entra igual em B, mais a
  linha que liga. Melhoria que aparecer no caminho vira anotação.
- **Multiloja por construção**: a peça é única; a prova é a mesma bateria das três
  (`tela-unica-contrato-api`, `front-chama-a-empresa-certa`, `duas-empresas-juntas`).
- **Linhas antes → depois** no corpo do PR. Encolheu mais do que o arquivo novo
  cresceu = perdeu código.
- `node verifica.js` antes de todo push; `?v=` novo em todo JS do front que mudar.
- Fora do horário do galpão não é exigência aqui (não gasta cota), mas **não mergear
  fatia do painel no meio de uma emissão de NF em lote** — o painel é servido sem
  cache e a tela recarregada pega a versão nova.
