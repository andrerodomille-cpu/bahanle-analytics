import { useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Column, FieldRef, FormatRule, Measure, MeasureFormat, RefLine, Report, Visual, VisualType } from "../model/types";
import { newId, sameField } from "../model/types";
import { FieldSelect } from "./FieldSelect";
import { hierarchyOf } from "../engine/query";
import type { Action } from "../model/store";
import { importFile } from "../model/importers";
import { parse } from "../engine/expr";
import { Engine, whatIfParams } from "../engine/query";
import { formatMeasure, formatValue } from "../model/format";
import { evaluateColumn } from "../model/calculated";
import { MEASURE_SLOTS, USES_LEGEND } from "./VisualView";
import { FiltersPane } from "./FiltersPane";
import { LakeDialog, refreshLakeTables } from "./LakeConnector";

export const VISUAL_TYPES: { type: VisualType; label: string; icon: string }[] = [
  { type: "bar", label: "Colunas", icon: "▮▮" },
  { type: "hbar", label: "Barras", icon: "☰" },
  { type: "stacked", label: "Empilhadas", icon: "▥" },
  { type: "line", label: "Linha", icon: "⟋" },
  { type: "area", label: "Área", icon: "◭" },
  { type: "scatter", label: "Dispersão", icon: "⁘" },
  { type: "pie", label: "Rosca", icon: "◔" },
  { type: "treemap", label: "Treemap", icon: "▦" },
  { type: "gauge", label: "Medidor", icon: "◠" },
  { type: "table", label: "Tabela", icon: "▤" },
  { type: "matrix", label: "Matriz", icon: "⊞" },
  { type: "card", label: "Cartão", icon: "123" },
  { type: "slicer", label: "Segmentação", icon: "☑" },
  { type: "kpi", label: "KPI", icon: "▲%" },
  { type: "combo", label: "Combo", icon: "▮⟋" },
  { type: "waterfall", label: "Cascata", icon: "▙▟" },
  { type: "heatmap", label: "Mapa calor", icon: "▩" },
  { type: "text", label: "Texto", icon: "T" },
  { type: "button", label: "Botão", icon: "⏵" },
  { type: "histogram", label: "Histograma", icon: "▁▃▇" },
  { type: "boxplot", label: "Box plot", icon: "⊟" },
  { type: "influencers", label: "Influência", icon: "⚖" },
  { type: "decomp", label: "Decompor", icon: "⊢" },
  { type: "map", label: "Mapa", icon: "🗺" },
  { type: "bubblemap", label: "Bolhas", icon: "◍" },
  { type: "image", label: "Imagem", icon: "🖼" },
  { type: "pareto", label: "Pareto", icon: "▇⟍" },
  { type: "narrative", label: "Narrativa", icon: "¶" },
  { type: "multicard", label: "Cartões", icon: "▤▤" },
  { type: "funnel", label: "Funil", icon: "⏷" },
  { type: "fieldparam", label: "Parâmetro", icon: "⇄" },
  { type: "bullet", label: "Marcador", icon: "▬|" },
  { type: "radar", label: "Radar", icon: "✶" },
  { type: "calendar", label: "Calendário", icon: "▦" },
  { type: "whatif", label: "E se", icon: "⇆" },
  { type: "sankey", label: "Sankey", icon: "⫘" },
  { type: "gantt", label: "Gantt", icon: "☰▬" },
  { type: "stacked100", label: "Colunas 100%", icon: "▥%" },
  { type: "area100", label: "Área 100%", icon: "◭%" },
  { type: "bump", label: "Ranking", icon: "⤨" },
  { type: "dumbbell", label: "Haltere", icon: "●─●" },
  { type: "sunburst", label: "Sunburst", icon: "◎" },
  { type: "waffle", label: "Waffle", icon: "▦▦" },
  { type: "pictogram", label: "Pictograma", icon: "☺☺" },
  { type: "violin", label: "Violino", icon: "◊" },
];

/** Ícones oferecidos no pictograma. */
const PICTO_ICONS = ["●", "■", "★", "♥", "☺", "👤", "🛒", "📦", "💰", "🏠", "🚗", "☕"];

const AXIS_LABEL: Partial<Record<VisualType, string>> = {
  slicer: "Campo",
  matrix: "Linhas",
  scatter: "Detalhes (um ponto por valor)",
  pie: "Legenda",
  treemap: "Categoria",
  kpi: "Tendência (eixo do minigráfico, opcional)",
  heatmap: "Linhas",
  boxplot: "Categoria (uma caixa por valor)",
  map: "Localização (UF, estado, código IBGE ou região)",
  bubblemap: "Local (uma bolha por valor)",
  narrative: "Eixo de tempo (opcional)",
  bullet: "Categoria (opcional: um marcador por valor)",
  calendar: "Data (coluna de data)",
  sankey: "Origem",
  gantt: "Tarefa",
  waterfall: "Categoria (cada degrau)",
  stacked100: "Eixo X",
  area100: "Eixo X (tempo)",
  bump: "Período",
  dumbbell: "Categoria (uma linha por valor)",
  sunburst: "Anel interno (níveis abaixo: drill)",
  waffle: "Categoria",
  pictogram: "Categoria",
  violin: "Categoria (um violino por valor)",
};

// ---------------- Painel esquerdo: visualizações + campos ----------------

export function FieldsPane({ report, dispatch, onAddVisual, onEditMeasure, onEditColumn }: {
  report: Report;
  dispatch: Dispatch<Action>;
  onAddVisual: (type: VisualType) => void;
  onEditMeasure: (m: Measure | null) => void;
  onEditColumn: (table: string | null, column: Column | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [lakeOpen, setLakeOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const hasRemote = report.tables.some((t) => t.remote);

  const importFiles = async (files: FileList | null) => {
    setError(null);
    for (const file of Array.from(files ?? [])) {
      try {
        for (const table of await importFile(file)) dispatch({ type: "addTable", table });
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
        <button onClick={() => fileRef.current?.click()} title="Importar tabelas de CSV, Excel (.xlsx) ou JSON">Obter dados</button>
        <button onClick={() => onEditMeasure(null)} title="Medida: recalculada a cada filtro">Medida</button>
        <button onClick={() => onEditColumn(null, null)} title="Coluna calculada: avaliada linha a linha">Coluna</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.json"
        multiple
        hidden
        onChange={(e) => importFiles(e.target.files)}
      />
      <div className="row-buttons">
        <button onClick={() => setLakeOpen(true)} title="Tabelas silver/gold do pipeline nextop-lake (API HTTP)">🔌 nextop-lake</button>
        {hasRemote && (
          <button
            disabled={refreshing === "…"}
            title="Busca de novo as tabelas do nextop-lake e reaplica as etapas da consulta"
            onClick={async () => {
              setError(null);
              setRefreshing("…");
              try {
                setRefreshing(await refreshLakeTables(report, dispatch));
              } catch (e) {
                setRefreshing(null);
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            ↻ Atualizar
          </button>
        )}
      </div>
      {refreshing && refreshing !== "…" && <div className="small muted">{refreshing}</div>}
      {lakeOpen && <LakeDialog report={report} dispatch={dispatch} onClose={() => setLakeOpen(false)} />}
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
                  {t.columns.map((c) =>
                    c.expression ? (
                      <li
                        key={c.name}
                        className={"tree-col calculated" + (c.error ? " has-error" : "")}
                        onClick={() => onEditColumn(t.name, c)}
                        title={c.error ? `Erro: ${c.error}` : c.expression}
                      >
                        ƒx {c.name}
                      </li>
                    ) : (
                      <li key={c.name} className="tree-col">
                        {c.type === "number" ? "#" : "Aa"} {c.name}
                      </li>
                    ),
                  )}
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

export function PropertiesPane({ report, visual, pageId, dispatch, filtersOnly }: {
  report: Report;
  visual: Visual | undefined;
  pageId: string;
  dispatch: Dispatch<Action>;
  /** Relatório publicado: o leitor só usa o Painel de Filtros. */
  filtersOnly?: boolean;
}) {
  const [tab, setTab] = useState<"props" | "filters">("props");
  if (filtersOnly) {
    return (
      <aside className="pane right">
        <h3>Filtros</h3>
        <FiltersPane report={report} visual={visual} pageId={pageId} dispatch={dispatch} />
      </aside>
    );
  }
  const activeFilters = report.paneFilters.filter((f) => (f.values.length > 0 || !!f.range) &&
    (f.scope === "report" || (f.scope === "page" && f.targetId === pageId) ||
      (f.scope === "visual" && f.targetId === visual?.id))).length;
  return (
    <aside className="pane right">
      <div className="pane-tabs">
        <button className={tab === "props" ? "active" : ""} onClick={() => setTab("props")}>Propriedades</button>
        <button className={tab === "filters" ? "active" : ""} onClick={() => setTab("filters")}>
          Filtros{activeFilters > 0 && <span className="count">{activeFilters}</span>}
        </button>
      </div>
      {tab === "props" ? (
        visual ? (
          <VisualProperties report={report} visual={visual} dispatch={dispatch} />
        ) : (
          <>
            <PageSettings report={report} pageId={pageId} dispatch={dispatch} />
            <Help />
          </>
        )
      ) : (
        <FiltersPane report={report} visual={visual} pageId={pageId} dispatch={dispatch} />
      )}
    </aside>
  );
}

function Help() {
  return (
    <>
      <p className="muted">Selecione um visual no canvas.</p>
      <h3>Como usar</h3>
      <ul className="help">
        <li>Clique numa barra, fatia ou linha de tabela para filtrar os outros visuais.</li>
        <li>Ctrl+clique seleciona vários itens.</li>
        <li>Arraste pelo título; redimensione pelo canto inferior direito.</li>
        <li>Filtros só fluem da dimensão (lado "um") para o fato (lado "muitos").</li>
        <li>Ctrl+Z / Ctrl+Y desfazem e refazem; Delete exclui o visual selecionado.</li>
        <li>Na aba Filtros, filtre um visual, a página ou o relatório inteiro.</li>
      </ul>
    </>
  );
}

const HAS_SORT: VisualType[] = ["bar", "hbar", "line", "area", "pie", "table", "matrix", "combo", "waterfall"];
const HAS_TOPN: VisualType[] = ["bar", "hbar", "line", "area", "pie", "treemap", "scatter", "table", "combo", "waterfall"];
/** Visuais de layout: sem eixo, medidas, ordenação ou filtros de visual. */
const LAYOUT: VisualType[] = ["text", "button", "image"];
/** Visuais sem eixo de categoria. */
const NO_AXIS_FIELD: VisualType[] = ["card", "gauge", "histogram", "influencers", "decomp", "fieldparam", "whatif", ...LAYOUT];
/** Visuais com dica de ferramenta detalhada. */
const HAS_DETAILS: VisualType[] = ["bar", "hbar", "line", "area", "pie"];
/** Visuais que aceitam formatação condicional por regras. */
const HAS_RULES: VisualType[] = ["table", "matrix", "card", "kpi", "multicard"];
const HAS_REFLINES: VisualType[] = ["bar", "hbar", "line", "area"];

function VisualProperties({ report, visual, dispatch }: {
  report: Report;
  visual: Visual;
  dispatch: Dispatch<Action>;
}) {

  const update = (patch: Partial<Visual>) => dispatch({ type: "updateVisual", id: visual.id, patch });
  const slots = MEASURE_SLOTS[visual.type];
  const single = slots?.length === 1;
  const limit = slots ? slots.length : Infinity;
  const fieldSelect = (label: string, value: Visual["axis"], onChange: (f: Visual["axis"]) => void) => (
    <FieldSelect report={report} label={label} value={value} onChange={onChange} />
  );

  const measures = visual.measureIds
    .map((id) => report.measures.find((m) => m.id === id))
    .filter((m): m is Measure => !!m);

  return (
    <>
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
            const max = MEASURE_SLOTS[type]?.length ?? Infinity;
            update({ type, measureIds: visual.measureIds.slice(0, max) });
          }}
        >
          {VISUAL_TYPES.map((v) => (
            <option key={v.type} value={v.type}>{v.label}</option>
          ))}
        </select>
      </label>

      {visual.type === "text" && (
        <label className="field">
          Texto
          <textarea
            rows={6}
            value={visual.text ?? ""}
            onChange={(e) => update({ text: e.target.value })}
          />
          <span className="small muted">
            "# Título", "## Subtítulo", "- item", **negrito**, *itálico*, [texto](https://link). [Nome da medida] mostra o valor com os filtros da página.
          </span>
        </label>
      )}

      {(visual.type === "text" || visual.type === "narrative") && (
        <div className="field-row">
          <label className="field">
            Alinhamento
            <select value={visual.textAlign ?? "left"} onChange={(e) => update({ textAlign: e.target.value as Visual["textAlign"] })}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </select>
          </label>
          <label className="field">
            Tamanho
            <select value={visual.textSize ?? "m"} onChange={(e) => update({ textSize: e.target.value as Visual["textSize"] })}>
              <option value="s">Pequeno</option>
              <option value="m">Médio</option>
              <option value="l">Grande</option>
            </select>
          </label>
        </div>
      )}

      {visual.type === "image" && <ImageEditor visual={visual} update={update} />}

      {visual.type === "slicer" && (
        <label className="field">
          Estilo
          <select
            value={visual.slicerStyle ?? "list"}
            onChange={(e) => {
              const slicerStyle = e.target.value as Visual["slicerStyle"];
              // Trocar de estilo limpa a seleção (lista de valores ≠ intervalo).
              dispatch({ type: "setFilter", sourceVisualId: visual.id, filter: null });
              update({ slicerStyle });
            }}
          >
            <option value="list">Lista</option>
            <option value="dropdown">Lista suspensa</option>
            <option value="between">Entre (intervalo de números ou datas)</option>
            <option value="relative">Data relativa (últimos N dias, este mês…)</option>
          </select>
        </label>
      )}

      {visual.type === "bubblemap" && (
        <>
          <FieldSelect report={report} label="Latitude (opcional)" value={visual.latField} onChange={(latField) => update({ latField })} />
          <FieldSelect report={report} label="Longitude (opcional)" value={visual.lonField} onChange={(lonField) => update({ lonField })} />
          <span className="small muted">Sem latitude/longitude, cada bolha vai para o centro da UF ou região do valor do eixo.</span>
        </>
      )}

      {visual.type === "button" && (
        <label className="field">
          Ao clicar
          <select
            value={visual.action ? `${visual.action.kind}:${visual.action.kind === "page" ? visual.action.pageId : visual.action.bookmarkId}` : ""}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              update({
                action: kind === "page" ? { kind: "page", pageId: id } : kind === "bookmark" ? { kind: "bookmark", bookmarkId: id } : undefined,
              });
            }}
          >
            <option value="">(nenhuma ação)</option>
            <optgroup label="Ir para a página">
              {report.pages.map((p) => <option key={p.id} value={`page:${p.id}`}>{p.name}</option>)}
            </optgroup>
            {report.bookmarks.length > 0 && (
              <optgroup label="Aplicar indicador">
                {report.bookmarks.map((b) => <option key={b.id} value={`bookmark:${b.id}`}>{b.name}</option>)}
              </optgroup>
            )}
          </select>
          <span className="small muted">O texto do botão é o título acima.</span>
        </label>
      )}

      {!NO_AXIS_FIELD.includes(visual.type) &&
        fieldSelect(AXIS_LABEL[visual.type] ?? "Eixo X / Categoria", visual.axis, (axis) => update({ axis }))}

      {visual.axis && !["slicer", "scatter", "kpi", "boxplot", "map", "bubblemap", "pareto", "narrative", "bullet", "radar",
        "calendar", "sankey", "gantt", "stacked100", "area100", "bump", "dumbbell", "waffle", "pictogram", "violin"].includes(visual.type) && (
        <DrillLevels report={report} visual={visual} update={update} />
      )}

      {USES_LEGEND.includes(visual.type) &&
        fieldSelect(
          visual.type === "stacked" || visual.type === "stacked100" || visual.type === "area100" ? "Legenda"
            : visual.type === "sankey" ? "Destino" : visual.type === "bump" ? "Séries (uma linha por valor)"
              : visual.type === "matrix" && visual.expandable ? "Colunas (opcional)" : "Colunas",
          visual.legend, (legend) => update({ legend }))}

      {visual.type === "matrix" && (
        <label className="check">
          <input type="checkbox" checked={!!visual.expandable}
            onChange={(e) => update({ expandable: e.target.checked, expanded: undefined, drill: undefined })} />
          Linhas hierárquicas (+/−): níveis = Linhas + níveis de detalhamento
        </label>
      )}

      {visual.type === "table" && (
        <FieldSelect report={report} label="Minigráfico: tendência por (opcional)" value={visual.sparkline}
          onChange={(sparkline) => update({ sparkline })} />
      )}

      {visual.type === "scatter" && (
        <>
          <FieldSelect report={report} label="Eixo de reprodução (opcional, ex.: Mês)" value={visual.playField}
            onChange={(playField) => update({ playField })} />
          {visual.playField && <span className="small muted">▶ anima os pontos, um quadro por valor do campo.</span>}
        </>
      )}

      {visual.type === "pictogram" && (
        <div className="field-row">
          <label className="field">
            Ícone
            <select value={visual.icon ?? "●"} onChange={(e) => update({ icon: e.target.value })}>
              {PICTO_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
          <label className="field">
            Cada ícone vale
            <input type="number" min={0} placeholder="automático" value={visual.unitValue ?? ""}
              onChange={(e) => update({ unitValue: e.target.value === "" || Number(e.target.value) <= 0 ? undefined : Number(e.target.value) })} />
          </label>
        </div>
      )}

      {visual.type === "gantt" && (
        <>
          <FieldSelect report={report} label="Início (data)" value={visual.startField} onChange={(startField) => update({ startField })} />
          <FieldSelect report={report} label="Fim (data)" value={visual.endField} onChange={(endField) => update({ endField })} />
          <FieldSelect report={report} label="% concluído (opcional, 0 a 1)" value={visual.progressField} onChange={(progressField) => update({ progressField })} />
          <FieldSelect report={report} label="Cor por (opcional)" value={visual.legend} onChange={(legend) => update({ legend })} />
        </>
      )}

      {visual.type === "whatif" && <WhatIfEditor report={report} visual={visual} update={update} />}

      {["bar", "line", "area"].includes(visual.type) && (
        <FieldSelect report={report} label="Pequenos múltiplos por (opcional)" value={visual.multiples}
          onChange={(multiples) => update({ multiples })} />
      )}

      {visual.type === "radar" && (
        <label className="check">
          <input type="checkbox" checked={visual.normalize ?? visual.measureIds.length > 1} onChange={(e) => update({ normalize: e.target.checked })} />
          Escalar cada medida pelo próprio máximo (comparar medidas diferentes)
        </label>
      )}

      {(visual.type === "histogram" || visual.type === "boxplot" || visual.type === "violin") && (
        <>
          <FieldSelect
            report={report}
            label="Valores (coluna numérica)"
            value={visual.valueField}
            onChange={(valueField) => update({ valueField })}
          />
          {visual.type === "histogram" && (
            <label className="field">
              Faixas
              <input
                type="number"
                min={2}
                max={100}
                placeholder="automático (regra de Sturges)"
                value={visual.bins ?? ""}
                onChange={(e) => update({ bins: e.target.value === "" ? undefined : Math.max(2, Number(e.target.value)) })}
              />
            </label>
          )}
        </>
      )}

      {(visual.type === "influencers" || visual.type === "decomp" || visual.type === "narrative") && (
        <FieldList
          report={report}
          label="Explicar por"
          fields={visual.explainBy ?? []}
          onChange={(explainBy) =>
            update({
              explainBy,
              // Níveis da árvore que usam uma dimensão removida deixam de valer.
              decomp: visual.decomp?.filter((l) => explainBy.some((f) => sameField(f, l.field))),
            })}
        />
      )}

      {visual.type === "fieldparam" && (
        <FieldList
          report={report}
          label="Campos oferecidos"
          fields={visual.paramFields ?? []}
          onChange={(paramFields) => update({ paramFields, paramIndex: 0 })}
        />
      )}

      {!NO_AXIS_FIELD.includes(visual.type) && <ParamLink report={report} visual={visual} update={update} />}

      {!["slicer", "histogram", "boxplot", "fieldparam", "whatif", "gantt", "violin", ...LAYOUT].includes(visual.type) && (
        <div className="field">
          {single ? "Medida" : "Medidas"}
          {slots && slots.length > 1 && (
            <span className="small">
              Na ordem marcada: {slots.join(", ")}.
            </span>
          )}
          <div className="checklist">
            {report.measures.map((m) => {
              const pos = visual.measureIds.indexOf(m.id);
              const on = pos >= 0;
              const full = !on && visual.measureIds.length >= limit;
              return (
                <label key={m.id} className={full && !single ? "disabled" : ""}>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={`m-${visual.id}`}
                    checked={on}
                    disabled={full && !single}
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
                  {on && slots && slots.length > 1 && <span className="slot">{slots[pos]}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {HAS_REFLINES.includes(visual.type) && <RefLinesEditor visual={visual} update={update} />}
      {(visual.type === "line" || visual.type === "area") && <ForecastEditor visual={visual} update={update} />}
      {(visual.type === "line" || visual.type === "area") && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={!!visual.anomalies}
              onChange={(e) => update({ anomalies: e.target.checked ? { sensitivity: 2 } : undefined })}
            />
            Destacar anomalias
          </label>
          {visual.anomalies && (
            <select
              value={visual.anomalies.sensitivity}
              onChange={(e) => update({ anomalies: { sensitivity: Number(e.target.value) } })}
            >
              <option value={2}>Sensível (±2 desvios)</option>
              <option value={3}>Só extremos (±3 desvios)</option>
            </select>
          )}
        </div>
      )}

      {HAS_RULES.includes(visual.type) && <RulesEditor visual={visual} measures={measures} update={update} />}

      {HAS_DETAILS.includes(visual.type) && <DetailsEditor report={report} visual={visual} update={update} />}

      {visual.type === "bullet" && (
        <div className="field">
          Faixas (fração da meta): ruim até / ok até
          <div className="field-row">
            <input type="number" step={0.05} min={0} max={1} value={(visual.bands ?? [0.6, 0.9])[0]}
              onChange={(e) => update({ bands: [Number(e.target.value), (visual.bands ?? [0.6, 0.9])[1]] })} />
            <input type="number" step={0.05} min={0} max={1.5} value={(visual.bands ?? [0.6, 0.9])[1]}
              onChange={(e) => update({ bands: [(visual.bands ?? [0.6, 0.9])[0], Number(e.target.value)] })} />
          </div>
        </div>
      )}

      {(visual.type === "gauge" || visual.type === "kpi" || visual.type === "bullet") && (
        <label className="field">
          Meta{visual.type !== "gauge" ? " fixa (opcional)" : ""}
          <input
            type="number"
            value={visual.target ?? ""}
            placeholder="ex.: 8000000"
            onChange={(e) => update({ target: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
      )}

      {(HAS_SORT.includes(visual.type) || HAS_TOPN.includes(visual.type) || visual.type === "table" || visual.type === "matrix") && (
        <h3>Formatação e filtro</h3>
      )}

      {HAS_SORT.includes(visual.type) && (
        <div className="field">
          Ordenar por
          <div className="field-row">
            <select
              value={visual.sort ? String(visual.sort.by) : ""}
              onChange={(e) => {
                const v = e.target.value;
                update({ sort: v === "" ? undefined : { by: v === "category" ? "category" : Number(v), desc: visual.sort?.desc ?? v !== "category" } });
              }}
            >
              <option value="">(padrão)</option>
              <option value="category">{visual.axis?.column ?? "Categoria"}</option>
              {measures.map((m, i) => <option key={m.id} value={i}>{m.name}</option>)}
            </select>
            <button
              disabled={!visual.sort}
              title="Inverter a ordem"
              onClick={() => visual.sort && update({ sort: { ...visual.sort, desc: !visual.sort.desc } })}
            >
              {visual.sort?.desc ? "↓ Decr." : "↑ Cresc."}
            </button>
          </div>
        </div>
      )}

      {HAS_TOPN.includes(visual.type) && (
        <label className="field">
          Top N (mantém as N maiores pela 1ª medida)
          <input
            type="number"
            min={1}
            placeholder="(todos)"
            value={visual.topN ?? ""}
            onChange={(e) => update({ topN: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)) })}
          />
        </label>
      )}

      {(visual.type === "table" || visual.type === "matrix") && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!!visual.dataBars}
              onChange={(e) => update({ dataBars: e.target.checked, colorScale: e.target.checked ? false : visual.colorScale })}
            />
            Barras de dados
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!visual.colorScale}
              onChange={(e) => update({ colorScale: e.target.checked, dataBars: e.target.checked ? false : visual.dataBars })}
            />
            Escala de cores
          </label>
        </>
      )}

      <button className="danger" onClick={() => dispatch({ type: "removeVisual", id: visual.id })}>
        Excluir visual
      </button>
    </>
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
    parse(expression);
    const draft: Measure = { id: measure?.id ?? "draft", name, table, expression, format };
    const others = report.measures.filter((m) => m.id !== measure?.id);
    const engine = new Engine({ ...report, measures: [...others, draft], params: whatIfParams(report) });
    status = { ok: true, text: `Total sem filtros: ${formatMeasure(engine.evaluateMeasure(draft, []), format)}` };
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
          <code>COUNTROWS(Tabela)</code>; <code>DIVIDE(a, b, alternativo)</code>; <code>IF(cond, a, b)</code>;
          outras medidas com <code>[Nome]</code>; operadores <code>+ - * / &amp; = &lt;&gt; &lt; &gt;</code>.
          Tabelas com espaço: <code>'Minha Tabela'[Col]</code>.
          <br />
          <code>CALCULATE(expr, filtros...)</code> muda o contexto de filtro. Filtros:{" "}
          <code>Lojas[Região] = "Sul"</code>, <code>&lt;&gt; "Sul"</code>, <code>IN {"{"} "Sul", "Sudeste" {"}"}</code>,{" "}
          <code>ALL(Produtos)</code>, <code>ALL(Produtos[Categoria])</code>.
          <br />
          Ex.: % do total = <code>DIVIDE([Faturamento], CALCULATE([Faturamento], ALL(Produtos)))</code>
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

// ---------------- Editor de colunas calculadas ----------------

export function ColumnEditor({ report, tableName, column, dispatch, onClose }: {
  report: Report;
  tableName: string | null;
  column: Column | null;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}) {
  const [table, setTable] = useState(tableName ?? report.tables[0]?.name ?? "");
  const [name, setName] = useState(column?.name ?? "Nova Coluna");
  const [expression, setExpression] = useState(column?.expression ?? "");
  const t = report.tables.find((x) => x.name === table);

  // Prévia ao vivo: avalia em todas as linhas e mostra as primeiras.
  let status: { ok: boolean; text: string; sample: string[] };
  try {
    if (!expression.trim()) throw new Error("Digite uma expressão.");
    if (!name.trim()) throw new Error("Dê um nome à coluna.");
    const clash = t?.columns.some((c) => c.name === name && c.name !== column?.name);
    if (clash) throw new Error(`A tabela ${table} já tem uma coluna "${name}".`);
    const preview = evaluateColumn(report, table, column?.name ?? name, expression);
    if (preview.error) throw new Error(preview.error);
    status = {
      ok: true,
      text: `${preview.type === "number" ? "Número" : "Texto"} · ${preview.values.length.toLocaleString("pt-BR")} linhas`,
      sample: preview.values.slice(0, 5).map(formatValue),
    };
  } catch (e) {
    status = { ok: false, text: e instanceof Error ? e.message : String(e), sample: [] };
  }

  const save = () => {
    if (!status.ok) return;
    dispatch({ type: "upsertColumn", table, name, expression, oldName: column?.name });
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{column ? "Editar coluna calculada" : "Nova coluna calculada"}</h3>
        <p className="muted small">
          Uma coluna calculada é avaliada <strong>uma vez por linha</strong> (contexto de linha) e gravada na
          tabela, como no Power BI. Use-a como eixo, legenda ou filtro. Para números que mudam com os
          filtros, crie uma medida.
        </p>
        <div className="field-row">
          <label className="field">
            Tabela
            <select value={table} disabled={!!column} onChange={(e) => setTable(e.target.value)}>
              {report.tables.map((x) => <option key={x.name}>{x.name}</option>)}
            </select>
          </label>
          <label className="field">
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <label className="field">
          Expressão
          <textarea
            rows={3}
            spellCheck={false}
            value={expression}
            placeholder={`${table}[Coluna] * 2   ·   RELATED(Outra[Coluna])   ·   IF(${table}[Coluna] > 10, "Alto", "Baixo")`}
            onChange={(e) => setExpression(e.target.value)}
          />
        </label>
        <div className={status.ok ? "ok small" : "error small"}>{status.text}</div>
        {status.sample.length > 0 && (
          <div className="sample small">Primeiras linhas: {status.sample.join(" · ")}</div>
        )}
        <details className="small">
          <summary>Como escrever</summary>
          <code>{table}[Coluna]</code> lê a linha atual; <code>RELATED(Dimensão[Coluna])</code> busca o valor
          na tabela do lado "um" do relacionamento; <code>IF</code>, comparações, <code>&amp;</code> (juntar
          textos) e contas funcionam como nas medidas. Agregações (ex.: <code>SUM</code>) aqui dão o total da
          tabela inteira, porque não há contexto de filtro.
        </details>
        <div className="modal-actions">
          {column && (
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: "removeColumn", table, name: column.name });
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

// ---------------- Níveis de detalhamento (drill-down) ----------------

function DrillLevels({ report, visual, update }: {
  report: Report;
  visual: Visual;
  update: (patch: Partial<Visual>) => void;
}) {
  const levels = hierarchyOf(report, visual);
  const isDate = levels.length > 1 && levels[0].part !== undefined && !visual.axis?.part;
  const extra = visual.drillFields ?? [];
  const setExtra = (drillFields: Visual["drillFields"]) => update({ drillFields, drill: undefined });
  return (
    <div className="field">
      Níveis de detalhamento (drill-down)
      {isDate ? (
        <span className="small muted">Coluna de data: Ano › Trimestre › Mês › Dia automáticos.</span>
      ) : (
        <>
          {extra.map((f, i) => (
            <div key={i} className="field-row">
              <FieldSelect
                report={report}
                value={f}
                onChange={(nf) => setExtra(nf ? extra.map((x, j) => (j === i ? nf : x)) : extra.filter((_, j) => j !== i))}
              />
              <button title="Remover nível" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <FieldSelect
            report={report}
            value={undefined}
            placeholder="+ Adicionar nível abaixo…"
            className="add-filter"
            onChange={(nf) => nf && setExtra([...extra, nf])}
          />
        </>
      )}
      {levels.length > 1 && !(visual.type === "matrix" && visual.expandable) && visual.type !== "sunburst" && (
        <label className="check">
          <input type="checkbox" checked={!!visual.drillMode} onChange={(e) => update({ drillMode: e.target.checked })} />
          Clique num item detalha (modo de drill)
        </label>
      )}
    </div>
  );
}

// ---------------- Lista de campos (Explicar por) ----------------

function FieldList({ report, label, fields, onChange }: {
  report: Report;
  label: string;
  fields: FieldRef[];
  onChange: (fields: FieldRef[]) => void;
}) {
  return (
    <div className="field">
      {label}
      {fields.map((f, i) => (
        <div key={i} className="field-row">
          <FieldSelect
            report={report}
            value={f}
            onChange={(nf) => onChange(nf ? fields.map((x, j) => (j === i ? nf : x)) : fields.filter((_, j) => j !== i))}
          />
          <button title="Remover" onClick={() => onChange(fields.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <FieldSelect
        report={report}
        value={undefined}
        placeholder="+ Adicionar dimensão…"
        className="add-filter"
        onChange={(nf) => nf && !fields.some((f) => sameField(f, nf)) && onChange([...fields, nf])}
      />
    </div>
  );
}

// ---------------- Linhas de referência ----------------

const REF_KINDS: { kind: RefLine["kind"]; label: string }[] = [
  { kind: "constant", label: "Valor fixo (meta)" },
  { kind: "average", label: "Média" },
  { kind: "median", label: "Mediana" },
  { kind: "min", label: "Mínimo" },
  { kind: "max", label: "Máximo" },
];

function RefLinesEditor({ visual, update }: { visual: Visual; update: (patch: Partial<Visual>) => void }) {
  const lines = visual.refLines ?? [];
  const set = (refLines: RefLine[]) => update({ refLines });
  const patch = (i: number, p: Partial<RefLine>) => set(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="field">
      Linhas de referência
      {lines.map((l, i) => (
        <div key={l.id} className="ref-line">
          <div className="field-row">
            <select value={l.kind} onChange={(e) => patch(i, { kind: e.target.value as RefLine["kind"] })}>
              {REF_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
            <button title="Remover linha" onClick={() => set(lines.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="field-row">
            {l.kind === "constant" && (
              <input
                type="number"
                placeholder="valor"
                value={l.value ?? ""}
                onChange={(e) => patch(i, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            )}
            <input placeholder="rótulo (opcional)" value={l.label ?? ""} onChange={(e) => patch(i, { label: e.target.value })} />
          </div>
        </div>
      ))}
      <button onClick={() => set([...lines, { id: newId(), kind: "average" }])}>+ Adicionar linha</button>
      <span className="small muted">Calculadas sobre os valores da 1ª medida mostrados no visual.</span>
    </div>
  );
}

// ---------------- Previsão ----------------

function ForecastEditor({ visual, update }: { visual: Visual; update: (patch: Partial<Visual>) => void }) {
  const fc = visual.forecast;
  const set = (p: Partial<NonNullable<Visual["forecast"]>>) =>
    update({ forecast: { periods: 6, method: "linear", confidence: 0.95, ...fc, ...p } });
  return (
    <div className="field">
      <label className="check">
        <input
          type="checkbox"
          checked={!!fc}
          onChange={(e) => update({ forecast: e.target.checked ? { periods: 6, method: "linear", confidence: 0.95 } : undefined })}
        />
        Previsão
      </label>
      {fc && (
        <>
          <div className="field-row">
            <label className="field">
              Períodos
              <input type="number" min={1} max={36} value={fc.periods}
                onChange={(e) => set({ periods: Math.min(36, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <label className="field">
              Confiança
              <select value={fc.confidence} onChange={(e) => set({ confidence: Number(e.target.value) })}>
                <option value={0.8}>80%</option>
                <option value={0.9}>90%</option>
                <option value={0.95}>95%</option>
              </select>
            </label>
          </div>
          <label className="field">
            Método
            <select value={fc.method} onChange={(e) => set({ method: e.target.value as "linear" | "moving" })}>
              <option value="linear">Tendência linear</option>
              <option value="moving">Média móvel (3 períodos)</option>
            </select>
          </label>
          <span className="small muted">Projeta a 1ª medida; a faixa é o intervalo em que o valor deve cair com essa confiança.</span>
        </>
      )}
    </div>
  );
}

// ---------------- Imagem ----------------

const MAX_IMAGE = 1_500_000;

function ImageEditor({ visual, update }: { visual: Visual; update: (patch: Partial<Visual>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const img = visual.image;
  const set = (p: Partial<NonNullable<Visual["image"]>>) => update({ image: { src: "", fit: "contain", ...img, ...p } });
  const isUpload = img?.src.startsWith("data:");

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Escolha um arquivo de imagem (PNG, JPG, SVG, GIF ou WebP).");
      return;
    }
    if (file.size > MAX_IMAGE &&
      !confirm(`A imagem tem ${(file.size / 1e6).toFixed(1)} MB. Ela fica dentro do relatório e pode não caber no armazenamento do navegador. Usar mesmo assim?`)) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set({ src: String(reader.result), alt: img?.alt || file.name.replace(/\.[^.]+$/, "") });
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="field">
      Imagem
      <div className="field-row">
        <button onClick={() => fileRef.current?.click()}>Enviar arquivo…</button>
        {img?.src && <button onClick={() => update({ image: undefined })}>Remover</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      <input
        placeholder="ou cole um endereço https://…"
        value={isUpload ? "" : img?.src ?? ""}
        onChange={(e) => set({ src: e.target.value.trim() })}
      />
      {isUpload && <span className="small muted">Imagem enviada ({Math.round((img!.src.length * 3) / 4 / 1024)} KB), guardada no relatório.</span>}
      {img?.src && !isUpload && <span className="small muted">Endereços externos precisam de internet para aparecer.</span>}
      <div className="field-row">
        <label className="field">
          Ajuste
          <select value={img?.fit ?? "contain"} onChange={(e) => set({ fit: e.target.value as "contain" | "cover" })}>
            <option value="contain">Caber inteira</option>
            <option value="cover">Preencher (corta)</option>
          </select>
        </label>
        <label className="field">
          Texto alternativo
          <input value={img?.alt ?? ""} onChange={(e) => set({ alt: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

// ---------------- Página: drill-through ----------------

function PageSettings({ report, pageId, dispatch }: { report: Report; pageId: string; dispatch: Dispatch<Action> }) {
  const page = report.pages.find((p) => p.id === pageId);
  if (!page) return null;
  return (
    <>
      <h3>Página: {page.name}</h3>
      <FieldList
        report={report}
        label="Drill-through: esta página detalha…"
        fields={page.drillthrough ?? []}
        onChange={(fields) => dispatch({ type: "setPageDrillthrough", pageId: page.id, fields })}
      />
      <p className="small muted">
        Com um campo aqui, selecione um item desse campo em outra página (clique numa barra, linha de tabela…) e use
        ↗ no visual ou o clique direito para abrir esta página filtrada por ele.
      </p>
    </>
  );
}

// ---------------- Parâmetro de campo: ligação do eixo ----------------

function ParamLink({ report, visual, update }: { report: Report; visual: Visual; update: (p: Partial<Visual>) => void }) {
  const params = report.visuals.filter((v) => v.type === "fieldparam" && v.pageId === visual.pageId);
  if (params.length === 0 && !visual.axisParam) return null;
  return (
    <label className="field">
      Eixo controlado por parâmetro
      <select value={visual.axisParam ?? ""} onChange={(e) => update({ axisParam: e.target.value || undefined, drill: undefined })}>
        <option value="">(não — usa o eixo acima)</option>
        {params.map((pv) => <option key={pv.id} value={pv.id}>{pv.title || "Parâmetro"}</option>)}
      </select>
      {visual.axisParam && <span className="small muted">O eixo acima vale só se o parâmetro estiver vazio.</span>}
    </label>
  );
}

// ---------------- Formatação condicional por regras ----------------

const RULE_OPS: { op: FormatRule["op"]; label: string }[] = [
  { op: ">", label: "maior que" }, { op: ">=", label: "maior ou igual a" }, { op: "<", label: "menor que" },
  { op: "<=", label: "menor ou igual a" }, { op: "between", label: "entre" },
];

function RulesEditor({ visual, measures, update }: { visual: Visual; measures: Measure[]; update: (p: Partial<Visual>) => void }) {
  const rules = visual.rules ?? [];
  const set = (next: FormatRule[]) => update({ rules: next });
  const patch = (i: number, p: Partial<FormatRule>) => set(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="field">
      Regras de cor (a primeira que bater vale)
      {rules.map((r, i) => (
        <div key={r.id} className="ref-line">
          <div className="field-row">
            <select value={r.measure} onChange={(e) => patch(i, { measure: Number(e.target.value) })}>
              {measures.map((m, k) => <option key={m.id} value={k}>{m.name}</option>)}
            </select>
            <button title="Remover regra" onClick={() => set(rules.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="field-row">
            <select value={r.op} onChange={(e) => patch(i, { op: e.target.value as FormatRule["op"] })}>
              {RULE_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            <input type="number" value={r.value} onChange={(e) => patch(i, { value: Number(e.target.value) })} />
            {r.op === "between" && (
              <input type="number" value={r.value2 ?? ""} onChange={(e) => patch(i, { value2: Number(e.target.value) })} />
            )}
          </div>
          <div className="field-row">
            <select value={r.style} onChange={(e) => patch(i, { style: e.target.value as FormatRule["style"] })}>
              <option value="good">▲ Verde (bom)</option>
              <option value="warn">● Amarelo (atenção)</option>
              <option value="bad">▼ Vermelho (ruim)</option>
            </select>
            <label className="check">
              <input type="checkbox" checked={r.icon} onChange={(e) => patch(i, { icon: e.target.checked })} />
              ícone
            </label>
          </div>
        </div>
      ))}
      <button disabled={measures.length === 0}
        onClick={() => set([...rules, { id: newId(), measure: 0, op: ">=", value: 0, style: "good", icon: true }])}>
        + Adicionar regra
      </button>
      <span className="small muted">Valores de percentual entram como fração: 10% = 0,1.</span>
    </div>
  );
}

// ---------------- Parâmetro "e se" ----------------

function WhatIfEditor({ report, visual, update }: { report: Report; visual: Visual; update: (p: Partial<Visual>) => void }) {
  const w = visual.whatif ?? { name: "", min: 0, max: 1, step: 0.01, value: 0, format: "percent" as MeasureFormat };
  const set = (p: Partial<NonNullable<Visual["whatif"]>>) => update({ whatif: { ...w, ...p } });
  const clash = !!w.name && report.measures.some((m) => m.name === w.name);
  const dup = !!w.name && report.visuals.some((v) => v.id !== visual.id && v.type === "whatif" && v.whatif?.name === w.name);
  const num = (k: "min" | "max" | "step" | "value", label: string) => (
    <label className="field">
      {label}
      <input type="number" value={w[k]} step={w.step} onChange={(e) => set({ [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="field">
      <label className="field">
        Nome do parâmetro (use [Nome] nas medidas)
        <input value={w.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {(clash || dup) && <span className="error small">Já existe uma medida ou parâmetro com esse nome.</span>}
      <div className="field-row">{num("min", "Mínimo")}{num("max", "Máximo")}</div>
      <div className="field-row">{num("step", "Passo")}{num("value", "Valor atual")}</div>
      <label className="field">
        Formato
        <select value={w.format} onChange={(e) => set({ format: e.target.value as MeasureFormat })}>
          <option value="percent">Percentual</option>
          <option value="number">Número</option>
          <option value="currency">Moeda (R$)</option>
        </select>
      </label>
    </div>
  );
}

// ---------------- Dica de ferramenta com detalhes ----------------

function DetailsEditor({ report, visual, update }: { report: Report; visual: Visual; update: (p: Partial<Visual>) => void }) {
  const chosen = visual.tooltipMeasures ?? [];
  return (
    <div className="field">
      Dica de ferramenta: medidas extras
      <div className="checklist">
        {report.measures.filter((m) => !visual.measureIds.includes(m.id)).map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              checked={chosen.includes(m.id)}
              onChange={() => update({ tooltipMeasures: chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : [...chosen, m.id] })}
            />
            {m.name}
          </label>
        ))}
      </div>
      <FieldSelect report={report} label="Minigráfico na dica, por (opcional)" value={visual.tooltipTrend}
        onChange={(tooltipTrend) => update({ tooltipTrend })} />
    </div>
  );
}
