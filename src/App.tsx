import { useEffect, useReducer, useRef, useState } from "react";
import type { ButtonAction, Column, Measure, PaletteName, Report, Value, ValueRange, Visual, VisualType } from "./model/types";
import { fieldKey, fieldLabel, newId } from "./model/types";
import { captureBookmark, historyReducer, loadReport, migrate, saveReport } from "./model/store";
import { sampleReport } from "./model/sampleData";
import { formatValue } from "./model/format";
import { PALETTES, PaletteContext } from "./model/theme";
import { exportPagePng, printPage, publishReport } from "./model/publish";
import { Canvas } from "./components/Canvas";
import { ColumnEditor, FieldsPane, MeasureEditor, PropertiesPane, VISUAL_TYPES } from "./components/Panels";
import { DataView, ModelView } from "./components/DataModelViews";
import { MEASURE_SLOTS } from "./components/VisualView";
import { Menu } from "./components/Menu";

type Tab = "report" | "data" | "model";

/** Texto de um filtro por intervalo: "entre 10 e 20", "≥ 10", "≤ 20". */
function summarizeRange(r: ValueRange): string {
  const has = (v: Value | undefined) => v !== undefined && v !== null;
  const f = (v: Value | undefined) =>
    typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : formatValue(v ?? null);
  if (has(r.min) && has(r.max)) {
    return r.maxOpen ? `de ${f(r.min)} a menos de ${f(r.max)}` : `entre ${f(r.min)} e ${f(r.max)}`;
  }
  if (has(r.min)) return `≥ ${f(r.min)}`;
  return `${r.maxOpen ? "<" : "≤"} ${f(r.max)}`;
}

/** Texto do filtro na barra: poucos valores aparecem; muitos viram uma contagem (e a faixa, se numéricos). */
function summarizeValues(values: Value[]): string {
  if (values.length <= 5) return values.map(formatValue).join(", ");
  const nums = values.filter((v): v is number => typeof v === "number");
  const range = nums.length === values.length
    ? ` (de ${Math.min(...nums).toLocaleString("pt-BR")} a ${Math.max(...nums).toLocaleString("pt-BR")})`
    : "";
  return `${values.length.toLocaleString("pt-BR")} valores${range}`;
}

const SIZES: Partial<Record<VisualType, [number, number]>> = {
  card: [220, 110],
  gauge: [300, 200],
  slicer: [220, 250],
  matrix: [600, 260],
  heatmap: [600, 300],
  kpi: [260, 160],
  text: [420, 90],
  button: [180, 50],
  histogram: [450, 280],
  boxplot: [450, 300],
  influencers: [450, 380],
  decomp: [700, 340],
  map: [450, 420],
  bubblemap: [450, 420],
  image: [200, 120],
  pareto: [450, 300],
  narrative: [450, 200],
};

/** Quantas medidas um visual novo já recebe. */
const DEFAULT_MEASURES: Partial<Record<VisualType, number>> = {
  scatter: 2, combo: 2, text: 0, button: 0, slicer: 0, histogram: 0, boxplot: 0, image: 0,
};

/**
 * `viewOnly` é o relatório publicado: quem recebe o HTML navega, filtra, faz
 * drill e exporta, mas não edita o modelo nem o layout.
 */
export default function App({ initial, viewOnly = false }: { initial?: Report; viewOnly?: boolean }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: initial ?? loadReport(),
    future: [],
  }));
  const report = history.present;
  const [tab, setTab] = useState<Tab>("report");
  const [pageId, setPageId] = useState(report.pages[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Measure | null | undefined>(undefined);
  const [editingColumn, setEditingColumn] = useState<{ table: string | null; column: Column | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Salva automaticamente (com atraso, para não gravar a cada pixel arrastado).
  useEffect(() => {
    if (viewOnly) return;
    const t = setTimeout(() => saveReport(report), 400);
    return () => clearTimeout(t);
  }, [report, viewOnly]);

  // Se a página atual sumir (excluída ou relatório trocado), vai para a primeira.
  const page = report.pages.find((p) => p.id === pageId) ?? report.pages[0];
  useEffect(() => {
    if (page.id !== pageId) setPageId(page.id);
  }, [page.id, pageId]);

  // Atalhos: Ctrl+Z / Ctrl+Y (ou Ctrl+Shift+Z) e Delete, fora de campos de texto.
  useEffect(() => {
    if (viewOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (editing !== undefined || editingColumn) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "undo" });
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Delete" && selectedId && tab === "report") {
        dispatch({ type: "removeVisual", id: selectedId });
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, tab, editing, editingColumn, viewOnly]);

  const goToPage = (id: string) => {
    setPageId(id);
    setSelectedId(null);
    setTab("report");
  };

  const addVisual = (type: VisualType) => {
    const onPage = report.visuals.filter((v) => v.pageId === page.id);
    const [w, h] = SIZES[type] ?? [420, 280];
    const count = Math.min(MEASURE_SLOTS[type]?.length ?? 1, DEFAULT_MEASURES[type] ?? 1);
    const visual: Visual = {
      id: newId(),
      pageId: page.id,
      type,
      title: VISUAL_TYPES.find((v) => v.type === type)!.label,
      x: 10,
      y: Math.max(10, ...onPage.map((v) => v.y + v.h + 10)),
      w,
      h,
      measureIds: report.measures.slice(0, count).map((m) => m.id),
      ...(type === "text" ? { text: "# Título\nEscreva aqui. Medidas entre colchetes viram valores: [" + (report.measures[0]?.name ?? "Medida") + "]" } : {}),
    };
    dispatch({ type: "addVisual", visual });
    setSelectedId(visual.id);
    setTab("report");
  };

  const addPage = () => {
    const id = newId();
    dispatch({ type: "addPage", page: { id, name: `Página ${report.pages.length + 1}` } });
    goToPage(id);
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
      dispatch({ type: "reset", report: migrate({ ...data, filters: [] }) });
      setSelectedId(null);
    } catch (e) {
      alert(`Não foi possível abrir o arquivo: ${e instanceof Error ? e.message : e}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Botões do relatório: navegar entre páginas ou aplicar um indicador. */
  const runAction = (a: ButtonAction) => {
    if (a.kind === "page") {
      if (report.pages.some((p) => p.id === a.pageId)) goToPage(a.pageId);
      return;
    }
    const b = report.bookmarks.find((x) => x.id === a.bookmarkId);
    if (!b) return;
    dispatch({ type: "applyBookmark", id: b.id });
    goToPage(b.pageId);
  };

  const addBookmark = () => {
    const name = prompt("Nome do indicador:", `${page.name} — ${new Date().toLocaleTimeString("pt-BR")}`);
    if (name?.trim()) dispatch({ type: "addBookmark", bookmark: captureBookmark(report, newId(), name.trim(), page.id) });
  };

  const selected = report.visuals.find((v) => v.id === selectedId);
  const pageVisualIds = new Set(report.visuals.filter((v) => v.pageId === page.id).map((v) => v.id));
  const pageFilters = report.filters.filter((f) => pageVisualIds.has(f.sourceVisualId));
  const palette = PALETTES[report.theme.palette] ?? PALETTES.padrao;

  return (
    <PaletteContext.Provider value={palette.colors}>
      <div className={"app" + (viewOnly ? " view-only" : "")} data-theme={report.theme.mode}>
        <header className="topbar">
          <strong className="brand">Mini BI</strong>
          {!viewOnly && (
            <nav>
              {([["report", "Relatório"], ["data", "Dados"], ["model", "Modelo"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>{label}</button>
              ))}
            </nav>
          )}
          {viewOnly && <span className="muted-on-dark">Relatório publicado · somente leitura</span>}
          <span style={{ flex: 1 }} />
          {busy && <span className="muted-on-dark">{busy}…</span>}
          {!viewOnly && (
            <>
              <button title="Desfazer (Ctrl+Z)" disabled={history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>↶</button>
              <button title="Refazer (Ctrl+Y)" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>↷</button>
            </>
          )}

          <Menu label="🔖 Indicadores">
            {report.bookmarks.length === 0 && <div className="menu-note">Nenhum indicador salvo.</div>}
            {report.bookmarks.map((b) => (
              <div key={b.id} className="menu-row">
                <button
                  className="menu-item grow"
                  title="Aplicar: volta à página, filtros e drill salvos"
                  onClick={() => {
                    dispatch({ type: "applyBookmark", id: b.id });
                    goToPage(b.pageId);
                  }}
                >
                  {b.name}
                </button>
                {!viewOnly && (
                  <>
                    <button
                      className="menu-icon"
                      title="Renomear"
                      onClick={() => {
                        const name = prompt("Novo nome:", b.name);
                        if (name?.trim()) dispatch({ type: "renameBookmark", id: b.id, name: name.trim() });
                      }}
                    >
                      ✎
                    </button>
                    <button className="menu-icon" title="Excluir" onClick={() => dispatch({ type: "removeBookmark", id: b.id })}>✕</button>
                  </>
                )}
              </div>
            ))}
            {!viewOnly && (
              <button className="menu-item accent" onClick={addBookmark}>+ Salvar estado atual como indicador</button>
            )}
          </Menu>

          {!viewOnly && (
            <Menu label="🎨 Tema">
              <div className="menu-note">Modo</div>
              {(["light", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  className={"menu-item" + (report.theme.mode === mode ? " checked" : "")}
                  onClick={() => dispatch({ type: "setTheme", theme: { ...report.theme, mode } })}
                >
                  {mode === "light" ? "☀ Claro" : "☾ Escuro"}
                </button>
              ))}
              <div className="menu-note">Cores dos visuais</div>
              {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
                <button
                  key={name}
                  className={"menu-item" + (report.theme.palette === name ? " checked" : "")}
                  onClick={() => dispatch({ type: "setTheme", theme: { ...report.theme, palette: name } })}
                >
                  <span className="swatches">
                    {PALETTES[name].colors.slice(0, 5).map((c) => <span key={c} style={{ background: c }} />)}
                  </span>
                  {PALETTES[name].label}
                </button>
              ))}
            </Menu>
          )}

          <Menu label="Arquivo ▾" align="right">
            {!viewOnly && (
              <>
                <button className="menu-item" onClick={exportJson}>Salvar relatório (.json)</button>
                <button className="menu-item" onClick={() => fileRef.current?.click()}>Abrir relatório (.json)</button>
                <div className="menu-sep" />
              </>
            )}
            <button
              className="menu-item"
              onClick={() => {
                setTab("report");
                void run("Gerando imagem", () => exportPagePng(page.name));
              }}
            >
              Exportar página como imagem (PNG)
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setTab("report");
                setTimeout(printPage, 50);
              }}
            >
              Imprimir / salvar página em PDF
            </button>
            {!viewOnly && (
              <>
                <button className="menu-item" onClick={() => void run("Publicando", () => publishReport(report))}>
                  Publicar relatório (HTML para compartilhar)
                </button>
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    if (confirm("Descartar o relatório atual e voltar ao exemplo?")) {
                      dispatch({ type: "reset", report: sampleReport() });
                      setSelectedId(null);
                    }
                  }}
                >
                  Restaurar exemplo
                </button>
              </>
            )}
          </Menu>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        </header>

        {tab === "report" && pageFilters.length > 0 && (
          <div className="filterbar">
            <span className="muted small">Filtros ativos:</span>
            {pageFilters.map((f) => (
              <span key={f.sourceVisualId} className="chip">
                {fieldKey(f.field)} {f.range ? summarizeRange(f.range) : `= ${summarizeValues(f.values)}`}
                <button
                  className="link"
                  onClick={() => dispatch({ type: "setFilter", sourceVisualId: f.sourceVisualId, filter: null })}
                >
                  ✕
                </button>
              </span>
            ))}
            <button className="link" onClick={() => dispatch({ type: "clearFilters", pageId: page.id })}>Limpar todos</button>
          </div>
        )}

        <main className="workspace">
          {!viewOnly && (
            <FieldsPane
              report={report}
              dispatch={dispatch}
              onAddVisual={addVisual}
              onEditMeasure={(m) => setEditing(m)}
              onEditColumn={(table, column) => setEditingColumn({ table, column })}
            />
          )}
          <section className="center">
            {tab === "report" && (
              <>
                {report.drillthrough?.pageId === page.id && (
                  <div className="drillbar">
                    <button
                      onClick={() => {
                        const from = report.drillthrough!.fromPageId;
                        dispatch({ type: "clearDrillthrough" });
                        goToPage(from);
                      }}
                    >
                      ← Voltar
                    </button>
                    <span>
                      Detalhando <strong>{fieldLabel(report.drillthrough.field)} = {formatValue(report.drillthrough.value)}</strong>
                      {" "}(vindo de {report.pages.find((p) => p.id === report.drillthrough!.fromPageId)?.name ?? "outra página"})
                    </span>
                    <button className="link" onClick={() => dispatch({ type: "clearDrillthrough" })}>Mostrar todos</button>
                  </div>
                )}
                <Canvas
                  report={report}
                  pageId={page.id}
                  dispatch={dispatch}
                  selectedId={selectedId}
                  onSelectVisual={setSelectedId}
                  readOnly={viewOnly}
                  onAction={runAction}
                  onDrillthrough={(targetId, field, value) => {
                    dispatch({ type: "drillthrough", state: { pageId: targetId, field, value, fromPageId: page.id } });
                    goToPage(targetId);
                  }}
                />
                <div className="pagebar">
                  {report.pages.map((p) =>
                    renaming === p.id ? (
                      <input
                        key={p.id}
                        autoFocus
                        className="page-rename"
                        defaultValue={p.name}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name) dispatch({ type: "renamePage", id: p.id, name });
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button
                        key={p.id}
                        className={p.id === page.id ? "page-tab active" : "page-tab"}
                        onClick={() => goToPage(p.id)}
                        onDoubleClick={() => !viewOnly && setRenaming(p.id)}
                        title={viewOnly ? p.name : "Clique duplo para renomear"}
                      >
                        {p.name}
                        {!viewOnly && p.id === page.id && report.pages.length > 1 && (
                          <span
                            className="page-close"
                            title="Excluir página"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Excluir a página "${p.name}" e seus visuais?`)) {
                                dispatch({ type: "removePage", id: p.id });
                              }
                            }}
                          >
                            ✕
                          </span>
                        )}
                      </button>
                    ),
                  )}
                  {!viewOnly && <button className="page-tab add" title="Nova página" onClick={addPage}>+</button>}
                </div>
              </>
            )}
            {tab === "data" && (
              <DataView report={report} dispatch={dispatch} onEditColumn={(table, column) => setEditingColumn({ table, column })} />
            )}
            {tab === "model" && <ModelView report={report} dispatch={dispatch} />}
          </section>
          {tab === "report" && (
            <PropertiesPane report={report} visual={selected} pageId={page.id} dispatch={dispatch} filtersOnly={viewOnly} />
          )}
        </main>

        {editingColumn && (
          <ColumnEditor
            report={report}
            tableName={editingColumn.table}
            column={editingColumn.column}
            dispatch={dispatch}
            onClose={() => setEditingColumn(null)}
          />
        )}
        {editing !== undefined && (
          <MeasureEditor report={report} measure={editing} dispatch={dispatch} onClose={() => setEditing(undefined)} />
        )}
      </div>
    </PaletteContext.Provider>
  );
}
