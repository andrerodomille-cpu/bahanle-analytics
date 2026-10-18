import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Measure, Value, Visual } from "../model/types";
import type { ResultRow, VisualResult } from "../engine/query";
import { valueKey } from "../engine/query";
import { formatMeasure, formatValue } from "../model/format";

export const PALETTE = ["#118dff", "#12239e", "#e66c37", "#6b007b", "#e044a7", "#744ec2", "#d9b300", "#d64550"];

interface Props {
  visual: Visual;
  result: VisualResult;
  totals: (number | null)[];
  measures: Measure[];
  /** Chaves selecionadas por este visual (filtro que ele originou). */
  selected: Set<string>;
  onSelect: (category: Value, multi: boolean) => void;
  onSetValues: (values: Value[]) => void;
}

export function VisualView({ visual, result, totals, measures, selected, onSelect, onSetValues }: Props) {
  if (result.error) return <div className="visual-msg error">{result.error}</div>;
  const needsAxis = visual.type !== "card";
  if (needsAxis && !visual.axis) return <div className="visual-msg">Escolha um campo de eixo no painel à direita.</div>;
  if (visual.type !== "slicer" && measures.length === 0)
    return <div className="visual-msg">Adicione ao menos uma medida.</div>;

  const dim = (cat: Value) => selected.size > 0 && !selected.has(valueKey(cat));

  switch (visual.type) {
    case "card": {
      const m = measures[0];
      return (
        <div className="card-visual">
          <div className="card-value">{formatMeasure(result.rows[0]?.values[0] ?? null, m.format)}</div>
          <div className="card-label">{m.name}</div>
        </div>
      );
    }

    case "slicer": {
      const items = [...result.rows].sort((a, b) => compareValues(a.category, b.category));
      const toggle = (cat: Value) => {
        const current = items.filter((r) => selected.has(valueKey(r.category))).map((r) => r.category);
        const on = selected.has(valueKey(cat));
        onSetValues(on ? current.filter((c) => valueKey(c) !== valueKey(cat)) : [...current, cat]);
      };
      return (
        <div className="slicer">
          {items.map((r) => (
            <label key={valueKey(r.category)}>
              <input type="checkbox" checked={selected.has(valueKey(r.category))} onChange={() => toggle(r.category)} />
              {formatValue(r.category)}
            </label>
          ))}
          {selected.size > 0 && (
            <button className="link" onClick={() => onSetValues([])}>
              Limpar seleção
            </button>
          )}
        </div>
      );
    }

    case "table": {
      const rows = sortByFirstMeasure(result.rows);
      return (
        <div className="table-visual">
          <table>
            <thead>
              <tr>
                <th>{visual.axis!.column}</th>
                {measures.map((m) => (
                  <th key={m.id} className="num">{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={valueKey(r.category)}
                  className={dim(r.category) ? "dim" : selected.has(valueKey(r.category)) ? "sel" : ""}
                  onClick={(e) => onSelect(r.category, e.ctrlKey || e.shiftKey || e.metaKey)}
                >
                  <td>{formatValue(r.category)}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className="num">{formatMeasure(v, measures[i].format)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {totals.map((v, i) => (
                  <td key={i} className="num">{formatMeasure(v, measures[i].format)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    case "bar":
    case "line": {
      const rows = visual.type === "bar"
        ? sortByFirstMeasure(result.rows)
        : [...result.rows].sort((a, b) => compareValues(a.category, b.category));
      const data = toChartData(rows, measures);
      const click = (state: { activeLabel?: string } | null, e: React.MouseEvent) => {
        if (!state || state.activeLabel === undefined) return;
        const row = rows.find((r) => formatValue(r.category) === state.activeLabel);
        if (row) onSelect(row.category, e.ctrlKey || e.shiftKey || e.metaKey);
      };
      const axisProps = {
        tick: { fontSize: 11 },
        tickFormatter: (v: number) => formatMeasure(v, measures[0].format, true),
        width: 70,
      };
      const tooltip = (
        <Tooltip formatter={(v: number, name: string) => {
          const m = measures.find((x) => x.name === name);
          return formatMeasure(v, m?.format ?? "number");
        }} />
      );
      return (
        <ResponsiveContainer width="100%" height="100%">
          {visual.type === "bar" ? (
            <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval={0} />
              <YAxis {...axisProps} />
              {tooltip}
              {measures.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {measures.map((m, i) => (
                <Bar
                  key={m.id}
                  dataKey={m.name}
                  fill={PALETTE[i % PALETTE.length]}
                  cursor="pointer"
                  onClick={(_d: unknown, index: number, e: React.MouseEvent) =>
                    onSelect(rows[index].category, e.ctrlKey || e.shiftKey || e.metaKey)}
                >
                  {rows.map((r) => (
                    <Cell key={valueKey(r.category)} fillOpacity={dim(r.category) ? 0.3 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} onClick={click as never} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="__label" tick={{ fontSize: 11 }} />
              <YAxis {...axisProps} />
              {tooltip}
              {measures.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {measures.map((m, i) => (
                <Line key={m.id} dataKey={m.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      );
    }

    case "pie": {
      const m = measures[0];
      const rows = sortByFirstMeasure(result.rows).filter((r) => (r.values[0] ?? 0) > 0);
      const data = rows.map((r) => ({ name: formatValue(r.category), value: r.values[0], category: r.category }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius="80%"
              cursor="pointer"
              onClick={(entry: { category: Value }, _i: number, e: React.MouseEvent) =>
                onSelect(entry.category, e.ctrlKey || e.shiftKey || e.metaKey)}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} fillOpacity={dim(d.category) ? 0.3 : 1} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => formatMeasure(v, m.format)} />
          </PieChart>
        </ResponsiveContainer>
      );
    }
  }
}

function toChartData(rows: ResultRow[], measures: Measure[]) {
  return rows.map((r) => {
    const d: Record<string, string | number | null> = { __label: formatValue(r.category) };
    measures.forEach((m, i) => (d[m.name] = r.values[i]));
    return d;
  });
}

const sortByFirstMeasure = (rows: ResultRow[]) =>
  [...rows].sort((a, b) => (b.values[0] ?? -Infinity) - (a.values[0] ?? -Infinity));

function compareValues(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true });
}
