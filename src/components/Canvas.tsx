import { useMemo } from "react";
import type { Dispatch } from "react";
import type { Measure, Report, Visual } from "../model/types";
import type { Action } from "../model/store";
import { Engine, runVisual, valueKey } from "../engine/query";
import { VisualView } from "./VisualView";

const GRID = 10;
const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);

interface Props {
  report: Report;
  dispatch: Dispatch<Action>;
  selectedId: string | null;
  onSelectVisual: (id: string | null) => void;
}

export function Canvas({ report, dispatch, selectedId, onSelectVisual }: Props) {
  // Um motor por versão do modelo: mover visuais ou filtrar reaproveita os caches.
  const { tables, relationships, measures } = report;
  const engine = useMemo(() => new Engine({ tables, relationships, measures }), [tables, relationships, measures]);
  const height = Math.max(700, ...report.visuals.map((v) => v.y + v.h + 20));

  return (
    <div className="canvas-scroll" onPointerDown={() => onSelectVisual(null)}>
      <div className="canvas" style={{ height }}>
        {report.visuals.map((v) => (
          <Frame
            key={v.id}
            visual={v}
            selected={v.id === selectedId}
            onSelect={() => onSelectVisual(v.id)}
            onChange={(patch) => dispatch({ type: "updateVisual", id: v.id, patch })}
          >
            <VisualBody report={report} engine={engine} visual={v} dispatch={dispatch} />
          </Frame>
        ))}
        {report.visuals.length === 0 && (
          <div className="canvas-empty">Adicione um visual pelo painel à esquerda.</div>
        )}
      </div>
    </div>
  );
}

function VisualBody({ report, engine, visual, dispatch }: {
  report: Report; engine: Engine; visual: Visual; dispatch: Dispatch<Action>;
}) {
  const result = runVisual(engine, report, visual);
  const totals = visual.type === "table" && visual.axis
    ? runVisual(engine, report, { ...visual, axis: undefined }).rows[0]?.values ?? []
    : [];
  const measures = visual.measureIds
    .map((id) => report.measures.find((m) => m.id === id))
    .filter((m): m is Measure => !!m);
  const own = report.filters.find((f) => f.sourceVisualId === visual.id);
  const selected = new Set((own?.values ?? []).map(valueKey));

  return (
    <VisualView
      visual={visual}
      result={result}
      totals={totals}
      measures={measures}
      selected={selected}
      onSelect={(category, multi) =>
        visual.axis &&
        dispatch({
          type: "toggleFilter",
          multi,
          filter: { field: visual.axis, values: [category], sourceVisualId: visual.id },
        })}
      onSetValues={(values) =>
        visual.axis &&
        dispatch({
          type: "setFilter",
          sourceVisualId: visual.id,
          filter: { field: visual.axis, values, sourceVisualId: visual.id },
        })}
    />
  );
}

function Frame({ visual, selected, onSelect, onChange, children }: {
  visual: Visual;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Visual>) => void;
  children: React.ReactNode;
}) {
  // Arrastar (pelo título) e redimensionar (pelo canto), com encaixe na grade.
  const startDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
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
      className={"frame" + (selected ? " selected" : "")}
      style={{ left: visual.x, top: visual.y, width: visual.w, height: visual.h }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div className="frame-title" onPointerDown={(e) => startDrag(e, "move")}>
        {visual.title}
      </div>
      <div className="frame-body">{children}</div>
      <div className="frame-resize" onPointerDown={(e) => startDrag(e, "resize")} />
    </div>
  );
}
