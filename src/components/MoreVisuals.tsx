import { Fragment } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ButtonAction, Measure, Value, Visual } from "../model/types";
import { fieldLabel } from "../model/types";
import { usePalette } from "../model/theme";
import type { GridResult, ResultRow } from "../engine/query";
import { valueKey } from "../engine/query";
import { formatMeasure, formatValue } from "../model/format";
import { RuledValue } from "./Package4Visuals";

// Visuais do "pacote executivo": KPI, combo, cascata, mapa de calor,
// caixa de texto e botão. As consultas são as mesmas dos outros visuais
// (runVisual / runGrid / runTotals); só a forma de desenhar muda.

const multi = (e?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) =>
  !!e && !!(e.ctrlKey || e.shiftKey || e.metaKey);

const GOOD = "#2e9d47";
const BAD = "#d64550";

// ---------------- Escala de cores (formatação condicional) ----------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Fundo proporcional ao valor entre o mínimo e o máximo; texto claro nos tons fortes. */
export function colorScaleStyle(
  v: number | null, min: number, max: number, color: string, floor = 0.08,
): React.CSSProperties | undefined {
  if (v === null) return undefined;
  const t = max > min ? (v - min) / (max - min) : 1;
  const alpha = floor + (0.9 - floor) * Math.max(0, Math.min(1, t));
  const [r, g, b] = hexToRgb(color);
  return { background: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`, color: alpha > 0.55 ? "#fff" : undefined };
}

export const rangeOf = (values: (number | null)[]) => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : { min: 0, max: 0 };
};

// ---------------- Cartão KPI ----------------

/**
 * Valor principal, variação contra a medida de comparação (ex.: ano anterior),
 * progresso da meta e, se houver eixo, um minigráfico de tendência.
 */
export function KpiVisual({ visual, result, totals, measures }: {
  visual: Visual; result: { rows: ResultRow[] }; totals: (number | null)[]; measures: Measure[];
}) {
  const palette = usePalette();
  const [m, cmp] = measures;
  const value = totals[0] ?? null;
  const base = cmp ? totals[1] ?? null : null;
  const delta = value !== null && base !== null && base !== 0 ? (value - base) / Math.abs(base) : null;
  const target = visual.target ?? null;
  const progress = value !== null && target ? value / target : null;
  const trend = visual.axis
    ? [...result.rows]
        .sort((a, b) => formatValue(a.category).localeCompare(formatValue(b.category), "pt-BR", { numeric: true }))
        .map((r) => ({ label: formatValue(r.category), v: r.values[0] }))
    : [];

  return (
    <div className="kpi-visual">
      {visual.title.toLowerCase() !== m.name.toLowerCase() && <div className="kpi-label">{m.name}</div>}
      <div className="kpi-value">
        <RuledValue rules={visual.rules} measure={0} value={value} text={formatMeasure(value, m.format)} />
      </div>
      {cmp && (
        <div className="kpi-delta" style={{ color: delta === null ? undefined : delta >= 0 ? GOOD : BAD }}>
          {delta === null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${formatMeasure(Math.abs(delta), "percent")}`}
          <span className="muted"> vs. {cmp.name} ({formatMeasure(base, cmp.format, true)})</span>
        </div>
      )}
      {progress !== null && (
        <div className="kpi-target" title={`Meta: ${formatMeasure(target, m.format)}`}>
          <div className="kpi-bar">
            <span style={{ width: `${Math.min(100, progress * 100)}%`, background: progress >= 1 ? GOOD : palette[0] }} />
          </div>
          <span className="muted">{formatMeasure(progress, "percent")} da meta</span>
        </div>
      )}
      {trend.length > 1 && (
        <div className="kpi-trend">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
              <Tooltip
                formatter={(v: number) => formatMeasure(v, m.format)}
                labelFormatter={(l: string) => `${fieldLabel(visual.axis!)}: ${l}`}
              />
              <Area dataKey="v" name={m.name} stroke={palette[0]} fill={palette[0]} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---------------- Combo: colunas + linha (dois eixos) ----------------

export function ComboVisual({ rows, measures, selected, onSelect }: {
  rows: ResultRow[]; measures: Measure[]; selected: Set<string>; onSelect: (c: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const [bars, line] = measures;
  const data = rows.map((r) => ({ __label: formatValue(r.category), bar: r.values[0], line: line ? r.values[1] : null }));
  const dim = (c: Value) => selected.size > 0 && !selected.has(valueKey(c));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 5, right: 4, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval={rows.length > 8 ? "preserveStartEnd" : 0} minTickGap={4} />
        <YAxis yAxisId="l" tick={{ fontSize: 11 }} width={70} tickFormatter={(v: number) => formatMeasure(v, bars.format, true)} />
        {line && (
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={56}
            tickFormatter={(v: number) => formatMeasure(v, line.format, true)} />
        )}
        <Tooltip
          formatter={(v: number, key: string) => formatMeasure(v, key === "line" && line ? line.format : bars.format)}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(key: string) => (key === "line" && line ? line.name : bars.name)} />
        <Bar
          yAxisId="l"
          dataKey="bar"
          name="bar"
          fill={palette[0]}
          cursor="pointer"
          onClick={(_d: unknown, i: number, e: React.MouseEvent) => onSelect(rows[i].category, multi(e))}
        >
          {rows.map((r) => <Cell key={valueKey(r.category)} fillOpacity={dim(r.category) ? 0.3 : 1} />)}
        </Bar>
        {line && (
          <Line yAxisId="r" dataKey="line" name="line" stroke={palette[2]} strokeWidth={2} dot={{ r: 3 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------- Cascata ----------------

interface Step {
  label: string;
  category?: Value;
  kind: "total" | "up" | "down";
  /** Parte invisível que "levanta" a barra até o acumulado anterior. */
  base: number;
  size: number;
  /** Valor exibido (variação ou total). */
  shown: number;
}

/**
 * Com uma medida: cada categoria soma ao acumulado, terminando no total.
 * Com duas (atual e base): começa no total da base, mostra quanto cada
 * categoria variou (atual − base) e termina no total atual — o "como fomos
 * de 2025 para 2026".
 */
export function waterfallSteps(rows: ResultRow[], totals: (number | null)[], measures: Measure[]): Step[] {
  const [current, baseMeasure] = measures;
  const steps: Step[] = [];
  let running = 0;
  if (baseMeasure) {
    running = totals[1] ?? 0;
    steps.push({ label: baseMeasure.name, kind: "total", base: 0, size: running, shown: running });
  }
  for (const r of rows) {
    const d = baseMeasure ? (r.values[0] ?? 0) - (r.values[1] ?? 0) : r.values[0] ?? 0;
    if (d === 0) continue;
    const from = running;
    running += d;
    steps.push({ label: formatValue(r.category), category: r.category, kind: d >= 0 ? "up" : "down", base: Math.min(from, running), size: Math.abs(d), shown: d });
  }
  const end = totals[0] ?? running;
  steps.push({ label: current.name, kind: "total", base: 0, size: end, shown: end });
  return steps;
}

export function WaterfallVisual({ rows, totals, measures, selected, onSelect }: {
  rows: ResultRow[]; totals: (number | null)[]; measures: Measure[]; selected: Set<string>;
  onSelect: (c: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const m = measures[0];
  const steps = waterfallSteps(rows, totals, measures);
  const color = (s: Step) => (s.kind === "total" ? palette[0] : s.kind === "up" ? GOOD : BAD);
  const dim = (s: Step) => s.category !== undefined && selected.size > 0 && !selected.has(valueKey(s.category));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={steps} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          interval={steps.length > 8 ? "preserveStartEnd" : 0}
          minTickGap={4}
          tickFormatter={(l: string) => (l.length > 14 ? `${l.slice(0, 13)}…` : l)}
        />
        <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v: number) => formatMeasure(v, m.format, true)} />
        <Tooltip
          content={({ payload }) => {
            const s = payload?.[0]?.payload as Step | undefined;
            if (!s) return null;
            const sign = s.kind === "up" ? "+" : s.kind === "down" ? "−" : "";
            return (
              <div className="tip">
                <strong>{s.label}</strong>
                <div>{s.kind === "total" ? "Total" : "Variação"}: {sign}{formatMeasure(Math.abs(s.shown), m.format)}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar
          dataKey="size"
          stackId="w"
          cursor="pointer"
          onClick={(_d: unknown, i: number, e: React.MouseEvent) => {
            const s = steps[i];
            if (s.category !== undefined) onSelect(s.category, multi(e));
          }}
        >
          {steps.map((s, i) => <Cell key={i} fill={color(s)} fillOpacity={dim(s) ? 0.3 : 1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------- Mapa de calor ----------------

export function HeatmapVisual({ visual, grid, measures, selected, onSelect }: {
  visual: Visual; grid: GridResult; measures: Measure[]; selected: Set<string>;
  onSelect: (c: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const m = measures[0];
  const sort = (a: Value, b: Value) => formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true });
  const rows = [...grid.rows].sort(sort);
  const cols = [...grid.cols].sort(sort);
  const cell = (r: Value, c: Value) => grid.cells.get(valueKey(r))?.get(valueKey(c))?.[0] ?? null;
  const { min, max } = rangeOf(rows.flatMap((r) => cols.map((c) => cell(r, c))));
  return (
    <div className="table-visual heatmap">
      <table>
        <thead>
          <tr>
            <th>{fieldLabel(visual.axis!)} \ {fieldLabel(visual.legend!)}</th>
            {cols.map((c) => <th key={valueKey(c)} className="num">{formatValue(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={valueKey(r)}
              className={selected.size === 0 ? "" : selected.has(valueKey(r)) ? "sel" : "dim"}
              onClick={(e) => onSelect(r, multi(e))}
            >
              <td>{formatValue(r)}</td>
              {cols.map((c) => {
                const v = cell(r, c);
                return (
                  <td key={valueKey(c)} className="num heat" style={colorScaleStyle(v, min, max, palette[0])}
                    title={`${formatValue(r)} · ${formatValue(c)}: ${formatMeasure(v, m.format)}`}>
                    {formatMeasure(v, m.format, true)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heat-legend">
        <span>{formatMeasure(min, m.format, true)}</span>
        <span className="heat-gradient" style={{ background: `linear-gradient(90deg, ${colorScaleStyle(min, min, max, palette[0])?.background}, ${colorScaleStyle(max, min, max, palette[0])?.background})` }} />
        <span>{formatMeasure(max, m.format, true)}</span>
      </div>
    </div>
  );
}

// ---------------- Caixa de texto ----------------

/**
 * Markdown mínimo: "# título", "## subtítulo", "- item" (lista), **negrito**,
 * *itálico* e [texto](https://link). Só links http(s) viram links — nada de
 * "javascript:" vindo de um relatório publicado.
 */
export function TextVisual({ text, align = "left", size = "m" }: {
  text: string;
  align?: Visual["textAlign"];
  size?: Visual["textSize"];
}) {
  if (!text.trim()) return <div className="visual-msg">Escreva o texto no painel à direita.</div>;

  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
      const k = `${key}-${i}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={k}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link) {
        return /^https?:\/\//i.test(link[2])
          ? <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>{link[1]}</a>
          : <Fragment key={k}>{link[1]}</Fragment>;
      }
      return <Fragment key={k}>{part}</Fragment>;
    });

  // Agrupa linhas "- " seguidas numa única lista.
  const blocks: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) {
      const id = `ul-${blocks.length}`;
      blocks.push(<ul key={id}>{items.map((it, i) => <li key={i}>{inline(it, `${id}-${i}`)}</li>)}</ul>);
      items = [];
    }
  };
  text.split("\n").forEach((line, i) => {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(bullet[1]);
      return;
    }
    flush();
    const k = `l${i}`;
    if (line.startsWith("## ")) blocks.push(<h3 key={k}>{inline(line.slice(3), k)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={k}>{inline(line.slice(2), k)}</h2>);
    else if (!line.trim()) blocks.push(<div key={k} className="text-gap" />);
    else blocks.push(<p key={k}>{inline(line, k)}</p>);
  });
  flush();

  return <div className={`text-visual size-${size}`} style={{ textAlign: align }}>{blocks}</div>;
}

// ---------------- Botão ----------------

export function ButtonVisual({ visual, onAction }: { visual: Visual; onAction: (a: ButtonAction) => void }) {
  const palette = usePalette();
  return (
    <button
      className="button-visual"
      style={{ background: palette[0] }}
      disabled={!visual.action}
      title={visual.action ? undefined : "Escolha a ação no painel à direita"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => visual.action && onAction(visual.action)}
    >
      {visual.title || "Botão"}
    </button>
  );
}
