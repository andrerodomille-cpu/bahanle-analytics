import { useRef, useState } from "react";
import type { Dispatch } from "react";
import type { FieldRef, Measure, MeasureFormat, Report, Visual, VisualType } from "../model/types";
import { fieldKey, newId } from "../model/types";
import type { Action } from "../model/store";
import { parseCsv } from "../model/csv";
import { parse } from "../engine/expr";
import { Engine } from "../engine/query";
import { formatMeasure } from "../model/format";

export const VISUAL_TYPES: { type: VisualType; label: string; icon: string }[] = [
  { type: "bar", label: "Colunas", icon: "▮▮" },
  { type: "line", label: "Linha", icon: "⟋" },
  { type: "pie", label: "Rosca", icon: "◔" },
  { type: "table", label: "Tabela", icon: "▤" },
  { type: "card", label: "Cartão", icon: "123" },
  { type: "slicer", label: "Segmentação", icon: "☰" },
];

// ---------------- Painel esquerdo: visualizações + campos ----------------

export function FieldsPane({ report, dispatch, onAddVisual, onEditMeasure }: {
  report: Report;
  dispatch: Dispatch<Action>;
  onAddVisual: (type: VisualType) => void;
  onEditMeasure: (m: Measure | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const importCsv = async (files: FileList | null) => {
    setError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        const table = parseCsv(file.name.replace(/\.csv$/i, ""), await file.text());
        dispatch({ type: "addTable", table });
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <aside className="pane left">
      <h3>Visualizações</h3>
      <div className="viz-grid">
        {VISUAL_TYPES.map((v) => (
          <button key={v.type} title={v.label} onClick={() => onAddVisual(v.type)}>
            <span className="viz-icon">{v.icon}</span>
            <span>{v.label}</span>
          </button>
        ))}
      </div>

      <h3>Dados</h3>
      <div className="row-buttons">
        <button onClick={() => fileRef.current?.click()}>Importar CSV</button>
        <button onClick={() => onEditMeasure(null)}>Nova medida</button>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => importCsv(e.target.files)} />
      {error && <div className="error small">{error}</div>}

      <ul className="tree">
        {report.tables.map((t) => {
          const isOpen = open[t.name] ?? false;
          const measures = report.measures.filter((m) => m.table === t.name);
          return (
            <li key={t.name}>
              <div className="tree-table" onClick={() => setOpen({ ...open, [t.name]: !isOpen })}>
                <span>{isOpen ? "▾" : "▸"} ▦ {t.name}</span>
                <span className="muted small">{t.rows.length.toLocaleString("pt-BR")}</span>
              </div>
              {isOpen && (
                <ul>
                  {measures.map((m) => (
                    <li key={m.id} className="tree-measure" onClick={() => onEditMeasure(m)} title={m.expression}>
                      ∑ {m.name}
                    </li>
                  ))}
                  {t.columns.map((c) => (
                    <li key={c.name} className="tree-col">
                      {c.type === "number" ? "#" : "Aa"} {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---------------- Painel direito: propriedades do visual ----------------

export function PropertiesPane({ report, visual, dispatch }: {
  report: Report;
  visual: Visual | undefined;
  dispatch: Dispatch<Action>;
}) {
  if (!visual) {
    return (
      <aside className="pane right">
        <h3>Propriedades</h3>
        <p className="muted">Selecione um visual no canvas.</p>
        <h3>Como usar</h3>
        <ul className="help">
          <li>Clique numa barra, fatia ou linha de tabela para filtrar os outros visuais.</li>
          <li>Ctrl+clique seleciona vários itens.</li>
          <li>Arraste pelo título; redimensione pelo canto inferior direito.</li>
          <li>Filtros só fluem da dimensão (lado "um") para o fato (lado "muitos").</li>
        </ul>
      </aside>
    );
  }

  const update = (patch: Partial<Visual>) => dispatch({ type: "updateVisual", id: visual.id, patch });
  const fields: FieldRef[] = report.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c.name })));
  const single = visual.type === "card" || visual.type === "pie";

  return (
    <aside className="pane right">
      <h3>Propriedades</h3>
      <label className="field">
        Título
        <input value={visual.title} onChange={(e) => update({ title: e.target.value })} />
      </label>
      <label className="field">
        Tipo
        <select
          value={visual.type}
          onChange={(e) => {
            const type = e.target.value as VisualType;
            const keep = type === "card" || type === "pie" ? visual.measureIds.slice(0, 1) : visual.measureIds;
            update({ type, measureIds: type === "slicer" ? [] : keep });
          }}
        >
          {VISUAL_TYPES.map((v) => (
            <option key={v.type} value={v.type}>{v.label}</option>
          ))}
        </select>
      </label>

      {visual.type !== "card" && (
        <label className="field">
          {visual.type === "slicer" ? "Campo" : "Eixo / Categoria"}
          <select
            value={visual.axis ? fieldKey(visual.axis) : ""}
            onChange={(e) => update({ axis: fields.find((f) => fieldKey(f) === e.target.value) })}
          >
            <option value="">(nenhum)</option>
            {report.tables.map((t) => (
              <optgroup key={t.name} label={t.name}>
                {t.columns.map((c) => (
                  <option key={c.name} value={fieldKey({ table: t.name, column: c.name })}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {visual.type !== "slicer" && (
        <div className="field">
          {single ? "Medida" : "Medidas"}
          <div className="checklist">
            {report.measures.map((m) => {
              const on = visual.measureIds.includes(m.id);
              return (
                <label key={m.id}>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={`m-${visual.id}`}
                    checked={on}
                    onChange={() =>
                      update({
                        measureIds: single
                          ? [m.id]
                          : on
                            ? visual.measureIds.filter((id) => id !== m.id)
                            : [...visual.measureIds, m.id],
                      })}
                  />
                  {m.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <button className="danger" onClick={() => dispatch({ type: "removeVisual", id: visual.id })}>
        Excluir visual
      </button>
    </aside>
  );
}

// ---------------- Editor de medidas ----------------

export function MeasureEditor({ report, measure, dispatch, onClose }: {
  report: Report;
  measure: Measure | null;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [name, setName] = useState(measure?.name ?? "Nova Medida");
  const [table, setTable] = useState(measure?.table ?? report.tables[0]?.name ?? "");
  const [expression, setExpression] = useState(measure?.expression ?? "");
  const [format, setFormat] = useState<MeasureFormat>(measure?.format ?? "number");

  // Validação ao vivo: parse + avaliação sem filtros, para mostrar o total.
  let status: { ok: boolean; text: string };
  try {
    if (!expression.trim()) throw new Error("Digite uma expressão.");
    const duplicate = report.measures.some((m) => m.name === name && m.id !== measure?.id);
    if (duplicate) throw new Error("Já existe uma medida com esse nome.");
    const ast = parse(expression);
    const draft: Measure = { id: measure?.id ?? "draft", name, table, expression, format };
    const others = report.measures.filter((m) => m.id !== measure?.id);
    const engine = new Engine({ ...report, measures: [...others, draft] });
    status = { ok: true, text: `Total sem filtros: ${formatMeasure(engine.evaluate(ast, [], [name]), format)}` };
  } catch (e) {
    status = { ok: false, text: e instanceof Error ? e.message : String(e) };
  }

  const save = () => {
    if (!status.ok) return;
    dispatch({ type: "upsertMeasure", measure: { id: measure?.id ?? newId(), name, table, expression, format } });
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{measure ? "Editar medida" : "Nova medida"}</h3>
        <label className="field">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            Tabela
            <select value={table} onChange={(e) => setTable(e.target.value)}>
              {report.tables.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            Formato
            <select value={format} onChange={(e) => setFormat(e.target.value as MeasureFormat)}>
              <option value="number">Número</option>
              <option value="currency">Moeda (R$)</option>
              <option value="percent">Percentual</option>
            </select>
          </label>
        </div>
        <label className="field">
          Expressão
          <textarea
            rows={3}
            spellCheck={false}
            value={expression}
            placeholder="SUM(Vendas[Valor])"
            onChange={(e) => setExpression(e.target.value)}
          />
        </label>
        <div className={status.ok ? "ok small" : "error small"}>{status.text}</div>
        <details className="small">
          <summary>Funções disponíveis</summary>
          <code>SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT</code> recebem <code>Tabela[Coluna]</code>;{" "}
          <code>COUNTROWS(Tabela)</code>; <code>DIVIDE(a, b, alternativo)</code>; outras medidas com{" "}
          <code>[Nome]</code>; operadores <code>+ - * /</code>. Tabelas com espaço: <code>'Minha Tabela'[Col]</code>.
        </details>
        <div className="modal-actions">
          {measure && (
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: "removeMeasure", id: measure.id });
                onClose();
              }}
            >
              Excluir
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={!status.ok} onClick={save}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
