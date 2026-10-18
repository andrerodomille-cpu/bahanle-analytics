import {
  Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis, Legend, type TooltipProps,
} from "recharts";
import type { Measure, Value, Visual } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey, type GridResult, type ResultRow } from "../engine/query";
import type { CalendarResult, Detail, GanttTask, MultiplesResult } from "../engine/lab";
import { colorScaleStyle, rangeOf } from "./MoreVisuals";
import { useSize } from "./AnalyticsVisuals";
import { formatDateBR, todayIso } from "../model/dates";

const multi = (e?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => !!e && !!(e.ctrlKey || e.shiftKey || e.metaKey);
type Select = (category: Value, multi: boolean) => void;

// ---------------- Gráfico de marcador (bullet) ----------------

/**
 * Para cada linha: faixas ruim/ok/bom (frações da meta), a barra do realizado
 * e o traço da meta. A meta vem da 2ª medida ou do valor fixo do visual.
 */
export function BulletVisual({ visual, rows, measures, selected, onSelect }: {
  visual: Visual; rows: { category: Value; values: (number | null)[] }[]; measures: Measure[];
  selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const [m, targetM] = measures;
  const [poor, ok] = visual.bands ?? [0.6, 0.9];
  return (
    <div className="bullet">
      {rows.map((r) => {
        const value = r.values[0];
        const target = targetM ? r.values[1] : visual.target ?? null;
        const scale = Math.max((target ?? 0) * 1.15, (value ?? 0) * 1.05, 1);
        const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
        const ratio = value !== null && target ? value / target : null;
        const dim = selected.size > 0 && r.category !== null && !selected.has(valueKey(r.category));
        return (
          <button key={valueKey(r.category)} className={"bullet-row" + (dim ? " dim" : "")}
            onClick={(e) => r.category !== null && onSelect(r.category, multi(e))}
            title={`${m.name}: ${formatMeasure(value, m.format)}${target !== null ? `\nMeta: ${formatMeasure(target, m.format)}` : ""}`}>
            <span className="bullet-label">{r.category === null ? m.name : formatValue(r.category)}</span>
            <span className="bullet-track">
              {target !== null && (
                <>
                  <span className="bullet-band b3" style={{ width: "100%" }} />
                  <span className="bullet-band b2" style={{ width: pct(target * ok) }} />
                  <span className="bullet-band b1" style={{ width: pct(target * poor) }} />
                </>
              )}
              <span className="bullet-bar" style={{ width: pct(value ?? 0), background: palette[0] }} />
              {target !== null && <span className="bullet-target" style={{ left: pct(target) }} />}
            </span>
            <span className="bullet-value">
              {formatMeasure(value, m.format, true)}
              {ratio !== null && <span className={ratio >= 1 ? "good" : ratio >= ok ? "warn" : "bad"}> {formatMeasure(ratio, "percent")}</span>}
            </span>
          </button>
        );
      })}
      {!targetM && visual.target === undefined && <div className="small muted">Defina a meta (2ª medida ou valor fixo) para ver as faixas.</div>}
    </div>
  );
}

// ---------------- Radar ----------------

export function RadarVisual({ visual, rows, measures, onSelect }: {
  visual: Visual; rows: ResultRow[]; measures: Measure[]; onSelect: Select;
}) {
  const palette = usePalette();
  // Medidas em escalas diferentes (R$ x pedidos) só se comparam normalizadas.
  const normalize = visual.normalize ?? measures.length > 1;
  const max = measures.map((_, i) => Math.max(...rows.map((r) => Math.abs(r.values[i] ?? 0)), 1e-9));
  const data = rows.map((r) => {
    const d: Record<string, unknown> = { __label: formatValue(r.category), __category: r.category };
    measures.forEach((m, i) => {
      d[m.name] = normalize ? ((r.values[i] ?? 0) / max[i]) * 100 : r.values[i];
      d[`__raw${i}`] = r.values[i];
    });
    return d;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%"
        onClick={(s: { activeTooltipIndex?: number } | null, e: React.MouseEvent) => {
          const i = s?.activeTooltipIndex;
          if (i !== undefined && rows[i]) onSelect(rows[i].category, multi(e));
        }}>
        <PolarGrid />
        <PolarAngleAxis dataKey="__label" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis tick={{ fontSize: 9 }} tickFormatter={(v: number) => (normalize ? `${Math.round(v)}%` : formatMeasure(v, measures[0].format, true))} />
        <Tooltip
          formatter={(_v: number, name: string, item: { payload?: Record<string, unknown> }) => {
            const i = measures.findIndex((m) => m.name === name);
            const raw = item.payload?.[`__raw${i}`] as number | null;
            return formatMeasure(raw ?? null, measures[i]?.format ?? "number");
          }}
        />
        {measures.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {measures.map((m, i) => (
          <Radar key={m.id} dataKey={m.name} stroke={palette[i % palette.length]} fill={palette[i % palette.length]} fillOpacity={0.2} />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ---------------- Pequenos múltiplos ----------------

/** Uma miniatura por valor, todas com a mesma escala — a comparação vem do formato. */
export function MultiplesVisual({ visual, result, measures, selected, onSelect }: {
  visual: Visual; result: MultiplesResult; measures: Measure[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  const m = measures[0];
  if (result.panels.length === 0) return <div className="visual-msg">Sem dados para os filtros atuais.</div>;
  const cols = Math.ceil(Math.sqrt(result.panels.length));
  const ordered = (rows: ResultRow[]) =>
    visual.type === "bar" ? rows : [...rows].sort((a, b) => formatValue(a.category).localeCompare(formatValue(b.category), "pt-BR", { numeric: true }));
  return (
    <div className="multiples" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {result.panels.map((p) => {
        const rows = ordered(p.rows);
        const data = rows.map((r) => ({ __label: formatValue(r.category), v: r.values[0], c: r.category }));
        const total = rows.reduce((a, r) => a + (r.values[0] ?? 0), 0);
        const common = { data, margin: { top: 2, right: 2, bottom: 0, left: 2 } };
        const axes = (
          <>
            <XAxis dataKey="__label" hide />
            <YAxis hide domain={[0, result.max]} />
            <Tooltip formatter={(v: number) => formatMeasure(v, m.format)} />
          </>
        );
        return (
          <div key={valueKey(p.value)} className="multiple">
            <div className="multiple-title">
              <span>{formatValue(p.value)}</span>
              <span className="muted">{formatMeasure(total, m.format, true)}</span>
            </div>
            <div className="multiple-chart">
              <ResponsiveContainer width="100%" height="100%">
                {visual.type === "line" ? (
                  <LineChart {...common}>{axes}<Line dataKey="v" name={m.name} stroke={palette[0]} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart>
                ) : visual.type === "area" ? (
                  <AreaChart {...common}>{axes}<Area dataKey="v" name={m.name} stroke={palette[0]} fill={palette[0]} fillOpacity={0.25} isAnimationActive={false} /></AreaChart>
                ) : (
                  <BarChart {...common}>
                    {axes}
                    <Bar dataKey="v" name={m.name} isAnimationActive={false} cursor="pointer"
                      onClick={(_d: unknown, i: number, e: React.MouseEvent) => onSelect(rows[i].category, multi(e))}>
                      {data.map((d) => (
                        <Cell key={valueKey(d.c)} fill={palette[0]} fillOpacity={selected.size && !selected.has(valueKey(d.c)) ? 0.3 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Calendário de calor ----------------

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Um quadrado por dia (colunas = semanas, linhas = dias da semana), como o calendário de contribuições. */
export function CalendarVisual({ result, measures, selected, onSelect, onUpdate }: {
  visual: Visual; result: CalendarResult; measures: Measure[]; selected: Set<string>; onSelect: Select;
  onUpdate: (p: Partial<Visual>) => void;
}) {
  const palette = usePalette();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const m = measures[0];
  const { year, years, days } = result;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const offset = jan1.getUTCDay();
  const total = (Date.UTC(year + 1, 0, 1) - jan1.getTime()) / 86400000;
  const weeks = Math.ceil((total + offset) / 7);
  const left = 28;
  const top = 16;
  const cell = Math.max(4, Math.min((w - left - 4) / weeks, (h - top - 4) / 7));
  const { min, max } = rangeOf([...days.values()]);
  const idx = years.indexOf(year);
  const cells = Array.from({ length: total }, (_, i) => {
    const d = new Date(jan1.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    return { iso, week: Math.floor((i + offset) / 7), dow: d.getUTCDay(), month: d.getUTCMonth(), date: d.getUTCDate() };
  });
  return (
    <div className="calendar">
      <div className="calendar-head">
        <button disabled={idx <= 0} onClick={() => onUpdate({ calendarYear: years[idx - 1] })}>‹</button>
        <strong>{year}</strong>
        <button disabled={idx < 0 || idx >= years.length - 1} onClick={() => onUpdate({ calendarYear: years[idx + 1] })}>›</button>
        <span className="muted small">{m.name}: {formatMeasure(min, m.format, true)} a {formatMeasure(max, m.format, true)}</span>
      </div>
      <div className="calendar-body" ref={ref}>
        {w > 0 && (
          <svg width={w} height={h}>
            {cells.filter((c) => c.date === 1).map((c) => (
              <text key={c.month} x={left + c.week * cell} y={10} className="cal-label">{MONTHS[c.month]}</text>
            ))}
            {[1, 3, 5].map((d) => (
              <text key={d} x={0} y={top + d * cell + cell * 0.75} className="cal-label">{WEEKDAYS[d]}</text>
            ))}
            {cells.map((c) => {
              const v = days.get(c.iso) ?? null;
              const style = colorScaleStyle(v, min, max, palette[0], 0.12);
              const dim = selected.size > 0 && !selected.has(valueKey(c.iso));
              return (
                <rect
                  key={c.iso}
                  x={left + c.week * cell}
                  y={top + c.dow * cell}
                  width={cell - 1.5}
                  height={cell - 1.5}
                  rx={1.5}
                  className={v === null ? "cal-day empty" : "cal-day"}
                  style={{ fill: style?.background as string | undefined, opacity: dim ? 0.3 : 1 }}
                  onClick={(e) => v !== null && onSelect(c.iso, multi(e))}
                >
                  <title>{`${WEEKDAYS[c.dow]}, ${formatDateBR(c.iso)}: ${formatMeasure(v, m.format)}`}</title>
                </rect>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

// ---------------- Parâmetro "e se" ----------------

export function WhatIfVisual({ visual, onUpdate }: { visual: Visual; onUpdate: (p: Partial<Visual>) => void }) {
  const w = visual.whatif;
  if (!w?.name) return <div className="visual-msg">Dê um nome ao parâmetro no painel à direita.</div>;
  const set = (value: number) => onUpdate({ whatif: { ...w, value: Math.min(w.max, Math.max(w.min, value)) } });
  return (
    <div className="whatif" onPointerDown={(e) => e.stopPropagation()}>
      <div className="whatif-value">{formatMeasure(w.value, w.format)}</div>
      <input type="range" min={w.min} max={w.max} step={w.step} value={w.value} onChange={(e) => set(Number(e.target.value))} />
      <div className="whatif-ends small muted">
        <span>{formatMeasure(w.min, w.format)}</span>
        <span>use <code>[{w.name}]</code> nas medidas</span>
        <span>{formatMeasure(w.max, w.format)}</span>
      </div>
    </div>
  );
}

// ---------------- Sankey ----------------

/** Fluxo da medida de cada valor do eixo (origem) para cada valor da legenda (destino). */
export function SankeyVisual({ grid, measures, onSelect }: {
  visual: Visual; grid: GridResult; measures: Measure[]; onSelect: Select;
}) {
  const palette = usePalette();
  const m = measures[0];
  const sources = grid.rows;
  const targets = grid.cols;
  const nodes = [...sources.map((s) => ({ name: formatValue(s) })), ...targets.map((t) => ({ name: formatValue(t) }))];
  const links = sources.flatMap((s, i) =>
    targets.map((t, j) => ({ source: i, target: sources.length + j, value: grid.cells.get(valueKey(s))?.get(valueKey(t))?.[0] ?? 0 }))
      .filter((l) => l.value > 0));
  if (links.length === 0) return <div className="visual-msg">Sem fluxo positivo para os filtros atuais.</div>;

  const Node = (p: { x: number; y: number; width: number; height: number; index: number; payload: { name: string } }) => {
    const isSource = p.index < sources.length;
    return (
      <g style={{ cursor: isSource ? "pointer" : "default" }} onClick={(e) => isSource && onSelect(sources[p.index], multi(e))}>
        <rect x={p.x} y={p.y} width={p.width} height={Math.max(1, p.height)} fill={palette[p.index % palette.length]} />
        <text x={isSource ? p.x - 6 : p.x + p.width + 6} y={p.y + p.height / 2} textAnchor={isSource ? "end" : "start"}
          dominantBaseline="middle" className="sankey-label">
          {p.payload.name}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Sankey
        data={{ nodes, links }}
        node={Node as never}
        nodePadding={14}
        nodeWidth={12}
        margin={{ top: 8, right: 110, bottom: 8, left: 110 }}
        link={{ stroke: palette[0], strokeOpacity: 0.25 }}
        iterations={32}
      >
        <Tooltip formatter={(v: number) => formatMeasure(v, m.format)} />
      </Sankey>
    </ResponsiveContainer>
  );
}

// ---------------- Gantt ----------------

const DAY = 86400000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function GanttVisual({ visual, tasks, selected, onSelect }: {
  visual: Visual; tasks: GanttTask[]; selected: Set<string>; onSelect: Select;
}) {
  const palette = usePalette();
  if (!visual.startField || !visual.endField) return <div className="visual-msg">Escolha as colunas de início e fim no painel à direita.</div>;
  if (tasks.length === 0) return <div className="visual-msg">Sem tarefas para os filtros atuais.</div>;
  const start = Math.min(...tasks.map((k) => t(k.start)));
  const end = Math.max(...tasks.map((k) => t(k.end))) + DAY;
  const span = end - start;
  const pos = (ms: number) => `${((ms - start) / span) * 100}%`;
  const groups = [...new Set(tasks.map((k) => formatValue(k.group)))];
  const color = (g: Value) => palette[groups.indexOf(formatValue(g)) % palette.length];
  // Marcas no 1º dia de cada mês.
  const ticks: number[] = [];
  const d = new Date(start);
  for (let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime(); m < end; ) {
    ticks.push(m);
    const x = new Date(m);
    m = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1);
  }
  const today = t(todayIso());
  return (
    <div className="gantt">
      <div className="gantt-row gantt-head">
        <span className="gantt-label" />
        <span className="gantt-track">
          {ticks.map((m) => (
            <span key={m} className="gantt-tick" style={{ left: pos(m) }}>
              {MONTHS[new Date(m).getUTCMonth()]}{new Date(m).getUTCMonth() === 0 ? ` ${new Date(m).getUTCFullYear()}` : ""}
            </span>
          ))}
        </span>
      </div>
      <div className="gantt-rows">
        {tasks.map((k) => {
          const dim = selected.size > 0 && !selected.has(valueKey(k.task));
          const days = Math.round((t(k.end) - t(k.start)) / DAY) + 1;
          return (
            <button key={valueKey(k.task)} className={"gantt-row" + (dim ? " dim" : "")} onClick={(e) => onSelect(k.task, multi(e))}
              title={`${formatValue(k.task)}\n${formatDateBR(k.start)} a ${formatDateBR(k.end)} (${days} dias)` +
                (k.progress !== null ? `\nConcluído: ${formatMeasure(k.progress, "percent")}` : "") +
                (k.group !== null ? `\n${formatValue(k.group)}` : "")}>
              <span className="gantt-label">{formatValue(k.task)}</span>
              <span className="gantt-track">
                {ticks.map((m) => <span key={m} className="gantt-grid" style={{ left: pos(m) }} />)}
                <span className="gantt-bar" style={{ left: pos(t(k.start)), width: `${((t(k.end) + DAY - t(k.start)) / span) * 100}%`, background: color(k.group) }}>
                  {k.progress !== null && <span className="gantt-progress" style={{ width: `${Math.min(1, Math.max(0, k.progress)) * 100}%` }} />}
                </span>
                {today >= start && today <= end && <span className="gantt-today" style={{ left: pos(today) }} />}
              </span>
            </button>
          );
        })}
      </div>
      {visual.legend && (
        <div className="gantt-legend small">
          {groups.map((g) => <span key={g}><i style={{ background: color(g) }} />{g}</span>)}
          {today >= start && today <= end && <span><i className="today" />hoje</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- Dica de ferramenta com detalhes ----------------

/** Conteúdo do Tooltip do Recharts: valor principal, medidas extras e minigráfico do item. */
export function detailTooltip(details: Map<string, Detail>, main: Measure[], extras: Measure[]) {
  return function DetailTooltip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const first = (payload[0].payload ?? {}) as Record<string, unknown>;
    const key = String(first.__label ?? first.name ?? label ?? "");
    const d = details.get(key);
    const values = d?.trend.map((p) => p.value ?? 0) ?? [];
    const lo = Math.min(...values, 0);
    const hi = Math.max(...values, 1e-9);
    const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 160},${36 - ((v - lo) / (hi - lo || 1)) * 32}`).join(" ");
    return (
      <div className="tip detail-tip">
        <strong>{key}</strong>
        {payload.filter((p) => !String(p.name).startsWith("__")).map((p) => {
          const m = main.find((x) => x.name === p.name) ?? main[0];
          const name = String(p.name ?? m?.name ?? "");
          return <div key={name}>{name}: <b>{formatMeasure(typeof p.value === "number" ? p.value : null, m?.format ?? "number")}</b></div>;
        })}
        {d && extras.map((m, i) => <div key={m.id}>{m.name}: <b>{formatMeasure(d.extra[i], m.format)}</b></div>)}
        {d && values.length > 1 && (
          <div className="detail-trend">
            <svg width={160} height={40}><polyline points={pts} fill="none" stroke="#118dff" strokeWidth={2} /></svg>
            <div className="small muted">{d.trend[0].label} → {d.trend[d.trend.length - 1].label}</div>
          </div>
        )}
      </div>
    );
  };
}
