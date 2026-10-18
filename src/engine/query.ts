// Motor de consulta: contexto de filtro, propagação por relacionamentos
// e avaliação de medidas. É uma versão didática do que o VertiPaq + DAX
// fazem no Power BI (sem compressão colunar, mas com a mesma semântica
// básica de filtros em direção única).

import { parse, type Ast } from "./expr";
import type {
  FieldRef,
  Measure,
  Relationship,
  Report,
  Row,
  Table,
  Value,
  Visual,
} from "../model/types";

/** Filtro do contexto: o valor resolvido do campo precisa estar no conjunto. */
export interface ContextFilter {
  field: FieldRef;
  keys: Set<string>;
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

  constructor(private model: Pick<Report, "tables" | "relationships" | "measures">) {
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
    return current[field.column];
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
    if (cached) return cached;
    let result: Row[];
    if (filters.length === 0) {
      result = this.table(tableName).rows;
    } else {
      const base = this.rows(tableName, filters.slice(0, -1));
      const f = filters[filters.length - 1];
      result = this.path(tableName, f.field.table)
        ? base.filter((r) => f.keys.has(valueKey(this.resolve(tableName, r, f.field) ?? null)))
        : base;
    }
    if (this.rowsCache.size > 20000) this.rowsCache.clear(); // limite simples de memória
    this.rowsCache.set(sig, result);
    return result;
  }

  // ---------- Medidas ----------

  ast(measure: Measure): Ast {
    let a = this.astCache.get(measure.id);
    if (!a) {
      a = parse(measure.expression);
      this.astCache.set(measure.id, a);
    }
    return a;
  }

  evaluateMeasure(measure: Measure, filters: ContextFilter[], stack: string[] = []): number | null {
    if (stack.includes(measure.name)) {
      throw new Error(`Referência circular: ${[...stack, measure.name].join(" → ")}`);
    }
    return this.evaluate(this.ast(measure), filters, [...stack, measure.name]);
  }

  evaluate(ast: Ast, filters: ContextFilter[], stack: string[] = []): number | null {
    switch (ast.kind) {
      case "number":
        return ast.value;
      case "neg": {
        const v = this.evaluate(ast.arg, filters, stack);
        return v === null ? null : -v;
      }
      case "binary": {
        const l = this.evaluate(ast.left, filters, stack);
        const r = this.evaluate(ast.right, filters, stack);
        // Semântica de BLANK: em soma/subtração vira 0; em produto/divisão propaga.
        if (ast.op === "+" || ast.op === "-") {
          if (l === null && r === null) return null;
          return ast.op === "+" ? (l ?? 0) + (r ?? 0) : (l ?? 0) - (r ?? 0);
        }
        if (l === null || r === null) return null;
        if (ast.op === "*") return l * r;
        return r === 0 ? null : l / r;
      }
      case "divide": {
        const n = this.evaluate(ast.num, filters, stack);
        const d = this.evaluate(ast.den, filters, stack);
        if (d === null || d === 0) return ast.alt ? this.evaluate(ast.alt, filters, stack) : null;
        return n === null ? null : n / d;
      }
      case "measure": {
        const m = this.measuresByName.get(ast.name);
        if (!m) throw new Error(`Medida não encontrada: [${ast.name}]`);
        return this.evaluateMeasure(m, filters, stack);
      }
      case "countrows": {
        const n = this.rows(ast.table, filters).length;
        return n === 0 ? null : n;
      }
      case "agg":
        return aggregate(ast.fn, this.rows(ast.table, filters).map((r) => r[ast.column]));
    }
  }

  /** Valores distintos de um campo, respeitando os filtros que o alcançam. */
  distinct(field: FieldRef, filters: ContextFilter[]): Value[] {
    const seen = new Map<string, Value>();
    for (const r of this.rows(field.table, filters)) {
      const v = r[field.column];
      const k = valueKey(v);
      if (!seen.has(k)) seen.set(k, v);
    }
    return [...seen.values()];
  }
}

const filterSig = (f: ContextFilter) =>
  `${f.field.table}[${f.field.column}]=${[...f.keys].sort().join(",")}`;

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
  // O visual que originou a seleção não se filtra (ele só destaca o item).
  return report.filters
    .filter((f) => f.sourceVisualId !== visual.id)
    .map((f) => ({ field: f.field, keys: new Set(f.values.map(valueKey)) }));
}

export function runVisual(engine: Engine, report: Report, visual: Visual): VisualResult {
  try {
    const context = contextFor(report, visual);
    const measures = visual.measureIds
      .map((id) => report.measures.find((m) => m.id === id))
      .filter((m): m is Measure => !!m);

    if (!visual.axis) {
      return { rows: [{ category: null, values: measures.map((m) => engine.evaluateMeasure(m, context)) }] };
    }

    const axis = visual.axis;
    const categories = engine.distinct(axis, context);
    const rows: ResultRow[] = [];
    for (const category of categories) {
      const ctx = [...context, { field: axis, keys: new Set([valueKey(category)]) }];
      const values = measures.map((m) => engine.evaluateMeasure(m, ctx));
      // Como no Power BI, categorias em que todas as medidas são BLANK somem.
      if (measures.length === 0 || values.some((v) => v !== null)) rows.push({ category, values });
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}
