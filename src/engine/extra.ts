// Consultas do último pacote de visuais: matriz hierárquica, sunburst,
// ranking (bump), distribuições (violino), waffle e dispersão animada.

import { Engine, contextFor, hierarchyOf, valueKey, type ContextFilter, type GridResult } from "./query";
import type { FieldRef, Measure, Report, Value, Visual } from "../model/types";
import { formatValue } from "../model/format";

const only = (field: FieldRef, v: Value): ContextFilter => ({ field, keys: new Set([valueKey(v)]) });
const byLabel = (a: Value, b: Value) => formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true });

// ---------------- Matriz hierárquica ----------------

export const pathKey = (path: Value[]) => path.map(valueKey).join("\u0001");

export interface TreeRow {
  key: string;
  path: Value[];
  level: number;
  value: Value;
  field: FieldRef;
  hasChildren: boolean;
  expanded: boolean;
  /** Medidas do nó (o subtotal do nível). */
  values: (number | null)[];
  /** Medidas por coluna (se houver campo de colunas). */
  cells: Map<string, (number | null)[]>;
}

export interface TreeResult {
  levels: FieldRef[];
  rows: TreeRow[];
  cols: Value[];
  colTotals: Map<string, (number | null)[]>;
  grandTotal: (number | null)[];
}

/**
 * Linhas em árvore: cada nível vem da hierarquia do eixo (eixo + níveis de
 * detalhamento, ou Ano › Trimestre › Mês › Dia numa data). Só os nós abertos
 * calculam os filhos; cada nó já é o subtotal do seu ramo.
 */
export function runMatrixTree(engine: Engine, report: Report, visual: Visual, measures: Measure[]): TreeResult {
  const levels = hierarchyOf(report, visual);
  const context = contextFor(report, visual);
  const open = new Set(visual.expanded ?? []);
  const legend = visual.legend;
  const cols = legend ? engine.distinct(legend, context).filter((c) => c !== null).sort(byLabel) : [];
  const evalAll = (ctx: ContextFilter[]) => measures.map((m) => engine.evaluateMeasure(m, ctx));
  const rows: TreeRow[] = [];

  const walk = (level: number, path: Value[], ctx: ContextFilter[]) => {
    const field = levels[level];
    const children = engine.distinct(field, ctx).map((value) => {
      const c = [...ctx, only(field, value)];
      return { value, ctx: c, values: evalAll(c) };
    }).filter((n) => n.values.some((v) => v !== null));
    // Datas seguem a ordem do tempo; o resto, do maior para o menor.
    if (field.part) children.sort((a, b) => byLabel(a.value, b.value));
    else children.sort((a, b) => (b.values[0] ?? -Infinity) - (a.values[0] ?? -Infinity));
    for (const n of children) {
      const p = [...path, n.value];
      const key = pathKey(p);
      const hasChildren = level < levels.length - 1;
      const expanded = hasChildren && open.has(key);
      const cells = new Map<string, (number | null)[]>();
      for (const c of cols) cells.set(valueKey(c), evalAll([...n.ctx, only(legend!, c)]));
      rows.push({ key, path: p, level, value: n.value, field, hasChildren, expanded, values: n.values, cells });
      if (expanded) walk(level + 1, p, n.ctx);
    }
  };
  if (levels.length) walk(0, [], context);

  const colTotals = new Map<string, (number | null)[]>();
  for (const c of cols) colTotals.set(valueKey(c), evalAll([...context, only(legend!, c)]));
  return { levels, rows, cols, colTotals, grandTotal: evalAll(context) };
}

/** Todos os caminhos com filhos, até o penúltimo nível — para "expandir tudo". */
export function allPaths(engine: Engine, report: Report, visual: Visual): string[] {
  const levels = hierarchyOf(report, visual);
  const out: string[] = [];
  const walk = (level: number, path: Value[], ctx: ContextFilter[]) => {
    if (level >= levels.length - 1) return;
    for (const v of engine.distinct(levels[level], ctx)) {
      const p = [...path, v];
      out.push(pathKey(p));
      walk(level + 1, p, [...ctx, only(levels[level], v)]);
    }
  };
  walk(0, [], contextFor(report, visual));
  return out;
}

// ---------------- Sunburst ----------------

export interface HierNode {
  value: Value;
  field: FieldRef;
  measure: number;
  path: Value[];
  children: HierNode[];
}

/** Árvore completa até `maxDepth` níveis, para os anéis do sunburst. */
export function runHierarchy(engine: Engine, report: Report, visual: Visual, measure: Measure, maxDepth = 3): { total: number; nodes: HierNode[] } {
  const levels = hierarchyOf(report, visual).slice(0, maxDepth);
  const build = (level: number, path: Value[], ctx: ContextFilter[]): HierNode[] => {
    if (level >= levels.length) return [];
    const field = levels[level];
    return engine.distinct(field, ctx)
      .map((value) => {
        const c = [...ctx, only(field, value)];
        const v = engine.evaluateMeasure(measure, c) ?? 0;
        return { value, field, measure: v, path: [...path, value], ctx: c };
      })
      .filter((n) => n.measure > 0)
      .sort((a, b) => b.measure - a.measure)
      .map(({ ctx: c, ...n }) => ({ ...n, children: build(level + 1, n.path, c) }));
  };
  const nodes = build(0, [], contextFor(report, visual));
  return { total: nodes.reduce((a, n) => a + n.measure, 0), nodes };
}

// ---------------- Ranking (bump chart) ----------------

export interface BumpResult {
  periods: Value[];
  series: Value[];
  /** rank[série][período]: 1 = maior valor naquele período (null = sem valor). */
  ranks: Map<string, (number | null)[]>;
  values: Map<string, (number | null)[]>;
}

/** A partir da grade período × série: a posição de cada série em cada período. */
export function bumpRanks(grid: GridResult): BumpResult {
  const periods = [...grid.rows].sort(byLabel);
  const series = [...grid.cols];
  const ranks = new Map<string, (number | null)[]>(series.map((s) => [valueKey(s), []]));
  const values = new Map<string, (number | null)[]>(series.map((s) => [valueKey(s), []]));
  for (const p of periods) {
    const row = series.map((s) => ({ s, v: grid.cells.get(valueKey(p))?.get(valueKey(s))?.[0] ?? null }));
    const sorted = row.filter((x) => x.v !== null).sort((a, b) => b.v! - a.v!);
    for (const x of row) {
      const r = sorted.indexOf(x);
      ranks.get(valueKey(x.s))!.push(r >= 0 ? r + 1 : null);
      values.get(valueKey(x.s))!.push(x.v);
    }
  }
  // Séries ordenadas pela posição no último período (a legenda lê de cima para baixo).
  const last = periods.length - 1;
  series.sort((a, b) => (ranks.get(valueKey(a))![last] ?? 99) - (ranks.get(valueKey(b))![last] ?? 99));
  return { periods, series, ranks, values };
}

// ---------------- Distribuições (violino) ----------------

export interface Distribution {
  category: Value;
  values: number[];
}

const numbers = (vs: (Value | undefined)[]) =>
  vs.filter((v): v is number | string => v !== null && v !== undefined && v !== "").map(Number).filter(Number.isFinite);

/** Valores de `valueField` em cada categoria do eixo. */
export function runDistributions(engine: Engine, report: Report, visual: Visual): Distribution[] {
  const f = visual.valueField;
  const axis = visual.axis;
  if (!f || !axis) return [];
  const context = contextFor(report, visual);
  return engine.distinct(axis, context)
    .map((category) => ({
      category,
      values: numbers(engine.rows(f.table, [...context, only(axis, category)]).map((r) => r[f.column])),
    }))
    .filter((d) => d.values.length > 1)
    .sort((a, b) => byLabel(a.category, b.category));
}

/**
 * Densidade por núcleo gaussiano (KDE), com a largura de banda de Silverman
 * (1,06·σ·n^(−1/5)), avaliada em `points` pontos entre `lo` e `hi`.
 */
export function kde(values: number[], lo: number, hi: number, points = 60): { x: number; d: number }[] {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, n - 1)) || 1;
  const h = 1.06 * sd * n ** -0.2;
  const k = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return Array.from({ length: points }, (_, i) => {
    const x = lo + ((hi - lo) * i) / (points - 1);
    let s = 0;
    for (const v of values) s += Math.exp(-0.5 * ((x - v) / h) ** 2);
    return { x, d: s * k };
  });
}

// ---------------- Waffle ----------------

/**
 * Distribui `cells` quadradinhos entre as categorias pelo método do maior
 * resto: cada uma recebe a parte inteira e as sobras vão para os maiores restos
 * — assim a soma é sempre exatamente `cells`.
 */
export function waffleCounts(values: number[], cells = 100): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / total) * cells);
  const counts = exact.map(Math.floor);
  let left = cells - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left-- <= 0) break;
    counts[i]++;
  }
  return counts;
}

/** Valor "redondo" por ícone para o pictograma: ~20 ícones na maior categoria. */
export function niceUnit(max: number, icons = 20): number {
  if (!(max > 0)) return 1;
  const raw = max / icons;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}
