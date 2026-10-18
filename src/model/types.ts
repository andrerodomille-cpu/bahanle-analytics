// Modelo semântico: o equivalente ao "Modelo" do Power BI.

export type Value = string | number | null;
export type Row = Record<string, Value>;

/** Datas são guardadas como texto ISO "AAAA-MM-DD" (ordenáveis e serializáveis). */
export type ColumnType = "number" | "text" | "date";

export interface Column {
  name: string;
  type: ColumnType;
  /** Coluna calculada: expressão avaliada linha a linha (contexto de linha). */
  expression?: string;
  /** Erro da última avaliação da coluna calculada, se houver. */
  error?: string;
}

// ---------- Editor de consultas (Power Query) ----------

export type FilterOp = "=" | "<>" | ">" | ">=" | "<" | "<=" | "contém" | "não está em branco";

/** Uma etapa aplicada da consulta. As etapas são reaplicadas, em ordem, sobre a fonte. */
export type QueryStep =
  | { kind: "type"; column: string; to: ColumnType; auto?: boolean }
  | { kind: "rename"; column: string; to: string }
  | { kind: "remove"; columns: string[] }
  | { kind: "filter"; column: string; op: FilterOp; value: string }
  | { kind: "replace"; column: string; from: string; to: string }
  | { kind: "dedupe" }
  | { kind: "removeBlank" };

export interface TableQuery {
  /** De onde veio: "vendas.csv", "planilha.xlsx › Plan1", "dados.json"… */
  origin: string;
  /** Dados como vieram da fonte, antes de qualquer etapa. */
  source: { columns: Column[]; rows: Row[] };
  steps: QueryStep[];
}

export interface Table {
  name: string;
  columns: Column[];
  rows: Row[];
  /** Consulta que gerou a tabela (ausente em tabelas criadas pelo exemplo). */
  query?: TableQuery;
}

export type DatePart = "year" | "quarter" | "month" | "day";

export interface FieldRef {
  table: string;
  column: string;
  /** Parte de uma coluna de data (hierarquia automática Ano › Trimestre › Mês › Dia). */
  part?: DatePart;
}

/**
 * Relacionamento muitos-para-um com filtro em direção única,
 * como o padrão do Power BI: `from` é o lado "muitos" (fato) e
 * `to` é o lado "um" (dimensão). Filtros fluem de `to` para `from`.
 */
export interface Relationship {
  id: string;
  from: FieldRef;
  to: FieldRef;
}

export type MeasureFormat = "number" | "currency" | "percent";

export interface Measure {
  id: string;
  name: string;
  /** Tabela "dona" da medida (só organização, como no Power BI). */
  table: string;
  /** Expressão no estilo DAX, ex.: SUM(Vendas[Valor]) */
  expression: string;
  format: MeasureFormat;
}

export type VisualType =
  | "bar"
  | "hbar"
  | "stacked"
  | "line"
  | "area"
  | "pie"
  | "treemap"
  | "scatter"
  | "table"
  | "matrix"
  | "card"
  | "gauge"
  | "slicer"
  | "kpi"
  | "combo"
  | "waterfall"
  | "heatmap"
  | "text"
  | "button"
  | "histogram"
  | "boxplot"
  | "influencers"
  | "decomp"
  | "map"
  | "bubblemap"
  | "image"
  | "pareto"
  | "narrative"
  | "multicard"
  | "funnel"
  | "fieldparam"
  | "bullet"
  | "radar"
  | "calendar"
  | "whatif"
  | "sankey"
  | "gantt"
  | "stacked100"
  | "area100"
  | "bump"
  | "dumbbell"
  | "sunburst"
  | "waffle"
  | "pictogram"
  | "violin";

/** Parâmetro "e se": um valor ajustável que as medidas leem como [Nome]. */
export interface WhatIf {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: MeasureFormat;
}

/** Filtro de data relativa: "últimos 30 dias", "este ano", "mês passado"… */
export interface RelativeDate {
  kind: "last" | "this" | "previous";
  /** Quantidade (só para "last"). */
  n?: number;
  unit: "day" | "month" | "year";
  /** Referência: a data mais recente dos dados ou o dia de hoje. */
  anchor: "data" | "today";
}

/** Regra de formatação condicional: se a medida atender à condição, aplica cor/ícone. */
export interface FormatRule {
  id: string;
  /** Índice da medida no visual. */
  measure: number;
  op: ">" | ">=" | "<" | "<=" | "between";
  value: number;
  value2?: number;
  style: "good" | "warn" | "bad";
  icon: boolean;
}

export interface ImageSource {
  /** data: URL (imagem enviada, fica dentro do relatório) ou endereço https. */
  src: string;
  fit: "contain" | "cover";
  alt?: string;
}

/** Linha de referência num gráfico cartesiano. */
export interface RefLine {
  id: string;
  kind: "constant" | "average" | "median" | "min" | "max";
  /** Valor fixo (só para "constant"). */
  value?: number;
  label?: string;
}

export interface ForecastOptions {
  /** Quantos períodos prever. */
  periods: number;
  method: "linear" | "moving";
  /** Nível de confiança da faixa: 0.8, 0.9 ou 0.95. */
  confidence: number;
}

/** Ação de um botão: ir para uma página ou aplicar um indicador. */
export type ButtonAction = { kind: "page"; pageId: string } | { kind: "bookmark"; bookmarkId: string };

export interface Page {
  id: string;
  name: string;
  /** Drill-through: campos que esta página aceita como "detalhe de…". */
  drillthrough?: FieldRef[];
}

/** Intervalo de valores (números ou datas ISO). Sem min/max = aberto daquele lado. */
export interface ValueRange {
  min?: Value;
  max?: Value;
  /** O máximo fica de fora (faixas do histograma, exceto a última). */
  maxOpen?: boolean;
}

/** Filtro de drill-through ativo: a página de destino mostra só o item escolhido. */
export interface DrillthroughState {
  pageId: string;
  field: FieldRef;
  value: Value;
  /** Página de onde veio, para o botão "Voltar". */
  fromPageId: string;
}

/** Estado de drill-down: nível atual e o valor escolhido em cada nível acima (undefined = todos). */
export interface DrillState {
  level: number;
  path: (Value | undefined)[];
}

export interface Visual {
  id: string;
  pageId: string;
  type: VisualType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Eixo / Linhas / Categoria / Detalhes, conforme o visual. */
  axis?: FieldRef;
  /** Níveis extras de detalhamento abaixo do eixo (ex.: Categoria › Produto). */
  drillFields?: FieldRef[];
  drill?: DrillState;
  /** Com o modo de drill ligado, clicar num ponto detalha em vez de filtrar. */
  drillMode?: boolean;
  /** Legenda (colunas empilhadas) ou Colunas (matriz). */
  legend?: FieldRef;
  measureIds: string[];
  /** Meta do medidor. */
  target?: number;
  /** Filtro Top N: mantém as N categorias com maior valor da 1ª medida. */
  topN?: number;
  /** Ordenação: pela categoria ou pelo índice da medida. */
  sort?: { by: "category" | number; desc: boolean };
  /** Formatação condicional: barras de dados (tabela e matriz). */
  dataBars?: boolean;
  /** Formatação condicional: escala de cores no fundo das células (tabela e matriz). */
  colorScale?: boolean;
  /** Caixa de texto: conteúdo; [Medida] vira o valor da medida no contexto da página. */
  text?: string;
  /** Botão: o que acontece ao clicar. */
  action?: ButtonAction;
  /** Linhas de referência (meta, média, mediana…) em gráficos cartesianos. */
  refLines?: RefLine[];
  /** Previsão em gráficos de linha e área. */
  forecast?: ForecastOptions;
  /** Coluna numérica distribuída (histograma e box plot). */
  valueField?: FieldRef;
  /** Número de faixas do histograma (padrão: regra de Sturges). */
  bins?: number;
  /** Dimensões analisadas (influenciadores e árvore de decomposição). */
  explainBy?: FieldRef[];
  /** Influenciadores: mostrar o que aumenta ou o que diminui a medida. */
  influenceDir?: "up" | "down";
  /** Árvore de decomposição: dimensão de cada nível e o nó escolhido nele. */
  decomp?: { field: FieldRef; value?: Value }[];
  /** Mapa de bolhas: colunas de latitude e longitude (opcionais; sem elas, usa o centro da UF). */
  latField?: FieldRef;
  lonField?: FieldRef;
  /** Visual de imagem. */
  image?: ImageSource;
  /** Caixa de texto: alinhamento e tamanho da letra. */
  textAlign?: "left" | "center" | "right";
  textSize?: "s" | "m" | "l";
  /** Segmentação: lista, lista suspensa ou intervalo ("entre"). */
  slicerStyle?: "list" | "dropdown" | "between" | "relative";
  /** Detecção de anomalias em linha/área: sensibilidade em desvios-padrão (2 ou 3). */
  anomalies?: { sensitivity: number };
  /** Segmentação de data relativa (estilo "relative"). */
  relative?: RelativeDate;
  /** Formatação condicional por regras (tabela, matriz, cartões). */
  rules?: FormatRule[];
  /** Parâmetro de campo: os campos oferecidos e o escolhido. */
  paramFields?: FieldRef[];
  paramIndex?: number;
  /** Eixo controlado por um parâmetro de campo (id do visual do parâmetro). */
  axisParam?: string;
  /** Pequenos múltiplos: repete o gráfico para cada valor deste campo. */
  multiples?: FieldRef;
  /** Gráfico de marcador: limites das faixas ruim/ok como fração da meta. */
  bands?: [number, number];
  /** Radar: escalar cada medida pelo próprio máximo (para comparar medidas diferentes). */
  normalize?: boolean;
  /** Calendário de calor: ano mostrado. */
  calendarYear?: number;
  /** Parâmetro "e se". */
  whatif?: WhatIf;
  /** Dica de ferramenta com detalhes: medidas extras e minigráfico por este campo. */
  tooltipMeasures?: string[];
  tooltipTrend?: FieldRef;
  /** Gantt: colunas de início, fim e % concluído. */
  startField?: FieldRef;
  endField?: FieldRef;
  progressField?: FieldRef;
  /** Matriz hierárquica: linhas que abrem e fecham (níveis = eixo + drillFields). */
  expandable?: boolean;
  /** Caminhos abertos na matriz hierárquica (valores do caminho unidos por \u0001). */
  expanded?: string[];
  /** Tabela: coluna de minigráfico (tendência da 1ª medida por este campo). */
  sparkline?: FieldRef;
  /** "Mostrar como tabela": troca o gráfico pelos números dele. */
  asTable?: boolean;
  /** Dispersão animada: um quadro por valor deste campo (eixo de reprodução). */
  playField?: FieldRef;
  /** Pictograma: ícone e quanto vale cada ícone. */
  icon?: string;
  unitValue?: number;
  /** Agrupamento de visuais: selecionam e se movem juntos. */
  groupId?: string;
}

export type FilterScope = "visual" | "page" | "report";

/** Filtro do Painel de Filtros, nos três níveis do Power BI. */
export interface PaneFilter {
  id: string;
  scope: FilterScope;
  /** id do visual (scope "visual") ou da página (scope "page"). */
  targetId?: string;
  field: FieldRef;
  /** Valores permitidos; lista vazia = sem filtro ("Todos"). */
  values: Value[];
  /** Filtragem avançada por intervalo (substitui a lista quando presente). */
  range?: ValueRange;
}

/** Filtro criado por um visual (clique num gráfico ou segmentação). */
export interface CrossFilter {
  field: FieldRef;
  values: Value[];
  /** Filtro por intervalo (segmentação "entre", faixa do histograma); quando presente, `values` é ignorado. */
  range?: ValueRange;
  sourceVisualId: string;
}

/** Indicador (bookmark): uma "foto" do estado do relatório para reaplicar depois. */
export interface Bookmark {
  id: string;
  name: string;
  pageId: string;
  filters: CrossFilter[];
  paneFilters: PaneFilter[];
  drills: Record<string, DrillState | undefined>;
}

export type ThemeMode = "light" | "dark";
export type PaletteName = "padrao" | "executivo" | "natureza" | "vibrante";

export interface ReportTheme {
  mode: ThemeMode;
  palette: PaletteName;
}

export interface Report {
  pages: Page[];
  tables: Table[];
  relationships: Relationship[];
  measures: Measure[];
  visuals: Visual[];
  filters: CrossFilter[];
  paneFilters: PaneFilter[];
  bookmarks: Bookmark[];
  theme: ReportTheme;
  drillthrough?: DrillthroughState;
}

const PART_SUFFIX: Record<DatePart, string> = { year: "Ano", quarter: "Trimestre", month: "Mês", day: "Dia" };

export const fieldKey = (f: FieldRef) => `${f.table}[${f.column}]${f.part ? `.${f.part}` : ""}`;

/** Rótulo do campo para a interface: "Data · Ano". */
export const fieldLabel = (f: FieldRef) => (f.part ? `${f.column} · ${PART_SUFFIX[f.part]}` : f.column);

export const sameField = (a: FieldRef, b: FieldRef) =>
  a.table === b.table && a.column === b.column && (a.part ?? null) === (b.part ?? null);

export const newId = () => Math.random().toString(36).slice(2, 10);
