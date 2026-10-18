import { useEffect, useReducer, useRef, useState } from "react";
import type { Measure, Report, Visual, VisualType } from "./model/types";
import { fieldKey, newId } from "./model/types";
import { loadReport, reducer, saveReport } from "./model/store";
import { sampleReport } from "./model/sampleData";
import { formatValue } from "./model/format";
import { Canvas } from "./components/Canvas";
import { FieldsPane, MeasureEditor, PropertiesPane, VISUAL_TYPES } from "./components/Panels";
import { DataView, ModelView } from "./components/DataModelViews";

type Tab = "report" | "data" | "model";

export default function App() {
  const [report, dispatch] = useReducer(reducer, undefined, loadReport);
  const [tab, setTab] = useState<Tab>("report");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Measure | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // Salva automaticamente (com atraso, para não gravar a cada pixel arrastado).
  useEffect(() => {
    const t = setTimeout(() => saveReport(report), 400);
    return () => clearTimeout(t);
  }, [report]);

  const addVisual = (type: VisualType) => {
    const y = Math.max(10, ...report.visuals.map((v) => v.y + v.h + 10));
    const visual: Visual = {
      id: newId(),
      type,
      title: VISUAL_TYPES.find((v) => v.type === type)!.label,
      x: 10,
      y,
      w: type === "card" ? 220 : 420,
      h: type === "card" ? 110 : 280,
      measureIds: type === "slicer" ? [] : report.measures.slice(0, 1).map((m) => m.id),
    };
    dispatch({ type: "addVisual", visual });
    setSelectedId(visual.id);
    setTab("report");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(report)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "relatorio.minibi.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Report;
      if (!Array.isArray(data.tables) || !Array.isArray(data.visuals)) throw new Error("formato inválido");
      dispatch({ type: "reset", report: { ...data, filters: [] } });
      setSelectedId(null);
    } catch (e) {
      alert(`Não foi possível abrir o arquivo: ${e instanceof Error ? e.message : e}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const selected = report.visuals.find((v) => v.id === selectedId);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Mini BI</strong>
        <nav>
          {([["report", "Relatório"], ["data", "Dados"], ["model", "Modelo"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <button onClick={exportJson}>Salvar arquivo</button>
        <button onClick={() => fileRef.current?.click()}>Abrir arquivo</button>
        <button
          onClick={() => {
            if (confirm("Descartar o relatório atual e voltar ao exemplo?")) {
              dispatch({ type: "reset", report: sampleReport() });
              setSelectedId(null);
            }
          }}
        >
          Restaurar exemplo
        </button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
      </header>

      {report.filters.length > 0 && (
        <div className="filterbar">
          <span className="muted small">Filtros ativos:</span>
          {report.filters.map((f) => (
            <span key={f.sourceVisualId} className="chip">
              {fieldKey(f.field)} = {f.values.map(formatValue).join(", ")}
              <button
                className="link"
                onClick={() => dispatch({ type: "setFilter", sourceVisualId: f.sourceVisualId, filter: null })}
              >
                ✕
              </button>
            </span>
          ))}
          <button className="link" onClick={() => dispatch({ type: "clearFilters" })}>Limpar todos</button>
        </div>
      )}

      <main className="workspace">
        <FieldsPane report={report} dispatch={dispatch} onAddVisual={addVisual} onEditMeasure={(m) => setEditing(m)} />
        <section className="center">
          {tab === "report" && (
            <Canvas report={report} dispatch={dispatch} selectedId={selectedId} onSelectVisual={setSelectedId} />
          )}
          {tab === "data" && <DataView report={report} dispatch={dispatch} />}
          {tab === "model" && <ModelView report={report} dispatch={dispatch} />}
        </section>
        {tab === "report" && <PropertiesPane report={report} visual={selected} dispatch={dispatch} />}
      </main>

      {editing !== undefined && (
        <MeasureEditor report={report} measure={editing} dispatch={dispatch} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
