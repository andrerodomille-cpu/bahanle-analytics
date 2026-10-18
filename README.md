# Mini BI

Um sistema de BI no estilo Power BI, feito do zero: obter e preparar dados,
modelar, criar medidas numa linguagem no estilo DAX, montar relatórios
interativos e entregá-los (imagem, PDF ou HTML publicado). Nenhum código do
Power BI foi usado — só os conceitos públicos.

```bash
npm install
npm run dev     # gera o visualizador e abre em http://localhost:5173
npm test        # testes do motor, consultas, datas e publicação
npm run build   # build de produção em dist/
```

Roda inteiro no navegador: os dados ficam em memória e no `localStorage`
(salve em `.json` pelo menu **Arquivo** para guardar ou levar a outro lugar).

## O que dá para fazer

| Etapa | Recursos |
| --- | --- |
| **Obter dados** | CSV (separador detectado), Excel `.xlsx` (todas as planilhas), JSON (listas, campos aninhados viram `a.b`) |
| **Preparar** (aba Dados) | Editor de consultas com *Etapas aplicadas*: tipo detectado automaticamente, renomear, mudar tipo, remover coluna, filtrar linhas, substituir valores, remover duplicadas e linhas em branco |
| **Modelar** (aba Modelo) | Relacionamentos muitos-para-um, colunas calculadas (`RELATED`, `IF`), tipo data |
| **Calcular** | Medidas em mini-DAX: agregações, `CALCULATE`/`ALL`, `IF`, iteradores `SUMX`/`FILTER`, inteligência de tempo |
| **Visualizar** | 28 visuais (incluindo KPI, combo, cascata, mapa de calor, texto dinâmico e botões), páginas, filtro cruzado, segmentação, Painel de Filtros (visual/página/relatório), Top N, ordenação, barras de dados e escala de cores |
| **Explorar** | Drill-down, árvore de decomposição, principais influenciadores, histograma e box plot, previsão com faixa de confiança, linhas de referência, modo foco, exportar dados do visual (CSV) |
| **Apresentar** | Temas claro/escuro, 4 paletas, indicadores (bookmarks) |
| **Entregar** | Página como PNG, impressão/PDF, **Publicar** como HTML único somente leitura |

## Mapa de estudo: conceito do Power BI → código

| Conceito | Onde está | O que estudar |
| --- | --- | --- |
| Power Query | `src/model/transform.ts`, `importers.ts` | Tabela = fonte + etapas reaplicadas em ordem; "Tipo Alterado" automático |
| Modelo semântico | `src/model/types.ts` | Esquema estrela: fato `Vendas` + dimensões + `Calendário` |
| Propagação de filtros | `Engine.rows` / `Engine.resolve` (`src/engine/query.ts`) | Filtros fluem do lado "um" para o "muitos" |
| DAX: parser | `src/engine/expr.ts` | Tokenizer → AST, gramática recursiva descendente |
| DAX: avaliação | `Engine.evaluate` | Contexto de filtro, BLANK, contexto de linha |
| `CALCULATE` / `ALL` | `Engine.applyCalcArgs` | Substituir/remover filtros; tabela expandida |
| Inteligência de tempo | `Engine.timeIntelligence` | Datas visíveis → novo conjunto de datas → troca os filtros da tabela de datas |
| Iteradores | `case "iter"` e `Engine.tableRows` | `SUMX(tabela, expr)` = contexto de linha dentro do contexto de filtro |
| Colunas calculadas | `src/model/calculated.ts` | Avaliadas uma vez por linha e gravadas |
| Hierarquias / drill | `hierarchyOf`, `axisOf`, `drillFilters` | Nível atual vira eixo; níveis acima viram filtros |
| Visual = consulta | `runVisual`, `runGrid`, `runTotals` | Cada ponto do gráfico é a medida num contexto de filtro |
| Painel de Filtros | `contextFor` | Filtros de relatório + página + visual + cruzado + drill-through + drill |
| Filtro por intervalo | `passes` / `toContext` em `src/engine/query.ts` | Um filtro é uma lista de valores **ou** um intervalo (mín./máx.) |
| Publicação | `src/model/publish.ts`, `vite.config.ts` | Visualizador num HTML único + dados embutidos |
| KPI, cascata, mapa de calor | `src/components/MoreVisuals.tsx` | `waterfallSteps`: base + variações por categoria = total; escala de cores entre mín. e máx. |
| Texto dinâmico | `fillTemplate` em `src/engine/query.ts` | `[Medida]` avaliada no contexto de filtro da caixa de texto |
| Mapas | `src/engine/geo.ts`, `src/model/geo/` | Projeção equirretangular, associação valor → UF, contornos do IBGE |
| Análises | `src/engine/analytics.ts` | Regressão linear e intervalo de predição, média móvel, quartis e bigodes de Tukey, regra de Sturges, influenciadores, decomposição |

### Visuais

| Grupo | Visuais |
| --- | --- |
| Comparação | Colunas, barras, colunas empilhadas, combo (colunas + linha, dois eixos), cascata, Pareto |
| Tendência | Linha, área |
| Composição | Rosca, treemap |
| Relação e distribuição | Dispersão, mapa de calor, histograma, box plot |
| Análise | Principais influenciadores, árvore de decomposição, narrativa automática |
| Indicadores | Cartão, KPI (valor + variação + meta + minigráfico), medidor |
| Tabelas | Tabela, matriz (barras de dados ou escala de cores) |
| Geografia | Mapa coroplético do Brasil (por UF, estado, código IBGE ou região), mapa de bolhas (latitude/longitude ou centro da UF) |
| Interação e layout | Segmentação (lista, lista suspensa ou intervalo "entre" para datas e números), caixa de texto (`[Medida]` dinâmica, listas, links, alinhamento e tamanho), imagem (arquivo enviado ou endereço), botão (página ou indicador) |

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

### Linguagem (mini-DAX)

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
   (a ideia do VertiPaq) e meça com 1 milhão de linhas.
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
