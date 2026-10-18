import type { CrossFilter, Measure, Relationship, Report, Table, Value, Visual } from "./types";
import { sampleReport } from "./sampleData";

export type Action =
  | { type: "reset"; report: Report }
  | { type: "addTable"; table: Table }
  | { type: "removeTable"; name: string }
  | { type: "addRelationship"; rel: Relationship }
  | { type: "removeRelationship"; id: string }
  | { type: "upsertMeasure"; measure: Measure }
  | { type: "removeMeasure"; id: string }
  | { type: "addVisual"; visual: Visual }
  | { type: "updateVisual"; id: string; patch: Partial<Visual> }
  | { type: "removeVisual"; id: string }
  | { type: "toggleFilter"; filter: CrossFilter; multi: boolean }
  | { type: "setFilter"; sourceVisualId: string; filter: CrossFilter | null }
  | { type: "clearFilters" };

export function reducer(state: Report, action: Action): Report {
  switch (action.type) {
    case "reset":
      return action.report;
    case "addTable":
      return {
        ...state,
        tables: [...state.tables.filter((t) => t.name !== action.table.name), action.table],
      };
    case "removeTable":
      return {
        ...state,
        tables: state.tables.filter((t) => t.name !== action.name),
        relationships: state.relationships.filter(
          (r) => r.from.table !== action.name && r.to.table !== action.name,
        ),
        filters: state.filters.filter((f) => f.field.table !== action.name),
      };
    case "addRelationship":
      return { ...state, relationships: [...state.relationships, action.rel] };
    case "removeRelationship":
      return { ...state, relationships: state.relationships.filter((r) => r.id !== action.id) };
    case "upsertMeasure": {
      const exists = state.measures.some((m) => m.id === action.measure.id);
      return {
        ...state,
        measures: exists
          ? state.measures.map((m) => (m.id === action.measure.id ? action.measure : m))
          : [...state.measures, action.measure],
      };
    }
    case "removeMeasure":
      return {
        ...state,
        measures: state.measures.filter((m) => m.id !== action.id),
        visuals: state.visuals.map((v) => ({ ...v, measureIds: v.measureIds.filter((id) => id !== action.id) })),
      };
    case "addVisual":
      return { ...state, visuals: [...state.visuals, action.visual] };
    case "updateVisual": {
      const visuals = state.visuals.map((v) => (v.id === action.id ? { ...v, ...action.patch } : v));
      // Mudou o eixo: o filtro que esse visual criou deixa de fazer sentido.
      const filters = "axis" in action.patch
        ? state.filters.filter((f) => f.sourceVisualId !== action.id)
        : state.filters;
      return { ...state, visuals, filters };
    }
    case "removeVisual":
      return {
        ...state,
        visuals: state.visuals.filter((v) => v.id !== action.id),
        filters: state.filters.filter((f) => f.sourceVisualId !== action.id),
      };
    case "toggleFilter": {
      // Clique num ponto de gráfico: alterna o valor; Ctrl/Shift acumula.
      const { filter, multi } = action;
      const current = state.filters.find((f) => f.sourceVisualId === filter.sourceVisualId);
      const others = state.filters.filter((f) => f.sourceVisualId !== filter.sourceVisualId);
      const value = filter.values[0];
      let values: Value[];
      if (!current) values = [value];
      else if (current.values.includes(value)) values = multi ? current.values.filter((v) => v !== value) : current.values.length > 1 ? [value] : [];
      else values = multi ? [...current.values, value] : [value];
      return { ...state, filters: values.length ? [...others, { ...filter, values }] : others };
    }
    case "setFilter": {
      const others = state.filters.filter((f) => f.sourceVisualId !== action.sourceVisualId);
      return { ...state, filters: action.filter && action.filter.values.length ? [...others, action.filter] : others };
    }
    case "clearFilters":
      return { ...state, filters: [] };
  }
}

const STORAGE_KEY = "mini-bi-report-v1";

export function loadReport(): Report {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Report;
  } catch {
    // armazenamento indisponível ou corrompido: volta ao exemplo
  }
  return sampleReport();
}

export function saveReport(report: Report) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
  } catch {
    // ex.: CSV grande demais para o localStorage; o app segue funcionando
  }
}
