import { useSyncExternalStore } from "react";
import type { FieldRef, FormatRule, Measure, RelativeDate, Value, ValueRange, Visual } from "../model/types";
import { fieldLabel } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey, type ResultRow } from "../engine/query";
import { RULE_COLORS, RULE_ICONS, matchRule } from "../model/rules";
import { describeRelative, formatDateBR, relativeRange, todayIso } from "../model/dates";
import { perfStore, type PerfEntry } from "../model/perf";

const multi = (e: React.MouseEvent) => e.ctrlKey || e.shiftKey || e.metaKey;

// ---------------- Formatação condicional por regras ----------------

/** Valor formatado com a cor (e o ícone) da primeira regra que bater. */
export function RuledValue({ rules, measure, value, text }: {
  rules?: FormatRule[];
  measure: number;
  value: number | null;
  text: string;
}) {
  const rule = matchRule(rules, measure, value);
  if (!rule) return <>{text}</>;
  return (
    <span className="ruled" style={{ color: RULE_COLORS[rule.style] }}>
      {rule.icon && <span className="rule-icon">{RULE_ICONS[rule.style]} </span>}
      {text}
    </span>
  );
}

// ---------------- Cartão de várias linhas ----------------

/** Um bloco por categoria, com as medidas lado a lado (o "cartão de várias linhas"). */
export function MultiCardVisual({ visual, rows, measures, selected, onSelect }: {
  visual: Visual;
  rows: ResultRow[];
  measures: Measure[];
  selected: Set<string>;
  onSelect: (c: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <div className="multicard">
      {rows.map((r) => {
        const dim = selected.size > 0 && !selected.has(valueKey(r.category));
        return (
          <button
            key={valueKey(r.category)}
            className={"multicard-row" + (dim ? " dim" : "")}
            style={{ borderLeftColor: palette[0] }}
            onClick={(e) => onSelect(r.category, multi(e))}
          >
            <div className="multicard-title">{formatValue(r.category)}</div>
            <div className="multicard-values">
              {measures.map((m, i) => (
                <div key={m.id} className="multicard-cell">
                  <div className="multicard-value">
                    <RuledValue rules={visual.rules} measure={i} value={r.values[i]} text={formatMeasure(r.values[i], m.format, true)} />
                  </div>
                  <div className="multicard-label">{m.name}</div>
                </div>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- Funil ----------------

/**
 * Etapas do maior para o menor (ou na ordem escolhida), centralizadas, com a
 * % em relação à primeira etapa e à etapa anterior.
 */
export function FunnelVisual({ rows, measures, selected, onSelect }: {
  rows: ResultRow[];
  measures: Measure[];
  selected: Set<string>;
  onSelect: (c: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const m = measures[0];
  const steps = rows.filter((r) => (r.values[0] ?? 0) > 0);
  if (steps.length === 0) return <div className="visual-msg">Sem valores positivos para os filtros atuais.</div>;
  const first = steps[0].values[0]!;
  const max = Math.max(...steps.map((r) => r.values[0]!));
  return (
    <div className="funnel">
      {steps.map((r, i) => {
        const v = r.values[0]!;
        const prev = i > 0 ? steps[i - 1].values[0]! : null;
        const dim = selected.size > 0 && !selected.has(valueKey(r.category));
        return (
          <button key={valueKey(r.category)} className={"funnel-step" + (dim ? " dim" : "")} onClick={(e) => onSelect(r.category, multi(e))}
            title={`${formatValue(r.category)}: ${formatMeasure(v, m.format)}`}>
            <span className="funnel-label">{formatValue(r.category)}</span>
            <span className="funnel-bar-wrap">
              <span className="funnel-bar" style={{ width: `${(v / max) * 100}%`, background: palette[i % palette.length] }}>
                {formatMeasure(v, m.format, true)}
              </span>
            </span>
            <span className="funnel-pct">
              {i === 0 ? "100%" : `${formatMeasure(v / first, "percent")} do início`}
              {prev !== null && <span className="muted"> · {formatMeasure(v / prev, "percent")} da anterior</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- Parâmetro de campo ----------------

/** Botões que trocam o campo dos visuais ligados ("ver por Região / Loja / Produto"). */
export function FieldParamVisual({ visual, onUpdate }: { visual: Visual; onUpdate: (p: Partial<Visual>) => void }) {
  const fields = visual.paramFields ?? [];
  if (fields.length === 0) return <div className="visual-msg">Adicione os campos do parâmetro no painel à direita.</div>;
  const current = Math.min(visual.paramIndex ?? 0, fields.length - 1);
  return (
    <div className="fieldparam">
      {fields.map((f: FieldRef, i: number) => (
        <button key={i} className={i === current ? "on" : ""} onPointerDown={(e) => e.stopPropagation()} onClick={() => onUpdate({ paramIndex: i })}>
          {fieldLabel(f)}
        </button>
      ))}
    </div>
  );
}

// ---------------- Segmentação de data relativa ----------------

/**
 * "Últimos N dias/meses/anos", "este mês/ano" ou "mês/ano anterior", contados a
 * partir da data mais recente dos dados (ou de hoje). Vira um filtro por intervalo.
 */
export function RelativeDateSlicer({ visual, maxDate, onChange }: {
  visual: Visual;
  maxDate: string | null;
  onChange: (spec: RelativeDate | undefined, range: ValueRange | null) => void;
}) {
  const spec = visual.relative;
  const set = (patch: Partial<RelativeDate> | null) => {
    if (patch === null) return onChange(undefined, null);
    const next: RelativeDate = { kind: "last", n: 30, unit: "day", anchor: "data", ...spec, ...patch };
    const anchor = next.anchor === "today" ? todayIso() : maxDate;
    if (!anchor) return;
    onChange(next, relativeRange(next, anchor));
  };
  if (!maxDate) return <div className="visual-msg">O estilo "Relativa" precisa de um campo de data.</div>;
  const anchor = spec?.anchor === "today" ? todayIso() : maxDate;
  const range = spec ? relativeRange(spec, anchor) : null;
  return (
    <div className="relative-slicer" onPointerDown={(e) => e.stopPropagation()}>
      <div className="field-row">
        <select value={spec?.kind ?? ""} onChange={(e) => (e.target.value ? set({ kind: e.target.value as RelativeDate["kind"] }) : set(null))}>
          <option value="">Todas as datas</option>
          <option value="last">Últimos</option>
          <option value="this">Este</option>
          <option value="previous">Anterior</option>
        </select>
        {spec?.kind === "last" && (
          <input type="number" min={1} value={spec.n ?? 1} onChange={(e) => set({ n: Math.max(1, Number(e.target.value) || 1) })} />
        )}
        {spec && (
          <select value={spec.unit} onChange={(e) => set({ unit: e.target.value as RelativeDate["unit"] })}>
            <option value="day">{spec.kind === "last" ? "dias" : "dia"}</option>
            <option value="month">{spec.kind === "last" ? "meses" : "mês"}</option>
            <option value="year">{spec.kind === "last" ? "anos" : "ano"}</option>
          </select>
        )}
      </div>
      {spec && range && (
        <div className="small muted">
          {describeRelative(spec)}: {formatDateBR(range.min)} a {formatDateBR(range.max)} ·{" "}
          <label className="inline-check">
            <input type="checkbox" checked={spec.anchor === "today"} onChange={(e) => set({ anchor: e.target.checked ? "today" : "data" })} />
            contar a partir de hoje
          </label>
        </div>
      )}
      {!spec && <div className="small muted">Referência: a data mais recente dos dados ({formatDateBR(maxDate)}).</div>}
    </div>
  );
}

// ---------------- Painel do analisador de desempenho ----------------

export function PerfPanel({ visualIds, onRefreshCold, onRefreshWarm, onClose }: {
  visualIds: Set<string>;
  onRefreshCold: () => void;
  onRefreshWarm: () => void;
  onClose: () => void;
}) {
  const all = useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot);
  const rows: PerfEntry[] = all.filter((e) => visualIds.has(e.visualId)).sort((a, b) => b.ms - a.ms);
  const sum = (k: keyof PerfEntry) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  return (
    <div className="perf-panel">
      <div className="perf-head">
        <strong>⏱ Analisador de desempenho</strong>
        <span className="small muted">Tempo de consulta ao motor (sem o desenho) e o trabalho feito por visual.</span>
        <span style={{ flex: 1 }} />
        <button onClick={onRefreshCold} title="Descarta os caches do motor e recalcula tudo">Recalcular do zero (cache frio)</button>
        <button onClick={onRefreshWarm} title="Recalcula reaproveitando os caches">Recalcular (cache quente)</button>
        <button className="link" onClick={onClose}>✕</button>
      </div>
      <div className="perf-body">
        <table className="grid">
          <thead>
            <tr>
              <th>Visual</th><th>Tipo</th><th className="num">Tempo (ms)</th><th className="num">Linhas percorridas</th>
              <th className="num">Cache: acertos / erros</th><th className="num">Medidas avaliadas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.visualId}>
                <td>{r.title || "(sem título)"}</td>
                <td>{r.type}</td>
                <td className="num">{r.ms.toFixed(1)}</td>
                <td className="num">{fmt(r.rowsScanned)}</td>
                <td className="num">{fmt(r.cacheHits)} / {fmt(r.cacheMisses)}</td>
                <td className="num">{fmt(r.measureEvals)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total da página</td><td />
              <td className="num">{sum("ms").toFixed(1)}</td>
              <td className="num">{fmt(sum("rowsScanned"))}</td>
              <td className="num">{fmt(sum("cacheHits"))} / {fmt(sum("cacheMisses"))}</td>
              <td className="num">{fmt(sum("measureEvals"))}</td>
            </tr>
          </tfoot>
        </table>
        <p className="small muted">
          "Linhas percorridas" conta as linhas testadas contra um filtro. Um acerto de cache reaproveita linhas já filtradas
          (o contexto comum é calculado uma vez e cada categoria filtra só o que sobrou). Compare "do zero" com "quente".
        </p>
      </div>
    </div>
  );
}
