import { useState } from "react";
import type { Dispatch } from "react";
import type { Column, ColumnType, FieldRef, FilterOp, QueryStep, Report, Table } from "../model/types";
import { fieldKey, newId } from "../model/types";
import type { Action } from "../model/store";
import { formatValue } from "../model/format";
import { valueKey } from "../engine/query";
import { applySteps, describeStep } from "../model/transform";

const PAGE = 200;
const TYPE_ICON: Record<ColumnType, string> = { number: "#", text: "Aa", date: "📅" };

export function DataView({ report, dispatch, onEditColumn }: {
  report: Report;
  dispatch: Dispatch<Action>;
  onEditColumn: (table: string, column: Column | null) => void;
}) {
  const [name, setName] = useState(report.tables[0]?.name ?? "");
  const [menu, setMenu] = useState<string | null>(null);
  const table = report.tables.find((t) => t.name === name) ?? report.tables[0];
  if (!table) return <div className="view-empty">Nenhuma tabela. Use "Obter dados" para importar CSV, Excel ou JSON.</div>;

  const steps = table.query?.steps ?? [];
  const setSteps = (next: QueryStep[]) => dispatch({ type: "setSteps", table: table.name, steps: next });
  const addStep = (step: QueryStep) => {
    setSteps([...steps, step]);
    setMenu(null);
  };

  return (
    <div className="data-view">
      <div className="toolbar">
        {report.tables.map((t) => (
          <button key={t.name} className={t.name === table.name ? "tab active" : "tab"} onClick={() => setName(t.name)}>
            {t.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => addStep({ kind: "dedupe" })} title="Etapa: remover linhas repetidas">Remover duplicadas</button>
        <button onClick={() => addStep({ kind: "removeBlank" })} title="Etapa: remover linhas totalmente vazias">
          Remover linhas em branco
        </button>
        <button onClick={() => onEditColumn(table.name, null)}>ƒx Nova coluna</button>
        <span className="muted small">
          {table.rows.length.toLocaleString("pt-BR")} linhas
          {table.rows.length > PAGE && ` (mostrando ${PAGE})`}
        </span>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Remover a tabela "${table.name}" e seus relacionamentos?`)) {
              dispatch({ type: "removeTable", name: table.name });
              setName("");
            }
          }}
        >
          Remover tabela
        </button>
      </div>
      <div className="data-body">
        <div className="grid-scroll">
          <table className="grid">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.name}
                    className={(c.type === "number" ? "num" : "") + (c.expression ? " calculated" : " transformable")}
                    title={c.expression
                      ? `${c.expression}${c.error ? `\nErro: ${c.error}` : ""}\n(clique para editar)`
                      : "Clique para transformar esta coluna"}
                    onClick={() => (c.expression ? onEditColumn(table.name, c) : setMenu(menu === c.name ? null : c.name))}
                  >
                    <span className="muted">{c.expression ? "ƒx" : TYPE_ICON[c.type]}</span> {c.name}
                    {c.error && <span className="error"> ⚠</span>}
                    {menu === c.name && (
                      <ColumnMenu table={table} column={c} onStep={addStep} onClose={() => setMenu(null)} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, PAGE).map((r, i) => (
                <tr key={i}>
                  {table.columns.map((c) => (
                    <td key={c.name} className={c.type === "number" ? "num" : ""}>{formatValue(r[c.name] ?? null)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AppliedSteps table={table} onChange={setSteps} />
      </div>
    </div>
  );
}

/** "Etapas aplicadas" do editor de consultas: a receita que transforma a fonte na tabela final. */
function AppliedSteps({ table, onChange }: { table: Table; onChange: (steps: QueryStep[]) => void }) {
  const steps = table.query?.steps ?? [];
  const errors = table.query ? applySteps(table.query).errors : [];
  return (
    <aside className="steps">
      <h3>Consulta</h3>
      <div className="small muted">Fonte: {table.query?.origin ?? (table.sql ? "SQL (notebook)" : "dados do modelo")}</div>
      {table.sql && (
        <>
          <pre className="sql-origin" title="Rode a célula de novo no notebook para atualizar a tabela">{table.sql}</pre>
          <p className="small muted">Criada por CREATE TABLE … AS num notebook. Para atualizar, rode a célula de novo.</p>
        </>
      )}
      <h3>Etapas aplicadas</h3>
      <ol>
        <li className="step source">Fonte</li>
        {steps.map((s, i) => (
          <li key={i} className={"step" + (errors[i] ? " has-error" : "")} title={errors[i] ?? ""}>
            <span>{errors[i] ? "⚠ " : ""}{describeStep(s)}</span>
            <button className="link" title="Excluir etapa" onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ol>
      {steps.length === 0 && (
        <p className="small muted">Clique no cabeçalho de uma coluna para renomear, mudar o tipo, filtrar ou substituir valores.</p>
      )}
      {steps.length > 0 && (
        <p className="small muted">
          Excluir uma etapa reaplica as outras sobre a fonte; etapas que dependem de uma coluna que deixou de existir
          ficam marcadas com ⚠ e são puladas.
        </p>
      )}
    </aside>
  );
}

const OPS: FilterOp[] = ["=", "<>", ">", ">=", "<", "<=", "contém", "não está em branco"];

function ColumnMenu({ table, column, onStep, onClose }: {
  table: Table;
  column: Column;
  onStep: (step: QueryStep) => void;
  onClose: () => void;
}) {
  const [rename, setRename] = useState(column.name);
  const [op, setOp] = useState<FilterOp>("=");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const clash = rename !== column.name && table.columns.some((c) => c.name === rename);

  return (
    <div className="column-menu" onClick={(e) => e.stopPropagation()}>
      <div className="column-menu-head">
        <strong>{column.name}</strong>
        <button className="link" onClick={onClose}>✕</button>
      </div>
      <label className="field">
        Renomear
        <div className="field-row">
          <input value={rename} onChange={(e) => setRename(e.target.value)} />
          <button
            disabled={!rename.trim() || rename === column.name || clash}
            onClick={() => onStep({ kind: "rename", column: column.name, to: rename.trim() })}
          >
            OK
          </button>
        </div>
      </label>
      <label className="field">
        Tipo
        <select value={column.type} onChange={(e) => onStep({ kind: "type", column: column.name, to: e.target.value as ColumnType })}>
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="date">Data</option>
        </select>
      </label>
      <div className="field">
        Manter linhas em que a coluna…
        <div className="field-row">
          <select value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
            {OPS.map((o) => <option key={o}>{o}</option>)}
          </select>
          {op !== "não está em branco" && (
            <input value={value} placeholder={column.type === "date" ? "dd/mm/aaaa" : "valor"} onChange={(e) => setValue(e.target.value)} />
          )}
          <button onClick={() => onStep({ kind: "filter", column: column.name, op, value })}>Filtrar</button>
        </div>
      </div>
      <div className="field">
        Substituir valores
        <div className="field-row">
          <input value={from} placeholder="de" onChange={(e) => setFrom(e.target.value)} />
          <input value={to} placeholder="para (vazio = em branco)" onChange={(e) => setTo(e.target.value)} />
          <button onClick={() => onStep({ kind: "replace", column: column.name, from, to })}>OK</button>
        </div>
      </div>
      <button className="danger" onClick={() => onStep({ kind: "remove", columns: [column.name] })}>Remover coluna</button>
    </div>
  );
}

export function ModelView({ report, dispatch }: { report: Report; dispatch: Dispatch<Action> }) {
  const fields: FieldRef[] = report.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c.name })));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromField = fields.find((f) => fieldKey(f) === from);
  const toField = fields.find((f) => fieldKey(f) === to);

  // O lado "um" precisa ter valores únicos.
  let problem: string | null = null;
  if (fromField && toField) {
    if (fromField.table === toField.table) problem = "Escolha colunas de tabelas diferentes.";
    else {
      const rows = report.tables.find((t) => t.name === toField.table)!.rows;
      const keys = new Set(rows.map((r) => valueKey(r[toField.column])));
      if (keys.size !== rows.length) problem = `${fieldKey(toField)} tem valores repetidos; o lado "um" precisa ser único.`;
    }
  }

  const options = (
    <>
      <option value="">(escolha)</option>
      {report.tables.map((t) => (
        <optgroup key={t.name} label={t.name}>
          {t.columns.map((c) => {
            const k = fieldKey({ table: t.name, column: c.name });
            return <option key={k} value={k}>{k}</option>;
          })}
        </optgroup>
      ))}
    </>
  );

  return (
    <div className="model-view">
      <div className="model-diagram">
        {report.tables.map((t) => {
          const isFact = report.relationships.some((r) => r.from.table === t.name);
          return (
            <div key={t.name} className={"model-table" + (isFact ? " fact" : "")}>
              <div className="model-table-title">{t.name}</div>
              {t.columns.map((c) => {
                const k = fieldKey({ table: t.name, column: c.name });
                const linked = report.relationships.some((r) => fieldKey(r.from) === k || fieldKey(r.to) === k);
                return <div key={c.name} className={linked ? "linked" : ""}>{c.name}</div>;
              })}
            </div>
          );
        })}
      </div>

      <h3>Relacionamentos</h3>
      <table className="grid rel-table">
        <thead>
          <tr><th>De (muitos)</th><th></th><th>Para (um)</th><th></th></tr>
        </thead>
        <tbody>
          {report.relationships.map((r) => (
            <tr key={r.id}>
              <td>{fieldKey(r.from)}</td>
              <td className="muted">* ──▶ 1</td>
              <td>{fieldKey(r.to)}</td>
              <td>
                <button className="link" onClick={() => dispatch({ type: "removeRelationship", id: r.id })}>remover</button>
              </td>
            </tr>
          ))}
          <tr>
            <td><select value={from} onChange={(e) => setFrom(e.target.value)}>{options}</select></td>
            <td className="muted">* ──▶ 1</td>
            <td><select value={to} onChange={(e) => setTo(e.target.value)}>{options}</select></td>
            <td>
              <button
                className="primary"
                disabled={!fromField || !toField || !!problem}
                onClick={() => {
                  dispatch({ type: "addRelationship", rel: { id: newId(), from: fromField!, to: toField! } });
                  setFrom("");
                  setTo("");
                }}
              >
                Criar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {problem && <div className="error small">{problem}</div>}
    </div>
  );
}
