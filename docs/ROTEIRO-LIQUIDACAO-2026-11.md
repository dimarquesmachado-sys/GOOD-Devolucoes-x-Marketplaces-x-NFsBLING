# Roteiro de liquidação — auditoria do Codex (15/11/2026) + o que já estava em processo

> **Este é o único roteiro.** Tudo o que está aberto no Devoluções vive aqui: os 11 P1 e os
> 16 P2 da auditoria do Codex, os 10 pontos de validação/decisão, as 6 frentes de teste que
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
| 11. Resiliência e testes | P2-05, P2-06, P2-07, P2-08, P2-09, P2-11, P2-13, P2-15, P2-16, V-07, T-01..T-06 | falha intermediária preserva o último estado válido e aparece como falha |
| 12. Operação e evolução | V-02, V-03, V-04, V-06, V-08, V-10, H-01..H-04, H-06..H-09 | evidência de recuperação e de independência entre empresas |

---

## 3. P1 — segurança e corrupção operacional

### P1-01 🔄 Fotos podem injetar JavaScript no painel admin
- **PR:** branch `dev/p1-01-xss-fotos-painel` (b706). A ficha de defeitos (`js-AMB/defeitos-ficha.js`) tinha a mesma causa e entrou junto: `onclick="verFotoDefeito('<esc(url)>')"` (o parser HTML desfaz o `&#39;` antes do JS) e `window.open(this.src)`.
- **Onde:** `amb-devolucoes/public-AMB/painel-AMB.html` (~l.1081); o painel é único (a GOOD recebe o mesmo via `lib/painel-unico.js`), então afeta as 3. Servidor aceita string arbitrária no array de fotos.
- **Errado:** URL da foto interpolada em atributo HTML e em `onclick`. Escapar HTML ≠ escapar argumento JS.
- **Correção:** montar elementos por propriedade (`img.src = …`) e `addEventListener`; retirar JS montado como string; validar no servidor que cada referência de foto é chave/URL do Storage esperado.
- **Aceite:** foto, título, SKU e tag com aspas, entidades e atributos continuam dados; não criam evento nem executam ao renderizar ou clicar.

### P1-02 ⬜ Callbacks públicos devolvem conteúdo sem escape
- **Onde:** `server.js` (~l.2970, `code` no HTML) e `amb-devolucoes/lib-AMB/oauth-callback-AMB.js` (~l.29, erro do provedor no HTML **antes** de validar o `state`).
- **Correção:** código e erro como texto codificado pro contexto; na fábrica, validar/consumir o state antes de qualquer resposta com dado do provedor.
- **Aceite:** parâmetro malicioso nos callbacks das 3 empresas não produz elemento nem evento executável.

### P1-03 ⬜ Autorizar a mesma recuperação de novo duplica estoque
- **Onde:** `lib/defeitos-ciclo.js` rota `POST /api/defeitos/pedido/:id/decidir` (~l.1337) — atualiza e chama a entrada no Bling sem exigir estado anterior nem respeitar movimentação já confirmada. Relançamento: ERP confirma, banco recusa o marcador, código responde sucesso.
- **Correção:** reservar a operação no banco **antes** do efeito externo (update condicional `status = 'pendente'`, id de operação), estados `pendente / em_processamento / confirmado / incerto`; reaproveitar o padrão do FULL (reserva persistente, `estoque_lancado`).
- **Aceite:** repetição sequencial, simultânea, resposta perdida e falha de persistência não geram entrada indevida; timeout depois do envio vira conciliação, nunca repetição cega.
- ⚠️ Pode pedir coluna nova → SQL explícito em `sql/`, compatível no deploy, **só com OK do dono**.

### P1-04 ⬜ Estoquista conclui pedido pendente sem aprovação
- **Onde:** mesma rota, ~l.1345: `concluir` passa com `requerLogin` e não confere `status === 'autorizado'`. Confirmado no código em 15/11.
- **Correção:** máquina de estados no servidor com permissão por transição: `autorizar/recusar` só admin e só de `pendente`; `concluir` só de `autorizado`. Negar = nenhuma escrita.
- **Aceite:** estoquista não promove pendente/recusado a concluído; resposta 403/409 sem update.

### P1-05 ⬜ Fallback por EAN escolhe o primeiro candidato
- **Onde:** `lib/defeitos-ciclo.js` (~l.93). Contraria `CLAUDE.md §5`: EAN não identifica produto neste catálogo.
- **Correção:** `produto.id` confirmado → SKU → de-para (`sku_depara*`); ambiguidade no EAN **interrompe** com mensagem, nunca escolhe.
- **Aceite:** dois produtos com o mesmo EAN jamais provocam escolha automática.

### P1-06 ⬜ Extensão vincula NF da Girassol/AMB a registro da GOOD
- **Onde:** `extensao-bridge/background.js` (~l.307): consulta ids fiscais pela empresa mas o auto-registro faz `PUT /api/admin/registrar-devolucao-gerada/:id` sempre na raiz.
- **Correção:** a empresa validada define o destino de **todas** as etapas; confirmar a conta Bling da aba escolhida corresponde à empresa; falha de persistência visível mesmo com o painel fechado.
- **Aceite:** mesmo ID nas 3 tabelas → só a empresa pedida muda. Ver H-05 (as duas Bridges divergem).

### P1-07 ⬜ Fotos de um pacote contaminam o seguinte
- **Onde:** `js-AMB/camera.js` (~l.128) — callback do upload escreve em índice numérico de array global; nova triagem troca o array com upload anterior em voo. Tela de bipe é única (js-AMB serve a GOOD).
- **Correção:** ID estável por foto + geração/identidade por triagem; resposta antiga só atualiza o fluxo que a originou.
- **Aceite:** inverter respostas, remover foto e trocar de pacote durante upload não mistura evidência nem deixa bloqueio permanente.

### P1-08 ⬜ Relatório financeiro multiplica qtd total pelo preço de um produto
- **Onde:** `lib/rotas-relatorios.js` (~l.208) — ignora `itens_devolvidos`; devolução só do 2º item ainda usa o 1º `order_item`. Ver `docs/ITENS-DEVOLVIDOS.md`.
- **Correção:** agregar por item efetivamente devolvido (id, qtd, preço); histórico sem evidência marcado como desconhecido/aproximado, não inventado.
- **Aceite:** parcial, múltiplos SKUs e só-o-2º-produto dão valores e rankings corretos (A 1×R$10 + B 1×R$100 = R$110, A=1, B=1).

### P1-09 🔄 Proxy de fotos não autoriza o objeto pela empresa
- **PR:** branch `dev/p1-09-proxy-foto-por-empresa` (b710), junto com P2-12 (mesma rota). Autoriza pelo vínculo `problema_fotos` na tabela da empresa; foto nova vai pra pasta da chave da empresa (`girassol/`, `ambtotal/`), as antigas em `amb/` seguem servidas pelo vínculo.
- **Onde:** `amb-devolucoes/lib-AMB/rotas-admin-AMB.js` (~l.52) — exige admin, aceita qualquer chave do bucket; upload da fábrica ainda usa prefixo `amb/` pra AMB e Girassol.
- **Correção:** autorizar empresa → devolução → foto; namespace por empresa com compatibilidade controlada pras imagens antigas.
- **Aceite:** admin de A pedindo foto de B recebe 403/404 antes de qualquer download.

### P1-10 ⬜ Multer 1.4.5-lts.2 com CVE-2025-47944 e CVE-2026-2359
- **Onde:** `package.json` `multer ^1.4.5-lts.1`, lock resolve lts.2; `memoryStorage`; rotas exigem sessão antes do parser.
- **Correção:** subir pra versão mantida sem advisory; revisar limites (tamanho, contagem); validar conteúdo real da imagem. **Não** `npm audit fix --force`. Junto com P2-14 (Node).
- **Aceite:** upload válido, excessivo, malformado e interrompido nas 3 — processo segue atendendo.

### P1-11 ⬜ OAuth Magalu da GOOD sem state de uso único
- **Onde:** `server.js` (~l.4301): `state='good'`, callback aceita code sem conferir estado/sessão; persiste tokens antes de confirmar a conta.
- **Correção:** usar o fluxo da fábrica (state aleatório, validade curta, consumo único, empresa vinculada, identidade confirmada antes de gravar) — a GOOD vira adaptador, como no ML (b702).
- **Aceite:** state ausente, expirado, repetido ou de outra empresa falha sem trocar nem gravar credencial.

---

## 4. P2 — confiabilidade, consistência, manutenção

| id | estado | ponto | onde / evidência | direção |
|---|---|---|---|---|
| P2-01 | ⬜ | Busca fora de ordem | `busca.js:35` (**dois** arquivos: `public/js/busca.js` e `js-AMB/busca.js`); A/B respondidos B/A → campo B, resultado A | identidade da solicitação; só a mais recente atualiza tela e payload |
| P2-02 | ⬜ | Quantidade inválida | `defeitos-ciclo.js:1358`: 0/negativo/NaN viram 1, `Infinity` passa | rejeitar inválido; exigir finito, inteiro, limite |
| P2-03 | ⬜ | Lista GOOD quebra em 150 pedidos | `defeitos-ciclo.js:510`: com 151 IDs registros `problema/delivered` somem da lista e seguem na contagem | consultar em lotes/páginas; testar 149/150/151/400 e formatos legados |
| P2-04 | ⬜ | Tags sem atomicidade | `rotas-relatorios.js:448`: DELETE com erro responde ok; DELETE ok + INSERT falho perde tags | operação transacional (RPC) ou verificar cada resultado e repor |
| P2-05 | ⬜ | Índice Magalu incompleto publicado | `magalu-AMB.js:423`: falha na 1ª página apaga o índice; falha depois publica parcial e limpa o erro | snapshot separado; publicar só completo; preservar último válido |
| P2-06 | ⬜ | Trabalho iniciado após SIGTERM | preventiva de tokens e retrofit com timers fora da drenagem | registrar timers na drenagem; checar antes de cada etapa; preservar o que está em voo |
| P2-07 | ⬜ | Sucesso atrasado apaga pausa de 429 | `ritmo-por-empresa.js:168` | carimbar tentativa; sucesso antigo não cancela Retry-After posterior |
| P2-08 | ⬜ | Modo remoto depende de access local | `temToken()` olha token local e controla pré-aquecimentos | separar "tem token local" de "integração operacional pela política"; testar remoto sem credencial local |
| P2-09 | ⬜ | Logout sem revogação efetiva | assinatura validada antes do Map; limpar Map/cookie não invalida token capturado | política de revogação por sessão/usuário/empresa, inclusive após reinício e troca de papel |
| P2-10 | ⬜ | Notificação vista compartilhada AMB/Girassol | chave fixa `amb_defeitos_visto_em` na mesma origem | empresa canônica na chave; decidir separação por usuário |
| P2-11 | ⬜ | Download de erro anunciado como foto | `painel-AMB.html:1222`: 401 JSON virou `.jpg` + "sucesso" | conferir status/tipo; contar só downloads concluídos |
| P2-12 | 🔄 | Fallback de foto com `SUPABASE_URL` não declarado (b710, no PR do P1-09) | `rotas-admin-AMB.js:79` → ReferenceError na falha do Storage | injetar dependência; testar o caminho de erro |
| P2-13 | ⬜ | Workflow verde sem operar | `.github/workflows/destrava-pr.yml`: sucesso com `fatal: not a git repository` | informar repositório; distinguir "nada a fazer" de erro |
| P2-14 | ⬜ | Contrato Node incompatível | `package.json` `node >=18`; Supabase do lock exige 22; CI usa 22 | alinhar manifesto, Render e CI em 22 (junto com P1-10) |
| P2-15 | ⬜ | Teste de boot aceita processo quebrado | teste do painel só checa ausência de frase; filho morto por SyntaxError passa | checar morte antecipada, `listening`, timeout e resposta HTTP real |
| P2-16 | ⬜ | Resolução de conversas por contagem | automação (`auto-merge-codex.yml`/scripts) resolve threads por quantidade; erro de consulta vira "zero problemas" | só resolver com prova de tratamento; erro de consulta bloqueia a decisão. Não reativar auto-merge antes disso |

---

## 5. Validação adicional / decisão de negócio

| id | estado | ponto | o que fazer | quem decide |
|---|---|---|---|---|
| V-01 | ⬜ | Completude das consultas (PostgREST) | relatórios e mapa de pedidos do ciclo leem sem paginar; teste simula teto pequeno e exige ler as páginas seguintes | código |
| V-02 | 🟡 | Matriz de permissões de recados GOOD × fábrica | divergência comprovada (aliases liberam ações ao estoquista); escrever a regra desejada, depois aplicar nas 3 | **dono** diz a regra |
| V-03 | 🟡 | `?k=` em URLs | migrar uso humano pra sessão, serviço pra header; retirar o antigo; **rotacionar `ADMIN_KEY`** (Render, serviço `good-devolucoes-x-marketplaces-x-nfsbling`, e no `mover-pedidos` onde a ponte usa a mesma chave) | código + dono rotaciona |
| V-04 | 🟡 | Backups e restore | runbook de restauração do Supabase (`sldnshulmhpmyjqrkstq`) e do Storage com RPO/RTO e ensaio registrado | dono confere o backup contratado |
| V-05 | ⬜ | Configuração real de segurança | CSP compatível com scripts legados; conferir políticas dos buckets, acesso anônimo, RLS/constraints, cabeçalhos do Render, proteção da main | código (CSP) + **dono** (painéis) |
| V-06 | ⬜ | Escala horizontal | filas/locks são locais ao processo; antes de réplica: executor único ou coordenação durável. Registrar como regra em `ESTADO-MULTILOJA.md` | código/doc |
| V-07 | ⬜ | Deadline nas chamadas Shopee do bipe | medir e limitar tempo total com resultado degradado claro | código |
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

---

## 7. Testes que o Codex pediu (acompanham as etapas)

| id | estado | frente | entra em |
|---|---|---|---|
| T-01 | ⬜ | Testes HTTP de papéis, empresa e estados (subir o servidor e bater nas rotas das 3) | P1-04, P1-09, V-02 |
| T-02 | ⬜ | PostgreSQL descartável com as migrations reais (constraints, FKs, RLS, update condicional) | P1-03, P2-04, H-03 |
| T-03 | ⬜ | Repetição, concorrência e falha entre ERP e banco | P1-03 |
| T-04 | ⬜ | Navegador real (Playwright): busca, câmera, troca de pacote, painel | P1-01, P1-07, P2-01, V-08 |
| T-05 | ⬜ | Instalação estrita pelo lockfile com Node alinhado (`npm ci`) | P2-14 |
| T-06 | ⬜ | Smoke que faz requisições reais ao servidor e às rotas de cada empresa | P2-15 |

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
