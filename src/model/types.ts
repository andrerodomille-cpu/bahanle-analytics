// Modelo semântico: o equivalente ao "Modelo" do Power BI.

export type Value = string | number | null;
export type Row = Record<string, Value>;

export type ColumnType = "number" | "text";

export interface Column {
  name: string;
  type: ColumnType;
}

export interface Table {
  name: string;
  columns: Column[];
  rows: Row[];
}

export interface FieldRef {
  table: string;
  column: string;
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

export type VisualType = "bar" | "line" | "pie" | "table" | "card" | "slicer";

export interface Visual {
  id: string;
  type: VisualType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  axis?: FieldRef;
  measureIds: string[];
}

/** Filtro criado por um visual (clique num gráfico ou segmentação). */
export interface CrossFilter {
  field: FieldRef;
  values: Value[];
  sourceVisualId: string;
}

export interface Report {
  tables: Table[];
  relationships: Relationship[];
  measures: Measure[];
  visuals: Visual[];
  filters: CrossFilter[];
}

export const fieldKey = (f: FieldRef) => `${f.table}[${f.column}]`;

export const newId = () => Math.random().toString(36).slice(2, 10);
