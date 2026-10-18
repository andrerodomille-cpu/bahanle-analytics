// Análises: previsão, estatísticas de distribuição, principais influenciadores
// e árvore de decomposição. Funções puras sobre números, mais os "runners"
// que montam o contexto de filtro e consultam o motor (como runVisual).

import { Engine, contextFor, valueKey, type ContextFilter } from "./query";
import type { FieldRef, Measure, RefLine, Report, Value, Visual } from "../model/types";
import { fieldKey } from "../model/types";
import { isIsoDate, shiftDate } from "../model/dates";

// ---------------- Estatística básica ----------------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Quantil com interpolação linear (o mesmo método do Excel QUARTIL.INC). */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Valor de uma linha de referência sobre os valores mostrados no visual. */
export function referenceValue(line: RefLine, values: (number | null)[]): number | null {
  if (line.kind === "constant") return line.value ?? null;
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  switch (line.kind) {
    case "average":
      return mean(xs);
    case "median":
      return quantile(xs, 0.5);
    case "min":
      return xs[0];
    case "max":
      return xs[xs.length - 1];
  }
}

// ---------------- Previsão ----------------

export interface ForecastPoint {
  y: number;
  low: number;
  high: number;
}

const Z: Record<number, number> = { 0.8: 1.2816, 0.9: 1.6449, 0.95: 1.96 };
const zOf = (confidence: number) => Z[confidence] ?? 1.96;

/**
 * Regressão linear (mínimos quadrados) sobre o índice do período.
 * A faixa é o intervalo de predição: cresce quanto mais longe do centro da série.
 */
export function linearForecast(ys: number[], periods: number, confidence = 0.95): ForecastPoint[] {
  const n = ys.length;
  if (n < 3 || periods < 1) return [];
  const xs = ys.map((_, i) => i);
  const xm = mean(xs);
  const ym = mean(ys);
  const sxx = xs.reduce((a, x) => a + (x - xm) ** 2, 0);
  const b = xs.reduce((a, x, i) => a + (x - xm) * (ys[i] - ym), 0) / sxx;
  const a = ym - b * xm;
  const sse = ys.reduce((acc, y, i) => acc + (y - (a + b * i)) ** 2, 0);
  const s = Math.sqrt(sse / (n - 2));
  const z = zOf(confidence);
  return Array.from({ length: periods }, (_, k) => {
    const x = n + k;
    const y = a + b * x;
    const half = z * s * Math.sqrt(1 + 1 / n + (x - xm) ** 2 / sxx);
    return { y, low: y - half, high: y + half };
  });
}

/**
 * Média móvel: projeta a média dos últimos `window` períodos. A faixa usa o
 * erro das previsões de um passo à frente feitas ao longo da série e alarga
 * com o horizonte (√k).
 */
export function movingForecast(ys: number[], periods: number, confidence = 0.95, window = 3): ForecastPoint[] {
  if (ys.length <= window || periods < 1) return [];
  const errors: number[] = [];
  for (let i = window; i < ys.length; i++) errors.push(ys[i] - mean(ys.slice(i - window, i)));
  const s = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
  const y = mean(ys.slice(-window));
  const z = zOf(confidence);
  return Array.from({ length: periods }, (_, k) => {
    const half = z * s * Math.sqrt(k + 1);
    return { y, low: y - half, high: y + half };
  });
}

/** Rótulos dos próximos períodos: "2026-12" → "2027-01", 2026 → 2027, datas → mesmo passo. */
export function nextLabels(labels: Value[], n: number): Value[] {
  const last = labels[labels.length - 1];
  if (typeof last === "string" && /^\d{4}-\d{2}$/.test(last)) {
    return Array.from({ length: n }, (_, k) => shiftDate(`${last}-01`, k + 1, "MONTH").slice(0, 7));
  }
  if (isIsoDate(last ?? null)) {
    const prev = labels[labels.length - 2];
    const step = isIsoDate(prev ?? null)
      ? Math.max(1, Math.round((Date.parse(last as string) - Date.parse(prev as string)) / 86400000))
      : 1;
    return Array.from({ length: n }, (_, k) => shiftDate(last as string, step * (k + 1), "DAY"));
  }
  if (typeof last === "number") return Array.from({ length: n }, (_, k) => last + k + 1);
  return Array.from({ length: n }, (_, k) => `+${k + 1}`);
}

// ---------------- Distribuição ----------------

export interface Bin {
  x0: number;
  x1: number;
  count: number;
}

/** Faixas de largura igual; padrão pela regra de Sturges (1 + log2 n). */
export function histogram(values: number[], bins?: number): Bin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const k = Math.max(1, Math.min(100, bins ?? Math.ceil(1 + Math.log2(values.length))));
  if (min === max) return [{ x0: min, x1: max, count: values.length }];
  const width = (max - min) / k;
  const out: Bin[] = Array.from({ length: k }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
  for (const v of values) out[Math.min(k - 1, Math.floor((v - min) / width))].count++;
  return out;
}

export interface BoxStats {
  n: number;
  mean: number;
  q1: number;
  median: number;
  q3: number;
  /** Bigodes: o menor/maior valor dentro de 1,5 × IQR dos quartis (Tukey). */
  low: number;
  high: number;
  outliers: number[];
}

export function boxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null;
  const xs = [...values].sort((a, b) => a - b);
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const inside = xs.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return {
    n: xs.length,
    mean: mean(xs),
    q1,
    median: quantile(xs, 0.5),
    q3,
    low: inside[0],
    high: inside[inside.length - 1],
    outliers: xs.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
  };
}

const numbers = (vs: (Value | undefined)[]) =>
  vs.filter((v): v is number | string => v !== null && v !== undefined && v !== "").map(Number).filter((n) => Number.isFinite(n));

/** Valores numéricos de uma coluna nas linhas que passam pelo contexto do visual. */
export function distributionValues(engine: Engine, report: Report, visual: Visual): number[] {
  const f = visual.valueField;
  if (!f) return [];
  return numbers(engine.rows(f.table, contextFor(report, visual)).map((r) => r[f.column]));
}

export interface BoxRow {
  category: Value;
  stats: BoxStats;
}

/** Uma caixa por valor do eixo: distribuição de `valueField` dentro de cada categoria. */
export function runBoxplot(engine: Engine, report: Report, visual: Visual): BoxRow[] {
  const f = visual.valueField;
  const axis = visual.axis;
  if (!f || !axis) return [];
  const context = contextFor(report, visual);
  const out: BoxRow[] = [];
  for (const category of engine.distinct(axis, context)) {
    const rows = engine.rows(f.table, [...context, { field: axis, keys: new Set([valueKey(category)]) }]);
    const stats = boxStats(numbers(rows.map((r) => r[f.column])));
    if (stats) out.push({ category, stats });
  }
  return out.sort((a, b) => b.stats.median - a.stats.median);
}

// ---------------- Principais influenciadores ----------------

export interface Influencer {
  field: FieldRef;
  value: Value;
  /** Medida no segmento e no total, e a razão entre elas. */
  segment: number;
  overall: number;
  ratio: number;
  /** Linhas da tabela da medida no segmento (tamanho da amostra). */
  rows: number;
}

export interface InfluencerResult {
  overall: number | null;
  totalRows: number;
  minRows: number;
  up: Influencer[];
  down: Influencer[];
}

/**
 * Versão simples de "Principais influenciadores": para cada valor de cada
 * dimensão, compara a medida no segmento com a medida no total. Segmentos
 * pequenos (menos de 2% das linhas, mínimo 20) ficam de fora para não confundir
 * acaso com padrão. É comparação de médias — não prova causa.
 */
export function keyInfluencers(engine: Engine, report: Report, visual: Visual, measure: Measure): InfluencerResult {
  const context = contextFor(report, visual);
  const overall = engine.evaluateMeasure(measure, context);
  const totalRows = engine.rows(measure.table, context).length;
  const minRows = Math.max(20, Math.ceil(totalRows * 0.02));
  const found: Influencer[] = [];
  if (overall !== null && overall !== 0) {
    for (const field of visual.explainBy ?? []) {
      for (const value of engine.distinct(field, context)) {
        const ctx = [...context, { field, keys: new Set([valueKey(value)]) }];
        const rows = engine.rows(measure.table, ctx).length;
        if (rows < minRows) continue;
        const segment = engine.evaluateMeasure(measure, ctx);
        if (segment === null) continue;
        found.push({ field, value, segment, overall, ratio: segment / overall, rows });
      }
    }
  }
  return {
    overall,
    totalRows,
    minRows,
    up: found.filter((i) => i.ratio > 1).sort((a, b) => b.ratio - a.ratio).slice(0, 10),
    down: found.filter((i) => i.ratio < 1).sort((a, b) => a.ratio - b.ratio).slice(0, 10),
  };
}

// ---------------- Árvore de decomposição ----------------

export interface DecompNode {
  value: Value;
  measure: number | null;
}

export interface DecompLevel {
  field: FieldRef;
  selected?: Value;
  nodes: DecompNode[];
}

export interface DecompResult {
  total: number | null;
  levels: DecompLevel[];
  /** Dimensões ainda não usadas, para o próximo nível. */
  available: FieldRef[];
}

/**
 * Cada nível divide a medida pelos valores de uma dimensão, dentro do caminho
 * escolhido nos níveis anteriores (cada nó escolhido vira um filtro).
 */
export function runDecomposition(engine: Engine, report: Report, visual: Visual, measure: Measure): DecompResult {
  let context: ContextFilter[] = contextFor(report, visual);
  const total = engine.evaluateMeasure(measure, context);
  const levels: DecompLevel[] = [];
  for (const level of visual.decomp ?? []) {
    const nodes = engine
      .distinct(level.field, context)
      .map((value) => ({
        value,
        measure: engine.evaluateMeasure(measure, [...context, { field: level.field, keys: new Set([valueKey(value)]) }]),
      }))
      .filter((n) => n.measure !== null)
      .sort((a, b) => (b.measure ?? 0) - (a.measure ?? 0));
    levels.push({ field: level.field, selected: level.value, nodes });
    // Só desce para o próximo nível se um nó deste foi escolhido.
    if (level.value === undefined) break;
    context = [...context, { field: level.field, keys: new Set([valueKey(level.value)]) }];
  }
  const used = new Set(levels.map((l) => fieldKey(l.field)));
  return { total, levels, available: (visual.explainBy ?? []).filter((f) => !used.has(fieldKey(f))) };
}

// ---------------- Anomalias ----------------

export interface AnomalyResult {
  expected: number[];
  low: number[];
  high: number[];
  flags: boolean[];
}

/**
 * Detecção de anomalias simples: ajusta a tendência linear da série e marca os
 * pontos cujo resíduo passa de `k` desvios-padrão (2 = mais sensível, 3 = só
 * os extremos). É a mesma regressão da previsão, olhando para trás.
 */
export function detectAnomalies(ys: number[], k = 2): AnomalyResult {
  const n = ys.length;
  const empty = { expected: [], low: [], high: [], flags: ys.map(() => false) };
  if (n < 4) return empty;
  const xm = (n - 1) / 2;
  const ym = mean(ys);
  const sxx = ys.reduce((a, _, i) => a + (i - xm) ** 2, 0);
  const b = ys.reduce((a, y, i) => a + (i - xm) * (y - ym), 0) / sxx;
  const a = ym - b * xm;
  const expected = ys.map((_, i) => a + b * i);
  const s = Math.sqrt(ys.reduce((acc, y, i) => acc + (y - expected[i]) ** 2, 0) / (n - 2));
  if (!Number.isFinite(s) || s === 0) return { ...empty, expected, low: expected, high: expected };
  return {
    expected,
    low: expected.map((e) => e - k * s),
    high: expected.map((e) => e + k * s),
    flags: ys.map((y, i) => Math.abs(y - expected[i]) > k * s),
  };
}

// ---------------- Pareto ----------------

export interface ParetoRow {
  category: Value;
  value: number;
  /** Participação acumulada (0–1), do maior para o menor. */
  cumulative: number;
}

/** Ordena do maior para o menor e acumula a participação no total. */
export function paretoRows(rows: { category: Value; values: (number | null)[] }[]): ParetoRow[] {
  const sorted = rows
    .map((r) => ({ category: r.category, value: r.values[0] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((x, y) => y.value - x.value);
  const total = sorted.reduce((acc, r) => acc + r.value, 0);
  let run = 0;
  return sorted.map((r) => {
    run += r.value;
    return { ...r, cumulative: total ? run / total : 0 };
  });
}

// ---------------- Narrativa automática ----------------

/**
 * Texto gerado a partir dos dados, em frases-modelo (sem IA externa): total,
 * comparação, evolução no eixo (início × fim, pico, vale, tendência e pontos
 * fora do padrão) e quem lidera em cada dimensão de "Explicar por".
 * Devolve markdown simples (**negrito**) para a caixa de texto desenhar.
 */
export function generateNarrative(
  engine: Engine,
  report: Report,
  visual: Visual,
  measures: Measure[],
  fmt: (v: number | null, m: Measure, short?: boolean) => string,
  label: (v: Value) => string,
): string {
  const [m, cmp] = measures;
  const context = contextFor(report, visual);
  const total = engine.evaluateMeasure(m, context);
  const lines: string[] = [`**${m.name}**: **${fmt(total, m)}**.`];
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

  if (cmp) {
    const base = engine.evaluateMeasure(cmp, context);
    if (total !== null && base) {
      lines.push(`Contra ${cmp.name} (${fmt(base, cmp)}), a variação é de **${pct((total - base) / Math.abs(base))}**.`);
    }
  }

  if (visual.axis) {
    const series = engine
      .distinct(visual.axis, context)
      .map((c) => ({ c, v: engine.evaluateMeasure(m, [...context, { field: visual.axis!, keys: new Set([valueKey(c)]) }]) }))
      .filter((p): p is { c: Value; v: number } => p.v !== null)
      .sort((a, b) => (a.c! < b.c! ? -1 : a.c! > b.c! ? 1 : 0));
    if (series.length >= 2) {
      const first = series[0];
      const last = series[series.length - 1];
      const peak = series.reduce((a, b) => (b.v > a.v ? b : a));
      const low = series.reduce((a, b) => (b.v < a.v ? b : a));
      const change = first.v ? `, variação de **${pct((last.v - first.v) / Math.abs(first.v))}**` : "";
      lines.push(
        `Entre ${label(first.c)} e ${label(last.c)}, ${m.name} foi de ${fmt(first.v, m, true)} para ${fmt(last.v, m, true)}${change}. ` +
        `O pico foi em **${label(peak.c)}** (${fmt(peak.v, m, true)}) e o menor valor em **${label(low.c)}** (${fmt(low.v, m, true)}).`,
      );
      const ys = series.map((p) => p.v);
      if (ys.length >= 4) {
        const an = detectAnomalies(ys, 2);
        const slope = an.expected[an.expected.length - 1] - an.expected[0];
        const rel = Math.abs(slope) / Math.max(1e-9, Math.abs(mean(ys)));
        lines.push(`A tendência no período é de **${rel < 0.05 ? "estabilidade" : slope > 0 ? "alta" : "queda"}**.`);
        const odd = series.filter((_, i) => an.flags[i]).map((p) => label(p.c));
        if (odd.length) lines.push(`Fora do padrão: ${odd.join(", ")}.`);
      }
    }
  }

  for (const field of visual.explainBy ?? []) {
    const parts = engine
      .distinct(field, context)
      .map((c) => ({ c, v: engine.evaluateMeasure(m, [...context, { field, keys: new Set([valueKey(c)]) }]) }))
      .filter((p): p is { c: Value; v: number } => p.v !== null)
      .sort((a, b) => b.v - a.v);
    if (parts.length < 2) continue;
    // Participação só faz sentido se a medida for aditiva (as partes somam o total).
    const sum = parts.reduce((a, p) => a + p.v, 0);
    const additive = total !== null && total !== 0 && Math.abs(sum - total) / Math.abs(total) < 0.01;
    const share = (v: number) => (additive ? `, ${(100 * v / total!).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total` : "");
    const [top, second] = parts;
    const bottom = parts[parts.length - 1];
    lines.push(
      `Por ${field.column}, **${label(top.c)}** lidera com ${fmt(top.v, m, true)}${share(top.v)}, seguido de ${label(second.c)} ` +
      `(${fmt(second.v, m, true)}); ${label(bottom.c)} tem o menor valor (${fmt(bottom.v, m, true)}).`,
    );
  }
  return lines.join("\n");
}
