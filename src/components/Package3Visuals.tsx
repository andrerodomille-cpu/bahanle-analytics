import { useEffect, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Measure, Value, ValueRange, Visual } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey, type ResultRow } from "../engine/query";
import { paretoRows } from "../engine/analytics";
import { formatDateBR, isIsoDate } from "../model/dates";

const multi = (e?: React.MouseEvent) => !!e && (e.ctrlKey || e.shiftKey || e.metaKey);

// ---------------- Segmentação "entre" (intervalo) ----------------

export interface RangeDomain {
  min: Value;
  max: Value;
  isDate: boolean;
}

const DAY = 86400000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

/**
 * Dois controles deslizantes sobre o mesmo trilho, mais campos para digitar.
 * Datas viram "número do dia" para o controle e voltam a ISO no filtro.
 */
export function RangeSlicer({ domain, current, onChange }: {
  domain: RangeDomain;
  current?: ValueRange;
  onChange: (range: ValueRange | null) => void;
}) {
  const toNum = (v: Value) => (domain.isDate ? toDay(String(v)) : Number(v));
  const fromNum = (n: number): Value => (domain.isDate ? fromDay(n) : n);
  const lo = toNum(domain.min);
  const hi = toNum(domain.max);
  const step = domain.isDate ? 1 : niceStep(hi - lo);
  const [a, setA] = useState(current?.min !== undefined && current.min !== null ? toNum(current.min) : lo);
  const [b, setB] = useState(current?.max !== undefined && current.max !== null ? toNum(current.max) : hi);

  // Filtro limpo de fora (ex.: "Limpar todos") → volta ao domínio inteiro.
  useEffect(() => {
    setA(current?.min !== undefined && current.min !== null ? toNum(current.min) : lo);
    setB(current?.max !== undefined && current.max !== null ? toNum(current.max) : hi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.min, current?.max, lo, hi]);

  const commit = (x: number, y: number) => {
    const [mn, mx] = x <= y ? [x, y] : [y, x];
    // O intervalo inteiro equivale a "sem filtro".
    if (mn <= lo && mx >= hi) onChange(null);
    else onChange({ min: mn <= lo ? undefined : fromNum(mn), max: mx >= hi ? undefined : fromNum(mx) });
  };
  const show = (n: number) => (domain.isDate ? formatDateBR(fromDay(n)) : formatMeasure(n, "number"));
  const pct = (n: number) => ((n - lo) / (hi - lo || 1)) * 100;

  return (
    <div className="range-slicer">
      <div className="range-inputs">
        <input
          type={domain.isDate ? "date" : "number"}
          value={domain.isDate ? fromDay(a) : a}
          min={domain.isDate ? fromDay(lo) : lo}
          max={domain.isDate ? fromDay(hi) : hi}
          onChange={(e) => {
            const n = domain.isDate ? (isIsoDate(e.target.value) ? toDay(e.target.value) : a) : Number(e.target.value);
            if (Number.isFinite(n)) setA(n);
          }}
          onBlur={() => commit(a, b)}
          onKeyDown={(e) => e.key === "Enter" && commit(a, b)}
        />
        <span className="muted">até</span>
        <input
          type={domain.isDate ? "date" : "number"}
          value={domain.isDate ? fromDay(b) : b}
          min={domain.isDate ? fromDay(lo) : lo}
          max={domain.isDate ? fromDay(hi) : hi}
          onChange={(e) => {
            const n = domain.isDate ? (isIsoDate(e.target.value) ? toDay(e.target.value) : b) : Number(e.target.value);
            if (Number.isFinite(n)) setB(n);
          }}
          onBlur={() => commit(a, b)}
          onKeyDown={(e) => e.key === "Enter" && commit(a, b)}
        />
      </div>
      <div className="range-track" onPointerDown={(e) => e.stopPropagation()}>
        <div className="range-fill" style={{ left: `${pct(Math.min(a, b))}%`, right: `${100 - pct(Math.max(a, b))}%` }} />
        <input type="range" min={lo} max={hi} step={step} value={a}
          onChange={(e) => setA(Number(e.target.value))} onPointerUp={() => commit(a, b)} onKeyUp={() => commit(a, b)} />
        <input type="range" min={lo} max={hi} step={step} value={b}
          onChange={(e) => setB(Number(e.target.value))} onPointerUp={() => commit(a, b)} onKeyUp={() => commit(a, b)} />
      </div>
      <div className="range-ends small muted">
        <span>{show(lo)}</span>
        <span>{show(hi)}</span>
      </div>
    </div>
  );
}

/** Passo "redondo" para o controle de números (1, 2, 5, 10, 20…). */
function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const raw = span / 200;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * pow;
}

// ---------------- Segmentação em lista suspensa ----------------

export function DropdownSlicer({ items, selected, onSetValues }: {
  items: Value[];
  selected: Set<string>;
  onSetValues: (values: Value[]) => void;
}) {
  const current = items.find((v) => selected.has(valueKey(v)));
  return (
    <select
      className="dropdown-slicer"
      value={current === undefined ? "" : valueKey(current)}
      onChange={(e) => {
        const v = items.find((x) => valueKey(x) === e.target.value);
        onSetValues(v === undefined ? [] : [v]);
      }}
    >
      <option value="">Todos</option>
      {items.map((v) => <option key={valueKey(v)} value={valueKey(v)}>{formatValue(v)}</option>)}
    </select>
  );
}

// ---------------- Pareto ----------------

/** Colunas do maior para o menor + linha de % acumulado e a referência de 80%. */
export function ParetoVisual({ rows, measures, selected, onSelect }: {
  rows: ResultRow[];
  measures: Measure[];
  selected: Set<string>;
  onSelect: (category: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const m = measures[0];
  const data = paretoRows(rows).map((r) => ({ ...r, label: formatValue(r.category), pct: r.cumulative * 100 }));
  if (data.length === 0) return <div className="visual-msg">Sem valores positivos para os filtros atuais.</div>;
  // Quantos itens fazem 80% do total — a frase clássica do Pareto.
  const k = data.findIndex((d) => d.cumulative >= 0.8) + 1;
  const dim = (c: Value) => selected.size > 0 && !selected.has(valueKey(c));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 4, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
            // Muitos itens: rótulos inclinados para não se sobreporem.
            {...(data.length > 5
              ? { angle: -35, textAnchor: "end", height: 58, tick: { fontSize: 10 } }
              : { tick: { fontSize: 11 } })}
          />
          <YAxis yAxisId="v" tick={{ fontSize: 11 }} width={70} tickFormatter={(v: number) => formatMeasure(v, m.format, true)} />
          <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} width={40} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip formatter={(v: number, key: string) => (key === "pct" ? `${v.toFixed(1)}%` : formatMeasure(v, m.format))} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(key: string) => (key === "pct" ? "% acumulado" : m.name)} />
          <Bar yAxisId="v" dataKey="value" fill={palette[0]} cursor="pointer"
            onClick={(_d: unknown, i: number, e: React.MouseEvent) => onSelect(data[i].category, multi(e))}>
            {data.map((d) => <Cell key={valueKey(d.category)} fillOpacity={dim(d.category) ? 0.3 : 1} />)}
          </Bar>
          <Line yAxisId="p" dataKey="pct" stroke={palette[2]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          <ReferenceLine yAxisId="p" y={80} stroke="#e66c37" strokeDasharray="6 4"
            label={{ value: "80%", position: "insideTopRight", fontSize: 10, fill: "#e66c37" }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="chart-note">
        {k} de {data.length} ({Math.round((100 * k) / data.length)}%) fazem 80% do total
      </div>
    </div>
  );
}

export type { Visual };
