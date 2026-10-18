// Consultas dos visuais do "laboratório": pequenos múltiplos, calendário de
// calor, Gantt, dica de ferramenta com detalhes e gráfico de marcador.

import { Engine, contextFor, runVisual, valueKey, type ContextFilter, type ResultRow } from "./query";
import type { FieldRef, Measure, Report, Value, Visual } from "../model/types";
import { isIsoDate } from "../model/dates";
import { formatValue } from "../model/format";

const only = (field: FieldRef, v: Value): ContextFilter => ({ field, keys: new Set([valueKey(v)]) });

// ---------------- Pequenos múltiplos ----------------

export interface MultiplesResult {
  panels: { value: Value; rows: ResultRow[] }[];
  /** Maior valor da 1ª medida entre todos os painéis: a escala comum. */
  max: number;
}

/**
 * Repete a consulta do visual para cada valor do campo de múltiplos. É o
 * mesmo runVisual, com um filtro de visual a mais por painel — então todos
 * os filtros, drill e Top N continuam valendo.
 */
export function runMultiples(
  engine: Engine, report: Report, visual: Visual, limit = 12, field: FieldRef = visual.multiples!,
): MultiplesResult {
  const values = engine
    .distinct(field, contextFor(report, visual))
    .filter((v) => v !== null && v !== "")
    .sort((a, b) => formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true }))
    .slice(0, limit);
  const panels = values.map((value) => {
    const r: Report = {
      ...report,
      paneFilters: [...report.paneFilters, { id: "__multiples", scope: "visual", targetId: visual.id, field, values: [value] }],
    };
    const res = runVisual(engine, r, visual);
    if (res.error) throw new Error(res.error);
    return { value, rows: res.rows };
  });
  const max = Math.max(0, ...panels.flatMap((p) => p.rows.map((row) => row.values[0] ?? 0)));
  return { panels, max };
}

// ---------------- Calendário de calor ----------------

export interface CalendarResult {
  year: number;
  years: number[];
  /** Medida por dia (data ISO). */
  days: Map<string, number | null>;
}

/**
 * Um valor por dia do ano escolhido. Antes de separar por dia, o contexto
 * recebe o intervalo do ano: assim cada dia filtra só as linhas daquele ano
 * (o cache por prefixo reaproveita esse passo).
 */
export function runCalendar(engine: Engine, report: Report, visual: Visual, measure: Measure): CalendarResult {
  const field = visual.axis!;
  const context = contextFor(report, visual);
  const allDays = engine.distinct(field, context).filter((d): d is string => isIsoDate(d));
  const years = [...new Set(allDays.map((d) => Number(d.slice(0, 4))))].sort();
  const year = visual.calendarYear && years.includes(visual.calendarYear) ? visual.calendarYear : years[years.length - 1];
  const days = new Map<string, number | null>();
  if (year === undefined) return { year: new Date().getFullYear(), years, days };
  const inYear = [...context, { field, range: { min: `${year}-01-01`, max: `${year}-12-31` } }];
  for (const d of allDays) {
    if (!d.startsWith(String(year))) continue;
    days.set(d, engine.evaluateMeasure(measure, [...inYear, only(field, d)]));
  }
  return { year, years, days };
}

// ---------------- Gantt ----------------

export interface GanttTask {
  task: Value;
  start: string;
  end: string;
  progress: number | null;
  group: Value;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Uma barra por tarefa (valor do eixo): do menor início ao maior fim das
 * linhas da tarefa; % concluído = média da coluna de progresso; cor pela
 * legenda (ex.: responsável).
 */
export function runGantt(engine: Engine, report: Report, visual: Visual): GanttTask[] {
  const { axis, startField, endField, progressField, legend } = visual;
  if (!axis || !startField || !endField) return [];
  const context = contextFor(report, visual);
  const tasks: GanttTask[] = [];
  for (const task of engine.distinct(axis, context)) {
    const ctx = [...context, only(axis, task)];
    const starts = engine.rows(startField.table, ctx).map((r) => r[startField.column]).filter((v): v is string => isIsoDate(v ?? null)).sort();
    const ends = engine.rows(endField.table, ctx).map((r) => r[endField.column]).filter((v): v is string => isIsoDate(v ?? null)).sort();
    if (!starts.length || !ends.length) continue;
    const progress = progressField
      ? avg(engine.rows(progressField.table, ctx).map((r) => Number(r[progressField.column])).filter(Number.isFinite))
      : null;
    const group = legend ? engine.rows(legend.table, ctx)[0]?.[legend.column] ?? null : null;
    tasks.push({ task, start: starts[0], end: ends[ends.length - 1], progress, group });
  }
  return tasks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// ---------------- Dica de ferramenta com detalhes ----------------

export interface Detail {
  extra: (number | null)[];
  trend: { label: string; value: number | null }[];
}

/**
 * Para cada categoria do visual: as medidas extras e o minigráfico pelo campo
 * de tendência. Limitado às primeiras categorias para não pesar.
 */
export function runDetails(engine: Engine, report: Report, visual: Visual, axis: FieldRef, rows: ResultRow[], limit = 40): Map<string, Detail> {
  const extras = (visual.tooltipMeasures ?? [])
    .map((id) => report.measures.find((m) => m.id === id))
    .filter((m): m is Measure => !!m);
  const main = report.measures.find((m) => m.id === visual.measureIds[0]);
  const context = contextFor(report, visual);
  const trendField = visual.tooltipTrend;
  const trendValues = trendField
    ? engine.distinct(trendField, context).sort((a, b) => formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true }))
    : [];
  const out = new Map<string, Detail>();
  for (const r of rows.slice(0, limit)) {
    const ctx = [...context, only(axis, r.category)];
    out.set(formatValue(r.category), {
      extra: extras.map((m) => engine.evaluateMeasure(m, ctx)),
      trend: trendField && main
        ? trendValues.map((t) => ({ label: formatValue(t), value: engine.evaluateMeasure(main, [...ctx, only(trendField, t)]) }))
        : [],
    });
  }
  return out;
}

export const detailMeasures = (report: Report, visual: Visual): Measure[] =>
  (visual.tooltipMeasures ?? []).map((id) => report.measures.find((m) => m.id === id)).filter((m): m is Measure => !!m);
