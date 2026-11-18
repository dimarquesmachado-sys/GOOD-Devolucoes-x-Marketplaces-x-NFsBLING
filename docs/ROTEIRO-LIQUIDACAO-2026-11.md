# Roteiro de liquidação — auditoria do Codex (15/11/2026) + o que já estava em processo

> **Este é o único roteiro.** Tudo o que está aberto no Devoluções vive aqui: os 11 P1 e os
> 16 P2 da auditoria do Codex (+1 achado no caminho), os 10 pontos de validação/decisão, as 6 frentes de teste que
> ele pediu, e as 9 pendências que já estavam em andamento antes dela. Nada fica fora, nada
> fica só na conversa.
>
> **Regra de uso (do dono, 15/11):** *"tratar 1 por 1 até liquidar tudo! Atacar e não desviar."*
> Um item por PR, na ordem da seção 2. Ao fechar um item, marcar ✅ com o número do PR e o
> build. Item que depende de decisão ou ação fora do código fica 🟡 com o nome de quem decide.

**Referência fixada (etapa 1 do Codex):**

| o quê | valor |
|---|---|
| main auditado | `78ce13f8` (15/11/2026) — hoje a main está em `b2868c9` (merge do #575, **b704**, `9.126.216`) |
| papéis | `admin` (dono: autoriza, recusa, gera NF, lança estoque) e `estoquista` (bipa, tria, conclui o que foi autorizado); a GOOD aceita também `adminOk(?k=)` |
| estados do pedido do ciclo (`defeito_pedidos*`) | `pendente → autorizado → concluido`, ou `pendente → recusado`. Hoje o servidor **não** exige o estado anterior (P1-04) nem bloqueia repetir `autorizar` (P1-03) |
| empresas | `good` (raiz, hospedeira), `ambtotal` (`/amb`), `girassol` (`/girassol`); peça compartilhada vale pras 3 e pra qualquer CNPJ futuro |
| versão | bump em todo PR: `server.js` `version: '9.126.NNN (bNNN: ...)'` e `amb-devolucoes/app-AMB.js` `const VERSAO = 'Devolucoes bNNN'` |

Legenda: ⬜ a fazer · 🔄 em PR · ✅ fechado · 🟡 depende de decisão/ação do dono · ⏸ pausado por decisão dele

---

## 1. Processo por entrega (não negociável)

1. **Reproduzir antes de corrigir** — teste vermelho que falha pela causa certa, exercitando a
   função/rota de produção (não cópia, não regex no fonte quando dá pra executar).
2. Corrigir **uma causa**.
3. Teste específico + `node verifica.js`.
4. Validar **as 3 empresas** quando a peça for compartilhada (quase sempre é).
5. `git diff --check` e `git show --stat` — só os arquivos do item.
6. PR legível sem a conversa: "PR #N — bNNN: <o que estava errado, o que mudou>".
7. Codex revisa; o dono mergeia. O primeiro apontamento de uma função é sintoma: auditar a
   função inteira. Apontamento que se repete vira teste.

---

## 2. Ordem de ataque

Segue as 12 etapas do Codex, com os itens de cada uma. A ordem dentro da etapa é a ordem de PR.

| etapa | itens | condição para avançar |
|---|---|---|
| 1. Fixar referência e critérios | este documento (R-00) | ✅ cada item abaixo tem o teste vermelho previsto; o teste em si nasce no PR do item |
| 2. Fechar XSS | P1-01, P1-02, V-05 (CSP compatível) | payloads ficam dados em renderização e clique nas 3 |
| 3. OAuth e acesso às fotos | P1-11, P1-09, P2-12 | estado inválido/outra empresa não chega à escrita nem ao Storage |
| 4. Caminho de upload | P1-10, P2-14 | upload malformado ou interrompido não derruba o serviço |
| 5. Transições do ciclo | P1-04 | pendente não vira concluído pelo estoquista |
| 6. Movimentações repetíveis | P1-03 | repetição e falha parcial não duplicam estoque |
| 7. Identificação e quantidade | P1-05, P2-02 | nenhuma escolha arbitrária de produto nem quantidade trocada em silêncio |
| 8. Identidade dos fluxos da UI | P1-07, P2-01, P2-10 | resposta antiga não altera o pacote atual |
| 9. Contrato da extensão | P1-06, H-05, V-09 | IDs iguais em empresas diferentes não cruzam |
| 10. Relatórios e leituras completas | P1-08, V-01, P2-03, P2-04 | vários SKUs e históricos grandes batem com a origem |
| 11. Resiliência e testes | P2-05, P2-06, P2-07, P2-08, P2-09, P2-11, P2-13, P2-15, P2-16, P2-17, V-07, T-01..T-06 | falha intermediária preserva o último estado válido e aparece como falha |
| 12. Operação e evolução | V-02, V-03, V-04, V-06, V-08, V-10, H-01..H-04, H-06..H-09 | evidência de recuperação e de independência entre empresas |

---

## 3. P1 — segurança e corrupção operacional

### P1-01 ✅ (#577 b706/b707) Fotos podem injetar JavaScript no painel admin
- **PR:** branch `dev/p1-01-xss-fotos-painel` (b706). A ficha de defeitos (`js-AMB/defeitos-ficha.js`) tinha a mesma causa e entrou junto: `onclick="verFotoDefeito('<esc(url)>')"` (o parser HTML desfaz o `&#39;` antes do JS) e `window.open(this.src)`.
- **Onde:** `amb-devolucoes/public-AMB/painel-AMB.html` (~l.1081); o painel é único (a GOOD recebe o mesmo via `lib/painel-unico.js`), então afeta as 3. Servidor aceita string arbitrária no array de fotos.
- **Errado:** URL da foto interpolada em atributo HTML e em `onclick`. Escapar HTML ≠ escapar argumento JS.
- **Correção:** montar elementos por propriedade (`img.src = …`) e `addEventListener`; retirar JS montado como string; validar no servidor que cada referência de foto é chave/URL do Storage esperado.
- **Aceite:** foto, título, SKU e tag com aspas, entidades e atributos continuam dados; não criam evento nem executam ao renderizar ou clicar.

### P1-02 ✅ (#592 b707 (lote)) Callbacks públicos devolvem conteúdo sem escape
- **PR:** branch `dev/p1-02-callbacks-escape` (b707). Entraram também `/bling/setup` e `/ml/setup` da GOOD (escopo, user_id e erro do provedor crus) e, na fábrica, conta/user_id/escopo/erro da troca — mesma causa.
- **Onde:** `server.js` (~l.2970, `code` no HTML) e `amb-devolucoes/lib-AMB/oauth-callback-AMB.js` (~l.29, erro do provedor no HTML **antes** de validar o `state`).
- **Correção:** código e erro como texto codificado pro contexto; na fábrica, validar/consumir o state antes de qualquer resposta com dado do provedor.
- **Aceite:** parâmetro malicioso nos callbacks das 3 empresas não produz elemento nem evento executável.

### P1-03 ✅ (#583 b713) Autorizar a mesma recuperação de novo duplica estoque
- **PR:** branch `dev/p1-03-reserva-estoque` (b713, sobre o b712). Marcador durável `defeito_pedidos*.estoque_operacao` (`LANCANDO <marca>` = reserva/incerto, `LANCADO <marca>` = confirmado, null = livre), gravado no **mesmo** update condicional da transição; `entradaNoEstoque` classifica *não aplicou* (4xx) × *incerto* (timeout/5xx/exceção); relançar respeita o marcador e só passa com `forcar` (confirmação humana na ficha), como compare-and-swap. ⚠️ **SQL pro dono:** `sql/2026-11-15-defeito-pedidos-estoque-operacao.sql` no projeto `sldnshulmhpmyjqrkstq` — sem a coluna, autorizar recuperada responde 503 com o SQL (descarte segue).
- **Onde:** `lib/defeitos-ciclo.js` rota `POST /api/defeitos/pedido/:id/decidir` (~l.1337) — atualiza e chama a entrada no Bling sem exigir estado anterior nem respeitar movimentação já confirmada. Relançamento: ERP confirma, banco recusa o marcador, código responde sucesso.
- **Correção:** reservar a operação no banco **antes** do efeito externo (update condicional `status = 'pendente'`, id de operação), estados `pendente / em_processamento / confirmado / incerto`; reaproveitar o padrão do FULL (reserva persistente, `estoque_lancado`).
- **Aceite:** repetição sequencial, simultânea, resposta perdida e falha de persistência não geram entrada indevida; timeout depois do envio vira conciliação, nunca repetição cega.
- ⚠️ Pode pedir coluna nova → SQL explícito em `sql/`, compatível no deploy, **só com OK do dono**.

### P1-04 ✅ (#583 b712) Estoquista conclui pedido pendente sem aprovação
- **PR:** branch `dev/p1-04-maquina-de-estados` (b712). Update condicional ao estado anterior (`in('status', DE[acao])`): `autorizar`/`recusar` só de `pendente`, `concluir` só de `autorizado`; 0 linhas → 404 ou 409 `{de, para}` sem nenhuma escrita. Isso já fecha a **1ª metade do P1-03** (autorizar de novo não lança no Bling de novo); fica pro P1-03 a reserva antes do efeito externo, o estado `incerto` e o relançamento que ignora falha do marcador.
- **Onde:** mesma rota, ~l.1345: `concluir` passa com `requerLogin` e não confere `status === 'autorizado'`. Confirmado no código em 15/11.
- **Correção:** máquina de estados no servidor com permissão por transição: `autorizar/recusar` só admin e só de `pendente`; `concluir` só de `autorizado`. Negar = nenhuma escrita.
- **Aceite:** estoquista não promove pendente/recusado a concluído; resposta 403/409 sem update.

### P1-05 ✅ (#583 b714) Fallback por EAN escolhe o primeiro candidato
- **PR:** branch `dev/p1-05-ean-ambiguo` (b714, sobre o b713). Ordem: código exato → de-para da empresa (`resolverSku`, agora injetado também na GOOD) → EAN **só com um** produto; mais de um interrompe (`ambiguo`, `candidatos`) e devolve a reserva.
- **Onde:** `lib/defeitos-ciclo.js` (~l.93). Contraria `CLAUDE.md §5`: EAN não identifica produto neste catálogo.
- **Correção:** `produto.id` confirmado → SKU → de-para (`sku_depara*`); ambiguidade no EAN **interrompe** com mensagem, nunca escolhe.
- **Aceite:** dois produtos com o mesmo EAN jamais provocam escolha automática.

### P1-06 ✅ (#592 b720 (lote)) Extensão vincula NF da Girassol/AMB a registro da GOOD
- ⚠️ **O Codex auditou a cópia congelada** (`extensao-bridge/`, parada desde 28/08 — ver `LEIA-ME.txt`). A extensão viva é a **Toolbox** no Mover-Pedidos (`toolbox-extensao/bg-devolucoes.js`), e o bug é o mesmo lá: a Girassol caía na raiz. **PR do Mover-Pedidos #904** (Toolbox 2.1.19): prefixo por empresa nos 4 pontos, fila de pendências em todo caminho, identidade da conta logada, entrega das pendências ao painel. **Este repo** (`dev/p1-06-extensao-empresa`, b719): o painel regrava as pendências desta empresa e avisa quando nem ele nem a extensão registraram. Passo do dono: reinstalar a Toolbox 2.1.19 nos 3 navegadores. Fecha também H-05 pela metade: a `extensao-bridge/` congelada deveria **sair do repo** (item novo H-10).
- **Onde:** `extensao-bridge/background.js` (~l.307): consulta ids fiscais pela empresa mas o auto-registro faz `PUT /api/admin/registrar-devolucao-gerada/:id` sempre na raiz.
- **Correção:** a empresa validada define o destino de **todas** as etapas; confirmar a conta Bling da aba escolhida corresponde à empresa; falha de persistência visível mesmo com o painel fechado.
- **Aceite:** mesmo ID nas 3 tabelas → só a empresa pedida muda. Ver H-05 (as duas Bridges divergem).

### P1-07 ✅ (#592 b716 (lote)) Fotos de um pacote contaminam o seguinte
- **PR:** branch `dev/p1-07-fotos-por-triagem` (b716). `public/js/camera.js` é a peça única (a fábrica serve o mesmo em `js-AMB/camera.js`): cada foto é um objeto com id; a conclusão do upload acha a entrada por identidade na lista **corrente** — lista trocada ou foto removida = descartado.
- **Onde:** `js-AMB/camera.js` (~l.128) — callback do upload escreve em índice numérico de array global; nova triagem troca o array com upload anterior em voo. Tela de bipe é única (js-AMB serve a GOOD).
- **Correção:** ID estável por foto + geração/identidade por triagem; resposta antiga só atualiza o fluxo que a originou.
- **Aceite:** inverter respostas, remover foto e trocar de pacote durante upload não mistura evidência nem deixa bloqueio permanente.

### P1-08 ✅ (#592 b721 (lote)) Relatório financeiro multiplica qtd total pelo preço de um produto
- **PR:** branch `dev/p1-08-relatorio-por-item` (b721). Relatório agrega por `itens_devolvidos` (agora com `valor_unit` do item da NF); item sem preço entra na quantidade e não no valor (`valorItensDesconhecidos`); triagem antiga sem a lista cai no cálculo legado e conta em `valorAproximadoDevolucoes` (o card mostra ≈ e explica no title). `produto_valor_unit` passa a ser do item que voltou, não do 1º order_item.
- **Onde:** `lib/rotas-relatorios.js` (~l.208) — ignora `itens_devolvidos`; devolução só do 2º item ainda usa o 1º `order_item`. Ver `docs/ITENS-DEVOLVIDOS.md`.
- **Correção:** agregar por item efetivamente devolvido (id, qtd, preço); histórico sem evidência marcado como desconhecido/aproximado, não inventado.
- **Aceite:** parcial, múltiplos SKUs e só-o-2º-produto dão valores e rankings corretos (A 1×R$10 + B 1×R$100 = R$110, A=1, B=1).

### P1-09 ✅ (#592 b710 (lote)) Proxy de fotos não autoriza o objeto pela empresa
- **PR:** branch `dev/p1-09-proxy-foto-por-empresa` (b710), junto com P2-12 (mesma rota). Autoriza pelo vínculo `problema_fotos` na tabela da empresa; foto nova vai pra pasta da chave da empresa (`girassol/`, `ambtotal/`), as antigas em `amb/` seguem servidas pelo vínculo.
- **Onde:** `amb-devolucoes/lib-AMB/rotas-admin-AMB.js` (~l.52) — exige admin, aceita qualquer chave do bucket; upload da fábrica ainda usa prefixo `amb/` pra AMB e Girassol.
- **Correção:** autorizar empresa → devolução → foto; namespace por empresa com compatibilidade controlada pras imagens antigas.
- **Aceite:** admin de A pedindo foto de B recebe 403/404 antes de qualquer download.

### P1-10 ✅ (#592 b711 (lote)) Multer 1.4.5-lts.2 com CVE-2025-47944 e CVE-2026-2359
- **PR:** branch `dev/p1-10-multer-node` (b711), junto com P2-14. Multer ^2.5.0 (audit: zero advisories no multer); `lib/upload-foto.js` é a peça das duas pontas: limite único (12 MB — era 6 na GOOD e 12 na fábrica), 1 arquivo, 413/400 em JSON, tipo pelos primeiros bytes (JPEG/PNG/WebP/GIF), extensão pelo tipo real. **O `npm audit` acusa outros pacotes** (express → body-parser/qs/proxy-addr; axios → follow-redirects; nodemailer) — virou P2-17, fora deste PR.
- **Onde:** `package.json` `multer ^1.4.5-lts.1`, lock resolve lts.2; `memoryStorage`; rotas exigem sessão antes do parser.
- **Correção:** subir pra versão mantida sem advisory; revisar limites (tamanho, contagem); validar conteúdo real da imagem. **Não** `npm audit fix --force`. Junto com P2-14 (Node).
- **Aceite:** upload válido, excessivo, malformado e interrompido nas 3 — processo segue atendendo.

### P1-11 ✅ (#592 b709 (lote)) OAuth Magalu da GOOD sem state de uso único
- **PR:** branch `dev/p1-11-oauth-magalu-state` (b709): `lib/oauth-state.js` é a peça única (a fábrica passou a usá-la com a gaveta dela; a GOOD criou a sua); `/magalu/autorizar` gera state aleatório, `/magalu/callback` consome antes de ler o code. **Fica em aberto** neste item: confirmar a identidade da conta Magalu antes de persistir o token — não há endpoint conhecido de "quem sou" no ID Magalu sem tenant; medir antes de inventar.
- **Onde:** `server.js` (~l.4301): `state='good'`, callback aceita code sem conferir estado/sessão; persiste tokens antes de confirmar a conta.
- **Correção:** usar o fluxo da fábrica (state aleatório, validade curta, consumo único, empresa vinculada, identidade confirmada antes de gravar) — a GOOD vira adaptador, como no ML (b702).
- **Aceite:** state ausente, expirado, repetido ou de outra empresa falha sem trocar nem gravar credencial.

---

## 4. P2 — confiabilidade, consistência, manutenção

| id | estado | ponto | onde / evidência | direção |
|---|---|---|---|---|
| P2-01 | ✅ #592 b717 (lote) | Busca fora de ordem (b717, `dev/p2-01-busca-em-ordem`: `_buscaSeq` — só a busca corrente renderiza, grava o payload e libera o loading) | `busca.js:35` (**dois** arquivos: `public/js/busca.js` e `js-AMB/busca.js`); A/B respondidos B/A → campo B, resultado A | identidade da solicitação; só a mais recente atualiza tela e payload |
| P2-02 | ✅ #583 b715 | Quantidade inválida (b715, `dev/p2-02-quantidade-valida` sobre o b714: `lerQuantidade` — inteiro 1..1000, ausente = 1, inválida = 400 antes de gravar; os `\|\| 1` que escondiam zero gravado saíram) | `defeitos-ciclo.js:1358`: 0/negativo/NaN viram 1, `Infinity` passa | rejeitar inválido; exigir finito, inteiro, limite |
| P2-03 | ✅ #593 b725 | Lista GOOD quebra em 150 pedidos (b725, `dev/p2-03-lista-por-lotes`: Recuperados/Descartados = consulta por tipo + ids em lotes de 150; Com Defeito = ATIVOS paginados por `range` descartando os resolvidos por pedido; nunca mais o "amplo") | `defeitos-ciclo.js:510`: com 151 IDs registros `problema/delivered` somem da lista e seguem na contagem | consultar em lotes/páginas; testar 149/150/151/400 e formatos legados |
| P2-04 | ✅ #594 b726/b727 | Tags sem atomicidade (b726, `dev/p2-04-tags-atomicas`: diff — lê, insere o que falta, apaga só o que saiu; cada passo confere o erro; sem RPC/DDL) | `rotas-relatorios.js:448`: DELETE com erro responde ok; DELETE ok + INSERT falho perde tags | operação transacional (RPC) ou verificar cada resultado e repor |
| P2-05 | ✅ #596 b729 | Índice Magalu incompleto publicado (b729, `dev/p2-05-indice-magalu`: snapshot local; falha em qualquer página = nada publicado, anterior fica, erro diz a página; 5 min entre tentativas on-demand) | `magalu-AMB.js:423`: falha na 1ª página apaga o índice; falha depois publica parcial e limpa o erro | snapshot separado; publicar só completo; preservar último válido |
| P2-06 | ✅ #597 b730 | Trabalho iniciado após SIGTERM (b730, `dev/p2-06-timers-na-drenagem`: preventiva de tokens, retrofit de itens e varredura Full-sem-NF com `drenagem.daquiA/intervalo`; checagem entre etapas; renovação em voo termina e grava; nova após SIGTERM recusada) | preventiva de tokens e retrofit com timers fora da drenagem | registrar timers na drenagem; checar antes de cada etapa; preservar o que está em voo |
| P2-07 | ✅ #598 b731 | Sucesso atrasado apaga pausa de 429 (b731, `dev/p2-07-pausa-429`: `ritmo-por-empresa` carimba o último 429 por pista; `avisarOk(…, saiuEm)` ignora sucesso mais velho; `bling-AMB` carimba `_saiuEm` após cada `aguardarVez`; a GOOD já tinha isso no porteiro desde 14/10) | `ritmo-por-empresa.js:168` | carimbar tentativa; sucesso antigo não cancela Retry-After posterior |
| P2-08 | ✅ #599 b732/b733 | Modo remoto depende de access local (b732, `dev/p2-08-remoto-sem-token-local`: `ml-AMB`/`bling-AMB` ganham `operacional()` (pergunta ao leitor) e `temToken()` = local OU token do dono já visto; o pré-aquecimento do boot usa `operacional()`) | `temToken()` olha token local e controla pré-aquecimentos | separar "tem token local" de "integração operacional pela política"; testar remoto sem credencial local |
| P2-09 | ✅ #600 b734 | Logout sem revogação efetiva (b734, `dev/p2-09-logout-revoga`: `lib/sessoes-revogadas.js` por empresa — logout revoga ESTE token assinado (hash, até vencer); `sairDeTodos(usuario)` encerra todas por carimbo; GOOD e fábrica. **Sobra:** sobreviver ao reinício do processo exige tabela no banco = DDL, decisão do dono) | assinatura validada antes do Map; limpar Map/cookie não invalida token capturado | política de revogação por sessão/usuário/empresa, inclusive após reinício e troca de papel |
| P2-10 | ✅ #592 b718 (lote) | Notificação vista compartilhada AMB/Girassol (b718, `dev/p2-10-notificacao-por-empresa`: chave `defeitos_visto_em:<empresa>`, a antiga da AMB lida como reserva) | chave fixa `amb_defeitos_visto_em` na mesma origem | 🟡 **dono decide**: separar também por usuário no mesmo navegador? Hoje é por navegador, como sempre foi |
| P2-11 | ✅ #601 b735 | Download de erro anunciado como foto (b735, `dev/p2-11-download-foto-confere`: só resposta ok com `image/*` vira arquivo, extensão do tipo real, toast conta só o que baixou e nomeia as falhas) | `painel-AMB.html:1222`: 401 JSON virou `.jpg` + "sucesso" | conferir status/tipo; contar só downloads concluídos |
| P2-12 | ✅ #592 b710 (lote) | Fallback de foto com `SUPABASE_URL` não declarado (b710, no PR do P1-09) | `rotas-admin-AMB.js:79` → ReferenceError na falha do Storage | injetar dependência; testar o caminho de erro |
| P2-13 | ✅ #602 b736 | Workflow verde sem operar (b736, `dev/p2-13-destrava-pr-honesto`: `GH_REPO` no env + `--repo` em todo `gh`; listagem falhando = `::error::` + exit 1 no passo (o job segue `continue-on-error`, nunca bloqueia o PR); zero PR = "nada a fazer") | `.github/workflows/destrava-pr.yml`: sucesso com `fatal: not a git repository` | informar repositório; distinguir "nada a fazer" de erro |
| P2-14 | ✅ #592 b711 (lote) | Contrato Node incompatível (b711, no PR do P1-10: manifesto e lock em `>=22.0.0`; conferir no Render qual Node o serviço usa — `/health → node`) | `package.json` `node >=18`; Supabase do lock exige 22; CI usa 22 | alinhar manifesto, Render e CI em 22 (junto com P1-10) |
| P2-15 | ✅ #603 b737/b738 | Teste de boot aceita processo quebrado (b737, `dev/p2-15-teste-boot-honesto`: `test/_boot-real.js` — morte antecipada = falha com o fim do log, `/health` 200 real com teto, `pedir()`; o teste do painel loga de verdade e exige `/painel-novo.html` 200 com HTML; `boot-real-detecta-morte` prova com SyntaxError e processo mudo) | teste do painel só checa ausência de frase; filho morto por SyntaxError passa | checar morte antecipada, `listening`, timeout e resposta HTTP real |
| P2-16 | ✅ #604 b739 | Resolução de conversas por contagem (b739, `dev/p2-16-destrava-so-com-prova`: no `destrava-pr.yml` erro de consulta = `::error::` e PR pulado (nunca "zero"); conversa só é resolvida com prova — resposta de não-Codex depois do apontamento ou `isOutdated`; sem prova fica aberta e nomeada. O `auto-merge-codex.yml` não resolve threads — e o merge segue manual) | automação (`auto-merge-codex.yml`/scripts) resolve threads por quantidade; erro de consulta vira "zero problemas" | só resolver com prova de tratamento; erro de consulta bloqueia a decisão. Não reativar auto-merge antes disso |
| P2-17 | ✅ #605/#606/#607 b740–b742 (npm audit: 0) | Dependências com advisories além do Multer (a) express ✅ #605 b740 — express 4.22.3, body-parser 1.20.9, qs 6.16.2, proxy-addr 2.0.8, changelogs lidos (só correções de segurança + `req.fresh` pra método QUERY); (b) axios ✅ #606 b741 — axios 1.21.1 + follow-redirects 1.16.3, changelog lido: a única quebra do 1.21.0 (defaults de header com instância de classe) não se aplica — o repo não usa `axios.create` nem `defaults.headers`; (c) nodemailer ✅ #607 b742 — 6.10.1 → 10.6.0; quebras lidas (7: SES removido; 8: `NoAuth`→`ENOAUTH`; 9: TLS validado ao buscar conteúdo remoto; 10: Node ≥20, build TS/CJS) — nenhuma toca o uso; provado contra SMTP local (achado ao rodar `npm audit` no b711) | `express@4` → `body-parser` <1.20.9, `qs`, `proxy-addr` (IP spoofing via IPv4-mapped IPv6 — importa pra `trust proxy`/rate limit); `axios` → `follow-redirects`; `nodemailer` ≤10.1.3 (injeção SMTP) | subir cada um no seu PR, lendo o changelog (express 4.x patch, axios 1.x, nodemailer 7/8 muda API de transporte?) — nunca `npm audit fix --force` |

---

## 5. Validação adicional / decisão de negócio

| id | estado | ponto | o que fazer | quem decide |
|---|---|---|---|---|
| V-01 | ✅ #595 b728 | Completude das consultas (PostgREST) (b728, `dev/v01-paginacao-postgrest`: `lib/ler-tudo.js` lê por `range` até a página curta, erro em qualquer página estoura; relatório financeiro e mapa de pedidos do ciclo usam; dublês cortam em max-rows como o PostgREST) | relatórios e mapa de pedidos do ciclo leem sem paginar; teste simula teto pequeno e exige ler as páginas seguintes | código |
| V-02 | 🟡 | Matriz de permissões de recados GOOD × fábrica | divergência comprovada (aliases liberam ações ao estoquista); escrever a regra desejada, depois aplicar nas 3 | **dono** diz a regra |
| V-03 | 🟡 | `?k=` em URLs | migrar uso humano pra sessão, serviço pra header; retirar o antigo; **rotacionar `ADMIN_KEY`** (Render, serviço `good-devolucoes-x-marketplaces-x-nfsbling`, e no `mover-pedidos` onde a ponte usa a mesma chave) | código + dono rotaciona |
| V-04 | 🟡 | Backups e restore | runbook de restauração do Supabase (`sldnshulmhpmyjqrkstq`) e do Storage com RPO/RTO e ensaio registrado | dono confere o backup contratado |
| V-05 | ✅ #579 b708 (código; ler o relato Report-Only no /health antes de endurecer a CSP = operação) | Configuração real de segurança | **b708** (`dev/v05-cabecalhos-csp`): nosniff/referrer/SAMEORIGIN + CSP em vigor só com o que nenhuma tela usa (`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`); a CSP completa em **Report-Only** com contagem em `/health → csp` — apertar fatia a fatia depois de ler o que ela bloquearia. Falta (dono): políticas dos buckets, acesso anônimo, RLS/constraints, cabeçalhos do Render, proteção da main | código (CSP) + **dono** (painéis) |
| V-06 | ⬜ | Escala horizontal | filas/locks são locais ao processo; antes de réplica: executor único ou coordenação durável. Registrar como regra em `ESTADO-MULTILOJA.md` | código/doc |
| V-07 | 🔄 | Deadline nas chamadas Shopee do bipe (b743, `dev/v07-shopee-deadline-bipe`: `lib/prazo-total.js` — relógio único pra sequência lista→índice→refresh→pedido cancelado, `SHOPEE_BIPE_PRAZO_MS` 20s, AbortSignal por chamada; estouro = `{degradado, etapa, motivo}` → tentativa 504 + aviso; tela diz "não respondeu a tempo"; GOOD e fábrica) | medir e limitar tempo total com resultado degradado claro | código |
| V-08 | ⬜ | UI/acessibilidade | provas em navegador real (celular, modais, foco, teclado, upload, sessão longa); revogar blobs; `integrity` nas libs externas | código |
| V-09 | ⬜ | Quarta empresa | extensão com lista fechada de 3; onboarding confere extensão, provedores, tabelas, permissões e operação — não só a ficha (`docs/PLUGAR-EMPRESA-NOVA.md`) | código/doc |
| V-10 | 🟡 | Fusão 01/01/2027 | titularidade do app Shopee e clients Magalu do Mover-Pedidos exigem confirmação externa; **não** forçar tudo pra `remoto` — `sombra` com app próprio é decisão válida | **dono** (ver H-02) |

---

## 6. O que já estava em processo antes da auditoria (herdado)

| id | estado | frente | situação em 15/11 | próximo passo |
|---|---|---|---|---|
| H-01 | ⬜ | **Cliente do Bling em duas cópias** — `lib/bling.js` (655 l.) × `amb-devolucoes/lib-AMB/bling-AMB.js` | única cópia que resta da dívida (`docs/divida-copias-empresas.md`); ML (b702) e buscas (b703) já são peça única | GOOD vira adaptador sobre a fábrica, nivelando por cima (medir antes o que cada lado tem que o outro não tem). Entra depois da etapa 11 — ou antes, se um P1/P2 exigir mexer nos dois |
| H-02 | 🟡 | **Fusão GOOD→Girassol** — `docs/FUSAO-GOOD-GIRASSOL.md` | ⏸ ordem do dono (06/11): primeiro o multiempresa redondo. Correção dele de 15/11 ainda **não** está no doc: a partir de 01/01/2027 nada é faturado pelo CNPJ da GOOD, mas as contas (marketplaces, Bling, banco, e-mail) **ficam vivas por uma sobra de tempo** pra puxar dados e são baixadas depois; até fim de jan/2027 produtos e anúncios recadastrados na Girassol | PR só de doc: sobra de tempo + lista "o que puxar enquanto as contas vivem" (NFs/XMLs do Bling, claims/returns do ML, financeiro Shopee/Magalu/TikTok, histórico do Supabase sem sufixo). Pendências **dele**: em qual conta está o app de parceiro da Shopee (`ambtotal-shopee-nf-sync-x-bling`); se os SMTP da Girassol/AMB no Render são do domínio da GOOD; client Magalu próprio no Mover-Pedidos fica **por último** ("não vou mexer no magalu agora") |
| H-03 | 🟡 | **`sql/provisionar-empresa.sql`** | `provisionar_empresa` cria o que falta mas não altera tabela existente ("ja existia (nao mexi)"); completar colunas pelo molde é DDL em produção | só com OK explícito do dono; rodar no projeto `sldnshulmhpmyjqrkstq` |
| H-04 | ⏸ | **Cancelado antes da postagem** (`/areas` do Mover-Pedidos; sonda TikTok no ar, #763) | pausado pelo dono até fechar o multiempresa; regra: só pedido **não postado** (postado é do Devoluções) | falta ML/Shopee/Magalu na sonda, card "NÃO EMBALAR", NF (cancelar ≤24h ou devolução) + Bling Cancelado. Repo: Mover-Pedidos |
| H-05 | ⬜ | **Duas Bridges divergem** — `extensao-bridge/` (Devoluções) × cópia dentro da Toolbox (Mover-Pedidos) | a Girassol entrou numa e não na outra (30/09) | consolidar junto com P1-06 e V-09: uma Bridge, empresa em toda rota |
| H-06 | 🟡 | **Fase 3B** — NF de devolução com item vazio (Bling exige id do item da NF que a v3 não devolve) | gate respondido em 06/11; aguarda a frase-gatilho do dono | nada até ele chamar |
| H-07 | 🟡 | **Devoluções dentro do Mover-Pedidos** (um Render só) | decisão de 25/07: sessão dedicada, com redirect do domínio antigo | não puxar; registrar aqui pra não perder |
| H-08 | ⬜ | **Aposentar o código da GOOD no `server.js`** (9.375 l.) em fatias — bootstrap fino | plano em `FUSAO-GOOD-GIRASSOL.md` "Depois (jan/2027)"; o Codex pede preservar como monólito modular, sem microserviços nem reescrever a UI | cada P1 que tocar a raiz já deve mover a regra pra fábrica (como P1-11), não consertar a cópia |
| H-09 | ⬜ | **Fila do Mover-Pedidos** (outro repo; plano em `docs/plano-multiloja-passos.md` de lá) | fábrica de rotas do painel (~7 rotas restantes + `dashboard.html` da GOOD), filtro de Full por unidade na Girassol (em aberto com o dono), ligar módulos ao porteiro do Bling um a um | segue lá, um PR por vez, depois deste roteiro ou quando um item daqui exigir PR gêmeo (contrato v16: Devoluções primeiro) |
| H-10 | 🔄 PR #615 b753 | **Apagar `extensao-bridge/` congelada** (LEIA-ME de 28/08 diz que a casa canônica é a Toolbox; o Codex auditou a cópia morta em 15/11) | continua no repo e confunde auditoria e leitor | PR só de remoção, com os testes que a leem apontados pra Toolbox ou removidos (`bridge-deteccao-sem-corrida`, `painel-modulo-bridge` leem o painel, não a pasta — conferir) |

---

## 7. Testes que o Codex pediu (acompanham as etapas)

| id | estado | frente | entra em |
|---|---|---|---|
| T-01 | 🔄 PR #610 b748 | Testes HTTP de papéis, empresa e estados (subir o servidor e bater nas rotas das 3) — `test/http-papeis-empresa-estados.test.js` sobe o `server.js` com GOOD+AMB+Girassol contra um PostgREST falso na porta (`test/_postgrest-falso.js`); V-02 (recados) entra quando o dono disser a regra | P1-04, P1-09, V-02 |
| T-02 | ⬜ | PostgreSQL descartável com as migrations reais (constraints, FKs, RLS, update condicional) | P1-03, P2-04, H-03 |
| T-03 | 🔄 PR #613 b751 | Repetição, concorrência e falha entre ERP e banco — `test/erp-banco-repeticao-concorrencia.test.js`: supabase-js real contra o PostgREST falso (gancho `interceptar` falha uma escrita específica), rotas no express real, Bling falso contando POSTs; 7 cenários × 3 fichas | P1-03 |
| T-04 | 🔄 PR #614 b752 | Navegador real (Playwright): busca, câmera, troca de pacote, painel — `test/navegador-real.test.js` (Chromium headless na tela servida pelo `server.js` real, 3 empresas: login pela tela, P2-01 bipe A lento + B rápido, P1-07 foto tardia não entra no pacote seguinte, P1-01 título hostil não executa); o painel admin e V-08 (acessibilidade) entram em rodada seguinte. Dev: `playwright 1.63.0` pinado no lock + `npx playwright install chromium` | P1-01, P1-07, P2-01, V-08 |
| T-05 | 🔄 PR #611 b749 | Instalação estrita pelo lockfile com Node alinhado (`npm ci`) — workflow `ai-pr-checks` com `npm ci` e `node-version-file: .nvmrc`; `test/lockfile-estrito.test.js` prova `npm ci --dry-run --offline` verde e vermelho com package.json fora do lock | P2-14 |
| T-06 | 🔄 PR #612 b750 | Smoke que faz requisições reais ao servidor e às rotas de cada empresa — `test/smoke-rotas-empresas.test.js` (página de entrada, todo script/estilo referenciado, `/api/auth/me`, login, painel, nas 3); substitui o "Boot real" do CI que só dava `require` | P2-15 |

Dos 263 testes, 217 leem fonte. Todo PR deste roteiro troca inspeção de fonte por execução onde
o item passar — sem reescrever o resto (`CLAUDE.md §6`).

---

## 8. Como atualizar este documento

- Ao abrir o PR do item: estado 🔄 e o nome da branch.
- Ao mergear: ✅ `#PR bNNN` e uma linha do que mudou; mover a lição pra `ESTADO-MULTILOJA.md`
  se for regra permanente.
- Item novo que surgir no caminho entra **no fim da seção certa** com id novo — não troca a
  ordem do que já está aqui. Se o conserto começar a se espalhar, parar e explicar a dependência.
- Decisão do dono: registrar a frase dele e a data no próprio item.
