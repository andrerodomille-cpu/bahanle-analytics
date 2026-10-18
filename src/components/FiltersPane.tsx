import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import type { FilterScope, PaneFilter, Report, Value, Visual } from "../model/types";
import { fieldLabel, newId } from "../model/types";
import { FieldSelect } from "./FieldSelect";
import { datePart } from "../model/dates";
import type { Action } from "../model/store";
import { valueKey } from "../engine/query";
import { formatValue } from "../model/format";

// Painel de Filtros do Power BI: o mesmo filtro pode valer só para um visual,
// para a página inteira ou para todas as páginas do relatório.

const SCOPES: { scope: FilterScope; title: string; hint: string }[] = [
  { scope: "visual", title: "Filtros neste visual", hint: "Afetam só o visual selecionado." },
  { scope: "page", title: "Filtros nesta página", hint: "Afetam todos os visuais da página." },
  { scope: "report", title: "Filtros em todas as páginas", hint: "Afetam o relatório inteiro." },
];

export function FiltersPane({ report, visual, pageId, dispatch }: {
  report: Report;
  visual: Visual | undefined;
  pageId: string;
  dispatch: Dispatch<Action>;
}) {
  return (
    <div className="filters-pane">
      {SCOPES.map(({ scope, title, hint }) => {
        if (scope === "visual" && !visual) {
          return (
            <section key={scope} className="filter-section">
              <h3>{title}</h3>
              <p className="muted small">Selecione um visual para filtrá-lo individualmente.</p>
            </section>
          );
        }
        const targetId = scope === "visual" ? visual!.id : scope === "page" ? pageId : undefined;
        const list = report.paneFilters.filter((f) => f.scope === scope && f.targetId === targetId);
        return (
          <section key={scope} className="filter-section">
            <h3>{title}</h3>
            <p className="muted small">{hint}</p>
            {list.map((f) => (
              <FilterCard key={f.id} report={report} filter={f} dispatch={dispatch} />
            ))}
            <FieldSelect
              report={report}
              value={undefined}
              className="add-filter"
              placeholder="+ Adicionar campo…"
              onChange={(field) => field && dispatch({ type: "addPaneFilter", filter: { id: newId(), scope, targetId, field, values: [] } })}
            />
          </section>
        );
      })}
    </div>
  );
}

const MAX_SHOWN = 200;

function FilterCard({ report, filter, dispatch }: { report: Report; filter: PaneFilter; dispatch: Dispatch<Action> }) {
  const [open, setOpen] = useState(filter.values.length === 0);
  const [search, setSearch] = useState("");

  // Valores distintos da coluna inteira (o painel lista todos, como no Power BI).
  const table = report.tables.find((t) => t.name === filter.field.table);
  const all = useMemo(() => {
    const seen = new Map<string, Value>();
    for (const r of table?.rows ?? []) {
      const raw = r[filter.field.column] ?? null;
      const v = filter.field.part ? datePart(raw, filter.field.part) : raw;
      if (!seen.has(valueKey(v))) seen.set(valueKey(v), v);
    }
    return [...seen.values()].sort((a, b) => formatValue(a).localeCompare(formatValue(b), "pt-BR", { numeric: true }));
  }, [table, filter.field.column, filter.field.part]);

  const selected = new Set(filter.values.map(valueKey));
  const term = search.trim().toLowerCase();
  const shown = all.filter((v) => !term || formatValue(v).toLowerCase().includes(term));
  const set = (values: Value[]) => dispatch({ type: "updatePaneFilter", id: filter.id, values });
  const toggle = (v: Value) =>
    set(selected.has(valueKey(v)) ? filter.values.filter((x) => valueKey(x) !== valueKey(v)) : [...filter.values, v]);

  const summary = filter.values.length === 0
    ? "é (Todos)"
    : `é ${filter.values.slice(0, 3).map(formatValue).join(", ")}${filter.values.length > 3 ? ` e mais ${filter.values.length - 3}` : ""}`;

  return (
    <div className={"filter-card" + (filter.values.length ? " active" : "")}>
      <div className="filter-card-head" onClick={() => setOpen(!open)}>
        <div>
          <strong>{fieldLabel(filter.field)}</strong> <span className="muted small">({filter.field.table})</span>
          <div className="small muted">{summary}</div>
        </div>
        <span className="filter-card-tools">
          {filter.values.length > 0 && (
            <button className="link" title="Limpar filtro" onClick={(e) => { e.stopPropagation(); set([]); }}>⌫</button>
          )}
          <button
            className="link"
            title="Remover do painel"
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "removePaneFilter", id: filter.id });
            }}
          >
            ✕
          </button>
          <span className="muted">{open ? "▾" : "▸"}</span>
        </span>
      </div>
      {open && (
        <div className="filter-card-body">
          {!table && <div className="error small">Tabela não existe mais.</div>}
          {all.length > 8 && (
            <input placeholder="Pesquisar" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          <div className="checklist filter-values">
            {shown.slice(0, MAX_SHOWN).map((v) => (
              <label key={valueKey(v)}>
                <input type="checkbox" checked={selected.has(valueKey(v))} onChange={() => toggle(v)} />
                {formatValue(v)}
              </label>
            ))}
            {shown.length > MAX_SHOWN && (
              <span className="muted small">Mostrando {MAX_SHOWN} de {shown.length}; use a pesquisa.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
