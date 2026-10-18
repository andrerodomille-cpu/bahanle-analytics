import { useState } from "react";
import type { Dispatch } from "react";
import type { FieldRef, Report } from "../model/types";
import { fieldKey, newId } from "../model/types";
import type { Action } from "../model/store";
import { formatValue } from "../model/format";
import { valueKey } from "../engine/query";

const PAGE = 200;

export function DataView({ report, dispatch }: { report: Report; dispatch: Dispatch<Action> }) {
  const [name, setName] = useState(report.tables[0]?.name ?? "");
  const table = report.tables.find((t) => t.name === name) ?? report.tables[0];
  if (!table) return <div className="view-empty">Nenhuma tabela. Importe um CSV.</div>;

  return (
    <div className="data-view">
      <div className="toolbar">
        {report.tables.map((t) => (
          <button key={t.name} className={t.name === table.name ? "tab active" : "tab"} onClick={() => setName(t.name)}>
            {t.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
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
      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c.name} className={c.type === "number" ? "num" : ""}>
                  <span className="muted">{c.type === "number" ? "#" : "Aa"}</span> {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, PAGE).map((r, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td key={c.name} className={c.type === "number" ? "num" : ""}>{formatValue(r[c.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ModelView({ report, dispatch }: { report: Report; dispatch: Dispatch<Action> }) {
  const fields: FieldRef[] = report.tables.flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c.name })));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromField = fields.find((f) => fieldKey(f) === from);
  const toField = fields.find((f) => fieldKey(f) === to);

  // O lado "um" precisa ter valores únicos, como no Power BI.
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
