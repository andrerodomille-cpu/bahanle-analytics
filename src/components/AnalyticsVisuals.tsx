import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CrossFilter, FieldRef, Measure, Value, ValueRange, Visual } from "../model/types";
import { fieldKey, fieldLabel, sameField } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey } from "../engine/query";
import { boxStats, histogram, type BoxRow, type DecompResult, type InfluencerResult } from "../engine/analytics";

/** Resultado das análises, calculado no canvas e só desenhado aqui. */
export type Analysis =
  | { kind: "histogram"; values: number[] }
  | { kind: "boxplot"; rows: BoxRow[] }
  | { kind: "influencers"; result: InfluencerResult }
  | { kind: "decomp"; result: DecompResult };

interface Common {
  visual: Visual;
  measures: Measure[];
  ownFilter?: CrossFilter;
  onSelect: (category: Value, multi: boolean) => void;
  onFilterField: (field: FieldRef, values: Value[]) => void;
  onSetRange: (range: ValueRange | null) => void;
  onUpdate: (patch: Partial<Visual>) => void;
}

const num = (v: number) => formatMeasure(v, "number", true);
const multi = (e: React.MouseEvent) => e.ctrlKey || e.shiftKey || e.metaKey;

/** Tamanho do contêiner, para desenhar SVG sem distorcer textos. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ---------------- Histograma ----------------

export function HistogramVisual({ visual, values, ownFilter, onSetRange }: Common & { values: number[] }) {
  const palette = usePalette();
  if (values.length === 0) return <div className="visual-msg">Sem valores numéricos para os filtros atuais.</div>;
  const bins = histogram(values, visual.bins);
  const field = visual.valueField!;
  const stats = boxStats(values)!;
  // Uma faixa está "selecionada" se o filtro deste visual cai dentro dela.
  // A faixa clicada vira um filtro por intervalo [x0, x1) — a última inclui o máximo.
  const range = ownFilter && sameField(ownFilter.field, field) ? ownFilter.range : undefined;
  const isBin = (i: number) => range !== undefined && Math.abs(Number(range.min) - bins[i].x0) < 1e-9 &&
    Math.abs(Number(range.max) - bins[i].x1) < 1e-9;
  const selected = range ? [0] : [];
  const data = bins.map((b, i) => ({ ...b, label: `${num(b.x0)}–${num(b.x1)}`, active: isBin(i) }));

  const pick = (i: number) =>
    onSetRange(isBin(i) ? null : { min: bins[i].x0, max: bins[i].x1, maxOpen: i < bins.length - 1 });

  return (
    <div className="analysis">
      <div className="analysis-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="4%" margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={{ fontSize: 11 }} width={44} allowDecimals={false} />
            <Tooltip
              formatter={(v: number) => [`${v.toLocaleString("pt-BR")} linhas`, "Quantidade"]}
              labelFormatter={(l: string) => `${fieldLabel(field)}: ${l}`}
            />
            <Bar dataKey="count" cursor="pointer" onClick={(_d: unknown, i: number) => pick(i)}>
              {data.map((d, i) => <Cell key={i} fill={palette[0]} fillOpacity={selected.length && !d.active ? 0.3 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="analysis-foot">
        n = {stats.n.toLocaleString("pt-BR")} · média {num(stats.mean)} · mediana {num(stats.median)} ·
        quartis {num(stats.q1)}–{num(stats.q3)}
      </div>
    </div>
  );
}

// ---------------- Box plot ----------------

export function BoxplotVisual({ visual, rows, ownFilter, onSelect }: Common & { rows: BoxRow[] }) {
  const palette = usePalette();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  if (rows.length === 0) {
    return <div className="boxplot" ref={ref}><div className="visual-msg">Sem valores numéricos para os filtros atuais.</div></div>;
  }

  const all = rows.flatMap((r) => [r.stats.low, r.stats.high, ...r.stats.outliers]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = { left: 56, right: 10, top: 8, bottom: 26 };
  const plotH = Math.max(10, h - pad.top - pad.bottom);
  const plotW = Math.max(10, w - pad.left - pad.right);
  const y = (v: number) => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const slot = plotW / rows.length;
  const boxW = Math.min(46, slot * 0.55);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const selected = new Set((ownFilter?.values ?? []).map(valueKey));

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
          {rows.map((r, i) => {
            const s = r.stats;
            const cx = pad.left + slot * (i + 0.5);
            const dim = selected.size > 0 && !selected.has(valueKey(r.category));
            const tip = [
              `${fieldLabel(visual.axis!)}: ${formatValue(r.category)}`,
              `n = ${s.n.toLocaleString("pt-BR")}`,
              `máx. (bigode) ${num(s.high)}`, `Q3 ${num(s.q3)}`, `mediana ${num(s.median)}`,
              `Q1 ${num(s.q1)}`, `mín. (bigode) ${num(s.low)}`, `média ${num(s.mean)}`,
              `${s.outliers.length} outliers`,
            ].join("\n");
            return (
              <g key={valueKey(r.category)} opacity={dim ? 0.3 : 1} style={{ cursor: "pointer" }}
                onClick={(e) => onSelect(r.category, multi(e))}>
                <title>{tip}</title>
                <line x1={cx} x2={cx} y1={y(s.high)} y2={y(s.low)} className="bp-whisker" />
                <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(s.high)} y2={y(s.high)} className="bp-whisker" />
                <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(s.low)} y2={y(s.low)} className="bp-whisker" />
                <rect x={cx - boxW / 2} width={boxW} y={y(s.q3)} height={Math.max(1, y(s.q1) - y(s.q3))}
                  fill={palette[0]} fillOpacity={0.35} stroke={palette[0]} />
                <line x1={cx - boxW / 2} x2={cx + boxW / 2} y1={y(s.median)} y2={y(s.median)} stroke={palette[0]} strokeWidth={2.5} />
                <path d={`M ${cx} ${y(s.mean) - 4} l 4 4 l -4 4 l -4 -4 z`} className="bp-mean" />
                {s.outliers.map((o, k) => <circle key={k} cx={cx} cy={y(o)} r={2.5} className="bp-outlier" />)}
                <text x={cx} y={h - 8} textAnchor="middle" className="bp-tick">
                  {truncate(formatValue(r.category), Math.max(4, Math.floor(slot / 7)))}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------- Principais influenciadores ----------------

export function InfluencersVisual({ visual, measures, result, ownFilter, onFilterField, onUpdate }: Common & { result: InfluencerResult }) {
  const palette = usePalette();
  const m = measures[0];
  const dir = visual.influenceDir ?? "up";
  const list = dir === "up" ? result.up : result.down;
  if (!visual.explainBy?.length) return <div className="visual-msg">Escolha as dimensões em "Explicar por" no painel à direita.</div>;
  const maxRatio = Math.max(...list.map((i) => (dir === "up" ? i.ratio : 1 / i.ratio)), 1);

  return (
    <div className="influencers">
      <div className="infl-head">
        <span>O que faz <strong>{m.name}</strong></span>
        <button className={dir === "up" ? "on" : ""} onClick={() => onUpdate({ influenceDir: "up" })}>aumentar ▲</button>
        <button className={dir === "down" ? "on" : ""} onClick={() => onUpdate({ influenceDir: "down" })}>diminuir ▼</button>
      </div>
      <div className="infl-list">
        {list.length === 0 && <div className="muted small">Nenhum segmento com amostra suficiente muda a medida nessa direção.</div>}
        {list.map((i) => {
          const active = ownFilter && sameField(ownFilter.field, i.field) && ownFilter.values.some((v) => valueKey(v) === valueKey(i.value));
          const factor = dir === "up" ? i.ratio : 1 / i.ratio;
          return (
            <button
              key={`${fieldKey(i.field)}=${valueKey(i.value)}`}
              className={"infl-item" + (active ? " active" : "")}
              title="Clique para filtrar a página por este segmento"
              onClick={() => onFilterField(i.field, active ? [] : [i.value])}
            >
              <div className="infl-text">
                Quando <strong>{fieldLabel(i.field)}</strong> é <strong>{formatValue(i.value)}</strong>
              </div>
              <div className="infl-bar">
                <span style={{ width: `${(factor / maxRatio) * 100}%`, background: dir === "up" ? palette[0] : palette[2] }} />
              </div>
              <div className="infl-detail">
                <strong>{i.ratio >= 1 ? "+" : "−"}{formatMeasure(Math.abs(i.ratio - 1), "percent")}</strong> ·{" "}
                {formatMeasure(i.segment, m.format)} vs. {formatMeasure(i.overall, m.format)} no total ·{" "}
                {i.rows.toLocaleString("pt-BR")} linhas
              </div>
            </button>
          );
        })}
      </div>
      <div className="analysis-foot">
        Compara a medida em cada segmento com o total. Segmentos com menos de {result.minRows.toLocaleString("pt-BR")} linhas
        ficam de fora. Mostra associação, não causa.
      </div>
    </div>
  );
}

// ---------------- Árvore de decomposição ----------------

export function DecompVisual({ visual, measures, result, onUpdate }: Common & { result: DecompResult }) {
  const palette = usePalette();
  const m = measures[0];
  const levels = visual.decomp ?? [];
  const set = (decomp: Visual["decomp"]) => onUpdate({ decomp });
  const canAdd = (levels.length === 0 || levels[levels.length - 1].value !== undefined) && result.available.length > 0;

  const choose = (i: number, value: Value) => {
    const current = levels[i];
    if (current.value !== undefined && valueKey(current.value) === valueKey(value)) {
      set([...levels.slice(0, i), { field: current.field }]); // desmarcar
      return;
    }
    const next = levels[i + 1] ? [{ field: levels[i + 1].field }] : [];
    set([...levels.slice(0, i), { field: current.field, value }, ...next]);
  };

  const picker = (
    <select
      className="decomp-add"
      value=""
      onChange={(e) => {
        const f = result.available.find((x) => fieldKey(x) === e.target.value);
        if (f) set([...levels, { field: f }]);
      }}
    >
      <option value="">+ Detalhar por…</option>
      {result.available.map((f) => <option key={fieldKey(f)} value={fieldKey(f)}>{fieldLabel(f)}</option>)}
    </select>
  );

  if (!visual.explainBy?.length) return <div className="visual-msg">Escolha as dimensões em "Explicar por" no painel à direita.</div>;

  return (
    <div className="decomp">
      <div className="decomp-col root">
        <div className="decomp-head">{m.name}</div>
        <div className="decomp-node selected">
          <span className="decomp-label">Total</span>
          <span className="decomp-value">{formatMeasure(result.total, m.format, true)}</span>
          <span className="decomp-bar"><span style={{ width: "100%", background: palette[0] }} /></span>
        </div>
        {levels.length === 0 && picker}
      </div>
      {result.levels.map((level, i) => {
        const max = Math.max(...level.nodes.map((n) => Math.abs(n.measure ?? 0)), 1);
        return (
          <div key={i} className="decomp-col">
            <div className="decomp-head">
              <span>{fieldLabel(level.field)}</span>
              <button className="link" title="Remover este nível" onClick={() => set(levels.slice(0, i))}>✕</button>
            </div>
            <div className="decomp-nodes">
              {level.nodes.map((n) => {
                const sel = level.selected !== undefined && valueKey(level.selected) === valueKey(n.value);
                return (
                  <button key={valueKey(n.value)} className={"decomp-node" + (sel ? " selected" : "")} onClick={() => choose(i, n.value)}>
                    <span className="decomp-label">{formatValue(n.value)}</span>
                    <span className="decomp-value">{formatMeasure(n.measure, m.format, true)}</span>
                    <span className="decomp-bar">
                      <span style={{ width: `${(Math.abs(n.measure ?? 0) / max) * 100}%`, background: palette[sel ? 0 : 1] }} />
                    </span>
                  </button>
                );
              })}
            </div>
            {i === result.levels.length - 1 && level.selected !== undefined && canAdd && picker}
          </div>
        );
      })}
      {levels.length > 0 && result.levels.length === 0 && picker}
    </div>
  );
}
