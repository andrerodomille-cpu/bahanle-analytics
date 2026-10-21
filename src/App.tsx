import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ButtonAction, Column, Measure, PaletteName, Report, Value, ValueRange, Visual, VisualType } from "./model/types";
import { fieldKey, fieldLabel, newId } from "./model/types";
import { captureBookmark, emptyReport, historyReducer, loadReport, migrate, saveReport } from "./model/store";
import { sampleReport } from "./model/sampleData";
import { formatValue } from "./model/format";
import { PALETTES, PaletteContext } from "./model/theme";
import { PlanContext, planAccess } from "./model/planContext";
import { planById, type PlanId } from "./model/plans";
import { exportPagePng, printPage, publishReport } from "./model/publish";
import { Canvas } from "./components/Canvas";
import { ColumnEditor, FieldsPane, MeasureEditor, PropertiesPane, VISUAL_TYPES } from "./components/Panels";
import { DataView, ModelView } from "./components/DataModelViews";
import { MEASURE_SLOTS } from "./components/VisualView";
import { Menu } from "./components/Menu";
import { PerfPanel } from "./components/Package4Visuals";
import { ArrangePane } from "./components/Arrange";
import { NotebookView } from "./components/Notebook";
import { AiAssistant } from "./components/AiAssistant";
import { BrandMark, Home, NameDialog } from "./components/Home";
import { UsersAdmin } from "./components/UsersAdmin";
import type { CloudLink, CloudSummary } from "./model/cloud";
import { CloudError, contentChanged, createCloudReport, loadLink, openCloudReport, saveCloudReport, storeLink } from "./model/cloud";
import { expandGroups } from "./engine/arrange";

type Tab = "report" | "data" | "model" | "notebook";

export interface Account {
  email: string;
  name: string;
  picture?: string;
  /** O plano da conta (free, iniciante, intermediario, avancado) ou "admin". */
  role?: "admin" | PlanId;
}

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
  multicard: [450, 300],
  funnel: [450, 300],
  fieldparam: [450, 50],
  bullet: [450, 200],
  radar: [450, 320],
  calendar: [910, 230],
  whatif: [300, 110],
  sankey: [450, 320],
  gantt: [600, 320],
  pareto: [450, 300],
  narrative: [450, 200],
  dumbbell: [450, 300],
  sunburst: [400, 360],
  waffle: [450, 300],
  pictogram: [450, 300],
  violin: [500, 320],
  bump: [600, 320],
};

/** Quantas medidas um visual novo já recebe. */
const DEFAULT_MEASURES: Partial<Record<VisualType, number>> = {
  scatter: 2, combo: 2, text: 0, button: 0, slicer: 0, histogram: 0, boxplot: 0, image: 0, fieldparam: 0, multicard: 2, whatif: 0, gantt: 0, radar: 3,
  dumbbell: 2, violin: 0,
};

/**
 * `viewOnly` é o relatório publicado: quem recebe o HTML navega, filtra, faz
 * drill e exporta, mas não edita o modelo nem o layout.
 */
export default function App({ initial, viewOnly = false, account = null }: {
  initial?: Report;
  viewOnly?: boolean;
  /** Conta Google da sessão (o servidor só entrega o app depois do login). */
  account?: Account | null;
}) {
  // Rascunho e vínculo com a nuvem ficam separados por conta no navegador.
  const owner = account?.email;
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: initial ?? loadReport(owner),
    future: [],
  }));
  const report = history.present;
  const [tab, setTab] = useState<Tab>("report");
  const [pageId, setPageId] = useState(report.pages[0].id);
  // Seleção de visuais: Ctrl/Shift+clique no título acumula; um membro de grupo seleciona o grupo.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  // Layout para celular: escolhido no editor; no relatório publicado, automático em telas estreitas.
  const [mobile, setMobile] = useState(() => viewOnly && typeof window !== "undefined" && window.innerWidth <= 700);
  useEffect(() => {
    if (!viewOnly) return;
    const mq = window.matchMedia("(max-width: 700px)");
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [viewOnly]);
  const [editing, setEditing] = useState<Measure | null | undefined>(undefined);
  const [editingColumn, setEditingColumn] = useState<{ table: string | null; column: Column | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Analisador de desempenho: painel aberto, época do motor (cache frio) e tique (cache quente).
  const [perfOpen, setPerfOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const user = viewOnly ? null : account;
  const [usersOpen, setUsersOpen] = useState(false);

  // Relatório da nuvem aberto no editor e o conteúdo dele como está salvo lá.
  const [cloud, setCloud] = useState<CloudLink | null>(() => (viewOnly ? null : loadLink(owner)));
  // Com login, o app abre na página inicial (relatórios da conta); o editor vem depois.
  const [view, setView] = useState<"home" | "editor">(viewOnly || !account ? "editor" : "home");
  // Janela de nome (no lugar do prompt do navegador): resolve com o nome ou null.
  const [naming, setNaming] = useState<{ title: string; initial: string; action: string; resolve: (n: string | null) => void } | null>(null);
  const askName = (title: string, initialName: string, action: string) =>
    new Promise<string | null>((resolve) => setNaming({ title, initial: initialName, action, resolve }));
  const cloudSaved = useRef(report);
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;
  // Um salvamento por vez (manual ou automático); estado do automático para a barra.
  const saving = useRef(false);
  const [autoSave, setAutoSave] = useState<"ok" | "saving" | "conflict" | "error">("ok");
  const dirty = cloud !== null && contentChanged(cloudSaved.current, report);
  const linkCloud = (link: CloudLink | null, saved: Report = report) => {
    cloudSaved.current = saved;
    setCloud(link);
    storeLink(link, owner);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    location.reload();
  };
  const [engineEpoch, setEngineEpoch] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Salva automaticamente (com atraso, para não gravar a cada pixel arrastado).
  useEffect(() => {
    if (viewOnly) return;
    const t = setTimeout(() => saveReport(report, owner), 400);
    return () => clearTimeout(t);
  }, [report, viewOnly, owner]);

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
      } else if (e.key === "Delete" && selectedIds.length && tab === "report") {
        dispatch({ type: "removeVisuals", ids: selectedIds });
        setSelectedIds([]);
      } else if (e.key === "Escape" && selectedIds.length) {
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, tab, editing, editingColumn, viewOnly]);

  const selectVisual = (id: string | null, additive = false) => {
    if (!id) return setSelectedIds([]);
    const ids = expandGroups(report.visuals, [id]);
    if (!ids.includes(id)) ids.push(id); // recém-criado (ainda fora de report.visuals)
    setSelectedIds((cur) => {
      if (additive) return cur.includes(id) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((x) => !cur.includes(x))];
      // Clicar num visual já selecionado mantém a seleção (para arrastar o conjunto).
      return cur.includes(id) ? cur : ids;
    });
  };

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
    a.download = "relatorio.bahanle.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Report;
      if (!Array.isArray(data.tables) || !Array.isArray(data.visuals)) throw new Error("formato inválido");
      dispatch({ type: "reset", report: migrate({ ...data, filters: [] }) });
      linkCloud(null);
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

  /**
   * Salvar na nuvem: atualiza o relatório aberto ou cria um novo (pede o nome).
   * Se outra aba ou computador salvou antes (409), pergunta se sobrescreve.
   */
  const saveToCloud = async (asCopy = false) => {
    // Relatório novo ou cópia: o nome vem antes (a janela não conta como "salvando").
    let name: string | null = null;
    if (!cloud || asCopy) {
      name = cloud
        ? await askName("Salvar uma cópia", `${cloud.name} (cópia)`, "Salvar cópia")
        : await askName("Salvar relatório", "Novo relatório", "Salvar");
      if (!name) return;
    }
    await run("Salvando", async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        await saveNow(name);
      } finally {
        saving.current = false;
      }
    });
  };

  const saveNow = async (newName: string | null) => {
    const snapshot = report;
    let link: CloudLink;
    if (cloud && !newName) {
      try {
        link = await saveCloudReport(cloud, snapshot);
      } catch (e) {
        if (!(e instanceof CloudError) || (e.status !== 409 && e.status !== 404)) throw e;
        if (e.status === 409) {
          if (!confirm(`"${cloud.name}" foi salvo em outro lugar depois que você o abriu.

Sobrescrever com a versão desta tela?`)) return;
          link = await saveCloudReport(cloud, snapshot, true);
        } else {
          if (!confirm(`"${cloud.name}" não existe mais na nuvem. Salvar como um relatório novo?`)) return;
          link = await createCloudReport(cloud.name, snapshot);
        }
      }
    } else {
      link = await createCloudReport(newName ?? "Novo relatório", snapshot);
    }
    linkCloud(link, snapshot);
    setAutoSave("ok");
  };

  /**
   * Salvamento automático: com o relatório já na nuvem, cada alteração é
   * gravada alguns segundos depois da última mexida. Se outra aba ou outro
   * computador salvou antes (409), para e pede um Ctrl+S (que pergunta).
   */
  useEffect(() => {
    if (viewOnly || !cloud || !dirty || autoSave === "conflict") return;
    const t = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      setAutoSave("saving");
      const snapshot = report;
      const target = cloud;
      try {
        const link = await saveCloudReport(target, snapshot);
        // Trocou de relatório enquanto salvava: o vínculo novo não muda.
        if (cloudRef.current?.id === target.id) linkCloud(link, snapshot);
        setAutoSave("ok");
      } catch (e) {
        setAutoSave(e instanceof CloudError && (e.status === 409 || e.status === 404) ? "conflict" : "error");
      } finally {
        saving.current = false;
      }
    }, autoSave === "error" ? 15_000 : 2_500);
    return () => clearTimeout(t);
  }, [report, cloud, dirty, autoSave, viewOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fechar a aba com alterações que ainda não foram para a nuvem: o navegador pergunta.
  useEffect(() => {
    if (!cloud || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cloud, dirty]);

  /** Arquivo › Novo relatório: em branco (ou o exemplo), já salvo na nuvem com o nome escolhido. */
  /** O editor tem conteúdo que não está em nenhum relatório salvo (rascunho sem nome). */
  const unnamedDraft = !cloud && (report.visuals.length > 0 || report.tables.length > 0);

  /**
   * Antes de trocar o relatório do editor: grava o que falta do atual (sem
   * esperar o automático) e, se for um rascunho sem nome, pergunta.
   */
  const leaveCurrent = async (): Promise<boolean> => {
    if (cloud && dirty && !saving.current) {
      try {
        linkCloud(await saveCloudReport(cloud, report), report);
      } catch {
        return confirm(`Não deu para salvar as últimas alterações de "${cloud.name}". Continuar mesmo assim?`);
      }
    }
    return !unnamedDraft || confirm("O rascunho sem nome deste navegador será descartado. Continuar? (Para guardar, use Arquivo › Salvar.)");
  };

  /** Coloca um relatório no editor (aberto da lista ou recém-criado). */
  const showReport = (next: Report, link: CloudLink | null) => {
    dispatch({ type: "reset", report: next });
    linkCloud(link, next);
    setSelectedIds([]);
    setPageId(next.pages[0].id);
    setTab("report");
    setAutoSave("ok");
    setView("editor");
  };

  /** Novo relatório: em branco ou a partir do modelo, já criado na conta com o nome escolhido. */
  const startNew = async (example = false) => {
    const name = await askName(example ? "Novo a partir do modelo" : "Novo relatório", example ? "Vendas (modelo)" : "Novo relatório", "Criar");
    if (!name || !(await leaveCurrent())) return;
    const next = example ? sampleReport() : emptyReport();
    if (!user) return showReport(next, null);
    await run("Criando", async () => showReport(next, await createCloudReport(name, next)));
  };

  /** Abrir um relatório da página inicial. */
  const openFromHome = async (r: CloudSummary) => {
    if (cloud?.id === r.id) return setView("editor");
    if (!(await leaveCurrent())) return;
    await run(`Abrindo ${r.name}`, async () => {
      const { link, report: opened } = await openCloudReport(r.id);
      showReport(opened, link);
    });
  };

  // Ctrl+S salva na nuvem (em vez do "salvar página" do navegador).
  useEffect(() => {
    if (viewOnly || !user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!busy) void saveToCloud();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
  const selection = report.visuals.filter((v) => selectedIds.includes(v.id) && v.pageId === page.id);
  const pageVisualIds = new Set(report.visuals.filter((v) => v.pageId === page.id).map((v) => v.id));
  const pageFilters = report.filters.filter((f) => pageVisualIds.has(f.sourceVisualId));
  const palette = PALETTES[report.theme.palette] ?? PALETTES.padrao;
  // Visuais liberados pelo plano da conta (sem conta: todos).
  const plan = useMemo(() => planAccess(user ? user.role ?? "free" : "admin"), [user]);

  const userMenu = user && (
    <Menu label={user.name.split(" ")[0]} align="right">
      <div className="menu-note user-card">
        {user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
        <span><strong>{user.name}</strong><br />{user.email}</span>
      </div>
      <div className="menu-note user-plan">
        {user.role === "admin" ? "Administrador · todos os visuais" : `Plano ${planById(user.role)?.name ?? "Gratuito"} · ${plan.allowed.size} de 45 visuais`}
        <a href="/planos" target="_blank" rel="noopener">Ver planos</a>
      </div>
      <div className="menu-sep" />
      {view === "editor" && <button className="menu-item" onClick={() => setView("home")}>⌂ Meus relatórios</button>}
      {user.role === "admin" && <button className="menu-item" onClick={() => setUsersOpen(true)}>👥 Usuários…</button>}
      <button className="menu-item" onClick={() => void logout()}>Sair</button>
    </Menu>
  );

  return (
    <PaletteContext.Provider value={palette.colors}>
    <PlanContext.Provider value={plan}>
      <div className={"app" + (viewOnly ? " view-only" : "")} data-theme={report.theme.mode}>
        {view === "home" && user && (
          <>
            <header className="topbar home-top">
              <span className="brand"><BrandMark />Bahanle <span>Analytics</span></span>
              <span style={{ flex: 1 }} />
              {busy && <span className="muted-on-dark">{busy}…</span>}
              {userMenu}
            </header>
            <Home
              firstName={user.name.split(" ")[0]}
              current={cloud ? { id: cloud.id, name: cloud.name, unsaved: dirty }
                : unnamedDraft ? { name: "Rascunho sem nome", unsaved: true } : null}
              onContinue={() => setView("editor")}
              onOpen={(r) => void openFromHome(r)}
              onCreate={(from) => void startNew(from === "example")}
              askName={askName}
              onCurrentChanged={(s) => (s && cloud ? linkCloud({ ...cloud, name: s.name, version: s.version }, cloudSaved.current) : linkCloud(null))}
            />
          </>
        )}
        {view === "editor" && (<>
        <header className="topbar">
          {viewOnly || !user
            ? <span className="brand"><BrandMark />Bahanle <span>Analytics</span></span>
            : <button className="brand" title="Início: meus relatórios" onClick={() => setView("home")}><BrandMark />Bahanle <span>Analytics</span></button>}
          {!viewOnly && (
            <nav>
              {([["report", "Relatório"], ["data", "Dados"], ["model", "Modelo"], ["notebook", "Notebooks"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>{label}</button>
              ))}
            </nav>
          )}
          {viewOnly && <span className="muted-on-dark">Relatório publicado · somente leitura</span>}
          {cloud && (
            <span className="cloud-status" title={dirty ? "Alterações ainda não salvas (salva sozinho em instantes; Ctrl+S salva já)" : "Tudo salvo"}>
              {cloud.name}
              {autoSave === "conflict" ? <span className="cloud-dirty"> ⚠ salvo em outro lugar — Ctrl+S</span>
                : autoSave === "error" && dirty ? <span className="cloud-dirty"> ⚠ sem conexão, tentando de novo</span>
                : autoSave === "saving" ? <span> · salvando…</span>
                : dirty ? <span className="cloud-dirty"> • não salvo</span>
                : <span className="cloud-ok"> ✓ salvo</span>}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {busy && <span className="muted-on-dark">{busy}…</span>}
          {!viewOnly && (
            <>
              <button title="Desfazer (Ctrl+Z)" disabled={history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>↶</button>
              <button title="Refazer (Ctrl+Y)" disabled={history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>↷</button>
            </>
          )}
          <button
            className={mobile ? "active" : ""}
            title="Layout para celular: visuais empilhados em uma coluna, na ordem de leitura"
            onClick={() => {
              setMobile((m) => !m);
              setSelectedIds([]);
            }}
          >
            📱 Celular
          </button>

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

          {!viewOnly && (
            <button className={aiOpen ? "active" : ""} title="Criar dashboards descrevendo em texto (IA local no Ollama)" onClick={() => setAiOpen(!aiOpen)}>
              ✨ IA
            </button>
          )}
          {!viewOnly && (
            <button className={perfOpen ? "active" : ""} title="Analisador de desempenho" onClick={() => {
              setPerfOpen(!perfOpen);
              setTab("report");
            }}>
              ⏱ Desempenho
            </button>
          )}
          <Menu label="Arquivo ▾" align="right">
            {!viewOnly && (
              <>
                {user && (
                  <>
                    <button className="menu-item" onClick={() => setView("home")}>⌂ Meus relatórios</button>
                    <button className="menu-item" onClick={() => void startNew()}>Novo relatório…</button>
                    <button className="menu-item" onClick={() => void startNew(true)}>Novo a partir do modelo…</button>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={() => void saveToCloud()}>
                      {cloud ? "Salvar" : "Salvar…"} <span className="menu-key">Ctrl+S</span>
                    </button>
                    {cloud && <button className="menu-item" onClick={() => void saveToCloud(true)}>Salvar uma cópia…</button>}
                    <div className="menu-sep" />
                  </>
                )}
                <button className="menu-item" onClick={exportJson}>Exportar como arquivo (.json)</button>
                <button className="menu-item" onClick={() => fileRef.current?.click()}>Importar arquivo (.json)</button>
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
              </>
            )}
          </Menu>
          {userMenu}
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
          {!viewOnly && tab !== "notebook" && (
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
                  selectedIds={selectedIds}
                  onSelectVisual={selectVisual}
                  mobile={mobile}
                  readOnly={viewOnly}
                  engineEpoch={engineEpoch}
                  renderTick={renderTick}
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
            {tab === "report" && perfOpen && (
              <PerfPanel
                visualIds={new Set(report.visuals.filter((v) => v.pageId === page.id).map((v) => v.id))}
                onRefreshCold={() => setEngineEpoch((n) => n + 1)}
                onRefreshWarm={() => setRenderTick((n) => n + 1)}
                onClose={() => setPerfOpen(false)}
              />
            )}
            {tab === "data" && (
              <DataView report={report} dispatch={dispatch} onEditColumn={(table, column) => setEditingColumn({ table, column })} />
            )}
            {tab === "model" && <ModelView report={report} dispatch={dispatch} />}
            {tab === "notebook" && <NotebookView report={report} dispatch={dispatch} />}
          </section>
          {tab === "report" && (
            selection.length > 1 && !viewOnly
              ? <ArrangePane visuals={selection} dispatch={dispatch} onSelect={setSelectedIds} />
              : <PropertiesPane report={report} visual={selected} pageId={page.id} dispatch={dispatch} filtersOnly={viewOnly} />
          )}
        </main>

        {aiOpen && !viewOnly && (
          <AiAssistant
            report={report}
            pageId={page.id}
            dispatch={dispatch}
            onGoToPage={goToPage}
            onClose={() => setAiOpen(false)}
          />
        )}
        </>)}
        {usersOpen && user && <UsersAdmin me={user.email} onClose={() => setUsersOpen(false)} />}
        {naming && (
          <NameDialog
            title={naming.title}
            initial={naming.initial}
            action={naming.action}
            onDone={(name) => {
              naming.resolve(name);
              setNaming(null);
            }}
          />
        )}
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
    </PlanContext.Provider>
    </PaletteContext.Provider>
  );
}
