# Bahanle Analytics

Uma plataforma de análise de dados e dashboards feita do zero: obter e preparar
dados, modelar, criar medidas com uma linguagem de fórmulas, montar relatórios
interativos e entregá-los (imagem, PDF ou HTML publicado).

```bash
npm install
npm run dev     # gera o visualizador e abre em http://localhost:5173
npm test        # testes do motor, consultas, datas e publicação
npm run build   # build de produção em dist/
npm start       # serve dist/ com login (lê o .env)
```

Os dados ficam em memória e no `localStorage` do navegador (salve em `.json`
pelo menu **Arquivo** para guardar ou levar a outro lugar). Um servidor pequeno
só cuida do **login com Google**: sem sessão, nenhum arquivo do app é entregue.

## Login com Google

Quem ainda não entrou vê o **site público** (`server/site.ts`), com páginas
Início, Recursos, Visuais (uma ficha por componente), IA, Segurança e Dúvidas,
e o botão **Entrar com Google** no topo de todas. Só entra quem tem acesso — tanto no
`npm run dev` quanto em produção.

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   crie uma credencial **ID do cliente OAuth** do tipo **Aplicativo da Web** e
   cadastre em *Origens JavaScript autorizadas*: `http://localhost`,
   `http://localhost:5173` e o endereço de produção.
2. Na tela de consentimento OAuth, **publique o app** (sai do modo Teste, que
   aceita no máximo 100 e-mails cadastrados à mão). Como o app só pede nome,
   e-mail e foto, não precisa da verificação do Google.
3. Copie `.env.example` para `.env` e preencha `GOOGLE_CLIENT_ID`,
   `ADMIN_EMAILS` (você) e `SESSION_SECRET`.
4. `npm run dev` para desenvolver; em produção, `npm run build && npm start`
   (porta 8080, sirva atrás de HTTPS).

Como funciona (`server/auth.ts`): o botão do Google devolve um ID token; o
servidor confere a assinatura (chaves públicas do Google), o emissor, o público
(seu Client ID), se o e-mail é verificado e se a pessoa tem acesso, e grava um
cookie de sessão `HttpOnly` assinado com HMAC. O acesso é conferido de novo a
cada pedido, então bloquear alguém corta o acesso na hora. O **relatório
publicado** (HTML único) é um arquivo à parte e não passa pelo login.

### Usuários

Com o banco ligado (`DATABASE_URL`), os usuários ficam na tabela `users`
(`server/users.ts`):

- **Administradores fixos** vêm de `ADMIN_EMAILS`: sempre entram e não dá para
  bloqueá-los pela tela (assim ninguém se tranca fora).
- No menu da conta (seu nome, no canto), **👥 Usuários…** — só para
  administradores — mostra todo mundo: convide pelo e-mail da conta Google
  (como usuário ou administrador), bloqueie, desbloqueie, troque o papel ou
  remova.
- Quem entra com o Google sem convite vira um **pedido de acesso** (aparece
  no topo da tela, com **Aprovar** e **Recusar**) e vê o aviso de que precisa
  de aprovação.
- `ALLOWED_EMAILS` (opcional) libera e-mails ou domínios inteiros
  (`@empresa.com`) sem convite; um bloqueio na tela vale mais que ele.

Cada usuário vê só os próprios relatórios em **Meus relatórios**. Sem banco,
valem só `ADMIN_EMAILS` e `ALLOWED_EMAILS`.

## O que dá para fazer

| Etapa | Recursos |
| --- | --- |
| **Obter dados** | CSV (separador detectado), Excel `.xlsx` (todas as planilhas), JSON (listas, campos aninhados viram `a.b`) |
| **Preparar** (aba Dados) | Editor de consultas com *Etapas aplicadas*: tipo detectado automaticamente, renomear, mudar tipo, remover coluna, filtrar linhas, substituir valores, remover duplicadas e linhas em branco |
| **Modelar** (aba Modelo) | Relacionamentos muitos-para-um, colunas calculadas (`RELATED`, `IF`), tipo data |
| **Calcular** | Medidas com fórmulas: agregações, `CALCULATE`/`ALL`, `IF`, iteradores `SUMX`/`FILTER`, inteligência de tempo |
| **Visualizar** | 37 visuais (incluindo KPI, combo, cascata, mapa de calor, texto dinâmico e botões), páginas, filtro cruzado, segmentação, Painel de Filtros (visual/página/relatório), Top N, ordenação, barras de dados e escala de cores |
| **Explorar** | Drill-down, árvore de decomposição, principais influenciadores, histograma e box plot, previsão com faixa de confiança, linhas de referência, modo foco, exportar dados do visual (CSV) |
| **Apresentar** | Temas claro/escuro, 4 paletas, indicadores (bookmarks) |
| **Entregar** | Página como PNG, impressão/PDF, **Publicar** como HTML único somente leitura |
| **Criar com IA** (botão ✨ IA) | Descreva o dashboard em texto ("total de vendas por estado"); um LLM local no Ollama monta página, medidas e visuais |
| **Lakehouse** (aba Notebooks) | Notebooks no estilo Databricks com SQL próprio (JOIN, GROUP BY, janelas, CTE), gráfico e plano de execução; `CREATE TABLE … AS` grava tabelas no modelo |

## Criar com IA (Ollama)

O botão **✨ IA** abre um chat: peça "total de vendas por estado" ou "dashboard
de vendas com totais, evolução mensal e top 5 produtos" e a IA cria uma página
com cartões, gráficos e as medidas que faltarem. Tudo roda no seu computador:

```bash
ollama pull qwen2.5:7b   # ou llama3.1:8b; modelos de 7B+ acertam bem mais os campos
ollama serve             # http://localhost:11434 (já libera localhost no CORS)
```

O LLM não cria nada direto: ele recebe as tabelas, colunas, relacionamentos e
medidas do modelo e devolve só um **plano em JSON** (o formato é imposto pelo
`format` do Ollama). O app confere cada coluna e valida cada medida no motor
motor de fórmulas; o que falhar volta ao modelo para uma correção. O resultado entra
como uma ação só — **Ctrl+Z** desfaz o dashboard inteiro.

## Relatórios na nuvem (Postgres / Neon)

Com `DATABASE_URL` no `.env`, cada usuário salva os próprios relatórios no
banco (o dono é o e-mail do login).

**Página inicial.** Depois do login, o app abre no **Início**
(`src/components/Home.tsx`): botão **+ Novo relatório**, os modelos para
começar (em branco ou o **Modelo de vendas**), o atalho **Continuar de onde
parou** e a grade de **Meus relatórios**, com busca, ordenação, renomear e
excluir. O logotipo na barra do editor volta para o Início.

**Salvar.** Todo relatório criado pelo Início já nasce salvo na conta, e cada
alteração é gravada sozinha uns 2 segundos depois da última mexida. A barra
mostra o nome do relatório com **✓ salvo**, **• não salvo**, **salvando…** ou um
aviso; seleções nos gráficos não contam. Se outra aba ou computador salvou
depois, o salvamento automático para e o **Ctrl+S** pergunta antes de
sobrescrever. Fechar a aba com algo pendente pede confirmação.

No menu **Arquivo**: **Meus relatórios** (volta ao Início), **Novo
relatório…**, **Novo a partir do modelo…**, **Salvar** (Ctrl+S), **Salvar uma
cópia…** e, à parte, **Exportar como arquivo (.json)** / **Importar arquivo
(.json)** para levar um relatório como arquivo.

O rascunho do navegador (`localStorage`) é só uma rede de segurança e é
separado por conta: duas pessoas no mesmo navegador não veem o trabalho uma da
outra. A tabela `reports` é criada sozinha na
primeira consulta (`server/reports.ts`): o relatório inteiro vai numa coluna
`jsonb`, e `version` impede que duas abas sobrescrevam uma à outra (409).

| Rota | O que faz |
| --- | --- |
| `GET /api/reports` | Lista os relatórios do usuário (nome, versão, data, tamanho) |
| `POST /api/reports` | Cria `{ name, data }` |
| `GET /api/reports/:id` | Abre |
| `PUT /api/reports/:id` | Salva `{ name?, data?, version }` — recusa (409) se outra aba salvou antes |
| `DELETE /api/reports/:id` | Exclui |

Limite de 10 MB por relatório (os dados das tabelas vão junto). Os testes da
API rodam contra um Postgres de verdade quando há `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL=postgres://usuario@localhost:5432/bahanle_test npm test
```

## Publicar no Render com Neon

O app e a API rodam num único **Web Service** do Render (mesmo endereço, sem
CORS, cookie de sessão simples); o Postgres fica no **Neon**. O `render.yaml`
já descreve o serviço.

**1. Repositório no GitHub.** O Render publica a partir de um repositório Git:
crie um repositório (pode ser privado) e envie a branch `main`. O `.env` não
vai junto (está no `.gitignore`).

**2. Banco no Neon** ([console.neon.tech](https://console.neon.tech)).
- Crie um projeto na região **AWS US East 2 (Ohio)**, a mesma do serviço no
  Render (`region: ohio` no `render.yaml`) — app e banco perto um do outro.
- Em **Connect**, ligue **Connection pooling** e copie a URL
  (`postgresql://…-pooler….neon.tech/neondb?sslmode=require…`). Ela é o
  `DATABASE_URL`. A tabela `reports` é criada sozinha no primeiro acesso.

**3. Login do Google** ([Google Cloud › Credenciais](https://console.cloud.google.com/apis/credentials)).
No mesmo ID do cliente OAuth do desenvolvimento (ou num novo, tipo *Aplicativo
da Web*), acrescente em *Origens JavaScript autorizadas* o endereço que o
Render der ao serviço, ex.: `https://bahanle-analytics.onrender.com` (o nome pode
ganhar um sufixo se já existir). Pode levar alguns minutos para valer.

**4. Serviço no Render** ([dashboard.render.com](https://dashboard.render.com)).
- **New › Blueprint**, conecte o GitHub e escolha o repositório: o Render lê o
  `render.yaml` e pede os valores marcados como secretos:
  - `GOOGLE_CLIENT_ID`: o ID do passo 3;
  - `ADMIN_EMAILS`: você (e outros administradores fixos); o resto das pessoas
    você convida ou aprova depois, pela tela **Usuários**;
  - `DATABASE_URL`: a URL do passo 2.

  O `SESSION_SECRET` é gerado pelo próprio Render e o `NODE_VERSION` é 24.
- O build roda `npm ci --include=dev && npm run build` (testes de tipo, o
  visualizador publicado e o app) e o serviço sobe com `node server/index.ts`
  na porta que o Render define. O health check usa `/healthz`, a única rota
  aberta sem login.
- Cada `git push` na `main` publica de novo (`autoDeploy`).

**5. Conferir.** Abra o endereço do serviço: deve aparecer a página de apresentação;
use **Entrar com Google** no topo com o e-mail de `ADMIN_EMAILS`, crie um relatório pelo **Início** e abra
o endereço em outro navegador — o relatório está em **Meus relatórios**.

**Bom saber**
- No plano gratuito, o serviço dorme após 15 minutos sem acesso; o primeiro
  acesso depois disso leva cerca de 1 minuto. O Neon gratuito também
  suspende o banco ocioso (volta em menos de 1 segundo) e tem 0,5 GB.
- O log pode mostrar um *SECURITY WARNING* do `pg` sobre `sslmode=require`:
  é só um aviso (a conexão já verifica o certificado). Para sumir, troque por
  `sslmode=verify-full` na URL.
- A **IA (Ollama)** continua rodando no computador de quem usa. Para o app
  publicado conversar com ele, libere a origem antes de abrir o Ollama, ex.:
  `OLLAMA_ORIGINS=https://bahanle-analytics.onrender.com`; o navegador pode pedir
  permissão para acessar a rede local.
- Para tirar o acesso de alguém, use **Bloquear** na tela **Usuários**: a
  sessão da pessoa deixa de valer no pedido seguinte.

## Mapa de estudo: conceito → código

| Conceito | Onde está | O que estudar |
| --- | --- | --- |
| Editor de consultas | `src/model/transform.ts`, `importers.ts` | Tabela = fonte + etapas reaplicadas em ordem; "Tipo Alterado" automático |
| Modelo semântico | `src/model/types.ts` | Esquema estrela: fato `Vendas` + dimensões + `Calendário` |
| Propagação de filtros | `Engine.rows` / `Engine.resolve` (`src/engine/query.ts`) | Filtros fluem do lado "um" para o "muitos" |
| Fórmulas: parser | `src/engine/expr.ts` | Tokenizer → AST, gramática recursiva descendente |
| Fórmulas: avaliação | `Engine.evaluate` | Contexto de filtro, BLANK, contexto de linha |
| `CALCULATE` / `ALL` | `Engine.applyCalcArgs` | Substituir/remover filtros; tabela expandida |
| Inteligência de tempo | `Engine.timeIntelligence` | Datas visíveis → novo conjunto de datas → troca os filtros da tabela de datas |
| Iteradores | `case "iter"` e `Engine.tableRows` | `SUMX(tabela, expr)` = contexto de linha dentro do contexto de filtro |
| Colunas calculadas | `src/model/calculated.ts` | Avaliadas uma vez por linha e gravadas |
| Hierarquias / drill | `hierarchyOf`, `axisOf`, `drillFilters` | Nível atual vira eixo; níveis acima viram filtros |
| Visual = consulta | `runVisual`, `runGrid`, `runTotals` | Cada ponto do gráfico é a medida num contexto de filtro |
| Painel de Filtros | `contextFor` | Filtros de relatório + página + visual + cruzado + drill-through + drill |
| Filtro por intervalo | `passes` / `toContext` em `src/engine/query.ts` | Um filtro é uma lista de valores **ou** um intervalo (mín./máx.) |
| Parâmetro de campo | `baseAxis` em `src/engine/query.ts` | O eixo do visual vem do campo escolhido no parâmetro |
| Desempenho | `src/model/perf.ts`, `Engine.stats` | Tempo de consulta, linhas percorridas e acertos do cache por visual |
| Agrupamento | `Engine.groups` em `src/engine/query.ts` | Filtrar por lista agrupa as linhas por valor **uma vez**; cada categoria é uma consulta ao grupo |
| Parâmetro "e se" | `Engine` (`params`) e `whatIfParams` | `[Nome do parâmetro]` numa medida vale o valor do controle |
| Laboratório | `src/engine/lab.ts` | Pequenos múltiplos, calendário, Gantt e dica com detalhes |
| Publicação | `src/model/publish.ts`, `vite.config.ts` | Visualizador num HTML único + dados embutidos |
| KPI, cascata, mapa de calor | `src/components/MoreVisuals.tsx` | `waterfallSteps`: base + variações por categoria = total; escala de cores entre mín. e máx. |
| Texto dinâmico | `fillTemplate` em `src/engine/query.ts` | `[Medida]` avaliada no contexto de filtro da caixa de texto |
| Mapas | `src/engine/geo.ts`, `src/model/geo/` | Projeção equirretangular, associação valor → UF, contornos do IBGE |
| Relatórios na nuvem (app) | `src/model/cloud.ts`, `src/components/Home.tsx` | Vínculo id + versão; "não salvo" comparando referências campo a campo (`contentChanged`) |
| API e banco | `server/reports.ts` | Rotas REST por usuário, jsonb no Postgres, controle de concorrência otimista por versão |
| Usuários | `server/users.ts`, `src/components/UsersAdmin.tsx` | Política de acesso (admins do .env + tabela `users`), pedidos de acesso, cache curto do papel por e-mail |
| Site público | `server/site.ts`, `server/site-visuals.ts` | Páginas em HTML do servidor (`/`, `/recursos`, `/visuais`, `/ia`, `/seguranca`, `/duvidas`) com o login no topo; sem sessão, só elas são entregues |
| Login | `server/auth.ts`, `server/index.ts` | ID token do Google (JWT) verificado no servidor → lista de permitidos → cookie de sessão assinado |
| Assistente de IA | `src/model/ai.ts`, `src/components/AiAssistant.tsx` | Esquema do modelo no prompt → plano JSON forçado por JSON Schema → validação de campos e medidas → ações num passo só de desfazer |
| Análises | `src/engine/analytics.ts` | Regressão linear e intervalo de predição, média móvel, quartis e bigodes de Tukey, regra de Sturges, influenciadores, decomposição |

### Visuais

| Grupo | Visuais |
| --- | --- |
| Comparação | Colunas, barras, colunas empilhadas, combo (colunas + linha, dois eixos), cascata, Pareto, funil |
| Tendência | Linha, área (ambas com pequenos múltiplos), calendário de calor |
| Composição | Rosca, treemap |
| Relação e distribuição | Dispersão, mapa de calor, histograma, box plot, radar, Sankey |
| Análise | Principais influenciadores, árvore de decomposição, narrativa automática |
| Indicadores | Cartão, cartão de várias linhas, KPI (valor + variação + meta + minigráfico), medidor, marcador (bullet) |
| Tabelas | Tabela, matriz (barras de dados ou escala de cores) |
| Geografia | Mapa coroplético do Brasil (por UF, estado, código IBGE ou região), mapa de bolhas (latitude/longitude ou centro da UF) |
| Interação e layout | Segmentação (lista, lista suspensa, intervalo "entre" ou data relativa), parâmetro de campo, parâmetro "e se", caixa de texto (`[Medida]` dinâmica, listas, links, alinhamento e tamanho), imagem (arquivo enviado ou endereço), botão (página ou indicador) |

A **cascata** aceita uma medida (cada categoria soma até o total) ou duas —
valor atual e valor base: começa no total da base, mostra a variação de cada
categoria (verde sobe, vermelho desce) e termina no total atual.

### Análises

- **Linhas de referência** (colunas, barras, linha, área): valor fixo/meta,
  média, mediana, mínimo ou máximo dos valores mostrados.
- **Previsão** (linha e área): tendência linear ou média móvel de 3 períodos,
  com faixa de 80%, 90% ou 95%. A faixa linear é o intervalo de predição da
  regressão — cresce quanto mais longe da série.
- **Histograma**: distribui uma coluna numérica em faixas iguais (regra de
  Sturges ou número escolhido). Clicar numa faixa filtra a página pelos valores
  dela.
- **Box plot**: uma caixa por categoria — quartis, mediana (linha), média
  (losango), bigodes a 1,5 × IQR e outliers (círculos). Passe o mouse para ver
  os números.
- **Principais influenciadores**: para cada valor das dimensões em "Explicar
  por", compara a medida no segmento com o total. Segmentos com menos de 2% das
  linhas (mínimo 20) ficam de fora. Mostra associação, não causa.
- **Árvore de decomposição**: comece pelo total, escolha a dimensão do próximo
  nível ("+ Detalhar por…") e clique num nó para abrir o caminho.

### Exploração

- **Segmentação "entre"**: dois controles deslizantes (ou campos de data e
  número) sobre uma coluna; vira um filtro por intervalo. O histograma também
  filtra por intervalo: clique numa faixa.
- **Drill-through**: na página de detalhe, sem nenhum visual selecionado,
  escolha em "Drill-through" o campo que ela aceita (no exemplo, a página
  *Detalhe do produto* aceita `Produtos[Produto]`). Em outra página, selecione
  um produto num visual e use **↗** no cabeçalho ou o **clique direito**. A
  página de detalhe abre filtrada, com **← Voltar**.
- **Pareto**: colunas do maior para o menor, % acumulado e a linha de 80%,
  com a frase "N de M fazem 80% do total".
- **Anomalias** (linha e área): pontos a mais de 2 ou 3 desvios da tendência
  ficam em vermelho, com o valor esperado na dica.
- **Narrativa automática**: frases geradas dos dados — total, comparação,
  evolução (início × fim, pico, vale, tendência, pontos fora do padrão) e quem
  lidera em cada dimensão. A participação no total só aparece para medidas
  aditivas (para o ticket médio, por exemplo, não faria sentido).

### Monitoramento e desempenho

- **Data relativa**: estilo de segmentação com "últimos N dias/meses/anos",
  "este mês/ano" ou "mês/ano anterior", contados a partir da data mais recente
  dos dados (ou de hoje).
- **Intervalo no Painel de Filtros**: campos numéricos e de data têm o modo
  "Intervalo" (mínimo e/ou máximo), nos três níveis.
- **Regras de cor**: em tabela, matriz, cartão, KPI e cartão de várias linhas —
  "maior que", "menor que", "entre"… com verde/amarelo/vermelho e ícone ▲●▼. A
  primeira regra que bate vale. Percentuais entram como fração (10% = 0,1).
- **Parâmetro de campo**: o visual "Parâmetro" oferece campos ("Região, Loja,
  Categoria, Produto"); visuais com "Eixo controlado por parâmetro" trocam de
  eixo junto.
- **Cartão de várias linhas** e **funil** (com a % do início e da etapa anterior).
- **⏱ Analisador de desempenho** (barra superior): por visual, o tempo de
  consulta ao motor, linhas percorridas, acertos/erros do cache de linhas
  filtradas e medidas avaliadas. Compare "Recalcular do zero" (cache frio) com
  "cache quente" — no exemplo, ~80 ms e 64 mil linhas contra ~20 ms e nenhuma.

### Laboratório e simulação

- **Marcador (bullet)**: realizado contra a meta (2ª medida ou valor fixo),
  com faixas ruim/ok/bom em fração da meta.
- **Radar**: categorias em várias medidas; com mais de uma medida, cada uma é
  escalada pelo próprio máximo (a dica mostra o valor real).
- **Pequenos múltiplos** (colunas, linha, área): "Pequenos múltiplos por" repete
  o gráfico para cada valor do campo, todos com a mesma escala.
- **Calendário de calor**: um quadrado por dia, semanas em colunas; ‹ › troca o
  ano; clicar num dia filtra a página.
- **Parâmetro "e se"**: um controle deslizante com nome; qualquer medida pode
  usar `[Nome]`. O exemplo simula aumento de preço com elasticidade da demanda:
  `[Faturamento] * (1 + [Aumento de preço]) * (1 - [Elasticidade] * [Aumento de preço])`.
- **Dica de ferramenta com detalhes** (colunas, barras, linha, área, rosca):
  medidas extras e um minigráfico do item ao passar o mouse.
- **Sankey**: fluxo da medida de uma dimensão (origem) para outra (destino).
- **Gantt**: tarefas com início e fim, % concluído, cor por grupo e a linha de
  hoje.

Por baixo, uma otimização do motor que vale estudar: ao filtrar por categoria,
as linhas são **agrupadas por valor uma única vez** (antes, cada categoria
percorria tudo de novo). O calendário de calor de um ano caiu de ~390 ms para
alguns milissegundos, e todo visual por categoria ficou mais rápido — veja no
analisador de desempenho.

### Composição, ranking e hierarquias

- **Matriz hierárquica**: marque "Linhas hierárquicas (+/−)" e os níveis de
  detalhamento viram linhas que abrem e fecham, com subtotais por nível;
  ⊞ Expandir tudo / ⊟ Recolher tudo. Clicar num rótulo filtra a página.
- **Minigráficos na tabela**: "Minigráfico: tendência por" acrescenta uma
  coluna com a tendência da 1ª medida (ex.: por Mês) em cada linha.
- **Colunas 100%** e **Área 100%**: composição em vez de tamanho (cada pilha
  soma 100%); a dica mostra valor e participação.
- **Mostrar como tabela** (botão ⊞ no cabeçalho): troca o gráfico pelos números
  que ele desenha; 📊 volta ao gráfico.
- **Dispersão animada**: "Eixo de reprodução" gera um quadro por valor (ex.:
  Mês); ▶ anima e o controle deslizante escolhe o quadro. Os eixos ficam fixos
  para a comparação entre quadros valer.
- **Ranking (bump chart)**: a posição (1º, 2º…) de cada série por período; a
  legenda filtra a página pela série.
- **Haltere**: antes → depois por categoria, com a variação %.
- **Sunburst**: anéis da hierarquia (eixo + níveis de detalhamento); o centro
  mostra o total.
- **Waffle**: 100 quadrados, arredondados pelo método do maior resto (a soma
  dá sempre 100).
- **Pictograma**: ícones proporcionais à medida; cada ícone vale um número
  "redondo" automático ou o valor escolhido.
- **Violino**: a densidade (estimativa por kernel, largura de Silverman) da
  coluna numérica em cada categoria, com mediana e quartis por dentro.

### Organizar e celular

- **Seleção múltipla**: Ctrl/Shift+clique no título acrescenta ou tira visuais;
  arrastar o título move o conjunto (um único passo de desfazer). Delete exclui
  todos; Esc limpa a seleção.
- **Alinhar e distribuir**: com 2+ visuais selecionados, o painel da direita
  alinha pelas bordas ou centro, distribui com espaços iguais (3+) e iguala
  largura/altura ao maior.
- **Agrupar**: membros de um grupo são selecionados e movidos juntos.
- **📱 Celular**: os visuais empilhados numa coluna, na ordem de leitura da
  página (faixas de cima para baixo, da esquerda para a direita). No relatório
  publicado, liga sozinho em telas de até 700 px.

### Notebooks e SQL (conceitos do Databricks)

A aba **Notebooks** traz a camada "antes do BI": células de SQL e de texto
executadas numa sessão, como num notebook do Databricks. O motor SQL
(`src/engine/sql.ts`) foi escrito do zero e vale estudar em três partes:

1. **Análise léxica e sintática**: texto → tokens → árvore (AST), com mensagens
   de erro que apontam linha e coluna.
2. **Otimização**: *predicate pushdown* (um filtro do WHERE que só usa uma
   tabela desce até a leitura dela, antes das junções, como faz o Catalyst do
   Spark) e *hash join* (junções por igualdade montam uma tabela hash em vez de
   comparar todos com todos).
3. **Execução** operador a operador, medindo linhas e tempo; a aba **Plano** de
   cada resultado e o comando `EXPLAIN` mostram a árvore.

O que o SQL suporta:

- `SELECT [DISTINCT]`, `FROM` com `JOIN` (INNER, LEFT, RIGHT, FULL, CROSS) e
  subconsultas, `WHERE`, `GROUP BY` (aceita posição e apelido), `HAVING`,
  `ORDER BY … NULLS FIRST/LAST`, `LIMIT/OFFSET`, `UNION [ALL]` e `WITH` (CTE).
- Expressões: `CASE`, `CAST`/`TRY_CAST`, `IN` (lista ou subconsulta),
  `BETWEEN`, `LIKE`/`ILIKE`, `IS NULL`, lógica de três valores com NULL.
- Funções de texto, número e data (`DATE_TRUNC`, `DATE_FORMAT`, `DATEDIFF`,
  `ADD_MONTHS`, `YEAR`…) e agregações (`COUNT(DISTINCT)`, `MEDIAN`, `STDDEV`…).
- Funções de janela: `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`, `LAG`/`LEAD`
  e agregações com `OVER (PARTITION BY … ORDER BY …)` (acumulado com empates).
- Comandos: `CREATE [OR REPLACE] TABLE … AS`, `CREATE TEMP VIEW`, `DROP`,
  `SHOW TABLES`, `DESCRIBE` e `EXPLAIN`.

No notebook:

- **Shift+Enter** executa e vai para a próxima célula; **Ctrl+Enter** executa
  e fica; `%md` ou `%sql` na primeira linha escolhe a linguagem.
- Resultado em **tabela**, **gráfico** (colunas, linha, área, rosca, dispersão,
  com eixos escolhidos e salvos na célula) ou **plano**; ⭳ CSV.
- **✦ Salvar como tabela** grava o resultado de uma consulta no modelo.
- O catálogo à esquerda lista tabelas, colunas e visões; clicar insere o nome.
- **⟲ Reiniciar sessão** apaga as visões temporárias, como reiniciar um cluster.

**Integração com o BI**: uma tabela criada por SQL vira tabela do modelo, com
campos, medidas e visuais como qualquer outra. O exemplo faz isso de ponta a
ponta: o notebook *Introdução ao SQL* cria `gold_vendas_mensais` (camada Gold
da arquitetura medalhão, com acumulado no ano por `SUM … OVER` e ano anterior
por `LAG(…, 12)`), e a página **Camada Gold (SQL)** usa essa tabela. Na aba
Dados, a tabela mostra o comando que a gerou.

### Mapas

Os contornos dos estados vêm da malha territorial do **IBGE** (API de malhas,
qualidade mínima), simplificada para coordenadas com 2 casas (~1 km) e
embutida em `src/model/geo/brazilStates.ts` — o mapa funciona sem internet e no
HTML publicado.

- **Mapa coroplético**: o campo de localização pode ter sigla (`SP`), nome
  (`São Paulo`, com ou sem acento), código do IBGE (`35`) ou região
  (`Sudeste` pinta todos os estados dela). Valores não reconhecidos aparecem
  num aviso.
- **Mapa de bolhas**: uma bolha por valor do eixo, com área proporcional à 1ª
  medida e cor pela 2ª (opcional). Com colunas de latitude e longitude, usa a
  média delas; sem, usa o centro da UF ou região do valor.

### Linguagem de fórmulas

| Tipo | Exemplos |
| --- | --- |
| Agregações | `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `DISTINCTCOUNT`, `COUNTROWS(tabela)` |
| Iteradores | `SUMX(Vendas, Vendas[Quantidade] * RELATED(Produtos[Preço]))`, `AVERAGEX`, `MINX`, `MAXX`, `COUNTX` |
| Tabelas | `FILTER(Vendas, Vendas[Valor] >= 5000)`, `ALL(Vendas)` |
| Contexto de filtro | `CALCULATE([Faturamento], Lojas[Região] = "Sul")`, `IN {…}`, `<>`, `ALL(Produtos)`, `REMOVEFILTERS(…)` |
| Tempo | `TOTALYTD([Faturamento], Calendário[Data])`, `CALCULATE([Faturamento], SAMEPERIODLASTYEAR(Calendário[Data]))`, `DATEADD(Calendário[Data], -1, MONTH)`, `DATESYTD(…)` |
| Lógica e texto | `IF(cond, a, b)`, `= <> < <= > >=`, `"texto" & [Medida]`, `DIVIDE(a, b, alt)` |
| Contexto de linha | `Vendas[Valor] / Vendas[Quantidade]`, `RELATED(Produtos[Categoria])` |

### Páginas do exemplo

- **Camada Gold (SQL)** — segmentação, cartão, linha e colunas empilhadas
  sobre `gold_vendas_mensais`, a tabela criada pelo notebook de exemplo.
- **Composição e ranking** — colunas 100% (regiões por trimestre), área 100%
  (mix de categorias), ranking das lojas mês a mês, waffle, haltere ano
  anterior → 2026, pictograma de pedidos e dispersão animada por mês.
- **Hierarquias e distribuição** — matriz Região › Loja › Categoria com +/−,
  sunburst, tabela com minigráficos e violino do valor das vendas.
- **Laboratório** — marcador de faturamento x meta por região (2026), radar
  das categorias, pequenos múltiplos por região, colunas com dica detalhada e
  calendário de pedidos por dia.
- **Simulação e projetos** — dois parâmetros "e se" (aumento de preço e
  elasticidade), KPIs e colunas simuladas, Sankey região → categoria e o Gantt
  de abertura de uma loja.
- **Monitoramento** — data relativa (começa em "Este ano"), parâmetro "Ver
  por", colunas e cartões de várias linhas ligados ao parâmetro, funil comercial
  e tabela com regras de cor no crescimento.
- **Exploração** — segmentações por período e por valor da venda, lista
  suspensa de região, Pareto de produtos, linha com anomalias, tabela de
  produtos (origem do drill-through) e narrativa.
- **Detalhe do produto** — página de drill-through: texto dinâmico, KPI,
  linha mensal, faturamento por loja e mapa, tudo do produto escolhido.
- **Geografia** — mapa por UF e por região, mapa de bolhas das lojas
  (tamanho = faturamento, cor = ticket médio), tabela com escala de cores,
  imagem (logotipo em SVG embutido) e texto com lista e link.
- **Avançado** — previsão de 6 meses com faixa de 95% e linha de média,
  faturamento por loja contra a meta, histograma e box plot do valor das
  vendas, influenciadores do ticket médio e árvore de decomposição.
- **Executivo** — painel de abertura: texto dinâmico, KPIs com comparação ao
  ano anterior, meta e minigráfico, combo (faturamento + crescimento %),
  cascata "de 2025 para 2026 por categoria", mapa de calor loja × trimestre e
  botões de navegação. A página inteira tem o filtro "Ano = 2026".
- **Visão geral** — cartões, segmentação e filtro cruzado.
- **Detalhes** — os visuais avançados (matriz, empilhadas, dispersão, treemap,
  medidor com filtro de visual "Ano = 2026").
- **Análises** — medida x coluna calculada, `CALCULATE`, Top N, barras de dados.
- **Tempo** — crescimento sobre o ano anterior, acumulado no ano, `SUMX`,
  `FILTER`, drill de datas (Ano › Trimestre › Mês › Dia) e de Categoria › Produto.

Teste o drill: na página Tempo, clique numa coluna de "Faturamento por Data"
(o modo de drill ↓ já está ligado). Use ↑ para subir e ⇊ para ir ao próximo
nível sem filtrar.

## Publicar um relatório

**Arquivo › Publicar relatório** baixa um `.html` com o app e os dados dentro.
Quem recebe abre no navegador, sem instalar nada, e pode navegar pelas páginas,
filtrar, fazer drill, usar os indicadores e exportar — mas não editar.

O visualizador é o próprio app compilado num arquivo só
(`npm run build:viewer`, que `npm run dev` e `npm run build` já executam).

## Exercícios sugeridos

1. **Transição de contexto**: `[Medida]` dentro de `SUMX` ou de uma coluna
   calculada deveria transformar a linha atual em filtro.
2. **Relacionamento bidirecional**: uma opção para o filtro fluir nos dois
   sentidos (e veja por que gera ambiguidade).
3. **Armazenamento colunar**: troque `rows: Row[]` por colunas + dicionário
   (armazenamento colunar) e meça com 1 milhão de linhas.
4. **Mesclar consultas** (join) e **acrescentar** (union) no editor de consultas.
5. **Servidor**: salvar relatórios num backend, com usuários e compartilhamento.

## Limitações conhecidas

- Dados em memória e no `localStorage` (limite do navegador, ~5 MB); arquivos
  grandes funcionam, mas podem não ficar salvos entre sessões.
- Relacionamentos só muitos-para-um e em direção única.
- Sem transição de contexto (ver exercício 1); `FILTER` não é aceito como
  filtro do `CALCULATE`.
- A importação guarda uma cópia dos dados da fonte; não há "atualizar" a partir
  do arquivo original (o navegador não tem acesso a ele depois).
- O histórico de desfazer fica só em memória.
- `1.234` num CSV é lido como mil duzentos e trinta e quatro (padrão pt-BR).
