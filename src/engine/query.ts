// Motor de consulta: contexto de filtro, propagação por relacionamentos
// e avaliação de medidas. É uma versão didática do que o VertiPaq + DAX
// fazem no Power BI (sem compressão colunar, mas com a mesma semântica
// básica de filtros em direção única).

import { parse, type Ast, type CalcArg, type CompareOp, type IterFn, type TableExpr } from "./expr";
import { datePart, isIsoDate, shiftDate } from "../model/dates";
import type {
  DatePart,
  FieldRef,
  ValueRange,
  Measure,
  Relationship,
  Report,
  Row,
  Table,
  Value,
  Visual,
} from "../model/types";

/**
 * Filtro do contexto: o valor resolvido do campo precisa estar no conjunto
 * (`keys`) ou dentro do intervalo (`range`).
 */
export interface ContextFilter {
  field: FieldRef;
  keys?: Set<string>;
  range?: ValueRange;
}

/** Compara números como números e o resto (datas ISO, textos) como texto. */
function cmp(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  // Datas ISO ordenam certo como texto, sem depender do idioma.
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** O valor passa pelo filtro? BLANK nunca entra num intervalo. */
export function passes(f: ContextFilter, v: Value): boolean {
  if (f.range) {
    if (v === null || v === "") return false;
    const { min, max, maxOpen } = f.range;
    if (min !== undefined && min !== null && cmp(v, min) < 0) return false;
    if (max !== undefined && max !== null) {
      const c = cmp(v, max);
      if (maxOpen ? c >= 0 : c > 0) return false;
    }
    return true;
  }
  return f.keys?.has(valueKey(v)) ?? true;
}

/** Converte um filtro salvo (lista ou intervalo) em filtro de contexto. */
export function toContext(f: { field: FieldRef; values: Value[]; range?: ValueRange }): ContextFilter {
  return f.range ? { field: f.field, range: f.range } : { field: f.field, keys: new Set(f.values.map(valueKey)) };
}

const isActive = (f: { values: Value[]; range?: ValueRange }) => f.values.length > 0 || !!f.range;

/** Resultado de uma expressão: número, texto, verdadeiro/falso ou BLANK (null). */
export type Scalar = number | string | boolean | null;

/** Contexto de linha: a linha atual de uma tabela (colunas calculadas). */
export interface RowContext {
  table: string;
  row: Row;
}

/** Chave canônica para comparar valores vindos de CSVs (número x texto). */
export const valueKey = (v: Value) => (v === null || v === "" ? "\u0000blank" : String(v));

export class Engine {
  private tables = new Map<string, Table>();
  private measuresByName = new Map<string, Measure>();
  private astCache = new Map<string, Ast>();
  private pathCache = new Map<string, Relationship[] | null>();
  private indexCache = new Map<string, Map<string, Row>>();
  private rowsCache = new Map<string, Row[]>();
  private groupCache = new Map<string, Map<string, Row[]>>();
  /** Contadores para o analisador de desempenho. */
  stats = { rowsScanned: 0, cacheHits: 0, cacheMisses: 0, measureEvals: 0 };

  constructor(private model: Pick<Report, "tables" | "relationships" | "measures"> & {
    /** Parâmetros "e se": [Nome] numa medida vale o valor atual do controle. */
    params?: Record<string, number>;
  }) {
    for (const t of model.tables) this.tables.set(t.name, t);
    for (const m of model.measures) this.measuresByName.set(m.name, m);
  }

  table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new Error(`Tabela não encontrada: ${name}`);
    return t;
  }

  // ---------- Relacionamentos ----------

  /** Caminho muitos→um de `from` até `to` (busca em largura). */
  path(from: string, to: string): Relationship[] | null {
    if (from === to) return [];
    const key = `${from}→${to}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key)!;
    const queue: { table: string; path: Relationship[] }[] = [{ table: from, path: [] }];
    const seen = new Set([from]);
    let found: Relationship[] | null = null;
    while (queue.length && !found) {
      const { table, path } = queue.shift()!;
      for (const rel of this.model.relationships) {
        if (rel.from.table !== table || seen.has(rel.to.table)) continue;
        const next = [...path, rel];
        if (rel.to.table === to) {
          found = next;
          break;
        }
        seen.add(rel.to.table);
        queue.push({ table: rel.to.table, path: next });
      }
    }
    this.pathCache.set(key, found);
    return found;
  }

  /** Índice do lado "um": valor da chave → linha. */
  private index(rel: Relationship): Map<string, Row> {
    const key = `${rel.to.table}[${rel.to.column}]`;
    let idx = this.indexCache.get(key);
    if (!idx) {
      idx = new Map();
      for (const row of this.table(rel.to.table).rows) idx.set(valueKey(row[rel.to.column]), row);
      this.indexCache.set(key, idx);
    }
    return idx;
  }

  /** Valor de `field` visto a partir de uma linha de `tableName` (como RELATED). */
  resolve(tableName: string, row: Row, field: FieldRef): Value | undefined {
    const path = this.path(tableName, field.table);
    if (!path) return undefined;
    let current: Row | undefined = row;
    for (const rel of path) {
      current = this.index(rel).get(valueKey(current[rel.from.column]));
      if (!current) return null; // chave sem correspondência = linha "em branco"
    }
    return withPart(current[field.column] ?? null, field.part);
  }

  // ---------- Contexto de filtro ----------

  /**
   * Linhas de `tableName` que passam pelos filtros. Filtros em tabelas
   * inalcançáveis (ex.: fato filtrando dimensão) são ignorados — é a
   * direção única do Power BI. O cache é incremental por prefixo, então
   * acrescentar o filtro de categoria reaproveita o contexto já filtrado.
   */
  rows(tableName: string, filters: ContextFilter[]): Row[] {
    const sig = tableName + "|" + filters.map(filterSig).join("|");
    const cached = this.rowsCache.get(sig);
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }
    this.stats.cacheMisses++;
    let result: Row[];
    if (filters.length === 0) {
      result = this.table(tableName).rows;
    } else {
      const prefix = filters.slice(0, -1);
      const base = this.rows(tableName, prefix);
      const f = filters[filters.length - 1];
      if (!this.path(tableName, f.field.table)) {
        result = base;
      } else if (f.keys) {
        // Filtro por lista: agrupa as linhas do prefixo pelo valor do campo uma
        // única vez; cada categoria vira uma consulta ao grupo, sem nova varredura.
        const groups = this.groups(tableName, prefix, base, f.field);
        result = f.keys.size === 1
          ? groups.get([...f.keys][0]) ?? []
          : [...f.keys].flatMap((k) => groups.get(k) ?? []);
      } else {
        this.stats.rowsScanned += base.length;
        result = base.filter((r) => passes(f, this.resolve(tableName, r, f.field) ?? null));
      }
    }
    if (this.rowsCache.size > 20000) {
      // limite simples de memória
      this.rowsCache.clear();
      this.groupCache.clear();
    }
    this.rowsCache.set(sig, result);
    return result;
  }

  /** Linhas de `base` agrupadas pelo valor resolvido de `field` (calculado uma vez por prefixo e campo). */
  private groups(tableName: string, prefix: ContextFilter[], base: Row[], field: FieldRef): Map<string, Row[]> {
    const key = `${tableName}|${prefix.map(filterSig).join("|")}#${field.table}[${field.column}]${field.part ?? ""}`;
    let g = this.groupCache.get(key);
    if (!g) {
      g = new Map();
      this.stats.rowsScanned += base.length;
      for (const r of base) {
        const k = valueKey(this.resolve(tableName, r, field) ?? null);
        const list = g.get(k);
        if (list) list.push(r);
        else g.set(k, [r]);
      }
      this.groupCache.set(key, g);
    }
    return g;
  }

  // ---------- Medidas e expressões ----------

  ast(measure: Measure): Ast {
    let a = this.astCache.get(measure.id);
    if (!a) {
      a = parse(measure.expression);
      this.astCache.set(measure.id, a);
    }
    return a;
  }

  /** Medidas sempre devolvem número (ou BLANK); verdadeiro/falso vira 1/0. */
  evaluateMeasure(measure: Measure, filters: ContextFilter[], stack: string[] = []): number | null {
    this.stats.measureEvals++;
    if (stack.includes(measure.name)) {
      throw new Error(`Referência circular: ${[...stack, measure.name].join(" → ")}`);
    }
    const v = this.evaluate(this.ast(measure), filters, [...stack, measure.name]);
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`A medida [${measure.name}] devolveu texto ("${v}"); medidas devem ser numéricas`);
      return n;
    }
    return typeof v === "boolean" ? Number(v) : v;
  }

  /**
   * Avalia uma expressão. `row` é o contexto de linha (colunas calculadas):
   * nele, Tabela[Coluna] lê a linha atual e RELATED segue os relacionamentos.
   * Sem contexto de linha, uma coluna solta é erro — precisa de agregação.
   */
  evaluate(ast: Ast, filters: ContextFilter[], stack: string[] = [], row?: RowContext): Scalar {
    const ev = (a: Ast, f = filters) => this.evaluate(a, f, stack, row);
    switch (ast.kind) {
      case "number":
      case "string":
        return ast.value;
      case "neg": {
        const v = toNumber(ev(ast.arg));
        return v === null ? null : -v;
      }
      case "binary": {
        const l = toNumber(ev(ast.left));
        const r = toNumber(ev(ast.right));
        // Semântica de BLANK: em soma/subtração vira 0; em produto/divisão propaga.
        if (ast.op === "+" || ast.op === "-") {
          if (l === null && r === null) return null;
          return ast.op === "+" ? (l ?? 0) + (r ?? 0) : (l ?? 0) - (r ?? 0);
        }
        if (l === null || r === null) return null;
        if (ast.op === "*") return l * r;
        return r === 0 ? null : l / r;
      }
      case "concat":
        return toText(ev(ast.left)) + toText(ev(ast.right));
      case "compare":
        return compareScalars(ast.op, ev(ast.left), ev(ast.right));
      case "if":
        return isTruthy(ev(ast.cond)) ? ev(ast.then) : ast.else ? ev(ast.else) : null;
      case "divide": {
        const n = toNumber(ev(ast.num));
        const d = toNumber(ev(ast.den));
        if (d === null || d === 0) return ast.alt ? ev(ast.alt) : null;
        return n === null ? null : n / d;
      }
      case "measure": {
        // Em coluna calculada, [Nome] pode ser uma coluna da própria tabela.
        if (row && this.table(row.table).columns.some((c) => c.name === ast.name)) {
          return row.row[ast.name] ?? null;
        }
        const param = this.model.params?.[ast.name];
        if (param !== undefined) return param;
        const m = this.measuresByName.get(ast.name);
        if (!m) throw new Error(`Medida não encontrada: [${ast.name}]`);
        return this.evaluateMeasure(m, filters, stack);
      }
      case "column": {
        if (!row) {
          throw new Error(
            `${ast.table}[${ast.column}] sem agregação: numa medida use SUM(${ast.table}[${ast.column}]) ou outra agregação`,
          );
        }
        this.checkColumn(ast.table, ast.column);
        if (ast.table === row.table) return row.row[ast.column] ?? null;
        // Coluna de outra tabela no contexto de linha: segue o relacionamento.
        return this.related(row, ast.table, ast.column);
      }
      case "related":
        if (!row) throw new Error("RELATED só funciona em colunas calculadas (contexto de linha)");
        this.checkColumn(ast.table, ast.column);
        return this.related(row, ast.table, ast.column);
      case "countrows": {
        const n = this.tableRows(ast.table, filters, stack, row).rows.length;
        return n === 0 ? null : n;
      }
      case "iter": {
        // Iterador: avalia a expressão em cada linha (contexto de linha) e agrega.
        // Simplificação didática: [Medida] dentro do iterador NÃO faz transição de
        // contexto (no DAX real, a linha atual viraria filtro).
        const { table, rows } = this.tableRows(ast.table, filters, stack, row);
        const values = rows.map((r) => this.evaluate(ast.expr, filters, stack, { table, row: r }));
        return iterate(ast.fn, values);
      }
      case "agg":
        this.checkColumn(ast.table, ast.column);
        return aggregate(ast.fn, this.rows(ast.table, filters).map((r) => r[ast.column]));
      case "calculate":
        return ev(ast.expr, this.applyCalcArgs(filters, ast.args));
    }
  }

  /**
   * CALCULATE modifica o contexto de filtro antes de avaliar:
   * - ALL(Tabela) remove os filtros que alcançam a tabela (tabela expandida);
   * - ALL(Tabela[Coluna]) remove só os filtros daquela coluna;
   * - Tabela[Coluna] = valor SUBSTITUI o filtro existente daquela coluna.
   */
  applyCalcArgs(filters: ContextFilter[], args: CalcArg[]): ContextFilter[] {
    let result = filters;
    for (const arg of args) {
      this.table(arg.table);
      if (arg.kind === "dates") {
        this.checkColumn(arg.table, arg.column);
        result = this.timeIntelligence(result, arg);
        continue;
      }
      if (arg.kind === "all") {
        if (arg.column) this.checkColumn(arg.table, arg.column);
        result = arg.column
          ? result.filter((f) => !(f.field.table === arg.table && f.field.column === arg.column))
          : result.filter((f) => !this.path(arg.table, f.field.table));
        continue;
      }
      this.checkColumn(arg.table, arg.column);
      const field = { table: arg.table, column: arg.column };
      let keys = new Set(arg.values.map((v) => valueKey(v)));
      if (arg.negate) {
        const excluded = keys;
        keys = new Set(this.table(arg.table).rows.map((r) => valueKey(r[arg.column])).filter((k) => !excluded.has(k)));
      }
      result = [
        ...result.filter((f) => !(f.field.table === arg.table && f.field.column === arg.column)),
        { field, keys },
      ];
    }
    return result;
  }

  /**
   * Funções de inteligência de tempo: partem das datas visíveis no contexto,
   * calculam o novo conjunto de datas e trocam TODOS os filtros da tabela de
   * datas por ele (como o Power BI faz com uma tabela de datas marcada).
   */
  private timeIntelligence(filters: ContextFilter[], arg: Extract<CalcArg, { kind: "dates" }>): ContextFilter[] {
    const visible = new Set<string>();
    for (const r of this.rows(arg.table, filters)) {
      const v = r[arg.column];
      if (isIsoDate(v ?? null)) visible.add(v as string);
    }
    let dates: string[];
    if (arg.fn === "ytd") {
      const max = [...visible].sort().at(-1);
      const all = this.table(arg.table).rows.map((r) => r[arg.column]).filter((v): v is string => isIsoDate(v ?? null));
      dates = max ? all.filter((d) => d >= `${max.slice(0, 4)}-01-01` && d <= max) : [];
    } else if (arg.fn === "sply") {
      dates = [...visible].map((d) => shiftDate(d, -1, "YEAR"));
    } else {
      dates = [...visible].map((d) => shiftDate(d, arg.n ?? 0, arg.unit ?? "DAY"));
    }
    return [
      ...filters.filter((f) => f.field.table !== arg.table),
      { field: { table: arg.table, column: arg.column }, keys: new Set(dates) },
    ];
  }

  /** Linhas de uma expressão de tabela: Tabela, ALL(Tabela) ou FILTER(...). */
  tableRows(te: TableExpr, filters: ContextFilter[], stack: string[], row?: RowContext): { table: string; rows: Row[] } {
    switch (te.kind) {
      case "table":
        return { table: te.name, rows: this.rows(te.name, filters) };
      case "all":
        return { table: te.name, rows: this.table(te.name).rows };
      case "filter": {
        const base = this.tableRows(te.table, filters, stack, row);
        const rows = base.rows.filter((r) => isTruthy(this.evaluate(te.cond, filters, stack, { table: base.table, row: r })));
        return { table: base.table, rows };
      }
    }
  }

  private related(row: RowContext, table: string, column: string): Scalar {
    const v = this.resolve(row.table, row.row, { table, column });
    if (v === undefined) {
      throw new Error(`Não há relacionamento de ${row.table} para ${table} (RELATED segue do lado "muitos" para o "um")`);
    }
    return v;
  }

  private checkColumn(table: string, column: string) {
    if (!this.table(table).columns.some((c) => c.name === column)) {
      throw new Error(`Coluna não encontrada: ${table}[${column}]`);
    }
  }

  /** Valores distintos de um campo, respeitando os filtros que o alcançam. */
  distinct(field: FieldRef, filters: ContextFilter[]): Value[] {
    const seen = new Map<string, Value>();
    for (const r of this.rows(field.table, filters)) {
      const v = withPart(r[field.column] ?? null, field.part);
      const k = valueKey(v);
      if (!seen.has(k)) seen.set(k, v);
    }
    return [...seen.values()];
  }
}

const filterSig = (f: ContextFilter) =>
  `${f.field.table}[${f.field.column}]${f.field.part ?? ""}` +
  (f.range
    ? `~${f.range.min ?? ""}..${f.range.max ?? ""}${f.range.maxOpen ? ")" : "]"}`
    : `=${[...(f.keys ?? [])].sort().join(",")}`);

const withPart = (v: Value, part?: DatePart): Value => (part ? datePart(v, part) : v);

function iterate(fn: IterFn, values: Scalar[]): number | null {
  if (fn === "COUNTX") {
    const n = values.filter((v) => v !== null && v !== "").length;
    return n || null;
  }
  const nums = values.map(toNumber).filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  switch (fn) {
    case "SUMX":
      return nums.reduce((a, b) => a + b, 0);
    case "AVERAGEX":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "MINX":
      return Math.min(...nums);
    case "MAXX":
      return Math.max(...nums);
  }
}

const toNumber = (v: Scalar): number | null => {
  if (v === null || v === "") return null;
  if (typeof v === "boolean") return Number(v);
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Não é possível usar o texto "${v}" numa conta`);
  return n;
};

const toText = (v: Scalar): string =>
  v === null ? "" : typeof v === "boolean" ? (v ? "VERDADEIRO" : "FALSO") : String(v);

const isTruthy = (v: Scalar) => v !== null && v !== "" && v !== 0 && v !== false;

const isNumeric = (v: Scalar) =>
  v === null || typeof v === "number" || typeof v === "boolean" ||
  (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));

/** Compara como número quando os dois lados são numéricos; senão, como texto. BLANK = 0 ou "". */
function compareScalars(op: CompareOp, a: Scalar, b: Scalar): boolean {
  const c = isNumeric(a) && isNumeric(b)
    ? (toNumber(a) ?? 0) - (toNumber(b) ?? 0)
    : toText(a).localeCompare(toText(b), "pt-BR");
  switch (op) {
    case "=": return c === 0;
    case "<>": return c !== 0;
    case "<": return c < 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    case ">=": return c >= 0;
  }
}

function aggregate(fn: string, values: Value[]): number | null {
  const nonBlank = values.filter((v) => v !== null && v !== "");
  if (fn === "COUNT") return nonBlank.length || null;
  if (fn === "DISTINCTCOUNT") return new Set(nonBlank.map(String)).size || null;
  const nums = nonBlank.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return null;
  switch (fn) {
    case "SUM":
      return nums.reduce((a, b) => a + b, 0);
    case "AVERAGE":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "MIN":
      return Math.min(...nums);
    case "MAX":
      return Math.max(...nums);
  }
  return null;
}

// ---------- Consulta de um visual ----------

export interface ResultRow {
  category: Value;
  values: (number | null)[];
}

export interface VisualResult {
  rows: ResultRow[];
  error?: string;
}

/** Converte os filtros cruzados do relatório no contexto de um visual. */
export function contextFor(report: Report, visual: Visual): ContextFilter[] {
  // 1) Painel de Filtros: relatório (todas as páginas), página e visual.
  const pane = (report.paneFilters ?? [])
    .filter(isActive)
    .filter((f) =>
      f.scope === "report" ||
      (f.scope === "page" && f.targetId === visual.pageId) ||
      (f.scope === "visual" && f.targetId === visual.id))
    .map(toContext);

  // 2) Filtro cruzado: vale só na página do visual. O visual que originou a
  //    seleção não se filtra (ele só destaca o item).
  const samePage = new Set(report.visuals.filter((v) => v.pageId === visual.pageId).map((v) => v.id));
  const cross = report.filters
    .filter((f) => f.sourceVisualId !== visual.id && samePage.has(f.sourceVisualId))
    .map(toContext);

  // 3) Drill-through: a página de detalhe vê só o item escolhido na origem.
  const dt = report.drillthrough;
  const through = dt && dt.pageId === visual.pageId ? [{ field: dt.field, keys: new Set([valueKey(dt.value)]) }] : [];

  // 4) Drill-down: o valor escolhido em cada nível acima do atual.
  return [...pane, ...cross, ...through, ...drillFilters(report, visual)];
}

// ---------- Hierarquias e drill-down ----------

const DATE_LEVELS: DatePart[] = ["year", "quarter", "month", "day"];

/**
 * Níveis de detalhamento do eixo. Uma coluna de data vira automaticamente
 * Ano › Trimestre › Mês › Dia (como a "data/hora automática" do Power BI);
 * outros campos usam o eixo seguido dos níveis extras configurados.
 */
export function hierarchyOf(report: Report, visual: Visual): FieldRef[] {
  const axis = baseAxis(report, visual);
  if (!axis) return [];
  const column = report.tables.find((t) => t.name === axis.table)?.columns.find((c) => c.name === axis.column);
  if (column?.type === "date" && !axis.part) return DATE_LEVELS.map((part) => ({ ...axis, part }));
  return [axis, ...(visual.drillFields ?? [])];
}

/**
 * Eixo configurado do visual. Se ele está ligado a um parâmetro de campo,
 * vale o campo escolhido no parâmetro ("ver por Região / Loja / Produto").
 */
export function baseAxis(report: Report, visual: Visual): FieldRef | undefined {
  if (visual.axisParam) {
    const param = report.visuals.find((v) => v.id === visual.axisParam && v.type === "fieldparam");
    const fields = param?.paramFields ?? [];
    if (fields.length) return fields[Math.min(param!.paramIndex ?? 0, fields.length - 1)];
  }
  return visual.axis;
}

const drillLevel = (report: Report, visual: Visual) =>
  Math.min(visual.drill?.level ?? 0, Math.max(0, hierarchyOf(report, visual).length - 1));

/** Campo efetivamente usado como eixo, considerando o nível de drill atual. */
export function axisOf(report: Report, visual: Visual): FieldRef | undefined {
  return hierarchyOf(report, visual)[drillLevel(report, visual)];
}

function drillFilters(report: Report, visual: Visual): ContextFilter[] {
  const levels = hierarchyOf(report, visual);
  const level = drillLevel(report, visual);
  const path = visual.drill?.path ?? [];
  const out: ContextFilter[] = [];
  for (let i = 0; i < level; i++) {
    if (path[i] !== undefined) out.push({ field: levels[i], keys: new Set([valueKey(path[i] ?? null)]) });
  }
  return out;
}

const only = (field: FieldRef, v: Value): ContextFilter => ({ field, keys: new Set([valueKey(v)]) });

/**
 * Linha de total de uma tabela: as medidas avaliadas sem o filtro de cada
 * categoria. Com Top N, o total considera só as categorias que sobraram.
 */
export function runTotals(engine: Engine, report: Report, visual: Visual, result: VisualResult): (number | null)[] {
  try {
    const measures = visual.measureIds
      .map((id) => report.measures.find((m) => m.id === id))
      .filter((m): m is Measure => !!m);
    let context = contextFor(report, visual);
    const axis = axisOf(report, visual);
    if (axis && visual.topN) {
      context = [...context, { field: axis, keys: new Set(result.rows.map((r) => valueKey(r.category))) }];
    }
    return measures.map((m) => engine.evaluateMeasure(m, context));
  } catch {
    return [];
  }
}

// ---------- Consulta em duas dimensões (matriz, colunas empilhadas) ----------

export interface GridResult {
  rows: Value[];
  cols: Value[];
  /** cells.get(chaveLinha)?.get(chaveColuna) = valores das medidas */
  cells: Map<string, Map<string, (number | null)[]>>;
  rowTotals: Map<string, (number | null)[]>;
  colTotals: Map<string, (number | null)[]>;
  grandTotal: (number | null)[];
  error?: string;
}

/**
 * Cada célula é avaliada no contexto linha + coluna; os totais são avaliados
 * de novo no contexto mais largo (não somados) — como no Power BI, o total de
 * uma medida não-aditiva (ex.: ticket médio) é a medida no total, não a soma.
 */
export function runGrid(engine: Engine, report: Report, visual: Visual): GridResult {
  const empty: GridResult = {
    rows: [], cols: [], cells: new Map(), rowTotals: new Map(), colTotals: new Map(), grandTotal: [],
  };
  try {
    const context = contextFor(report, visual);
    const measures = visual.measureIds
      .map((id) => report.measures.find((m) => m.id === id))
      .filter((m): m is Measure => !!m);
    const axis = axisOf(report, visual);
    const legend = visual.legend;
    if (!axis || !legend || measures.length === 0) return empty;
    const evalAll = (ctx: ContextFilter[]) => measures.map((m) => engine.evaluateMeasure(m, ctx));
    const hasValue = (vals: (number | null)[]) => vals.some((v) => v !== null);

    const result: GridResult = { ...empty, grandTotal: evalAll(context) };
    const rows = engine.distinct(axis, context);
    const cols = engine.distinct(legend, context);

    for (const r of rows) {
      const vals = evalAll([...context, only(axis, r)]);
      if (hasValue(vals)) {
        result.rows.push(r);
        result.rowTotals.set(valueKey(r), vals);
      }
    }
    for (const c of cols) {
      const vals = evalAll([...context, only(legend, c)]);
      if (hasValue(vals)) {
        result.cols.push(c);
        result.colTotals.set(valueKey(c), vals);
      }
    }
    for (const r of result.rows) {
      const line = new Map<string, (number | null)[]>();
      const rowCtx = [...context, only(axis, r)];
      for (const c of result.cols) line.set(valueKey(c), evalAll([...rowCtx, only(legend, c)]));
      result.cells.set(valueKey(r), line);
    }
    return result;
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

export function runVisual(engine: Engine, report: Report, visual: Visual): VisualResult {
  try {
    const context = contextFor(report, visual);
    const measures = visual.measureIds
      .map((id) => report.measures.find((m) => m.id === id))
      .filter((m): m is Measure => !!m);

    const axis = axisOf(report, visual);
    if (!axis) {
      return { rows: [{ category: null, values: measures.map((m) => engine.evaluateMeasure(m, context)) }] };
    }

    const categories = engine.distinct(axis, context);
    const rows: ResultRow[] = [];
    for (const category of categories) {
      const ctx = [...context, { field: axis, keys: new Set([valueKey(category)]) }];
      const values = measures.map((m) => engine.evaluateMeasure(m, ctx));
      // Como no Power BI, categorias em que todas as medidas são BLANK somem.
      if (measures.length === 0 || values.some((v) => v !== null)) rows.push({ category, values });
    }
    // Filtro Top N: as N categorias com maior valor da primeira medida.
    if (visual.topN && visual.topN > 0 && measures.length > 0 && rows.length > visual.topN) {
      const kept = new Set(
        [...rows]
          .sort((a, b) => (b.values[0] ?? -Infinity) - (a.values[0] ?? -Infinity))
          .slice(0, visual.topN),
      );
      return { rows: rows.filter((r) => kept.has(r)) };
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Texto dinâmico ----------

/**
 * Caixa de texto: cada [Nome da medida] vira o valor da medida avaliada no
 * contexto do visual (filtros do painel, cruzados e da página), já formatado.
 * Nomes que não são medidas ficam como estão.
 */
export function fillTemplate(
  engine: Engine,
  report: Report,
  visual: Visual,
  text: string,
  format: (v: number | null, m: Measure) => string,
): string {
  const context = contextFor(report, visual);
  return text.replace(/\[([^\]]+)\]/g, (token, name: string) => {
    const m = report.measures.find((x) => x.name === name);
    if (!m) return token;
    try {
      return format(engine.evaluateMeasure(m, context), m);
    } catch {
      return "(erro)";
    }
  });
}

/** Valores atuais dos parâmetros "e se" do relatório, por nome. */
export function whatIfParams(report: Pick<Report, "visuals">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of report.visuals) if (v.type === "whatif" && v.whatif?.name) out[v.whatif.name] = v.whatif.value;
  return out;
}
