import { useEffect, useState } from "react";
import {
  CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { FieldRef, Measure, Value, Visual } from "../model/types";
import { fieldLabel } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey, type GridResult, type ResultRow } from "../engine/query";
import { bumpRanks, kde, niceUnit, waffleCounts, type Distribution, type HierNode, type TreeResult } from "../engine/extra";
import { boxStats } from "../engine/analytics";
import type { MultiplesResult } from "../engine/lab";
import { RuledValue } from "./Package4Visuals";
import { useSize } from "./AnalyticsVisuals";

const multi = (e?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => !!e && !!(e.ctrlKey || e.shiftKey || e.metaKey);
type Select = (category: Value, multi: boolean) => void;
type FilterField = (field: FieldRef, values: Value[]) => void;

// ---------------- Matriz hierárquica ----------------

/** Linhas que abrem e fecham; cada nó mostra o subtotal do seu ramo. */
export function TreeMatrixVisual({ visual, tree, measures, ownFilterKey, onFilterField, onUpdate, onExpandAll }: {
  visual: Visual; tree: TreeResult; measures: Measure[]; ownFilterKey?: string;
  onFilterField: FilterField; onUpdate: (p: Partial<Visual>) => void; onExpandAll: () => void;
}) {
  const open = new Set(visual.expanded ?? []);
  const toggle = (key: string) =>
    onUpdate({ expanded: open.has(key) ? [...open].filter((k) => k !== key && !k.startsWith(key + "\u0001")) : [...open, key] });
  const cols = tree.cols;
  const cells = (vals: (number | null)[] | undefined, key: string) =>
    measures.map((m, i) => (
      <td key={`${key}-${m.id}`} className="num">
        <RuledValue rules={visual.rules} measure={i} value={vals?.[i] ?? null} text={formatMeasure(vals?.[i] ?? null, m.format)} />
      </td>
    ));
  return (
    <div className="table-visual tree-matrix">
      <div className="tree-tools">
        <button className="link" onClick={onExpandAll}>⊞ Expandir tudo</button>
        <button className="link" onClick={() => onUpdate({ expanded: [] })}>⊟ Recolher tudo</button>
        <span className="muted small">{tree.levels.map(fieldLabel).join(" › ")}</span>
      </div>
      <table className="matrix">
        <thead>
          <tr>
            <th>{fieldLabel(tree.levels[0])}</th>
            {cols.map((c) => <th key={valueKey(c)} colSpan={measures.length} className="num">{formatValue(c)}</th>)}
            <th colSpan={measures.length} className="num total-col">{cols.length ? "Total" : measures.map((m) => m.name).join(" · ")}</th>
          </tr>
          {(cols.length > 0 || measures.length > 1) && (
            <tr>
              <th />
              {[...cols, "__t"].flatMap((c) => measures.map((m) => <th key={`${valueKey(c as Value)}-${m.id}`} className="num sub">{m.name}</th>))}
            </tr>
          )}
        </thead>
        <tbody>
          {tree.rows.map((r) => (
            <tr key={r.key} className={(r.expanded ? "subtotal" : "") + (ownFilterKey === `${valueKey(r.value)}@${r.field.column}` ? " sel" : "")}>
              <td style={{ paddingLeft: 6 + r.level * 16 }}>
                {r.hasChildren
                  ? <button className="tree-toggle" onClick={() => toggle(r.key)}>{r.expanded ? "▾" : "▸"}</button>
                  : <span className="tree-toggle-space" />}
                <span className="tree-label" onClick={() => onFilterField(r.field, [r.value])}>{formatValue(r.value)}</span>
              </td>
              {cols.flatMap((c) => cells(r.cells.get(valueKey(c)), valueKey(c)))}
              {cells(r.values, "__t")}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {cols.flatMap((c) => cells(tree.colTotals.get(valueKey(c)), valueKey(c)))}
            {cells(tree.grandTotal, "__t")}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------- "Mostrar como tabela" ----------------

/** Os números por trás de qualquer gráfico: linhas (categoria × medidas) ou grade (linhas × colunas). */
export function AsTableView({ visual, rows, grid, measures }: {
  visual: Visual; rows: ResultRow[]; grid?: GridResult; measures: Measure[];
}) {
  if (grid && visual.legend) {
    const cols = grid.cols;
    return (
      <div className="table-visual">
        <table>
          <thead>
            <tr>
              <th>{visual.axis ? fieldLabel(visual.axis) : ""} \ {fieldLabel(visual.legend)}</th>
              {cols.map((c) => <th key={valueKey(c)} className="num">{formatValue(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={valueKey(r)}>
                <td>{formatValue(r)}</td>
                {cols.map((c) => (
                  <td key={valueKey(c)} className="num">
                    {formatMeasure(grid.cells.get(valueKey(r))?.get(valueKey(c))?.[0] ?? null, measures[0]?.format ?? "number")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-visual">
      <table>
        <thead>
          <tr>
            {visual.axis && <th>{fieldLabel(visual.axis)}</th>}
            {measures.map((m) => <th key={m.id} className="num">{m.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {visual.axis && <td>{formatValue(r.category)}</td>}
              {r.values.map((v, j) => <td key={j} className="num">{formatMeasure(v, measures[j]?.format ?? "number")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Dispersão animada (eixo de reprodução) ----------------

/**
 * Um quadro por valor do eixo de reprodução (ex.: mês); ▶ avança os quadros e
 * os pontos se movem. Os eixos ficam fixos no mínimo e máximo de todos os
 * quadros, para o movimento ser comparável.
 */
export function PlayScatterVisual({ visual, frames, measures, selected, onSelect }: {
  visual: Visual; frames: MultiplesResult; measures: Measure[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const [mx, my, mz] = measures;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const n = frames.panels.length;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((k) => {
      if (k >= n - 1) {
        setPlaying(false);
        return k;
      }
      return k + 1;
    }), 700);
    return () => clearInterval(t);
  }, [playing, n]);
  if (n === 0) return <div className="visual-msg">Sem quadros para os filtros atuais.</div>;
  const frame = frames.panels[Math.min(i, n - 1)];
  const all = frames.panels.flatMap((p) => p.rows);
  const ext = (k: number) => {
    const xs = all.map((r) => r.values[k]).filter((v): v is number => v !== null);
    return [Math.min(0, ...xs), Math.max(...xs) * 1.05] as [number, number];
  };
  const points = frame.rows
    .filter((r) => r.values[0] !== null && r.values[1] !== null)
    .map((r) => ({ x: r.values[0], y: r.values[1], z: mz ? r.values[2] ?? 0 : 1, category: r.category, label: formatValue(r.category) }));
  return (
    <div className="play-scatter">
      <div className="play-chart">
        <div className="play-watermark">{formatValue(frame.value)}</div>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name={mx.name} domain={ext(0)} tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => formatMeasure(v, mx.format, true)} />
            <YAxis type="number" dataKey="y" name={my.name} domain={ext(1)} tick={{ fontSize: 11 }} width={70}
              tickFormatter={(v: number) => formatMeasure(v, my.format, true)} />
            <ZAxis type="number" dataKey="z" range={mz ? [60, 600] : [90, 90]} domain={mz ? ext(2) : undefined} />
            <Tooltip content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
              if (!p) return null;
              return (
                <div className="tip">
                  <strong>{p.label}</strong>
                  <div>{mx.name}: {formatMeasure(p.x, mx.format)}</div>
                  <div>{my.name}: {formatMeasure(p.y, my.format)}</div>
                </div>
              );
            }} />
            <Scatter data={points} fill={palette[0]} cursor="pointer" animationDuration={600}
              onClick={(_d: unknown, k: number, e: React.MouseEvent) => onSelect(points[k].category, multi(e))}>
              {points.map((p) => (
                <Cell key={p.label} fill={palette[0]} fillOpacity={selected.size && !selected.has(valueKey(p.category)) ? 0.2 : 0.8} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="play-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => {
          if (i >= n - 1) setI(0);
          setPlaying(!playing);
        }}>{playing ? "⏸" : "▶"}</button>
        <input type="range" min={0} max={n - 1} value={Math.min(i, n - 1)} onChange={(e) => {
          setPlaying(false);
          setI(Number(e.target.value));
        }} />
        <span className="small muted">{fieldLabel(visual.playField!)}: {formatValue(frame.value)} ({i + 1}/{n})</span>
      </div>
    </div>
  );
}

// ---------------- Ranking ao longo do tempo (bump chart) ----------------

/** A posição de cada série em cada período (1 = maior), com linhas que se cruzam quando o ranking muda. */
export function BumpVisual({ visual, grid, measures, onFilterField, ownFilterKey }: {
  visual: Visual; grid: GridResult; measures: Measure[]; onFilterField: FilterField; ownFilterKey?: string;
}) {
  const palette = usePalette();
  const m = measures[0];
  const r = bumpRanks(grid);
  const data = r.periods.map((p, i) => {
    const d: Record<string, unknown> = { __label: formatValue(p) };
    for (const s of r.series) {
      d[formatValue(s)] = r.ranks.get(valueKey(s))![i];
      d[`__v_${formatValue(s)}`] = r.values.get(valueKey(s))![i];
    }
    return d;
  });
  const n = r.series.length;
  return (
    <div className="bump">
      <div className="bump-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={6} />
            <YAxis reversed domain={[1, n]} allowDecimals={false} tickCount={Math.min(n, 10)} width={34}
              tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}º`} />
            <Tooltip
              itemSorter={(item) => Number(item.value)}
              formatter={(v: number, name: string, item: { payload?: Record<string, unknown> }) =>
                `${v}º · ${formatMeasure((item.payload?.[`__v_${name}`] as number | null) ?? null, m.format, true)}`}
            />
            {r.series.map((s, i) => {
              const name = formatValue(s);
              const active = !ownFilterKey || ownFilterKey === `${valueKey(s)}@${visual.legend!.column}`;
              return (
                <Line key={name} dataKey={name} stroke={palette[i % palette.length]} strokeWidth={active ? 2.5 : 1}
                  strokeOpacity={active ? 1 : 0.25} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="bump-legend">
        {r.series.map((s, i) => (
          <button key={valueKey(s)} onClick={() => onFilterField(visual.legend!, ownFilterKey === `${valueKey(s)}@${visual.legend!.column}` ? [] : [s])}>
            <i style={{ background: palette[i % palette.length] }} />
            {r.ranks.get(valueKey(s))![r.periods.length - 1] ?? "–"}º {formatValue(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Haltere (dumbbell) ----------------

/** Antes × depois por categoria: dois pontos ligados por uma linha, com a variação. */
export function DumbbellVisual({ rows, measures, selected, onSelect }: {
  rows: ResultRow[]; measures: Measure[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const [a, b] = measures;
  const all = rows.flatMap((r) => [r.values[0], r.values[1]]).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, 1);
  const pos = (v: number | null) => `${(((v ?? 0) - lo) / (hi - lo || 1)) * 100}%`;
  const sorted = [...rows].sort((x, y) => (y.values[1] ?? 0) - (x.values[1] ?? 0));
  return (
    <div className="dumbbell">
      <div className="dumbbell-legend small">
        <span><i style={{ background: palette[1] }} />{a.name}</span>
        <span><i style={{ background: palette[0] }} />{b.name}</span>
      </div>
      {sorted.map((r) => {
        const va = r.values[0];
        const vb = r.values[1];
        const delta = va && vb !== null ? (vb - va) / Math.abs(va) : null;
        const dim = selected.size > 0 && !selected.has(valueKey(r.category));
        return (
          <button key={valueKey(r.category)} className={"dumbbell-row" + (dim ? " dim" : "")} onClick={(e) => onSelect(r.category, multi(e))}
            title={`${a.name}: ${formatMeasure(va, a.format)}\n${b.name}: ${formatMeasure(vb, b.format)}`}>
            <span className="dumbbell-label">{formatValue(r.category)}</span>
            <span className="dumbbell-track">
              <span className="dumbbell-line" style={{ left: pos(Math.min(va ?? 0, vb ?? 0)), right: `calc(100% - ${pos(Math.max(va ?? 0, vb ?? 0))})` }} />
              <span className="dumbbell-dot" style={{ left: pos(va), background: palette[1] }} />
              <span className="dumbbell-dot" style={{ left: pos(vb), background: palette[0] }} />
            </span>
            <span className={"dumbbell-delta " + (delta === null ? "" : delta >= 0 ? "good" : "bad")}>
              {delta === null ? "–" : `${delta >= 0 ? "+" : "−"}${formatMeasure(Math.abs(delta), "percent")}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- Sunburst ----------------

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z`;
}

/**
 * Anéis concêntricos: o de dentro é o 1º nível, cada anel seguinte divide o
 * pedaço do pai. O ângulo é proporcional à medida.
 */
export function SunburstVisual({ hier, measures, onFilterField, ownFilterKey }: {
  hier: { total: number; nodes: HierNode[] }; measures: Measure[]; onFilterField: FilterField; ownFilterKey?: string;
}) {
  const palette = usePalette();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const m = measures[0];
  const depth = (ns: HierNode[]): number => (ns.length ? 1 + Math.max(...ns.map((n) => depth(n.children))) : 0);
  const levels = Math.max(1, depth(hier.nodes));
  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const hole = size * 0.12;
  const ring = (size / 2 - hole - 4) / levels;
  const arcs: React.ReactNode[] = [];
  const draw = (nodes: HierNode[], level: number, a0: number, a1: number, color?: string) => {
    let a = a0;
    const sum = nodes.reduce((s, n) => s + n.measure, 0) || 1;
    nodes.forEach((n, i) => {
      const span = ((a1 - a0) * n.measure) / sum;
      const c = color ?? palette[i % palette.length];
      const key = `${valueKey(n.value)}@${n.field.column}`;
      const dim = ownFilterKey && ownFilterKey !== key;
      if (span > 0.002) {
        arcs.push(
          <path key={n.path.map(valueKey).join("/")} d={arcPath(cx, cy, hole + level * ring, hole + (level + 1) * ring - 1, a, a + span)}
            fill={c} fillOpacity={(dim ? 0.25 : 1) * (1 - level * 0.22)} className="sun-arc"
            onClick={() => onFilterField(n.field, ownFilterKey === key ? [] : [n.value])}>
            <title>{`${n.path.map(formatValue).join(" › ")}\n${m.name}: ${formatMeasure(n.measure, m.format)} (${formatMeasure(n.measure / (hier.total || 1), "percent")} do total)`}</title>
          </path>,
        );
        if (span > 0.25 && ring > 30) {
          const [tx, ty] = polar(cx, cy, hole + (level + 0.5) * ring, a + span / 2);
          arcs.push(<text key={`t${n.path.map(valueKey).join("/")}`} x={tx} y={ty} className="sun-label" textAnchor="middle" dominantBaseline="middle">{formatValue(n.value)}</text>);
        }
      }
      draw(n.children, level + 1, a, a + span, c);
      a += span;
    });
  };
  if (w > 0) draw(hier.nodes, 0, 0, 2 * Math.PI);
  return (
    <div className="sunburst" ref={ref}>
      {w > 0 && (
        <svg width={w} height={h}>
          {arcs}
          <text x={cx} y={cy - 6} textAnchor="middle" className="sun-center">{formatMeasure(hier.total, m.format, true)}</text>
          <text x={cx} y={cy + 10} textAnchor="middle" className="sun-center-label">{m.name}</text>
        </svg>
      )}
    </div>
  );
}

// ---------------- Waffle ----------------

/** 100 quadradinhos: cada categoria ocupa a sua parte do total (método do maior resto). */
export function WaffleVisual({ rows, measures, selected, onSelect }: {
  rows: ResultRow[]; measures: Measure[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const m = measures[0];
  const sorted = [...rows].filter((r) => (r.values[0] ?? 0) > 0).sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0));
  const counts = waffleCounts(sorted.map((r) => r.values[0] ?? 0));
  const cells = sorted.flatMap((_, i) => Array.from({ length: counts[i] }, () => i));
  return (
    <div className="waffle">
      <div className="waffle-grid">
        {cells.map((i, k) => {
          const dim = selected.size > 0 && !selected.has(valueKey(sorted[i].category));
          return <span key={k} style={{ background: palette[i % palette.length], opacity: dim ? 0.25 : 1 }} title={formatValue(sorted[i].category)} />;
        })}
      </div>
      <div className="waffle-legend">
        {sorted.map((r, i) => (
          <button key={valueKey(r.category)} onClick={(e) => onSelect(r.category, multi(e))}>
            <i style={{ background: palette[i % palette.length] }} />
            <strong>{counts[i]}</strong> de 100 · {formatValue(r.category)}
            <span className="muted"> ({formatMeasure(r.values[0], m.format, true)})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Pictograma ----------------

/** Ícones repetidos: cada ícone vale `unitValue`; o último é cortado na fração que sobra. */
export function PictogramVisual({ visual, rows, measures, selected, onSelect }: {
  visual: Visual; rows: ResultRow[]; measures: Measure[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const m = measures[0];
  const max = Math.max(...rows.map((r) => r.values[0] ?? 0), 0);
  const unit = visual.unitValue && visual.unitValue > 0 ? visual.unitValue : niceUnit(max);
  const icon = visual.icon || "●";
  return (
    <div className="pictogram">
      <div className="small muted">Cada {icon} = {formatMeasure(unit, m.format, true)}</div>
      {rows.map((r) => {
        const n = (r.values[0] ?? 0) / unit;
        const whole = Math.floor(n);
        const part = n - whole;
        const dim = selected.size > 0 && !selected.has(valueKey(r.category));
        return (
          <button key={valueKey(r.category)} className={"picto-row" + (dim ? " dim" : "")} onClick={(e) => onSelect(r.category, multi(e))}
            title={`${formatValue(r.category)}: ${formatMeasure(r.values[0], m.format)}`}>
            <span className="picto-label">{formatValue(r.category)}</span>
            <span className="picto-icons" style={{ color: palette[0] }}>
              {Array.from({ length: Math.min(whole, 60) }, (_, k) => <span key={k}>{icon}</span>)}
              {part > 0.05 && <span className="picto-part" style={{ width: `${part}em` }}>{icon}</span>}
            </span>
            <span className="picto-value">{formatMeasure(r.values[0], m.format, true)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- Violino ----------------

/** Forma da distribuição (densidade espelhada) por categoria, com mediana e quartis. */
export function ViolinVisual({ visual, dists, selected, onSelect }: {
  visual: Visual; dists: Distribution[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  if (dists.length === 0) {
    return <div className="boxplot" ref={ref}><div className="visual-msg">Sem valores numéricos para os filtros atuais.</div></div>;
  }
  const all = dists.flatMap((d) => d.values);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = { left: 56, right: 10, top: 8, bottom: 26 };
  const plotH = Math.max(10, h - pad.top - pad.bottom);
  const plotW = Math.max(10, w - pad.left - pad.right);
  const y = (v: number) => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const slot = plotW / dists.length;
  const shapes = dists.map((d) => ({ d, pts: kde(d.values, lo, hi, 60), stats: boxStats(d.values)! }));
  const maxD = Math.max(...shapes.flatMap((s) => s.pts.map((p) => p.d)));
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const num = (v: number) => formatMeasure(v, "number", true);
  return (
    <div className="boxplot" ref={ref}>
      {w > 0 && (
        <svg width={w} height={h}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} className="bp-grid" />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="bp-tick">{num(t)}</text>
            </g>
          ))}
          {shapes.map(({ d, pts, stats }, i) => {
            const cx = pad.left + slot * (i + 0.5);
            const half = slot * 0.42;
            const right = pts.map((p) => `${cx + (p.d / maxD) * half},${y(p.x)}`);
            const left = [...pts].reverse().map((p) => `${cx - (p.d / maxD) * half},${y(p.x)}`);
            const dim = selected.size > 0 && !selected.has(valueKey(d.category));
            return (
              <g key={valueKey(d.category)} opacity={dim ? 0.3 : 1} style={{ cursor: "pointer" }} onClick={(e) => onSelect(d.category, multi(e))}>
                <title>{`${fieldLabel(visual.axis!)}: ${formatValue(d.category)}\nn = ${stats.n}\nmediana ${num(stats.median)} · quartis ${num(stats.q1)}–${num(stats.q3)}`}</title>
                <polygon points={[...right, ...left].join(" ")} fill={palette[i % palette.length]} fillOpacity={0.35} stroke={palette[i % palette.length]} />
                <line x1={cx} x2={cx} y1={y(stats.q3)} y2={y(stats.q1)} stroke="var(--text)" strokeWidth={4} />
                <circle cx={cx} cy={y(stats.median)} r={3} fill="#fff" stroke="var(--text)" />
                <text x={cx} y={h - 8} textAnchor="middle" className="bp-tick">{formatValue(d.category)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
