import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch } from "react";
import {
  Area, Bar, CartesianGrid, Cell as PieCell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import type { CellDisplay, ChartKind, NotebookCell, Report, Value } from "../model/types";
import { newId } from "../model/types";
import type { Action } from "../model/store";
import { Session } from "../engine/sql";
import type { PlanNode, RunResult, StatementResult } from "../engine/sql";
import { TextVisual } from "./MoreVisuals";
import { usePalette } from "../model/theme";
import { downloadText } from "../model/exportCsv";

/**
 * Notebooks no estilo do Databricks: células de SQL e Markdown executadas
 * numa sessão (o "cluster"). Tabelas criadas com CREATE TABLE … AS vão para o
 * modelo do relatório; visões temporárias vivem só na sessão.
 */

interface CellRun {
  status: "running" | "done" | "error";
  run?: RunResult;
  /** Número da execução, como o [3] dos notebooks. */
  count: number;
}

const ROW_LIMIT = 1000;
const CHART_LIMIT = 500;

/** "%md" / "%sql" na primeira linha escolhe a linguagem, como no Databricks. */
function effectiveLang(cell: NotebookCell): "sql" | "md" {
  const first = cell.source.trimStart().split("\n")[0].trim().toLowerCase();
  if (first === "%md") return "md";
  if (first === "%sql") return "sql";
  return cell.lang;
}
const stripMagic = (src: string) => src.replace(/^\s*%(md|sql)[^\n]*\n?/i, "");

export function NotebookView({ report, dispatch }: { report: Report; dispatch: Dispatch<Action> }) {
  const notebooks = report.notebooks ?? [];
  const [activeId, setActiveId] = useState<string | undefined>(notebooks[0]?.id);
  const nb = notebooks.find((n) => n.id === activeId) ?? notebooks[0];

  // Uma sessão por notebook; as tabelas acompanham o modelo, as visões ficam.
  const sessions = useRef(new Map<string, Session>());
  const session = useMemo(() => {
    if (!nb) return null;
    let s = sessions.current.get(nb.id);
    if (!s) {
      s = new Session(report.tables);
      sessions.current.set(nb.id, s);
    }
    return s;
  }, [nb, report.tables]);
  if (session) session.tables = report.tables;

  const [runs, setRuns] = useState<Record<string, CellRun>>({});
  const counter = useRef(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const editors = useRef(new Map<string, HTMLTextAreaElement>());
  const [, setViewsTick] = useState(0);

  if (!nb || !session) {
    return (
      <div className="view-empty">
        Nenhum notebook.{" "}
        <button onClick={() => {
          const id = newId();
          dispatch({ type: "addNotebook", notebook: { id, name: "Notebook 1", cells: [{ id: newId(), lang: "sql", source: "SELECT 1" }] } });
          setActiveId(id);
        }}>+ Novo notebook</button>
      </div>
    );
  }

  const setCells = (cells: NotebookCell[]) => dispatch({ type: "updateNotebook", id: nb.id, patch: { cells } });
  const updateCell = (id: string, patch: Partial<NotebookCell>) =>
    setCells(nb.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** Executa uma célula e aplica os efeitos (tabelas novas ou removidas) no modelo. */
  const execute = (cell: NotebookCell): boolean => {
    if (effectiveLang(cell) === "md") return true;
    const count = ++counter.current;
    const run = session.run(stripMagic(cell.source));
    for (const r of run.results) {
      if (r.effect?.kind === "createTable") dispatch({ type: "addTable", table: r.effect.table });
      if (r.effect?.kind === "dropTable") dispatch({ type: "removeTable", name: r.effect.name });
    }
    setRuns((prev) => ({ ...prev, [cell.id]: { status: run.error ? "error" : "done", run, count } }));
    setViewsTick((n) => n + 1);
    return !run.error;
  };

  const runCell = (cell: NotebookCell) => {
    setRuns((prev) => ({ ...prev, [cell.id]: { ...(prev[cell.id] ?? { count: 0 }), status: "running" } }));
    // Deixa a tela mostrar "executando" antes do trabalho.
    setTimeout(() => execute(cell), 0);
  };

  const runAll = () => {
    setTimeout(() => {
      for (const c of nb.cells) if (!execute(c)) break;
    }, 0);
  };

  const addCell = (lang: "sql" | "md", after?: string) => {
    const cell: NotebookCell = { id: newId(), lang, source: "" };
    const i = after ? nb.cells.findIndex((c) => c.id === after) + 1 : nb.cells.length;
    setCells([...nb.cells.slice(0, i), cell, ...nb.cells.slice(i)]);
    setFocusId(cell.id);
    return cell;
  };

  const moveCell = (id: string, d: -1 | 1) => {
    const i = nb.cells.findIndex((c) => c.id === id);
    const j = i + d;
    if (j < 0 || j >= nb.cells.length) return;
    const cells = [...nb.cells];
    [cells[i], cells[j]] = [cells[j], cells[i]];
    setCells(cells);
  };

  /** Shift+Enter: executa e vai para a próxima (cria uma se for a última). */
  const runAndAdvance = (cell: NotebookCell) => {
    runCell(cell);
    const i = nb.cells.findIndex((c) => c.id === cell.id);
    const next = nb.cells[i + 1] ?? addCell("sql", cell.id);
    setFocusId(next.id);
  };

  /** Clique no catálogo: insere o nome na célula em foco, na posição do cursor. */
  const insert = (text: string) => {
    const target = nb.cells.find((c) => c.id === focusId) ?? [...nb.cells].reverse().find((c) => effectiveLang(c) === "sql");
    if (!target) return;
    const el = editors.current.get(target.id);
    const pos = el ? el.selectionStart : target.source.length;
    const end = el ? el.selectionEnd : pos;
    updateCell(target.id, { source: target.source.slice(0, pos) + text + target.source.slice(end) });
    setFocusId(target.id);
    requestAnimationFrame(() => {
      const e2 = editors.current.get(target.id);
      if (e2) {
        e2.focus();
        e2.setSelectionRange(pos + text.length, pos + text.length);
      }
    });
  };

  const quote = (name: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `\`${name}\``);

  return (
    <div className="notebook-view">
      <aside className="nb-side">
        <h3>Notebooks</h3>
        {notebooks.map((n) => (
          <button key={n.id} className={"nb-item" + (n.id === nb.id ? " active" : "")} onClick={() => setActiveId(n.id)}>
            📓 {n.name}
          </button>
        ))}
        <button className="link" onClick={() => {
          const id = newId();
          dispatch({
            type: "addNotebook",
            notebook: { id, name: `Notebook ${notebooks.length + 1}`, cells: [{ id: newId(), lang: "sql", source: "" }] },
          });
          setActiveId(id);
        }}>+ Novo notebook</button>

        <h3>Catálogo</h3>
        <Catalog report={report} views={[...session.views.keys()]} onInsert={(t) => insert(quote(t))} />
      </aside>

      <section className="nb-main">
        <div className="nb-header">
          <input className="nb-title" value={nb.name} onChange={(e) => dispatch({ type: "updateNotebook", id: nb.id, patch: { name: e.target.value } })} />
          <span className="nb-cluster" title="A sessão guarda as visões temporárias; reiniciar apaga as visões e os resultados">
            ● Sessão ativa · {session.views.size} {session.views.size === 1 ? "visão temporária" : "visões temporárias"}
          </span>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={runAll}>▶ Executar tudo</button>
          <button onClick={() => setRuns({})}>Limpar resultados</button>
          <button onClick={() => {
            sessions.current.delete(nb.id);
            setRuns({});
            setViewsTick((n) => n + 1);
          }}>⟲ Reiniciar sessão</button>
          <button className="danger" onClick={() => {
            if (!confirm(`Excluir o notebook "${nb.name}"? As tabelas criadas por ele continuam no modelo.`)) return;
            dispatch({ type: "removeNotebook", id: nb.id });
            setActiveId(undefined);
          }}>Excluir</button>
        </div>

        {nb.cells.map((cell, i) => (
          <CellView
            key={cell.id}
            cell={cell}
            index={i}
            run={runs[cell.id]}
            focused={focusId === cell.id}
            onFocus={() => setFocusId(cell.id)}
            registerEditor={(el) => {
              if (el) editors.current.set(cell.id, el);
              else editors.current.delete(cell.id);
            }}
            onChange={(patch) => updateCell(cell.id, patch)}
            onRun={() => runCell(cell)}
            onRunAdvance={() => runAndAdvance(cell)}
            onMove={(d) => moveCell(cell.id, d)}
            onDelete={() => setCells(nb.cells.filter((c) => c.id !== cell.id))}
            onAdd={(lang) => addCell(lang, cell.id)}
            onSaveAsTable={(text) => {
              const name = prompt("Nome da nova tabela no modelo:", "resultado_" + (i + 1));
              if (!name?.trim()) return;
              // A célula nova guarda o comando: rodar de novo atualiza a tabela.
              const created: NotebookCell = { id: newId(), lang: "sql", source: `CREATE OR REPLACE TABLE ${quote(name.trim())} AS\n${text}` };
              setCells([...nb.cells.slice(0, i + 1), created, ...nb.cells.slice(i + 1)]);
              setFocusId(created.id);
              setTimeout(() => execute(created), 0);
            }}
          />
        ))}
        <div className="nb-add">
          <button onClick={() => addCell("sql")}>+ SQL</button>
          <button onClick={() => addCell("md")}>+ Texto (Markdown)</button>
        </div>
      </section>
    </div>
  );
}

// ---------------- Catálogo (tabelas, colunas e visões) ----------------

const TYPE_ICON = { number: "#", text: "Aa", date: "📅" } as const;

function Catalog({ report, views, onInsert }: { report: Report; views: string[]; onInsert: (name: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="nb-catalog">
      {report.tables.map((t) => (
        <div key={t.name}>
          <div className="nb-table">
            <button className="nb-toggle" onClick={() => setOpen({ ...open, [t.name]: !open[t.name] })}>{open[t.name] ? "▾" : "▸"}</button>
            <button className="nb-name" title="Inserir na célula" onClick={() => onInsert(t.name)}>
              {t.sql ? "✦" : "▦"} {t.name}
            </button>
            <span className="muted small">{t.rows.length.toLocaleString("pt-BR")}</span>
          </div>
          {open[t.name] && t.columns.map((c) => (
            <button key={c.name} className="nb-col" title="Inserir na célula" onClick={() => onInsert(c.name)}>
              <span className="nb-type">{TYPE_ICON[c.type]}</span> {c.name}
            </button>
          ))}
        </div>
      ))}
      {views.length > 0 && <div className="muted small nb-views-label">Visões temporárias</div>}
      {views.map((v) => (
        <button key={v} className="nb-name view" onClick={() => onInsert(v)}>◌ {v}</button>
      ))}
      <p className="muted small">✦ = criada por SQL. Clique para inserir o nome na célula.</p>
    </div>
  );
}

// ---------------- Célula ----------------

function CellView({
  cell, index, run, focused, onFocus, registerEditor, onChange, onRun, onRunAdvance, onMove, onDelete, onAdd, onSaveAsTable,
}: {
  cell: NotebookCell;
  index: number;
  run?: CellRun;
  focused: boolean;
  onFocus: () => void;
  registerEditor: (el: HTMLTextAreaElement | null) => void;
  onChange: (patch: Partial<NotebookCell>) => void;
  onRun: () => void;
  onRunAdvance: () => void;
  onMove: (d: -1 | 1) => void;
  onDelete: () => void;
  onAdd: (lang: "sql" | "md") => void;
  onSaveAsTable: (sql: string) => void;
}) {
  const lang = effectiveLang(cell);
  const [editingMd, setEditingMd] = useState(!cell.source.trim());
  const showEditor = lang === "sql" || editingMd;
  return (
    <div className={"nb-cell" + (focused ? " focused" : "")} onPointerDown={onFocus}>
      <div className="nb-cell-bar">
        <span className="nb-count">{lang === "sql" ? (run?.status === "running" ? "[*]" : run ? `[${run.count}]` : "[ ]") : ""}</span>
        <select value={cell.lang} onChange={(e) => onChange({ lang: e.target.value as NotebookCell["lang"] })} title="Linguagem (ou %md / %sql na primeira linha)">
          <option value="sql">SQL</option>
          <option value="md">Markdown</option>
        </select>
        <span className="muted small">Célula {index + 1}</span>
        <span style={{ flex: 1 }} />
        <button title="Executar (Ctrl+Enter)" onClick={() => (lang === "md" ? setEditingMd(false) : onRun())}>▶</button>
        <button title="Mover para cima" onClick={() => onMove(-1)}>↑</button>
        <button title="Mover para baixo" onClick={() => onMove(1)}>↓</button>
        <button title="Nova célula SQL abaixo" onClick={() => onAdd("sql")}>+</button>
        <button title="Excluir célula" onClick={onDelete}>✕</button>
      </div>
      {showEditor ? (
        <CodeEditor
          value={cell.source}
          lang={lang}
          autoFocus={focused}
          registerEditor={registerEditor}
          onFocus={onFocus}
          onChange={(source) => onChange({ source })}
          onRun={() => (lang === "md" ? setEditingMd(false) : onRun())}
          onRunAdvance={() => {
            if (lang === "md") setEditingMd(false);
            onRunAdvance();
          }}
          onBlur={() => lang === "md" && cell.source.trim() && setEditingMd(false)}
        />
      ) : (
        <div className="nb-md" title="Clique duplo para editar" onDoubleClick={() => setEditingMd(true)}>
          <TextVisual text={stripMagic(cell.source)} />
        </div>
      )}
      {lang === "sql" && run && <CellOutput cell={cell} run={run} onChange={onChange} onSaveAsTable={onSaveAsTable} />}
    </div>
  );
}

// ---------------- Editor com realce de sintaxe ----------------

const KEYWORDS = new Set((
  "SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AS AND OR NOT IN IS NULL " +
  "BETWEEN LIKE ILIKE CASE WHEN THEN ELSE END UNION ALL DISTINCT WITH ASC DESC NULLS FIRST LAST OVER PARTITION TRUE FALSE " +
  "CREATE REPLACE TABLE VIEW TEMP TEMPORARY DROP IF EXISTS SHOW TABLES DESCRIBE EXPLAIN CAST TRY_CAST USING DATE"
).split(" "));

const TOKEN_RE = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\]|\\.|'')*'?|"(?:[^"\\]|\\.)*"?)|(`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([\p{L}_][\p{L}\p{N}_]*)(?=\s*\()|([\p{L}_][\p{L}\p{N}_]*)|(%(?:sql|md)\b)/gu;

/** Realce de SQL para o editor (comentários, textos, números, palavras-chave, funções). */
function highlight(src: string, lang: "sql" | "md"): React.ReactNode[] {
  if (lang === "md") return [src];
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    if (m.index! > last) out.push(src.slice(last, m.index));
    const [text, comment, str, quoted, num, fn, word, magic] = m;
    const cls = comment ? "tk-comment" : str ? "tk-str" : quoted ? "tk-id" : num ? "tk-num" : magic ? "tk-magic"
      : fn ? (KEYWORDS.has(fn.toUpperCase()) ? "tk-kw" : "tk-fn") : word && KEYWORDS.has(word.toUpperCase()) ? "tk-kw" : null;
    out.push(cls ? <span key={k++} className={cls}>{text}</span> : text);
    last = m.index! + text.length;
  }
  out.push(src.slice(last));
  return out;
}

function CodeEditor({ value, lang, autoFocus, registerEditor, onFocus, onChange, onRun, onRunAdvance, onBlur }: {
  value: string;
  lang: "sql" | "md";
  autoFocus: boolean;
  registerEditor: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (v: string) => void;
  onRun: () => void;
  onRunAdvance: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    registerEditor(ref.current);
    return () => registerEditor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (autoFocus && ref.current && document.activeElement !== ref.current) ref.current.focus();
  }, [autoFocus]);
  // O bloco realçado fica no fluxo e dá a altura (inclusive com quebras de linha);
  // o textarea transparente fica por cima, exatamente alinhado.
  return (
    <div className={"nb-editor" + (lang === "md" ? " md" : "")}>
      <pre aria-hidden className="nb-highlight">{highlight(value, lang)}{"\n"}</pre>
      <textarea
        ref={ref}
        spellCheck={false}
        value={value}
        placeholder={lang === "sql" ? "SELECT … (Shift+Enter executa)" : "# Título, **negrito**, - lista…"}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            onRunAdvance();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onRun();
          } else if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = el;
            onChange(value.slice(0, a) + "  " + value.slice(b));
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
          }
        }}
      />
    </div>
  );
}

// ---------------- Resultado ----------------

function lineCol(src: string, pos: number) {
  const before = src.slice(0, pos).split("\n");
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

function CellOutput({ cell, run, onChange, onSaveAsTable }: {
  cell: NotebookCell;
  run: CellRun;
  onChange: (patch: Partial<NotebookCell>) => void;
  onSaveAsTable: (sql: string) => void;
}) {
  if (run.status === "running" && !run.run) return <div className="nb-output muted small">Executando…</div>;
  if (!run.run) return null;
  const { results, error } = run.run;
  // O resultado principal é o último com colunas; os outros comandos mostram só a mensagem.
  const main = [...results].reverse().find((r) => r.columns.length > 0);
  const messages = results.filter((r) => r.message && r !== main);
  const src = stripMagic(cell.source);
  return (
    <div className="nb-output">
      {messages.map((r, i) => <div key={i} className="nb-msg">✓ {r.message}</div>)}
      {main && <ResultView result={main} display={cell.display} onDisplay={(display) => onChange({ display })} onSaveAsTable={onSaveAsTable} />}
      {main?.message && <div className="nb-msg">✓ {main.message}</div>}
      {!error && !main && results.length === 0 && <div className="muted small">Nada para executar.</div>}
      {error && (
        <div className="nb-error">
          <strong>Erro{results.length || error.statement ? ` no comando ${error.statement + 1}` : ""}:</strong> {error.message}
          {error.pos !== undefined && (() => {
            const { line, col } = lineCol(src, error.pos);
            const text = src.split("\n")[line - 1] ?? "";
            return (
              <pre className="nb-error-at">{`linha ${line}, coluna ${col}\n${text}\n${" ".repeat(col - 1)}^`}</pre>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const fmtNum = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const fmtCell = (v: Value) => (v === null ? null : typeof v === "number" ? fmtNum(v) : v);

function toCsv(r: StatementResult) {
  const cell = (v: Value) => {
    if (v === null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [r.columns.map((c) => cell(c.name)).join(";"), ...r.rows.map((row) => row.map(cell).join(";"))].join("\n");
}

function ResultView({ result, display, onDisplay, onSaveAsTable }: {
  result: StatementResult;
  display?: CellDisplay;
  onDisplay: (d: CellDisplay) => void;
  onSaveAsTable: (sql: string) => void;
}) {
  const view = display?.view ?? "table";
  const isQuery = /^\s*(SELECT|WITH|\()/i.test(result.text);
  const ms = `${result.ms < 10 ? result.ms.toFixed(1) : Math.round(result.ms)} ms`.replace(".", ",");
  return (
    <div className="nb-result">
      <div className="nb-result-bar">
        {(["table", "chart", "plan"] as const).map((v) => (
          <button key={v} className={view === v ? "tab active" : "tab"} disabled={v === "plan" && !result.plan}
            onClick={() => onDisplay({ ...display, view: v })}>
            {v === "table" ? "▤ Tabela" : v === "chart" ? "📊 Gráfico" : "⛓ Plano"}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="muted small">
          {result.rows.length.toLocaleString("pt-BR")} {result.rows.length === 1 ? "linha" : "linhas"} · {ms}
        </span>
        <button title="Baixar CSV" onClick={() => downloadText("resultado.csv", toCsv(result))}>⭳ CSV</button>
        {isQuery && <button title="Gravar o resultado como tabela do modelo (CREATE TABLE … AS)" onClick={() => onSaveAsTable(result.text)}>✦ Salvar como tabela</button>}
      </div>
      {view === "table" && <ResultTable result={result} />}
      {view === "chart" && <ResultChart result={result} display={display ?? { view: "chart" }} onDisplay={onDisplay} />}
      {view === "plan" && result.plan && <PlanTree node={result.plan} max={maxRows(result.plan)} />}
    </div>
  );
}

function ResultTable({ result }: { result: StatementResult }) {
  const rows = result.rows.slice(0, ROW_LIMIT);
  return (
    <div className="nb-table-wrap">
      <table className="nb-grid">
        <thead>
          <tr>
            <th className="nb-rownum" />
            {result.columns.map((c, i) => (
              <th key={i} className={c.type === "number" ? "num" : ""}>
                <span className="nb-type">{TYPE_ICON[c.type]}</span> {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="nb-rownum">{i + 1}</td>
              {row.map((v, j) => (
                <td key={j} className={typeof v === "number" ? "num" : ""}>
                  {v === null ? <span className="nb-null">null</span> : fmtCell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > ROW_LIMIT && (
        <div className="muted small nb-trunc">Mostrando {ROW_LIMIT.toLocaleString("pt-BR")} de {result.rows.length.toLocaleString("pt-BR")} linhas (o CSV traz todas).</div>
      )}
    </div>
  );
}

const CHARTS: [ChartKind, string][] = [["bar", "Colunas"], ["line", "Linha"], ["area", "Área"], ["pie", "Rosca"], ["scatter", "Dispersão"]];

function ResultChart({ result, display, onDisplay }: { result: StatementResult; display: CellDisplay; onDisplay: (d: CellDisplay) => void }) {
  const palette = usePalette();
  const numeric = result.columns.filter((c) => c.type === "number").map((c) => c.name);
  const names = result.columns.map((c) => c.name);
  const kind = display.chart ?? "bar";
  const x = display.x && names.includes(display.x) ? display.x : result.columns.find((c) => c.type !== "number")?.name ?? names[0];
  const ys = (display.y ?? []).filter((y) => numeric.includes(y) && y !== x);
  const y = ys.length ? ys : numeric.filter((n) => n !== x).slice(0, 1);
  const set = (patch: Partial<CellDisplay>) => onDisplay({ ...display, view: "chart", chart: kind, x, y, ...patch });
  const xi = names.indexOf(x);
  const data = result.rows.slice(0, CHART_LIMIT).map((row) => {
    const d: Record<string, Value> = { __x: row[xi] };
    for (const n of y) d[n] = row[names.indexOf(n)];
    return d;
  });

  let chart: React.ReactNode;
  if (!y.length) chart = <div className="visual-msg">O gráfico precisa de ao menos uma coluna numérica.</div>;
  else if (kind === "pie") {
    chart = (
      <PieChart>
        <Tooltip formatter={(v: number) => fmtNum(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie data={data} dataKey={y[0]} nameKey="__x" innerRadius="45%" outerRadius="80%" isAnimationActive={false}>
          {data.map((_, i) => <PieCell key={i} fill={palette[i % palette.length]} />)}
        </Pie>
      </PieChart>
    );
  } else if (kind === "scatter") {
    chart = (
      <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="__x" type="number" name={x} tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
        <YAxis dataKey={y[0]} type="number" name={y[0]} tick={{ fontSize: 11 }} tickFormatter={fmtNum} width={80} />
        <Tooltip formatter={(v: number) => fmtNum(v)} />
        <Scatter data={data} fill={palette[0]} isAnimationActive={false} />
      </ScatterChart>
    );
  } else {
    chart = (
      <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="__x" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtNum} width={80} />
        <Tooltip formatter={(v: number) => fmtNum(v)} />
        {y.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {y.map((n, i) => {
          const color = palette[i % palette.length];
          if (kind === "line") return <Line key={n} dataKey={n} stroke={color} dot={data.length < 40} strokeWidth={2} isAnimationActive={false} />;
          if (kind === "area") return <Area key={n} dataKey={n} stroke={color} fill={color} fillOpacity={0.3} isAnimationActive={false} />;
          return <Bar key={n} dataKey={n} fill={color} isAnimationActive={false} />;
        })}
      </ComposedChart>
    );
  }

  return (
    <div className="nb-chart">
      <div className="nb-chart-config">
        <label>Tipo
          <select value={kind} onChange={(e) => set({ chart: e.target.value as ChartKind })}>
            {CHARTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label>Eixo X
          <select value={x} onChange={(e) => set({ x: e.target.value })}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="nb-ys">Valores:
          {numeric.filter((n) => n !== x).map((n) => (
            <label key={n} className="check">
              <input type="checkbox" checked={y.includes(n)}
                onChange={(e) => set({ y: e.target.checked ? [...y, n] : y.filter((v) => v !== n) })} />
              {n}
            </label>
          ))}
        </div>
      </div>
      <div className="nb-chart-body">
        <ResponsiveContainer width="100%" height="100%">{chart as React.ReactElement}</ResponsiveContainer>
      </div>
      {result.rows.length > CHART_LIMIT && <div className="muted small">Gráfico com as primeiras {CHART_LIMIT} linhas.</div>}
    </div>
  );
}

// ---------------- Plano de execução ----------------

const maxRows = (p: PlanNode): number => Math.max(p.rows, ...p.children.map(maxRows));

/** O plano como árvore: cada operador com linhas que saem dele e o tempo gasto. */
function PlanTree({ node, max }: { node: PlanNode; max: number }) {
  const ms = `${node.ms < 1 ? node.ms.toFixed(2) : node.ms.toFixed(1)} ms`.replace(".", ",");
  const kind = node.op.startsWith("Leitura") ? "scan" : node.op.startsWith("Filtro") ? "filter"
    : node.op.includes("join") || node.op.includes("cartesiano") ? "join" : node.op === "Agregação" || node.op === "Janela" ? "agg" : "other";
  return (
    <div className="plan-node">
      <div className={`plan-row ${kind}`}>
        <span className="plan-op">{node.op}</span>
        {node.detail && <span className="plan-detail" title={node.detail}>{node.detail}</span>}
        <span style={{ flex: 1 }} />
        <span className="plan-bar"><span style={{ width: `${max ? Math.max(2, (100 * node.rows) / max) : 0}%` }} /></span>
        <span className="plan-rows">{node.rows.toLocaleString("pt-BR")} linhas</span>
        <span className="plan-ms">{ms}</span>
      </div>
      {node.children.length > 0 && (
        <div className="plan-children">
          {node.children.map((c, i) => <Fragment key={i}><PlanTree node={c} max={max} /></Fragment>)}
        </div>
      )}
    </div>
  );
}
