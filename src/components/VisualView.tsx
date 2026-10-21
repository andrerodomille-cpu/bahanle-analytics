import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ButtonAction, CrossFilter, FieldRef, Measure, RefLine, RelativeDate, Value, ValueRange, Visual } from "../model/types";
import { fieldLabel } from "../model/types";
import { usePalette } from "../model/theme";
import type { GridResult, ResultRow, VisualResult } from "../engine/query";
import { valueKey } from "../engine/query";
import { formatMeasure, formatValue } from "../model/format";
import { detectAnomalies, linearForecast, movingForecast, nextLabels, referenceValue } from "../engine/analytics";
import { DropdownSlicer, ParetoVisual, RangeSlicer, type RangeDomain } from "./Package3Visuals";
import { FieldParamVisual, FunnelVisual, MultiCardVisual, RelativeDateSlicer, RuledValue } from "./Package4Visuals";
import {
  BulletVisual, CalendarVisual, GanttVisual, MultiplesVisual, RadarVisual, SankeyVisual, WhatIfVisual, detailTooltip,
} from "./LabVisuals";
import type { CalendarResult, Detail, GanttTask, MultiplesResult } from "../engine/lab";
import type { Distribution, HierNode, TreeResult } from "../engine/extra";
import {
  AsTableView, BumpVisual, DumbbellVisual, PictogramVisual, PlayScatterVisual, SunburstVisual, TreeMatrixVisual, ViolinVisual,
  WaffleVisual,
} from "./ExtraVisuals";
import { BoxplotVisual, DecompVisual, HistogramVisual, InfluencersVisual, type Analysis } from "./AnalyticsVisuals";
import { BubbleMapVisual, ChoroplethVisual, ImageVisual } from "./GeoVisuals";
import type { BubbleResult, ChoroplethResult } from "../engine/geo";
import {
  ButtonVisual, ComboVisual, HeatmapVisual, KpiVisual, TextVisual, WaterfallVisual, colorScaleStyle, rangeOf,
} from "./MoreVisuals";


/** Quantas medidas cada visual usa e o que cada uma significa. */
export const MEASURE_SLOTS: Partial<Record<Visual["type"], string[]>> = {
  card: ["Valor"],
  gauge: ["Valor"],
  pie: ["Valores"],
  treemap: ["Valores"],
  stacked: ["Valores"],
  scatter: ["Eixo X", "Eixo Y", "Tamanho (opcional)"],
  slicer: [],
  kpi: ["Valor", "Comparar com (opcional)"],
  combo: ["Colunas", "Linha (eixo direito)"],
  waterfall: ["Valor atual", "Valor base (opcional)"],
  heatmap: ["Valores"],
  text: [],
  button: [],
  histogram: [],
  boxplot: [],
  influencers: ["Analisar"],
  decomp: ["Analisar"],
  map: ["Cor"],
  pareto: ["Valores"],
  funnel: ["Valores"],
  fieldparam: [],
  bullet: ["Valor", "Meta (opcional)"],
  calendar: ["Valores"],
  whatif: [],
  sankey: ["Valores"],
  gantt: [],
  stacked100: ["Valores"],
  area100: ["Valores"],
  bump: ["Valores"],
  dumbbell: ["Antes", "Depois"],
  sunburst: ["Valores"],
  waffle: ["Valores"],
  pictogram: ["Valores"],
  violin: [],
  narrative: ["Medida", "Comparar com (opcional)"],
  bubblemap: ["Tamanho", "Cor (opcional)"],
  image: [],
};

/** Visuais que não usam eixo (ou em que ele é opcional). */
export const NO_AXIS: Visual["type"][] = [
  "card", "gauge", "kpi", "text", "button", "image", "histogram", "influencers", "decomp", "narrative", "fieldparam",
  "bullet", "whatif",
];

/** Visuais que não usam medida. */
const NO_MEASURE: Visual["type"][] = [
  "slicer", "histogram", "boxplot", "text", "button", "image", "fieldparam", "whatif", "gantt", "violin",
];

/** Visuais que usam o campo de legenda / colunas. */
export const USES_LEGEND: Visual["type"][] = ["stacked", "matrix", "heatmap", "sankey", "stacked100", "area100", "bump"];

interface Props {
  visual: Visual;
  result: VisualResult;
  grid?: GridResult;
  totals: (number | null)[];
  measures: Measure[];
  /** Chaves selecionadas por este visual (filtro que ele originou). */
  selected: Set<string>;
  onSelect: (category: Value, multi: boolean) => void;
  onSetValues: (values: Value[]) => void;
  onUpdate: (patch: Partial<Visual>) => void;
  /** Ação de botão (ir para página / aplicar indicador). */
  onAction: (a: ButtonAction) => void;
  /** Texto da caixa de texto com as medidas já substituídas. */
  text?: string;
  /** Resultado das análises (histograma, box plot, influenciadores, decomposição). */
  analysis?: Analysis;
  /** Resultado dos mapas. */
  geo?: { kind: "map"; result: ChoroplethResult } | { kind: "bubblemap"; result: BubbleResult };
  /** Filtro cruzado que este visual criou (campo + valores). */
  ownFilter?: CrossFilter;
  /** Filtra a página por um campo qualquer (influenciadores, faixa do histograma). */
  onFilterField: (field: FieldRef, values: Value[]) => void;
  /** Segmentação "entre": mínimo e máximo do campo, e como aplicar o intervalo. */
  rangeDomain?: RangeDomain;
  onSetRange: (range: ValueRange | null) => void;
  /** Segmentação de data relativa: guarda a escolha e aplica o intervalo. */
  onSetRelative: (spec: RelativeDate | undefined, range: ValueRange | null) => void;
  /** Resultados dos visuais do laboratório. */
  lab?: { kind: "multiples"; result: MultiplesResult } | { kind: "calendar"; result: CalendarResult } | { kind: "gantt"; tasks: GanttTask[] };
  /** Dica de ferramenta com detalhes: por rótulo da categoria. */
  details?: Map<string, Detail>;
  detailExtras?: Measure[];
  /** Tabela: minigráfico por rótulo da categoria. */
  sparks?: Map<string, (number | null)[]>;
  /** Resultados do último pacote: árvore da matriz, hierarquia, distribuições, quadros da animação. */
  extra?:
    | { kind: "tree"; tree: TreeResult }
    | { kind: "hier"; hier: { total: number; nodes: HierNode[] } }
    | { kind: "dists"; dists: Distribution[] }
    | { kind: "play"; frames: MultiplesResult };
  onExpandAll?: () => void;
}

const isMulti = (e?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) =>
  !!e && !!(e.ctrlKey || e.shiftKey || e.metaKey);

export function VisualView(props: Props) {
  const { visual, result, grid, measures } = props;
  const error = result.error ?? grid?.error;
  if (error) return <div className="visual-msg error">{error}</div>;
  if (visual.type === "text") {
    return <TextVisual text={props.text ?? visual.text ?? ""} align={visual.textAlign} size={visual.textSize} />;
  }
  if (visual.type === "image") return <ImageVisual visual={visual} />;
  if (visual.type === "fieldparam") return <FieldParamVisual visual={visual} onUpdate={props.onUpdate} />;
  if (visual.type === "whatif") return <WhatIfVisual visual={visual} onUpdate={props.onUpdate} />;
  if (visual.type === "narrative" && measures.length > 0) {
    return <TextVisual text={props.text ?? ""} align={visual.textAlign} size={visual.textSize ?? "s"} />;
  }
  if (visual.type === "button") return <ButtonVisual visual={visual} onAction={props.onAction} />;
  if (!NO_AXIS.includes(visual.type) && !visual.axis)
    return <div className="visual-msg">Escolha o campo de eixo no painel à direita.</div>;
  if (USES_LEGEND.includes(visual.type) && !visual.legend && !(visual.type === "matrix" && visual.expandable))
    return <div className="visual-msg">Escolha o campo de {visual.type === "stacked" ? "legenda" : "colunas"}.</div>;
  if ((visual.type === "histogram" || visual.type === "boxplot" || visual.type === "violin") && !visual.valueField)
    return <div className="visual-msg">Escolha a coluna numérica em "Valores" no painel à direita.</div>;
  if (!NO_MEASURE.includes(visual.type) && measures.length === 0)
    return <div className="visual-msg">Adicione ao menos uma medida.</div>;
  if (visual.type === "scatter" && measures.length < 2)
    return <div className="visual-msg">A dispersão precisa de duas medidas: X e Y.</div>;
  if (visual.type === "dumbbell" && measures.length < 2)
    return <div className="visual-msg">O haltere precisa de duas medidas: antes e depois.</div>;
  if (visual.asTable) return <AsTableView visual={visual} rows={result.rows} grid={grid} measures={measures} />;
  if (visual.type === "sankey" && !visual.legend)
    return <div className="visual-msg">Escolha o campo de destino no painel à direita.</div>;
  if (result.rows.length === 0 && !NO_AXIS.includes(visual.type) && visual.type !== "boxplot")
    return <div className="visual-msg">Sem dados para os filtros atuais.</div>;

  const a = props.analysis;
  const ex = props.extra;
  // Chave "valor@coluna" do filtro de valor único deste visual (para destacar o item escolhido).
  const own = props.ownFilter;
  const ownFilterKey = own && !own.range && own.values.length === 1 ? `${valueKey(own.values[0])}@${own.field.column}` : undefined;
  const common = {
    visual, measures, ownFilter: props.ownFilter, onSelect: props.onSelect,
    onFilterField: props.onFilterField, onSetRange: props.onSetRange, onUpdate: props.onUpdate,
  };
  switch (visual.type) {
    case "histogram":
      return a?.kind === "histogram" ? <HistogramVisual {...common} values={a.values} /> : null;
    case "boxplot":
      return a?.kind === "boxplot" ? <BoxplotVisual {...common} rows={a.rows} /> : null;
    case "influencers":
      return a?.kind === "influencers" ? <InfluencersVisual {...common} result={a.result} /> : null;
    case "decomp":
      return a?.kind === "decomp" ? <DecompVisual {...common} result={a.result} /> : null;
    case "multicard":
      return (
        <MultiCardVisual visual={visual} rows={orderRows(visual, result.rows)} measures={measures}
          selected={props.selected} onSelect={props.onSelect} />
      );
    case "funnel":
      return <FunnelVisual rows={orderRows(visual, result.rows)} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "pareto":
      return <ParetoVisual rows={result.rows} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "map":
      return props.geo?.kind === "map"
        ? <ChoroplethVisual visual={visual} measures={measures} result={props.geo.result} selected={props.selected} onSelect={props.onSelect} />
        : null;
    case "bubblemap":
      return props.geo?.kind === "bubblemap"
        ? <BubbleMapVisual visual={visual} measures={measures} result={props.geo.result} selected={props.selected} onSelect={props.onSelect} />
        : null;
    case "kpi":
      return <KpiVisual visual={visual} result={result} totals={props.totals} measures={measures} />;
    case "combo":
      return <ComboVisual rows={orderRows(visual, result.rows)} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "waterfall":
      return (
        <WaterfallVisual rows={orderRows(visual, result.rows)} totals={props.totals} measures={measures}
          selected={props.selected} onSelect={props.onSelect} />
      );
    case "heatmap":
      return grid ? <HeatmapVisual visual={visual} grid={grid} measures={measures} selected={props.selected} onSelect={props.onSelect} /> : null;
    case "card":
      return <CardVisual {...props} />;
    case "gauge":
      return <GaugeVisual {...props} />;
    case "slicer":
      return <SlicerVisual {...props} />;
    case "table":
      return <TableVisual {...props} />;
    case "matrix":
      if (visual.expandable && ex?.kind === "tree") {
        return (
          <TreeMatrixVisual visual={visual} tree={ex.tree} measures={measures} ownFilterKey={ownFilterKey}
            onFilterField={props.onFilterField} onUpdate={props.onUpdate} onExpandAll={props.onExpandAll ?? (() => {})} />
        );
      }
      return <MatrixVisual {...props} />;
    case "stacked100":
    case "area100":
      return <StackedVisual {...props} />;
    case "bump":
      return grid
        ? <BumpVisual visual={visual} grid={grid} measures={measures} onFilterField={props.onFilterField} ownFilterKey={ownFilterKey} />
        : null;
    case "dumbbell":
      return <DumbbellVisual rows={result.rows} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "sunburst":
      return ex?.kind === "hier"
        ? <SunburstVisual hier={ex.hier} measures={measures} onFilterField={props.onFilterField} ownFilterKey={ownFilterKey} />
        : null;
    case "waffle":
      return <WaffleVisual rows={result.rows} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "pictogram":
      return <PictogramVisual visual={visual} rows={orderRows(visual, result.rows)} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
    case "violin":
      return ex?.kind === "dists" ? <ViolinVisual visual={visual} dists={ex.dists} selected={props.selected} onSelect={props.onSelect} /> : null;
    case "bar":
    case "hbar":
    case "line":
    case "area":
      if (visual.multiples && props.lab?.kind === "multiples") {
        return <MultiplesVisual visual={visual} result={props.lab.result} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
      }
      return <CartesianVisual {...props} />;
    case "bullet":
      return (
        <BulletVisual
          visual={visual}
          rows={visual.axis ? orderRows(visual, result.rows) : [{ category: null, values: props.totals }]}
          measures={measures}
          selected={props.selected}
          onSelect={props.onSelect}
        />
      );
    case "radar":
      return <RadarVisual visual={visual} rows={orderRows({ ...visual, sort: visual.sort ?? { by: "category", desc: false } }, result.rows)} measures={measures} onSelect={props.onSelect} />;
    case "calendar":
      return props.lab?.kind === "calendar"
        ? <CalendarVisual visual={visual} result={props.lab.result} measures={measures} selected={props.selected} onSelect={props.onSelect} onUpdate={props.onUpdate} />
        : null;
    case "sankey":
      return grid ? <SankeyVisual visual={visual} grid={grid} measures={measures} onSelect={props.onSelect} /> : null;
    case "gantt":
      return props.lab?.kind === "gantt"
        ? <GanttVisual visual={visual} tasks={props.lab.tasks} selected={props.selected} onSelect={props.onSelect} />
        : null;
    case "stacked":
      return <StackedVisual {...props} />;
    case "scatter":
      if (visual.playField && ex?.kind === "play") {
        return <PlayScatterVisual visual={visual} frames={ex.frames} measures={measures} selected={props.selected} onSelect={props.onSelect} />;
      }
      return <ScatterVisual {...props} />;
    case "pie":
      return <PieVisual {...props} />;
    case "treemap":
      return <TreemapVisual {...props} />;
  }
}

// ---------------- Cartão e medidor ----------------

function CardVisual({ visual, result, measures }: Props) {
  const m = measures[0];
  return (
    <div className="card-visual">
      <div className="card-value">
        <RuledValue rules={visual.rules} measure={0} value={result.rows[0]?.values[0] ?? null}
          text={formatMeasure(result.rows[0]?.values[0] ?? null, m.format)} />
      </div>
      <div className="card-label">{m.name}</div>
    </div>
  );
}

function GaugeVisual({ visual, result, measures }: Props) {
  const PALETTE = usePalette();
  const m = measures[0];
  const value = result.rows[0]?.values[0] ?? null;
  const target = visual.target ?? null;
  const max = Math.max(value ?? 0, target ?? 0) * 1.2 || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, v / max));
  // Semicírculo de 180° a 0°; raio 80, centro (100, 100).
  const point = (f: number, r = 80) => {
    const a = Math.PI * (1 - f);
    return [100 + r * Math.cos(a), 100 - r * Math.sin(a)];
  };
  const arc = (f: number) => {
    const [x, y] = point(f);
    return `M 20 100 A 80 80 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const reached = value !== null && target !== null && value >= target;
  return (
    <div className="gauge-visual">
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">
        <path d={arc(1)} stroke="#e1dfdd" strokeWidth="18" fill="none" />
        {value !== null && value > 0 && (
          <path d={arc(frac(value))} stroke={reached ? "#107c10" : PALETTE[0]} strokeWidth="18" fill="none" />
        )}
        {target !== null && (() => {
          const [x1, y1] = point(frac(target), 68);
          const [x2, y2] = point(frac(target), 92);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#252423" strokeWidth="3" />;
        })()}
        <text x="100" y="92" textAnchor="middle" className="gauge-value">
          {formatMeasure(value, m.format, true)}
        </text>
        <text x="20" y="116" textAnchor="middle" className="gauge-axis">0</text>
        <text x="180" y="116" textAnchor="middle" className="gauge-axis">{formatMeasure(max, m.format, true)}</text>
      </svg>
      <div className="card-label">
        {target === null
          ? "Defina a meta no painel à direita"
          : `Meta: ${formatMeasure(target, m.format)} (${value === null ? "—" : Math.round((value / target) * 100) + "%"})`}
      </div>
    </div>
  );
}

// ---------------- Segmentação ----------------

function SlicerVisual({ visual, result, selected, onSetValues, rangeDomain, ownFilter, onSetRange, onSetRelative }: Props) {
  if (visual.slicerStyle === "relative") {
    const maxDate = rangeDomain?.isDate ? String(rangeDomain.max) : null;
    // A escolha salva só vale se o filtro dela estiver ativo (filtros cruzados
    // são limpos ao publicar ou reabrir o relatório).
    const shown = ownFilter?.range ? visual : { ...visual, relative: undefined };
    return <RelativeDateSlicer visual={shown} maxDate={maxDate} onChange={onSetRelative} />;
  }
  if (visual.slicerStyle === "between") {
    return rangeDomain
      ? <RangeSlicer domain={rangeDomain} current={ownFilter?.range} onChange={onSetRange} />
      : <div className="visual-msg">O estilo "Entre" precisa de um campo numérico ou de data.</div>;
  }
  const items = [...result.rows].sort((a, b) => compareValues(a.category, b.category));
  if (visual.slicerStyle === "dropdown") {
    return <DropdownSlicer items={items.map((r) => r.category)} selected={selected} onSetValues={onSetValues} />;
  }
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
        <button className="link" onClick={() => onSetValues([])}>Limpar seleção</button>
      )}
    </div>
  );
}

// ---------------- Tabela e matriz ----------------

function rowClass(selected: Set<string>, cat: Value) {
  if (selected.size === 0) return "";
  return selected.has(valueKey(cat)) ? "sel" : "dim";
}

/** Formatação condicional "barras de dados": fundo proporcional ao maior valor da coluna. */
function dataBar(v: number | null, max: number): React.CSSProperties | undefined {
  if (v === null || max <= 0 || v <= 0) return undefined;
  const pct = Math.min(100, (v / max) * 100);
  return { background: `linear-gradient(90deg, var(--databar) ${pct}%, transparent ${pct}%)` };
}

const maxOf = (values: (number | null)[]) => Math.max(0, ...values.map((v) => v ?? 0));

function SortHeader({ label, by, visual, onUpdate, className }: {
  label: string; by: "category" | number; visual: Visual; onUpdate: Props["onUpdate"]; className?: string;
}) {
  const active = visual.sort?.by === by;
  const arrow = active ? (visual.sort!.desc ? " ▼" : " ▲") : "";
  return (
    <th
      className={(className ?? "") + " sortable"}
      title="Clique para ordenar"
      onClick={() => onUpdate({ sort: { by, desc: active ? !visual.sort!.desc : by !== "category" } })}
    >
      {label}{arrow}
    </th>
  );
}

/** Minigráfico de uma linha da tabela (tendência da 1ª medida). */
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const ys = values.map((v) => v ?? 0);
  if (ys.length < 2) return null;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const w = 90;
  const h = 20;
  const pts = ys.map((y, i) => `${((i / (ys.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}

function TableVisual({ visual, result, totals, measures, selected, onSelect, onUpdate, sparks }: Props) {
  const PALETTE = usePalette();
  const rows = orderRows(visual, result.rows);
  const max = measures.map((_, i) => maxOf(rows.map((r) => r.values[i])));
  const range = measures.map((_, i) => rangeOf(rows.map((r) => r.values[i])));
  const cellStyle = (v: number | null, i: number) =>
    visual.colorScale ? colorScaleStyle(v, range[i].min, range[i].max, PALETTE[i % PALETTE.length])
      : visual.dataBars ? dataBar(v, max[i]) : undefined;
  return (
    <div className="table-visual">
      <table>
        <thead>
          <tr>
            <SortHeader label={fieldLabel(visual.axis!)} by="category" visual={visual} onUpdate={onUpdate} />
            {measures.map((m, i) => (
              <SortHeader key={m.id} label={m.name} by={i} visual={visual} onUpdate={onUpdate} className="num" />
            ))}
            {sparks && <th>Tendência ({fieldLabel(visual.sparkline!)})</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={valueKey(r.category)} className={rowClass(selected, r.category)} onClick={(e) => onSelect(r.category, isMulti(e))}>
              <td>{formatValue(r.category)}</td>
              {r.values.map((v, i) => (
                <td key={i} className="num" style={cellStyle(v, i)}>
                  <RuledValue rules={visual.rules} measure={i} value={v} text={formatMeasure(v, measures[i].format)} />
                </td>
              ))}
              {sparks && <td><Sparkline values={sparks.get(formatValue(r.category)) ?? []} color={PALETTE[0]} /></td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {totals.map((v, i) => <td key={i} className="num">{formatMeasure(v, measures[i].format)}</td>)}
            {sparks && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MatrixVisual({ visual, grid, measures, selected, onSelect }: Props) {
  if (!grid) return null;
  const cols = [...grid.cols].sort(compareValues);
  // Linhas ordenadas como numa tabela, usando os totais da linha.
  const rows = orderRows(
    visual,
    grid.rows.map((r) => ({ category: r, values: grid.rowTotals.get(valueKey(r)) ?? [] })),
  ).map((r) => r.category);
  const multi = measures.length > 1;
  // Barras de dados comparam as células (sem os totais), medida a medida.
  const PALETTE = usePalette();
  const cellValues = (i: number) =>
    rows.flatMap((r) => cols.map((c) => grid.cells.get(valueKey(r))?.get(valueKey(c))?.[i] ?? null));
  const max = measures.map((_, i) => maxOf(cellValues(i)));
  const range = measures.map((_, i) => rangeOf(cellValues(i)));
  const cellStyle = (v: number | null, i: number) =>
    visual.colorScale ? colorScaleStyle(v, range[i].min, range[i].max, PALETTE[i % PALETTE.length])
      : visual.dataBars ? dataBar(v, max[i]) : undefined;
  const cells = (col: string, vals: (number | null)[] | undefined, formatted = false) =>
    measures.map((m, i) => (
      <td key={`${col}-${m.id}`} className="num" style={formatted ? cellStyle(vals?.[i] ?? null, i) : undefined}>
        <RuledValue rules={visual.rules} measure={i} value={vals?.[i] ?? null} text={formatMeasure(vals?.[i] ?? null, m.format)} />
      </td>
    ));

  return (
    <div className="table-visual">
      <table className="matrix">
        <thead>
          <tr>
            <th rowSpan={multi ? 2 : 1}>{fieldLabel(visual.axis!)} \ {fieldLabel(visual.legend!)}</th>
            {cols.map((c) => <th key={valueKey(c)} colSpan={measures.length} className="num">{formatValue(c)}</th>)}
            <th colSpan={measures.length} className="num total-col">Total</th>
          </tr>
          {multi && (
            <tr>
              {[...cols, "__total"].flatMap((c) =>
                measures.map((m) => <th key={`${valueKey(c as Value)}-${m.id}`} className="num sub">{m.name}</th>))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = valueKey(r);
            return (
              <tr key={k} className={rowClass(selected, r)} onClick={(e) => onSelect(r, isMulti(e))}>
                <td>{formatValue(r)}</td>
                {cols.flatMap((c) => cells(valueKey(c), grid.cells.get(k)?.get(valueKey(c)), true))}
                {cells("__total", grid.rowTotals.get(k))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {cols.flatMap((c) => cells(valueKey(c), grid.colTotals.get(valueKey(c))))}
            {cells("__total", grid.grandTotal)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------- Gráficos cartesianos ----------------

function CartesianVisual({ visual, result, measures, selected, onSelect, details, detailExtras }: Props) {
  const PALETTE = usePalette();
  const rows = orderRows(visual, result.rows);
  const data: Record<string, unknown>[] = toChartData(rows, measures);
  const dim = (cat: Value) => selected.size > 0 && !selected.has(valueKey(cat));
  const fmt = (v: number) => formatMeasure(v, measures[0].format, true);
  const valueAxis = { tick: { fontSize: 11 }, tickFormatter: fmt };
  const margin = { top: 5, right: 12, bottom: 5, left: 0 };
  // Linha/área: o clique vem do gráfico (ponto mais próximo do cursor).
  const chartClick = (state: { activeTooltipIndex?: number } | null, e: React.MouseEvent) => {
    const i = state?.activeTooltipIndex;
    if (i !== undefined && rows[i]) onSelect(rows[i].category, isMulti(e));
  };
  const legend = (measures.length > 1 || visual.forecast) && <Legend wrapperStyle={{ fontSize: 11 }} />;
  const tooltip = details ? <Tooltip content={detailTooltip(details, measures, detailExtras ?? [])} /> : (
    <Tooltip
      formatter={(v: number | number[], name: string) => {
        const m = measures.find((x) => x.name === name) ?? measures[0];
        return Array.isArray(v)
          ? `${formatMeasure(v[0], m.format)} – ${formatMeasure(v[1], m.format)}`
          : formatMeasure(v, m.format);
      }}
    />
  );
  // Linhas de referência sobre os valores da 1ª medida mostrados no visual.
  const horizontal = visual.type === "hbar";
  const refs = (visual.refLines ?? []).map((line) => ({ line, value: referenceValue(line, rows.map((r) => r.values[0])) }))
    .filter((r): r is { line: RefLine; value: number } => r.value !== null)
    .map(({ line, value }) => (
      <ReferenceLine
        key={line.id}
        {...(horizontal ? { x: value } : { y: value })}
        stroke="#e66c37"
        strokeDasharray="6 4"
        strokeWidth={1.5}
        ifOverflow="extendDomain"
        label={{ value: `${line.label || REF_LABEL[line.kind]}: ${fmt(value)}`, position: horizontal ? "insideTopRight" : "insideTopLeft", fontSize: 10, fill: "#e66c37" }}
      />
    ));

  if (visual.type === "bar" || visual.type === "hbar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...valueAxis} />
              <YAxis type="category" dataKey="__label" width={110} tick={{ fontSize: 11 }} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval={rows.length > 8 ? "preserveStartEnd" : 0} minTickGap={4} />
              <YAxis {...valueAxis} width={70} />
            </>
          )}
          {tooltip}
          {legend}
          {measures.map((m, i) => (
            <Bar
              key={m.id}
              dataKey={m.name}
              fill={PALETTE[i % PALETTE.length]}
              cursor="pointer"
              onClick={(_d: unknown, index: number, e: React.MouseEvent) => onSelect(rows[index].category, isMulti(e))}
            >
              {rows.map((r) => <Cell key={valueKey(r.category)} fillOpacity={dim(r.category) ? 0.3 : 1} />)}
            </Bar>
          ))}
          {refs}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Previsão: continua a série da 1ª medida, com a faixa de confiança.
  const fc = visual.forecast;
  const series = rows.map((r) => r.values[0]);
  const canForecast = !!fc && series.length >= 4 && series.every((v) => v !== null);
  if (fc && canForecast) {
    const ys = series as number[];
    const points = fc.method === "moving" ? movingForecast(ys, fc.periods, fc.confidence) : linearForecast(ys, fc.periods, fc.confidence);
    const labels = nextLabels(rows.map((r) => r.category), points.length);
    const last = data[data.length - 1];
    last.__fc = ys[ys.length - 1];
    last.__band = [ys[ys.length - 1], ys[ys.length - 1]];
    points.forEach((p, k) => data.push({ __label: formatValue(labels[k]), __fc: p.y, __band: [p.low, p.high] }));
  }
  const fcName = fc ? `Previsão (${fc.method === "moving" ? "média móvel" : "linear"})` : "";
  const an = visual.anomalies && series.length >= 4 && series.every((v) => v !== null)
    ? detectAnomalies(series as number[], visual.anomalies.sensitivity)
    : null;
  const oddCount = an ? an.flags.filter(Boolean).length : 0;
  const anomalyDot = (color: string) => (p: { cx?: number; cy?: number; index?: number }) => {
    if (p.cx === undefined || p.cy === undefined || p.cy === null || p.index === undefined || p.index >= rows.length) {
      return <g key={`d${p.index}`} />;
    }
    const odd = an?.flags[p.index];
    return (
      <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={odd ? 6 : 3} fill={odd ? "#d64550" : color}
        stroke={odd ? "#fff" : color} strokeWidth={odd ? 2 : 1}>
        {odd && <title>{`Fora do padrão: esperado ~${formatMeasure(an!.expected[p.index], measures[0].format)}`}</title>}
      </circle>
    );
  };
  const bandName = fc ? `Faixa de ${Math.round(fc.confidence * 100)}%` : "";

  // ComposedChart aceita linha e área juntas (a faixa da previsão é uma área).
  const body = (
    <ComposedChart data={data} margin={margin} onClick={chartClick as never}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={6} />
      <YAxis {...valueAxis} width={70} />
      {tooltip}
      {legend}
      {fc && canForecast && (
        <Area dataKey="__band" name={bandName} stroke="none" fill={PALETTE[0]} fillOpacity={0.15} isAnimationActive={false} legendType="square" />
      )}
      {measures.map((m, i) => {
        const color = PALETTE[i % PALETTE.length];
        return visual.type === "line" ? (
          <Line key={m.id} dataKey={m.name} stroke={color} strokeWidth={2} cursor="pointer"
            dot={i === 0 && an ? anomalyDot(color) : { r: 3 }} />
        ) : (
          <Area key={m.id} dataKey={m.name} stroke={color} fill={color} fillOpacity={0.25} strokeWidth={2} cursor="pointer"
            dot={i === 0 && an ? anomalyDot(color) : false} />
        );
      })}
      {fc && canForecast && (
        <Line dataKey="__fc" name={fcName} stroke={PALETTE[0]} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
      )}
      {refs}
    </ComposedChart>
  );
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>
      {fc && !canForecast && <div className="chart-note">Previsão precisa de pelo menos 4 períodos sem valores em branco.</div>}
      {an && (
        <div className="chart-note anomaly-note">
          {oddCount === 0 ? "Nenhum ponto fora do padrão" : `${oddCount} ponto(s) fora do padrão`} (±{visual.anomalies!.sensitivity} desvios da tendência)
        </div>
      )}
    </div>
  );
}

const REF_LABEL: Record<RefLine["kind"], string> = {
  constant: "Meta", average: "Média", median: "Mediana", min: "Mínimo", max: "Máximo",
};

/**
 * Colunas empilhadas, colunas 100% e área 100%. Nas versões 100%, o Recharts
 * normaliza cada pilha (stackOffset "expand"): o eixo vai de 0 a 100% e mostra
 * a composição, não o tamanho.
 */
function StackedVisual({ visual, grid, measures, selected, onSelect }: Props) {
  const PALETTE = usePalette();
  if (!grid) return null;
  const m = measures[0];
  const percent = visual.type === "stacked100" || visual.type === "area100";
  const rows = [...grid.rows].sort(compareValues);
  const cols = [...grid.cols].sort(compareValues);
  const names = cols.map(formatValue);
  const data = rows.map((r) => {
    const d: Record<string, string | number | null> = { __label: formatValue(r) };
    for (const c of cols) d[formatValue(c)] = grid.cells.get(valueKey(r))?.get(valueKey(c))?.[0] ?? null;
    return d;
  });
  const dim = (r: Value) => selected.size > 0 && !selected.has(valueKey(r));
  const margin = { top: 5, right: 12, bottom: 5, left: 0 };
  const xAxis = <XAxis dataKey="__label" tick={{ fontSize: 11 }} interval={rows.length > 8 ? "preserveStartEnd" : 0} minTickGap={4} />;
  const yAxis = (
    <YAxis tick={{ fontSize: 11 }} width={percent ? 44 : 70}
      tickFormatter={(v: number) => (percent ? `${Math.round(v * 100)}%` : formatMeasure(v, m.format, true))} />
  );
  // Na dica, valor e participação na pilha.
  const tooltip = (
    <Tooltip
      formatter={(v: number, _name: string, item: { payload?: Record<string, unknown> }) => {
        const sum = names.reduce((a, n) => a + (Number(item.payload?.[n]) || 0), 0);
        const share = sum ? ` (${formatMeasure(v / sum, "percent")})` : "";
        return `${formatMeasure(v, m.format)}${share}`;
      }}
    />
  );
  if (visual.type === "area100") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={margin} stackOffset="expand"
          onClick={(s: { activeTooltipIndex?: number } | null, e: React.MouseEvent) => {
            const i = s?.activeTooltipIndex;
            if (i !== undefined && rows[i] !== undefined) onSelect(rows[i], isMulti(e));
          }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          {xAxis}
          {yAxis}
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {cols.map((c, i) => (
            <Area key={valueKey(c)} dataKey={formatValue(c)} stackId="pilha" type="monotone"
              stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.75} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={margin} stackOffset={percent ? "expand" : undefined}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        {xAxis}
        {yAxis}
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {cols.map((c, i) => (
          <Bar
            key={valueKey(c)}
            dataKey={formatValue(c)}
            stackId="pilha"
            fill={PALETTE[i % PALETTE.length]}
            cursor="pointer"
            onClick={(_d: unknown, index: number, e: React.MouseEvent) => onSelect(rows[index], isMulti(e))}
          >
            {rows.map((r) => <Cell key={valueKey(r)} fillOpacity={dim(r) ? 0.3 : 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScatterVisual({ visual, result, measures, selected, onSelect }: Props) {
  const PALETTE = usePalette();
  const [mx, my, mz] = measures;
  const points = result.rows
    .filter((r) => r.values[0] !== null && r.values[1] !== null)
    .map((r) => ({ x: r.values[0], y: r.values[1], z: mz ? r.values[2] ?? 0 : 1, category: r.category, label: formatValue(r.category) }));
  const dim = (cat: Value) => selected.size > 0 && !selected.has(valueKey(cat));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name={mx.name} tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => formatMeasure(v, mx.format, true)} />
        <YAxis type="number" dataKey="y" name={my.name} tick={{ fontSize: 11 }} width={70}
          tickFormatter={(v: number) => formatMeasure(v, my.format, true)} />
        <ZAxis type="number" dataKey="z" range={mz ? [60, 600] : [90, 90]} />
        <Tooltip
          content={({ payload }) => {
            const p = payload?.[0]?.payload as (typeof points)[number] | undefined;
            if (!p) return null;
            return (
              <div className="tip">
                <strong>{fieldLabel(visual.axis!)}: {p.label}</strong>
                <div>{mx.name}: {formatMeasure(p.x, mx.format)}</div>
                <div>{my.name}: {formatMeasure(p.y, my.format)}</div>
                {mz && <div>{mz.name}: {formatMeasure(p.z, mz.format)}</div>}
              </div>
            );
          }}
        />
        <Scatter
          data={points}
          fill={PALETTE[0]}
          cursor="pointer"
          onClick={(_d: unknown, index: number, e: React.MouseEvent) => onSelect(points[index].category, isMulti(e))}
        >
          {points.map((p) => <Cell key={p.label} fillOpacity={dim(p.category) ? 0.25 : 0.85} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ---------------- Rosca e treemap ----------------

function PieVisual({ visual, result, measures, selected, onSelect, details, detailExtras }: Props) {
  const PALETTE = usePalette();
  const m = measures[0];
  const rows = orderRows(visual, result.rows).filter((r) => (r.values[0] ?? 0) > 0);
  const data = rows.map((r) => ({ name: formatValue(r.category), value: r.values[0], category: r.category }));
  const dim = (cat: Value) => selected.size > 0 && !selected.has(valueKey(cat));
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
          onClick={(entry: { category: Value }, _i: number, e: React.MouseEvent) => onSelect(entry.category, isMulti(e))}
        >
          {data.map((d, i) => <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} fillOpacity={dim(d.category) ? 0.3 : 1} />)}
        </Pie>
        {details
          ? <Tooltip content={detailTooltip(details, measures, detailExtras ?? [])} />
          : <Tooltip formatter={(v: number) => formatMeasure(v, m.format)} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

function TreemapVisual({ result, measures, selected, onSelect }: Props) {
  const PALETTE = usePalette();
  const m = measures[0];
  const rows = sortByFirstMeasure(result.rows).filter((r) => (r.values[0] ?? 0) > 0);
  const data = rows.map((r) => ({ name: formatValue(r.category), size: r.values[0] ?? 0 }));
  const byName = new Map(rows.map((r) => [formatValue(r.category), r.category]));
  const dim = (cat: Value) => selected.size > 0 && !selected.has(valueKey(cat));

  const Tile = (p: { x: number; y: number; width: number; height: number; index: number; name: string; depth: number }) => {
    if (p.depth !== 1) return <g />;
    const cat = byName.get(p.name) ?? null;
    return (
      <g style={{ cursor: "pointer" }} onClick={(e) => onSelect(cat, isMulti(e))}>
        <rect x={p.x} y={p.y} width={p.width} height={p.height}
          fill={PALETTE[p.index % PALETTE.length]} fillOpacity={dim(cat) ? 0.3 : 1} stroke="#fff" strokeWidth={2} />
        {p.width > 50 && p.height > 22 && (
          <text x={p.x + 6} y={p.y + 16} fill="#fff" fontSize={11}>{p.name}</text>
        )}
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap data={data} dataKey="size" nameKey="name" isAnimationActive={false} content={Tile as never}>
        <Tooltip formatter={(v: number) => formatMeasure(v, m.format)} />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ---------------- Auxiliares ----------------

function toChartData(rows: ResultRow[], measures: Measure[]) {
  return rows.map((r) => {
    const d: Record<string, string | number | null> = { __label: formatValue(r.category) };
    measures.forEach((m, i) => (d[m.name] = r.values[i]));
    return d;
  });
}

const sortByFirstMeasure = (rows: ResultRow[]) =>
  [...rows].sort((a, b) => (b.values[0] ?? -Infinity) - (a.values[0] ?? -Infinity));

/**
 * Ordenação do visual: a escolhida pelo usuário ou o padrão
 * (eixo de tempo/linha em ordem de categoria; demais pela 1ª medida, decrescente).
 * Recebe o visual com o eixo efetivo (já considerando o nível de drill).
 */
export function orderRows(visual: Visual, rows: ResultRow[]): ResultRow[] {
  const sort = visual.sort ?? (
    // Tempo (linha, área ou eixo de data) segue a ordem cronológica.
    visual.type === "line" || visual.type === "area" || visual.type === "slicer" || visual.axis?.part
      ? { by: "category" as const, desc: false }
      : { by: 0, desc: true }
  );
  const dir = sort.desc ? -1 : 1;
  if (sort.by === "category") return [...rows].sort((a, b) => dir * compareValues(a.category, b.category));
  const i = sort.by;
  return [...rows].sort((a, b) => dir * ((a.values[i] ?? -Infinity) - (b.values[i] ?? -Infinity)));
}

function compareValues(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true });
}
