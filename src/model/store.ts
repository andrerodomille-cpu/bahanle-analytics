import type {
  Bookmark, CrossFilter, DrillthroughState, FieldRef, Measure, Page, PaneFilter, QueryStep, Relationship, Report, ReportTheme, Table, Value, Visual,
} from "./types";
import { tableFromQuery } from "./importers";
import { sampleReport } from "./sampleData";
import { materialize, removeColumn, setColumn } from "./calculated";

export type Action =
  | { type: "reset"; report: Report }
  | { type: "addTable"; table: Table }
  | { type: "removeTable"; name: string }
  | { type: "addRelationship"; rel: Relationship }
  | { type: "removeRelationship"; id: string }
  | { type: "upsertColumn"; table: string; name: string; expression: string; oldName?: string }
  | { type: "removeColumn"; table: string; name: string }
  | { type: "setSteps"; table: string; steps: QueryStep[] }
  | { type: "upsertMeasure"; measure: Measure }
  | { type: "removeMeasure"; id: string }
  | { type: "addVisual"; visual: Visual }
  | { type: "updateVisual"; id: string; patch: Partial<Visual> }
  | { type: "removeVisual"; id: string }
  | { type: "toggleFilter"; filter: CrossFilter; multi: boolean }
  | { type: "setFilter"; sourceVisualId: string; filter: CrossFilter | null }
  | { type: "clearFilters"; pageId: string }
  | { type: "addPaneFilter"; filter: PaneFilter }
  | { type: "updatePaneFilter"; id: string; values: Value[] }
  | { type: "removePaneFilter"; id: string }
  | { type: "addPage"; page: Page }
  | { type: "renamePage"; id: string; name: string }
  | { type: "removePage"; id: string }
  | { type: "addBookmark"; bookmark: Bookmark }
  | { type: "renameBookmark"; id: string; name: string }
  | { type: "removeBookmark"; id: string }
  | { type: "applyBookmark"; id: string }
  | { type: "setTheme"; theme: ReportTheme }
  | { type: "setPageDrillthrough"; pageId: string; fields: FieldRef[] }
  | { type: "drillthrough"; state: DrillthroughState }
  | { type: "clearDrillthrough" };

export function reducer(state: Report, action: Action): Report {
  switch (action.type) {
    case "reset":
      return action.report;
    case "addTable":
      return materialize({
        ...state,
        tables: [...state.tables.filter((t) => t.name !== action.table.name), action.table],
      });
    case "removeTable":
      return materialize({
        ...state,
        tables: state.tables.filter((t) => t.name !== action.name),
        relationships: state.relationships.filter(
          (r) => r.from.table !== action.name && r.to.table !== action.name,
        ),
        filters: state.filters.filter((f) => f.field.table !== action.name),
        paneFilters: state.paneFilters.filter((f) => f.field.table !== action.name),
      });
    case "addRelationship":
      return materialize({ ...state, relationships: [...state.relationships, action.rel] });
    case "removeRelationship":
      return materialize({ ...state, relationships: state.relationships.filter((r) => r.id !== action.id) });
    case "upsertColumn": {
      const updated = setColumn(state, action.table, { name: action.name }, action.expression, action.oldName);
      // Outras colunas calculadas podem depender desta.
      return materialize(updated);
    }
    case "removeColumn":
      return materialize(removeColumn(state, action.table, action.name));
    case "setSteps":
      return materialize({
        ...state,
        tables: state.tables.map((t) => (t.name === action.table ? withSteps(t, action.steps) : t)),
      });
    case "upsertMeasure": {
      const exists = state.measures.some((m) => m.id === action.measure.id);
      const measures = exists
        ? state.measures.map((m) => (m.id === action.measure.id ? action.measure : m))
        : [...state.measures, action.measure];
      // Colunas calculadas podem usar medidas (ex.: [Faturamento] total).
      return materialize({ ...state, measures });
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
      // Mudou o eixo (ou o nível de drill): o filtro que esse visual criou deixa de fazer sentido.
      const filters = "axis" in action.patch || "drill" in action.patch || "drillFields" in action.patch
        ? state.filters.filter((f) => f.sourceVisualId !== action.id)
        : state.filters;
      return { ...state, visuals, filters };
    }
    case "removeVisual":
      return {
        ...state,
        visuals: state.visuals.filter((v) => v.id !== action.id),
        filters: state.filters.filter((f) => f.sourceVisualId !== action.id),
        paneFilters: state.paneFilters.filter((f) => !(f.scope === "visual" && f.targetId === action.id)),
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
      const active = action.filter && (action.filter.values.length > 0 || action.filter.range);
      return { ...state, filters: active ? [...others, action.filter!] : others };
    }
    case "clearFilters": {
      const onPage = new Set(state.visuals.filter((v) => v.pageId === action.pageId).map((v) => v.id));
      return { ...state, filters: state.filters.filter((f) => !onPage.has(f.sourceVisualId)) };
    }
    case "addPaneFilter":
      return { ...state, paneFilters: [...state.paneFilters, action.filter] };
    case "updatePaneFilter":
      return {
        ...state,
        paneFilters: state.paneFilters.map((f) => (f.id === action.id ? { ...f, values: action.values } : f)),
      };
    case "removePaneFilter":
      return { ...state, paneFilters: state.paneFilters.filter((f) => f.id !== action.id) };
    case "addPage":
      return { ...state, pages: [...state.pages, action.page] };
    case "renamePage":
      return { ...state, pages: state.pages.map((p) => (p.id === action.id ? { ...p, name: action.name } : p)) };
    case "addBookmark":
      return { ...state, bookmarks: [...state.bookmarks, action.bookmark] };
    case "renameBookmark":
      return { ...state, bookmarks: state.bookmarks.map((b) => (b.id === action.id ? { ...b, name: action.name } : b)) };
    case "removeBookmark":
      return { ...state, bookmarks: state.bookmarks.filter((b) => b.id !== action.id) };
    case "applyBookmark": {
      const b = state.bookmarks.find((x) => x.id === action.id);
      if (!b) return state;
      const alive = new Set(state.visuals.map((v) => v.id));
      return {
        ...state,
        filters: b.filters.filter((f) => alive.has(f.sourceVisualId)),
        paneFilters: b.paneFilters,
        visuals: state.visuals.map((v) => (v.id in b.drills ? { ...v, drill: b.drills[v.id] } : v)),
      };
    }
    case "setTheme":
      return { ...state, theme: action.theme };
    case "setPageDrillthrough":
      return {
        ...state,
        pages: state.pages.map((p) => (p.id === action.pageId ? { ...p, drillthrough: action.fields } : p)),
        // Se a página deixou de aceitar o campo do drill-through ativo, ele sai.
        drillthrough: state.drillthrough?.pageId === action.pageId &&
          !action.fields.some((f) => f.table === state.drillthrough!.field.table && f.column === state.drillthrough!.field.column)
          ? undefined
          : state.drillthrough,
      };
    case "drillthrough":
      return { ...state, drillthrough: action.state };
    case "clearDrillthrough":
      return { ...state, drillthrough: undefined };
    case "removePage": {
      if (state.pages.length <= 1) return state;
      const removed = new Set(state.visuals.filter((v) => v.pageId === action.id).map((v) => v.id));
      return {
        ...state,
        pages: state.pages.filter((p) => p.id !== action.id),
        visuals: state.visuals.filter((v) => !removed.has(v.id)),
        filters: state.filters.filter((f) => !removed.has(f.sourceVisualId)),
        paneFilters: state.paneFilters.filter((f) =>
          !((f.scope === "page" && f.targetId === action.id) || (f.scope === "visual" && removed.has(f.targetId ?? "")))),
      };
    }
  }
}

/**
 * Reaplica a consulta com novas etapas. Tabelas sem consulta (ex.: as do
 * exemplo) ganham uma na primeira transformação, com os dados atuais como fonte.
 * Colunas calculadas são preservadas e recalculadas depois.
 */
function withSteps(t: Table, steps: QueryStep[]): Table {
  const base = t.columns.filter((c) => !c.expression);
  const query = t.query ?? {
    origin: "Dados do modelo",
    source: {
      columns: base.map((c) => ({ name: c.name, type: c.type })),
      rows: t.rows.map((r) => Object.fromEntries(base.map((c) => [c.name, r[c.name] ?? null]))),
    },
    steps: [],
  };
  const rebuilt = tableFromQuery(t.name, { ...query, steps });
  const calculated = t.columns.filter((c) => c.expression && !rebuilt.columns.some((b) => b.name === c.name));
  return { ...rebuilt, columns: [...rebuilt.columns, ...calculated] };
}

/** Foto do estado atual para um indicador. */
export function captureBookmark(state: Report, id: string, name: string, pageId: string): Bookmark {
  const onPage = state.visuals.filter((v) => v.pageId === pageId);
  return {
    id,
    name,
    pageId,
    filters: state.filters,
    paneFilters: state.paneFilters,
    drills: Object.fromEntries(onPage.map((v) => [v.id, v.drill])),
  };
}

// ---------------- Desfazer / refazer ----------------

export interface History {
  past: Report[];
  present: Report;
  future: Report[];
  /** Chave e hora da última ação, para juntar arrastos e digitação num passo só. */
  lastKey?: string;
  lastTime?: number;
}

export type HistoryAction = Action | { type: "undo" } | { type: "redo" };

/** Seleções (filtro cruzado) não entram no histórico, como no Power BI. */
const NOT_UNDOABLE = new Set<Action["type"]>(["toggleFilter", "setFilter", "clearFilters"]);
const LIMIT = 100;
const MERGE_MS = 1000;

function mergeKey(action: Action): string | undefined {
  if (action.type === "updateVisual") return `visual:${action.id}:${Object.keys(action.patch).sort().join(",")}`;
  if (action.type === "renamePage") return `page:${action.id}`;
  if (action.type === "updatePaneFilter") return `pane:${action.id}`;
  return undefined;
}

export function historyReducer(h: History, action: HistoryAction): History {
  if (action.type === "undo") {
    if (h.past.length === 0) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
  }
  if (action.type === "redo") {
    if (h.future.length === 0) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  }
  const present = reducer(h.present, action);
  if (present === h.present) return h;
  if (NOT_UNDOABLE.has(action.type)) return { ...h, present };

  const key = mergeKey(action);
  const now = Date.now();
  if (key && key === h.lastKey && h.lastTime && now - h.lastTime < MERGE_MS) {
    return { ...h, present, future: [], lastTime: now };
  }
  return { past: [...h.past, h.present].slice(-LIMIT), present, future: [], lastKey: key, lastTime: now };
}

// ---------------- Persistência ----------------

/** Completa relatórios salvos por versões anteriores do app. */
export function migrate(report: Report): Report {
  let r = report;
  if (!Array.isArray(r.pages) || r.pages.length === 0) {
    const page: Page = { id: "p1", name: "Página 1" };
    r = { ...r, pages: [page], visuals: r.visuals.map((v) => ({ ...v, pageId: v.pageId ?? page.id })) };
  }
  if (!Array.isArray(r.paneFilters)) r = { ...r, paneFilters: [] };
  if (!Array.isArray(r.bookmarks)) r = { ...r, bookmarks: [] };
  if (!r.theme) r = { ...r, theme: { mode: "light", palette: "padrao" } };
  return r;
}

const STORAGE_KEY = "mini-bi-report-v1";

export function loadReport(): Report {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw) as Report);
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
