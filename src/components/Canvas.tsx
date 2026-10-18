import { useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { ButtonAction, FieldRef, Measure, Page, Report, Value, ValueRange, Visual } from "../model/types";
import { fieldLabel, newId } from "../model/types";
import type { Action } from "../model/store";
import {
  Engine, axisOf, contextFor, fillTemplate, hierarchyOf, runGrid, runTotals, runVisual, valueKey, whatIfParams,
} from "../engine/query";
import { detailMeasures, runCalendar, runDetails, runGantt, runMultiples } from "../engine/lab";
import { distributionValues, generateNarrative, keyInfluencers, runBoxplot, runDecomposition } from "../engine/analytics";
import type { RangeDomain } from "./Package3Visuals";
import { isIsoDate } from "../model/dates";
import { runBubbles, runChoropleth } from "../engine/geo";
import type { Analysis } from "./AnalyticsVisuals";
import { USES_LEGEND, VisualView } from "./VisualView";
import { downloadText, visualToCsv } from "../model/exportCsv";
import { formatMeasure, formatValue } from "../model/format";
import { measure } from "../model/perf";

const GRID = 10;
const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);

interface Props {
  report: Report;
  pageId: string;
  dispatch: Dispatch<Action>;
  selectedId: string | null;
  onSelectVisual: (id: string | null) => void;
  /** Relatório publicado: sem mover, redimensionar ou duplicar visuais. */
  readOnly?: boolean;
  /** Botões: ir para uma página ou aplicar um indicador. */
  onAction: (a: ButtonAction) => void;
  /** Drill-through: abrir a página de detalhe filtrada pelo item. */
  onDrillthrough: (pageId: string, field: FieldRef, value: Value) => void;
  /** Muda para recriar o motor do zero (caches vazios) — usado pelo analisador de desempenho. */
  engineEpoch?: number;
  /** Muda para recalcular reaproveitando os caches. */
  renderTick?: number;
}

/**
 * Páginas de detalhe que aceitam o item selecionado neste visual: o filtro
 * cruzado dele precisa ser de um único valor, num campo que a página aceita.
 */
function drillthroughTargets(report: Report, v: Visual): { pages: Page[]; field: FieldRef; value: Value } | null {
  const own = report.filters.find((f) => f.sourceVisualId === v.id);
  if (!own || own.range || own.values.length !== 1) return null;
  const pages = report.pages.filter((p) => p.id !== v.pageId && (p.drillthrough ?? []).some((f) =>
    f.table === own.field.table && f.column === own.field.column && (f.part ?? null) === (own.field.part ?? null)));
  return pages.length ? { pages, field: own.field, value: own.values[0] } : null;
}

/** Visuais "de layout": sem cabeçalho, sem drill, foco ou exportação. */
const DECORATIVE: Visual["type"][] = ["text", "button", "image"];
/** Visuais de análise: consultas próprias, sem drill. */
const ANALYSIS: Visual["type"][] = ["histogram", "boxplot", "influencers", "decomp", "narrative"];
/** Mapas: consulta normal + posição geográfica; sem drill. */
const MAPS: Visual["type"][] = ["map", "bubblemap"];
/** Visuais que usam a linha de total (medidas sem o filtro de categoria). */
const NEEDS_TOTALS: Visual["type"][] = ["table", "kpi", "waterfall", "bullet"];

export function Canvas({
  report, pageId, dispatch, selectedId, onSelectVisual, readOnly, onAction, onDrillthrough, engineEpoch = 0, renderTick = 0,
}: Props) {
  // Um motor por versão do modelo: mover visuais ou filtrar reaproveita os caches.
  const { tables, relationships, measures } = report;
  // Parâmetros "e se" entram no motor; mudar um deles recria o motor (as medidas mudam).
  const params = whatIfParams(report);
  const paramsKey = JSON.stringify(params);
  const engine = useMemo(
    () => new Engine({ tables, relationships, measures, params }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, relationships, measures, engineEpoch, paramsKey],
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const visuals = report.visuals.filter((v) => v.pageId === pageId);
  const focused = visuals.find((v) => v.id === focusId);
  const height = Math.max(700, ...visuals.map((v) => v.y + v.h + 20));

  const body = (v: Visual) => (
    <VisualBody key={`${v.id}-${renderTick}`} report={report} engine={engine} visual={v} dispatch={dispatch} onAction={onAction} />
  );

  const actions = (v: Visual): FrameAction[] => {
    const list: FrameAction[] = [...drillActions(report, v, dispatch)];
    const dt = drillthroughTargets(report, v);
    if (dt) {
      list.push({
        icon: "↗",
        title: `Detalhar ${formatValue(dt.value)} em…`,
        run: () => {},
        menu: dt.pages.map((p) => ({ label: p.name, run: () => onDrillthrough(p.id, dt.field, dt.value) })),
      });
    }
    if (!DECORATIVE.includes(v.type)) {
      list.push({ icon: focusId === v.id ? "⤡" : "⤢", title: focusId === v.id ? "Voltar ao relatório" : "Modo foco",
        run: () => setFocusId(focusId === v.id ? null : v.id) });
    }
    // Análises têm resultados próprios (faixas, quartis…), fora da tabela categoria × medida.
    if (!DECORATIVE.includes(v.type) && !ANALYSIS.includes(v.type)) {
      list.push({ icon: "⭳", title: "Exportar dados (CSV)", run: () => exportVisual(engine, report, v) });
    }
    if (!readOnly) {
      list.push({ icon: "⧉", title: "Duplicar visual", run: () => {
        const copy = { ...v, id: newId(), x: v.x + 20, y: v.y + 20, title: `${v.title} (cópia)` };
        dispatch({ type: "addVisual", visual: copy });
        onSelectVisual(copy.id);
      } });
    }
    return list;
  };

  // Modo foco: o visual ocupa a área do relatório, como no Power BI.
  if (focused) {
    return (
      <div className="canvas-scroll">
        <div className="focus-view">
          <div className="focus-header">
            <button onClick={() => setFocusId(null)}>← Voltar ao relatório</button>
            <strong>{focused.title}</strong>
            <DrillPath report={report} visual={focused} />
            <span style={{ flex: 1 }} />
            {actions(focused).filter((a) => a.title !== "Voltar ao relatório").flatMap((a) =>
              a.menu
                ? a.menu.map((item) => (
                    <button key={item.label} title={a.title} onClick={item.run}>{a.icon} {item.label}</button>
                  ))
                : [
                    <button key={a.title} title={a.title} className={a.active ? "on" : ""} disabled={a.disabled} onClick={a.run}>
                      {a.icon}
                    </button>,
                  ])}
          </div>
          <div className="focus-body">{body(focused)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-scroll" onPointerDown={() => onSelectVisual(null)}>
      <div className="canvas" style={{ height }}>
        {visuals.map((v) => (
          <Frame
            key={v.id}
            report={report}
            visual={v}
            selected={v.id === selectedId}
            readOnly={readOnly}
            actions={actions(v)}
            onSelect={() => onSelectVisual(v.id)}
            onChange={(patch) => dispatch({ type: "updateVisual", id: v.id, patch })}
          >
            {body(v)}
          </Frame>
        ))}
        {visuals.length === 0 && (
          <div className="canvas-empty">{readOnly ? "Página vazia." : "Adicione um visual pelo painel à esquerda."}</div>
        )}
      </div>
    </div>
  );
}

// ---------------- Drill-down ----------------

/** Botões de drill do Power BI: subir, ir para o próximo nível e o modo "clique detalha". */
function drillActions(report: Report, v: Visual, dispatch: Dispatch<Action>): FrameAction[] {
  if (["kpi", "slicer", "fieldparam", "bullet", "calendar", "gantt", "sankey", "whatif", "radar"].includes(v.type) || DECORATIVE.includes(v.type) || ANALYSIS.includes(v.type) || MAPS.includes(v.type)) return [];
  const levels = hierarchyOf(report, v);
  if (levels.length < 2) return [];
  const level = Math.min(v.drill?.level ?? 0, levels.length - 1);
  const path = v.drill?.path ?? [];
  const set = (patch: Partial<Visual>) => dispatch({ type: "updateVisual", id: v.id, patch });
  return [
    {
      icon: "↑", title: "Subir um nível", disabled: level === 0,
      run: () => set({ drill: { level: level - 1, path: path.slice(0, level - 1) } }),
    },
    {
      icon: "⇊", title: `Ir para o próximo nível (${fieldLabel(levels[Math.min(level + 1, levels.length - 1)])})`,
      disabled: level >= levels.length - 1,
      run: () => set({ drill: { level: level + 1, path: [...path.slice(0, level), undefined] } }),
    },
    {
      icon: "↓", title: v.drillMode ? "Modo de drill ligado: clique num item para detalhar" : "Ligar modo de drill",
      active: !!v.drillMode,
      run: () => set({ drillMode: !v.drillMode }),
    },
  ];
}

/** Trilha do drill: "Ano 2026 › T1 › Mês". */
function DrillPath({ report, visual }: { report: Report; visual: Visual }) {
  const levels = hierarchyOf(report, visual);
  const level = Math.min(visual.drill?.level ?? 0, Math.max(0, levels.length - 1));
  if (levels.length < 2 || level === 0) return null;
  const path = visual.drill?.path ?? [];
  const parts = levels.slice(0, level).map((f, i) => (path[i] === undefined ? `${fieldLabel(f)}: todos` : formatValue(path[i] ?? null)));
  return <span className="drill-path" title="Caminho do drill">{[...parts, fieldLabel(levels[level])].join(" › ")}</span>;
}

// ---------------- Corpo e cabeçalho do visual ----------------

function measuresOf(report: Report, visual: Visual): Measure[] {
  return visual.measureIds
    .map((id) => report.measures.find((m) => m.id === id))
    .filter((m): m is Measure => !!m);
}

function exportVisual(engine: Engine, report: Report, visual: Visual) {
  const shown = { ...visual, axis: axisOf(report, visual) };
  const result = runVisual(engine, report, visual);
  const grid = USES_LEGEND.includes(visual.type) ? runGrid(engine, report, visual) : undefined;
  const csv = visualToCsv(shown, measuresOf(report, visual), result, grid);
  const name = visual.title.replace(/[\\/:*?"<>|]+/g, "_").trim() || "visual";
  downloadText(`${name}.csv`, csv);
}

type BodyProps = {
  report: Report; engine: Engine; visual: Visual; dispatch: Dispatch<Action>; onAction: (a: ButtonAction) => void;
};

/** Calcula o visual medindo o tempo e o trabalho do motor (analisador de desempenho). */
function VisualBody(props: BodyProps) {
  const { engine, visual } = props;
  return measure(engine.stats, { visualId: visual.id, title: visual.title, type: visual.type }, () => visualBody(props));
}

function visualBody({ report, engine, visual, dispatch, onAction }: BodyProps) {
  const update = (patch: Partial<Visual>) => dispatch({ type: "updateVisual", id: visual.id, patch });
  if (visual.type === "button" || visual.type === "image") {
    return <VisualView {...EMPTY} visual={visual} measures={[]} onAction={onAction} />;
  }
  if (visual.type === "fieldparam" || visual.type === "whatif") {
    return <VisualView {...EMPTY} visual={visual} measures={[]} onAction={onAction} onUpdate={update} />;
  }
  if (visual.type === "narrative") {
    const ms = measuresOf(report, visual);
    let text = "";
    try {
      text = ms.length ? generateNarrative(engine, report, visual, ms, (v, m, short) => formatMeasure(v, m.format, short), formatValue) : "";
    } catch (e) {
      text = `Não foi possível gerar o texto: ${e instanceof Error ? e.message : e}`;
    }
    return <VisualView {...EMPTY} visual={visual} measures={ms} text={text} onAction={onAction} />;
  }
  if (visual.type === "text") {
    const text = fillTemplate(engine, report, visual, visual.text ?? "", (v, m) => formatMeasure(v, m.format));
    return <VisualView {...EMPTY} visual={visual} measures={[]} text={text} onAction={onAction} />;
  }
  const measures = measuresOf(report, visual);
  const isAnalysis = ANALYSIS.includes(visual.type);
  const result = isAnalysis ? { rows: [] } : runVisual(engine, report, visual);
  const grid = USES_LEGEND.includes(visual.type) ? runGrid(engine, report, visual) : undefined;
  const totals = NEEDS_TOTALS.includes(visual.type) ? runTotals(engine, report, visual, result) : [];
  const own = report.filters.find((f) => f.sourceVisualId === visual.id);
  let analysis: Analysis | undefined;
  let analysisError: string | undefined;
  let geo: React.ComponentProps<typeof VisualView>["geo"];
  let lab: React.ComponentProps<typeof VisualView>["lab"];
  let details: React.ComponentProps<typeof VisualView>["details"];
  try {
    if (visual.type === "histogram") analysis = { kind: "histogram", values: distributionValues(engine, report, visual) };
    if (visual.type === "boxplot") analysis = { kind: "boxplot", rows: runBoxplot(engine, report, visual) };
    if (visual.type === "influencers" && measures[0]) {
      analysis = { kind: "influencers", result: keyInfluencers(engine, report, visual, measures[0]) };
    }
    if (visual.type === "decomp" && measures[0]) {
      analysis = { kind: "decomp", result: runDecomposition(engine, report, visual, measures[0]) };
    }
    if (visual.type === "map" && visual.axis && measures[0]) {
      geo = { kind: "map", result: runChoropleth(engine, report, visual) };
    }
    if (visual.type === "bubblemap" && visual.axis && measures[0]) {
      geo = { kind: "bubblemap", result: runBubbles(engine, report, visual, measures) };
    }
    if (visual.multiples && ["bar", "line", "area"].includes(visual.type) && measures[0]) {
      lab = { kind: "multiples", result: runMultiples(engine, report, visual) };
    }
    if (visual.type === "calendar" && visual.axis && measures[0]) {
      lab = { kind: "calendar", result: runCalendar(engine, report, visual, measures[0]) };
    }
    if (visual.type === "gantt") lab = { kind: "gantt", tasks: runGantt(engine, report, visual) };
    const axisNow = axisOf(report, visual);
    if ((visual.tooltipMeasures?.length || visual.tooltipTrend) && axisNow && !result.error) {
      details = runDetails(engine, report, visual, axisNow, result.rows);
    }
  } catch (e) {
    analysisError = e instanceof Error ? e.message : String(e);
  }

  // Segmentação "entre": mínimo e máximo do campo (coluna inteira, sem hierarquia de datas),
  // com os outros filtros da página — o próprio filtro dela não limita o domínio.
  let rangeDomain: RangeDomain | undefined;
  if (visual.type === "slicer" && (visual.slicerStyle === "between" || visual.slicerStyle === "relative") && visual.axis) {
    const vals = engine.distinct(visual.axis, contextFor(report, visual)).filter((x) => x !== null && x !== "");
    const isDate = vals.length > 0 && vals.every((x) => isIsoDate(x));
    const nums = vals.map(Number);
    if (isDate) {
      const sorted = (vals as string[]).sort();
      rangeDomain = { min: sorted[0], max: sorted[sorted.length - 1], isDate: true };
    } else if (vals.length > 0 && nums.every(Number.isFinite)) {
      rangeDomain = { min: Math.min(...nums), max: Math.max(...nums), isDate: false };
    }
  }
  const rangeField = visual.type === "histogram" ? visual.valueField : visual.axis;
  const setRange = (range: ValueRange | null) =>
    rangeField &&
    dispatch({
      type: "setFilter",
      sourceVisualId: visual.id,
      filter: range ? { field: rangeField, values: [], range, sourceVisualId: visual.id } : null,
    });

  // Filtro por um campo qualquer (segmento do influenciador).
  const filterField = (field: FieldRef, values: Value[]) =>
    dispatch({ type: "setFilter", sourceVisualId: visual.id, filter: values.length ? { field, values, sourceVisualId: visual.id } : null });
  const selected = new Set((own?.values ?? []).map(valueKey));
  const axis = axisOf(report, visual);
  const levels = hierarchyOf(report, visual);
  const level = Math.min(visual.drill?.level ?? 0, Math.max(0, levels.length - 1));

  const select = (category: Value, multi: boolean) => {
    if (!axis) return;
    // Modo de drill: o clique desce um nível filtrando pelo item, em vez de filtrar a página.
    if (visual.drillMode && level < levels.length - 1) {
      const path = [...(visual.drill?.path ?? []).slice(0, level), category];
      dispatch({ type: "updateVisual", id: visual.id, patch: { drill: { level: level + 1, path } } });
      return;
    }
    const field = visual.type === "calendar" && visual.axis ? visual.axis : axis;
    dispatch({ type: "toggleFilter", multi, filter: { field, values: [category], sourceVisualId: visual.id } });
  };

  return (
    <VisualView
      visual={{ ...visual, axis }}
      result={analysisError ? { rows: [], error: analysisError } : result}
      grid={grid}
      totals={totals}
      measures={measures}
      analysis={analysis}
      geo={geo}
      lab={lab}
      details={details}
      detailExtras={details ? detailMeasures(report, visual) : undefined}
      ownFilter={own}
      onFilterField={filterField}
      rangeDomain={rangeDomain}
      onSetRange={setRange}
      onSetRelative={(relative, range) => {
        update({ relative });
        setRange(range);
      }}
      selected={selected}
      onSelect={select}
      onSetValues={(values) =>
        axis &&
        dispatch({
          type: "setFilter",
          sourceVisualId: visual.id,
          filter: { field: axis, values, sourceVisualId: visual.id },
        })}
      onUpdate={(patch) => dispatch({ type: "updateVisual", id: visual.id, patch })}
      onAction={onAction}
    />
  );
}

const EMPTY = {
  result: { rows: [] },
  totals: [],
  selected: new Set<string>(),
  onSelect: () => {},
  onSetValues: () => {},
  onUpdate: () => {},
  onFilterField: () => {},
  onSetRange: () => {},
  onSetRelative: () => {},
};

interface FrameAction {
  icon: string;
  title: string;
  run: () => void;
  /** Ação com submenu (ex.: escolher a página do drill-through). */
  menu?: { label: string; run: () => void }[];
  active?: boolean;
  disabled?: boolean;
}

function Frame({ report, visual, selected, readOnly, actions, onSelect, onChange, children }: {
  report: Report;
  visual: Visual;
  selected: boolean;
  readOnly?: boolean;
  actions: FrameAction[];
  onSelect: () => void;
  onChange: (patch: Partial<Visual>) => void;
  children: React.ReactNode;
}) {
  // Submenu aberto (drill-through), pelo botão ↗ ou pelo clique direito no visual.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAction = actions.find((a) => a.menu);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  // Arrastar (pelo título) e redimensionar (pelo canto), com encaixe na grade.
  const startDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const start = { x: e.clientX, y: e.clientY, vx: visual.x, vy: visual.y, w: visual.w, h: visual.h };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      onChange(
        mode === "move"
          ? { x: snap(start.vx + dx), y: snap(start.vy + dy) }
          : { w: Math.max(140, snap(start.w + dx)), h: Math.max(90, snap(start.h + dy)) },
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={"frame" + (selected ? " selected" : "") + (readOnly ? " readonly" : "") +
        (DECORATIVE.includes(visual.type) ? " chromeless" : "")}
      style={{ left: visual.x, top: visual.y, width: visual.w, height: visual.h }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={(e) => {
        if (!menuAction) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="frame-header">
        <div className="frame-title" onPointerDown={(e) => startDrag(e, "move")}>
          {DECORATIVE.includes(visual.type) ? "" : visual.title}
          <DrillPath report={report} visual={visual} />
        </div>
        <div className="frame-actions">
          {visual.topN ? <span className="badge" title="Filtro Top N ativo">Top {visual.topN}</span> : null}
          {actions.map((a) => (
            <button
              key={a.title}
              title={a.title}
              className={a.active ? "on" : ""}
              disabled={a.disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (a.menu) setMenuOpen(!menuOpen);
                else a.run();
              }}
            >
              {a.icon}
            </button>
          ))}
        </div>
        {menuOpen && menuAction?.menu && (
          <div className="frame-menu" onPointerDown={(e) => e.stopPropagation()}>
            <div className="menu-note">{menuAction.title}</div>
            {menuAction.menu.map((item) => (
              <button key={item.label} className="menu-item" onClick={() => {
                setMenuOpen(false);
                item.run();
              }}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="frame-body">{children}</div>
      {!readOnly && <div className="frame-resize" onPointerDown={(e) => startDrag(e, "resize")} />}
    </div>
  );
}
