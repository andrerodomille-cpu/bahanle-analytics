import type { DatePart, FieldRef, Measure, MeasureFormat, Report, Table, Visual, VisualType } from "./types";
import { fieldKey, newId } from "./types";
import type { Action } from "./store";
import { parse } from "../engine/expr";
import { Engine, whatIfParams } from "../engine/query";

/**
 * Assistente de IA: "crie um dashboard de vendas por estado" vira páginas,
 * medidas e visuais. O LLM roda localmente no Ollama e só devolve um PLANO em
 * JSON (formato fixo por JSON Schema); quem cria os visuais é este módulo, que
 * confere cada campo e cada medida contra o modelo antes de aplicar. O que não
 * passa volta para o modelo corrigir (uma tentativa).
 */

export interface OllamaConfig {
  url: string;
  model: string;
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export class AiError extends Error {}

const base = (url: string) => url.trim().replace(/\/+$/, "");

async function call<T>(url: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(url) + path, body === undefined ? { signal } : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new AiError(`Não conectou no Ollama em ${base(url)}. Ele está aberto (ollama serve) e libera esta origem (OLLAMA_ORIGINS)?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch {
      // resposta sem JSON
    }
    throw new AiError(`Ollama respondeu ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

/** Modelos baixados no Ollama (ollama pull …). */
export async function listModels(url: string): Promise<string[]> {
  const r = await call<{ models: { name: string }[] }>(url, "/api/tags");
  return r.models.map((m) => m.name).sort();
}

// ---------------- O plano que o LLM devolve ----------------

/** Visuais que a IA pode usar, com a dica do que cada um precisa. */
const AI_VISUALS: Partial<Record<VisualType, string>> = {
  card: "um número grande (1 medida, sem eixo)",
  multicard: "vários números lado a lado (2+ medidas, sem eixo)",
  kpi: "valor com variação contra outra medida (1-2 medidas; eixo de data opcional para o minigráfico)",
  gauge: "medidor de uma medida contra uma meta (1 medida, sem eixo)",
  bar: "colunas verticais: comparar categorias ou períodos curtos (eixo + 1+ medidas)",
  hbar: "barras horizontais: rankings e categorias com nomes longos (eixo + 1+ medidas)",
  stacked: "colunas empilhadas: categoria no eixo dividida pela legenda (eixo + legenda + 1 medida)",
  stacked100: "colunas 100%: participação de cada legenda em cada categoria (eixo + legenda + 1 medida)",
  line: "linha: evolução no tempo (eixo de tempo + 1+ medidas)",
  area: "área: evolução no tempo com volume (eixo de tempo + 1+ medidas)",
  combo: "colunas + linha em dois eixos (eixo + 2 medidas)",
  pie: "rosca: participação de poucas categorias, até ~6 (eixo + 1 medida)",
  treemap: "treemap: participação de muitas categorias (eixo + 1 medida)",
  waterfall: "cascata: como cada categoria compõe o total (eixo + 1 medida)",
  pareto: "Pareto: barras ordenadas + % acumulado (eixo + 1 medida)",
  funnel: "funil: etapas de um processo (eixo + 1 medida)",
  heatmap: "mapa de calor: linhas (eixo) x colunas (legenda) (eixo + legenda + 1 medida)",
  scatter: "dispersão: relação entre duas medidas, um ponto por valor do eixo (eixo + 2 medidas)",
  table: "tabela: lista com números (eixo + 1+ medidas)",
  matrix: "matriz: linhas (eixo) x colunas (legenda opcional) (eixo + 1+ medidas)",
  map: "mapa do Brasil pintado por estado; o eixo é a coluna de UF, estado ou região (eixo + 1 medida)",
  slicer: "segmentação (filtro clicável) por uma coluna (eixo, sem medidas)",
};

const PLAN_TYPES = Object.keys(AI_VISUALS) as VisualType[];

export interface PlanMeasure {
  name: string;
  table: string;
  expression: string;
  format: MeasureFormat;
}

export interface PlanVisual {
  type: string;
  title: string;
  axis?: string;
  datePart?: string;
  legend?: string;
  measures?: string[];
  topN?: number;
  sort?: string;
}

export interface Plan {
  reply: string;
  pageName?: string;
  measures?: PlanMeasure[];
  visuals?: PlanVisual[];
}

/** JSON Schema passado ao Ollama em `format`: a saída do modelo é forçada a este formato. */
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    pageName: { type: "string" },
    measures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          table: { type: "string" },
          expression: { type: "string" },
          format: { type: "string", enum: ["number", "currency", "percent"] },
        },
        required: ["name", "table", "expression", "format"],
      },
    },
    visuals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: PLAN_TYPES },
          title: { type: "string" },
          axis: { type: "string" },
          datePart: { type: "string", enum: ["", "year", "quarter", "month", "day"] },
          legend: { type: "string" },
          measures: { type: "array", items: { type: "string" } },
          topN: { type: "integer" },
          sort: { type: "string", enum: ["", "value_desc", "value_asc", "category"] },
        },
        required: ["type", "title", "axis", "measures"],
      },
    },
  },
  required: ["reply", "pageName", "measures", "visuals"],
} as const;

// ---------------- Contexto: o que o LLM sabe do modelo ----------------

/** Até `n` valores distintos de uma coluna de texto (ajuda a escrever filtros como Lojas[Região] = "Sul"). */
function sampleValues(t: Table, column: string, n = 6): string[] | null {
  const seen = new Set<string>();
  for (const r of t.rows) {
    const v = r[column];
    if (typeof v === "string" && v) seen.add(v);
    if (seen.size > 40) return null; // muitos valores distintos: amostra não ajuda
  }
  return [...seen].slice(0, n);
}

/** Descrição compacta do modelo semântico para o prompt. */
export function describeModel(report: Pick<Report, "tables" | "relationships" | "measures">): string {
  const lines: string[] = ["TABELAS (colunas e tipos):"];
  for (const t of report.tables) {
    const cols = t.columns.map((c) => {
      const sample = c.type === "text" ? sampleValues(t, c.name) : null;
      return `${c.name} (${c.type})${sample?.length ? ` ex.: ${sample.map((s) => JSON.stringify(s)).join(", ")}` : ""}`;
    });
    lines.push(`- ${t.name} [${t.rows.length} linhas]: ${cols.join("; ")}`);
  }
  if (report.relationships.length) {
    lines.push("", "RELACIONAMENTOS (muitos → um; filtros vão do lado um para o muitos):");
    for (const r of report.relationships) lines.push(`- ${r.from.table}[${r.from.column}] → ${r.to.table}[${r.to.column}]`);
  }
  if (report.measures.length) {
    lines.push("", "MEDIDAS QUE JÁ EXISTEM (use pelo nome, sem recriar):");
    for (const m of report.measures) lines.push(`- ${m.name} = ${m.expression} (${m.format})`);
  }
  return lines.join("\n");
}

export function systemPrompt(report: Pick<Report, "tables" | "relationships" | "measures">): string {
  return `Você é o assistente de um sistema de BI parecido com o Power BI. O usuário pede um dashboard em português e você responde SOMENTE com um plano em JSON.

${describeModel(report)}

COMO RESPONDER:
- "reply": uma ou duas frases em português dizendo o que você montou.
- "pageName": nome curto para a página do dashboard.
- "measures": medidas NOVAS necessárias (não repita as que já existem). Expressões em mini-DAX:
  SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT recebem Tabela[Coluna]; COUNTROWS(Tabela); DIVIDE(a, b);
  IF(cond, a, b); outra medida com [Nome]; CALCULATE(expr, Tabela[Coluna] = "valor") ou ALL(Tabela);
  SUMX(Tabela, expressão por linha). Tabelas com espaço: 'Minha Tabela'[Coluna].
  format: "currency" para dinheiro, "percent" para percentuais, "number" para o resto.
- "visuals": de 1 a 8 visuais. Cada um tem:
  type: um destes tipos —
${PLAN_TYPES.map((t) => `    ${t}: ${AI_VISUALS[t]}`).join("\n")}
  title: título curto em português.
  axis: a coluna da categoria no formato Tabela[Coluna] ("" quando o tipo não usa eixo).
  datePart: se o eixo for uma coluna do tipo date, a parte: year, quarter, month ou day; senão "".
  legend: Tabela[Coluna] para empilhadas, colunas 100%, mapa de calor e matriz; senão "".
  measures: NOMES de medidas (existentes ou criadas em "measures"), nunca expressões.
  topN: quantas categorias mostrar (0 = todas). sort: "value_desc", "value_asc", "category" ou "".

REGRAS:
- Use apenas tabelas e colunas listadas acima, escritas exatamente como aparecem.
- Prefira colunas das tabelas de dimensão (o lado "um" dos relacionamentos) no eixo.
- Para estado/UF no Brasil, o visual "map" com a coluna de UF fica ótimo; para ranking use "hbar" com sort "value_desc".
- Para tempo, use a coluna de data com datePart ou colunas como Ano/Mês de uma tabela de calendário, em "line" ou "area".
- Um dashboard completo costuma ter cartões com os totais no topo e gráficos abaixo. Se o pedido for de um único gráfico, devolva só ele.`;
}

// ---------------- Conversa com o Ollama ----------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function askPlan(config: OllamaConfig, messages: ChatMessage[], signal?: AbortSignal): Promise<{ plan: Plan; raw: string }> {
  const r = await call<{ message?: { content?: string } }>(config.url, "/api/chat", {
    model: config.model,
    messages,
    stream: false,
    format: PLAN_SCHEMA,
    options: { temperature: 0.2 },
  }, signal);
  const raw = r.message?.content ?? "";
  try {
    return { plan: JSON.parse(raw) as Plan, raw };
  } catch {
    throw new AiError("O modelo não devolveu um JSON válido. Tente de novo ou use um modelo maior.");
  }
}

// ---------------- Do plano para o relatório ----------------

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

const DATE_PARTS: DatePart[] = ["year", "quarter", "month", "day"];

/**
 * "Lojas[UF]", "'Lojas'[UF]", "Lojas.UF" ou só "UF" → campo do modelo.
 * Sem tabela, procura a coluna em todas, preferindo as dimensões (lado "um").
 */
export function resolveField(report: Pick<Report, "tables" | "relationships">, ref: string | undefined, part?: string): FieldRef | null {
  const text = (ref ?? "").trim();
  if (!text) return null;
  const m = /^'?([^'[\]]+?)'?\s*[[.]\s*([^\]]+?)\]?$/.exec(text);
  const [tableName, columnName] = m ? [m[1], m[2]] : [null, text];
  const dims = new Set(report.relationships.map((r) => r.to.table));
  const tables = tableName
    ? report.tables.filter((t) => norm(t.name) === norm(tableName))
    : [...report.tables].sort((a, b) => Number(dims.has(b.name)) - Number(dims.has(a.name)));
  for (const t of tables) {
    const col = t.columns.find((c) => c.name === columnName) ?? t.columns.find((c) => norm(c.name) === norm(columnName));
    if (!col) continue;
    const field: FieldRef = { table: t.name, column: col.name };
    if (col.type === "date" && DATE_PARTS.includes(part as DatePart)) field.part = part as DatePart;
    return field;
  }
  return null;
}

/** Tamanho preferido de cada visual (a linha estica para ocupar a largura). */
const PREFERRED: Partial<Record<VisualType, [number, number]>> = {
  card: [220, 110], kpi: [260, 160], gauge: [300, 200], multicard: [450, 160], slicer: [220, 250],
  map: [450, 420], table: [450, 320], matrix: [600, 320], heatmap: [600, 300], line: [600, 280], area: [600, 280],
};
const SMALL: VisualType[] = ["card", "kpi", "gauge", "multicard"];

export const PAGE_WIDTH = 910;
const GAP = 10;

/** Arruma os visuais em linhas: indicadores no topo, gráficos abaixo, cada linha esticada até a largura da página. */
export function layout(visuals: Pick<Visual, "type">[], top = GAP): { x: number; y: number; w: number; h: number }[] {
  const order = visuals.map((_, i) => i).sort((a, b) =>
    Number(!SMALL.includes(visuals[a].type)) - Number(!SMALL.includes(visuals[b].type)) || a - b);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let y = top;
  let row: { i: number; w: number; h: number }[] = [];
  const flush = () => {
    if (!row.length) return;
    const used = row.reduce((s, r) => s + r.w, 0);
    const scale = (PAGE_WIDTH - GAP * (row.length - 1)) / used;
    const h = Math.max(...row.map((r) => r.h));
    let x = GAP;
    for (const r of row) {
      const w = Math.round(r.w * scale);
      out[r.i] = { x, y, w, h };
      x += w + GAP;
    }
    y += h + GAP;
    row = [];
  };
  for (const i of order) {
    const [w, h] = PREFERRED[visuals[i].type] ?? [450, 280];
    const width = row.reduce((s, r) => s + r.w + GAP, 0);
    const isSmall = SMALL.includes(visuals[i].type);
    // Indicadores e gráficos não dividem a mesma linha.
    if (row.length && (width + w > PAGE_WIDTH || isSmall !== SMALL.includes(visuals[row[0].i].type))) flush();
    row.push({ i, w, h });
  }
  flush();
  return out;
}

export interface Applied {
  actions: Action[];
  /** O que foi criado, para mostrar na conversa. */
  notes: string[];
  /** Problemas do plano (campo inexistente, medida inválida…). */
  problems: string[];
  pageId: string;
  visualCount: number;
}

/**
 * Valida o plano contra o modelo e gera as ações (medidas, página, visuais).
 * Função pura: não toca no relatório, só diz o que despachar.
 */
export function planToActions(report: Report, plan: Plan, opts: { newPage: boolean; pageId: string }): Applied {
  const actions: Action[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  const measures: Measure[] = [...report.measures];
  const byName = (name: string) => measures.find((m) => m.name === name) ?? measures.find((m) => norm(m.name) === norm(name));

  const tryMeasure = (draft: Measure): string | null => {
    try {
      parse(draft.expression);
      const engine = new Engine({ ...report, measures: [...measures, draft], params: whatIfParams(report) });
      engine.evaluateMeasure(draft, []);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const addMeasure = (pm: PlanMeasure): Measure | null => {
    const name = pm.name?.trim();
    if (!name || !pm.expression?.trim()) return null;
    const existing = byName(name);
    if (existing) return existing;
    const table = report.tables.find((t) => norm(t.name) === norm(pm.table ?? ""))?.name ?? report.tables[0]?.name ?? "";
    const format: MeasureFormat = ["number", "currency", "percent"].includes(pm.format) ? pm.format : "number";
    const draft: Measure = { id: newId(), name, table, expression: pm.expression.trim(), format };
    const error = tryMeasure(draft);
    if (error) {
      problems.push(`Medida "${name}" = ${draft.expression}: ${error}`);
      return null;
    }
    measures.push(draft);
    actions.push({ type: "upsertMeasure", measure: draft });
    notes.push(`Medida [${name}] = ${draft.expression}`);
    return draft;
  };

  for (const pm of plan.measures ?? []) addMeasure(pm);

  let pageId = opts.pageId;
  if (opts.newPage) {
    pageId = newId();
    const name = plan.pageName?.trim() || `Página ${report.pages.length + 1}`;
    actions.push({ type: "addPage", page: { id: pageId, name } });
    notes.push(`Página "${name}"`);
  }

  const visuals: Visual[] = [];
  for (const pv of plan.visuals ?? []) {
    const type = pv.type as VisualType;
    const label = pv.title?.trim() || pv.type;
    if (!PLAN_TYPES.includes(type)) {
      problems.push(`Visual "${label}": tipo "${pv.type}" não existe.`);
      continue;
    }
    const usesAxis = !["card", "multicard", "gauge"].includes(type);
    const needsAxis = usesAxis && type !== "kpi";
    const axis = usesAxis ? resolveField(report, pv.axis, pv.datePart) : null;
    if (needsAxis && !axis) {
      problems.push(`Visual "${label}": eixo "${pv.axis ?? ""}" não é uma coluna do modelo (use Tabela[Coluna]).`);
      continue;
    }
    const legend = pv.legend ? resolveField(report, pv.legend) : null;
    if (pv.legend && !legend) problems.push(`Visual "${label}": legenda "${pv.legend}" não é uma coluna do modelo; ficou sem legenda.`);

    const ids: string[] = [];
    for (const ref of pv.measures ?? []) {
      const r = ref.trim().replace(/^\[(.*)\]$/, "$1");
      let m = byName(r);
      // Expressão no lugar do nome (ex.: "SUM(Vendas[Valor])"): vira uma medida nova.
      if (!m && /[([]/.test(r)) m = addMeasure({ name: r.slice(0, 60), table: "", expression: r, format: "number" }) ?? undefined;
      if (m) ids.push(m.id);
      else problems.push(`Visual "${label}": medida "${r}" não existe.`);
    }
    if (type !== "slicer" && ids.length === 0) {
      problems.push(`Visual "${label}": nenhuma medida válida; não foi criado.`);
      continue;
    }

    const sort = pv.sort === "value_desc" ? { by: 0, desc: true } : pv.sort === "value_asc" ? { by: 0, desc: false }
      : pv.sort === "category" ? { by: "category" as const, desc: false } : undefined;
    visuals.push({
      id: newId(),
      pageId,
      type,
      title: label,
      x: 0, y: 0, w: 0, h: 0,
      ...(axis ? { axis } : {}),
      ...(legend ? { legend } : {}),
      measureIds: type === "slicer" ? [] : ids,
      ...(pv.topN && pv.topN > 0 ? { topN: Math.round(pv.topN) } : {}),
      ...(sort ? { sort } : {}),
    });
  }

  // Página nova começa do topo; na página atual, os visuais vão abaixo dos que já estão lá.
  const top = opts.newPage ? GAP : Math.max(GAP, ...report.visuals.filter((v) => v.pageId === pageId).map((v) => v.y + v.h + GAP));
  layout(visuals, top).forEach((pos, i) => Object.assign(visuals[i], pos));
  for (const v of visuals) {
    actions.push({ type: "addVisual", visual: v });
    notes.push(`${v.title}${v.axis ? ` (por ${fieldKey(v.axis)})` : ""}`);
  }
  return { actions, notes, problems, pageId, visualCount: visuals.length };
}

export interface GenerateResult extends Applied {
  reply: string;
}

/**
 * Pedido em texto → ações para o relatório. Se o plano tiver problemas, devolve
 * a lista ao modelo uma vez para ele corrigir; fica com a melhor das tentativas.
 */
export async function generateDashboard(
  report: Report,
  request: string,
  config: OllamaConfig,
  opts: { newPage: boolean; pageId: string; signal?: AbortSignal; onStatus?: (s: string) => void },
): Promise<GenerateResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(report) },
    { role: "user", content: request },
  ];
  opts.onStatus?.("Pensando no dashboard");
  let { plan, raw } = await askPlan(config, messages, opts.signal);
  let applied = planToActions(report, plan, opts);
  if (applied.problems.length) {
    opts.onStatus?.("Corrigindo o plano");
    messages.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `Estes itens do plano não funcionaram:\n${applied.problems.map((p) => `- ${p}`).join("\n")}\n` +
          "Devolva o plano completo corrigido, usando só tabelas, colunas e funções que existem.",
      },
    );
    try {
      const second = await askPlan(config, messages, opts.signal);
      const retry = planToActions(report, second.plan, opts);
      if (retry.visualCount > applied.visualCount ||
        (retry.visualCount === applied.visualCount && retry.problems.length < applied.problems.length)) {
        plan = second.plan;
        applied = retry;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // a primeira tentativa continua valendo
    }
  }
  return { ...applied, reply: plan.reply?.trim() || "Pronto." };
}
