// Editor de consultas (Power Query, em miniatura): a tabela final é sempre
// fonte + etapas aplicadas em ordem. Nada é alterado "no lugar" — apagar ou
// mudar uma etapa e reaplicar dá um resultado reprodutível.

import type { Column, ColumnType, FilterOp, QueryStep, Row, TableQuery, Value } from "./types";
import { parseDate } from "./dates";

export interface StepResult {
  columns: Column[];
  rows: Row[];
  /** Erro de cada etapa (mesmo índice de `steps`); etapas com erro são puladas. */
  errors: (string | undefined)[];
}

export function applySteps(query: TableQuery): StepResult {
  let columns = query.source.columns.map((c) => ({ name: c.name, type: c.type }));
  let rows = query.source.rows;
  const errors: (string | undefined)[] = [];
  const has = (name: string) => columns.some((c) => c.name === name);

  for (const step of query.steps) {
    const missing = stepColumns(step).find((c) => !has(c));
    if (missing) {
      errors.push(`A coluna "${missing}" não existe neste ponto da consulta`);
      continue;
    }
    errors.push(undefined);
    switch (step.kind) {
      case "type": {
        columns = columns.map((c) => (c.name === step.column ? { ...c, type: step.to } : c));
        rows = rows.map((r) => ({ ...r, [step.column]: convert(r[step.column] ?? null, step.to) }));
        break;
      }
      case "rename": {
        if (has(step.to)) {
          errors[errors.length - 1] = `Já existe uma coluna "${step.to}"`;
          break;
        }
        columns = columns.map((c) => (c.name === step.column ? { ...c, name: step.to } : c));
        rows = rows.map((r) => {
          const { [step.column]: v, ...rest } = r;
          return { ...rest, [step.to]: v ?? null };
        });
        break;
      }
      case "remove": {
        const drop = new Set(step.columns);
        columns = columns.filter((c) => !drop.has(c.name));
        rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k))));
        break;
      }
      case "filter": {
        const type = columns.find((c) => c.name === step.column)!.type;
        rows = rows.filter((r) => matches(r[step.column] ?? null, step.op, step.value, type));
        break;
      }
      case "replace": {
        const type = columns.find((c) => c.name === step.column)!.type;
        const from = step.from;
        const to = step.to === "" ? null : convert(step.to, type);
        rows = rows.map((r) => (displayOf(r[step.column] ?? null) === from ? { ...r, [step.column]: to } : r));
        break;
      }
      case "dedupe": {
        const seen = new Set<string>();
        rows = rows.filter((r) => {
          const key = JSON.stringify(columns.map((c) => r[c.name] ?? null));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        break;
      }
      case "removeBlank":
        rows = rows.filter((r) => columns.some((c) => r[c.name] !== null && r[c.name] !== ""));
        break;
    }
  }
  return { columns, rows, errors };
}

function stepColumns(step: QueryStep): string[] {
  switch (step.kind) {
    case "type":
    case "rename":
    case "filter":
    case "replace":
      return [step.column];
    case "remove":
      return step.columns;
    default:
      return [];
  }
}

/** Converte um valor para o tipo; o que não converte vira em branco (como "Erro" → null). */
export function convert(v: Value, to: ColumnType): Value {
  if (v === null || v === "") return null;
  if (to === "text") return String(v);
  if (to === "number") {
    if (typeof v === "number") return v;
    const n = Number(normalizeNumber(v));
    return Number.isNaN(n) ? null : n;
  }
  return parseDate(typeof v === "number" ? excelSerialToIso(v) : v);
}

/** Excel guarda datas como número de dias desde 30/12/1899. */
function excelSerialToIso(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Aceita "1.234,56" (pt-BR) além de "1234.56". */
export function normalizeNumber(s: string): string {
  const t = s.trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) {
    return t.replace(/\./g, "").replace(",", ".");
  }
  return t;
}

const displayOf = (v: Value) => (v === null ? "" : String(v));

function matches(v: Value, op: FilterOp, raw: string, type: ColumnType): boolean {
  if (op === "não está em branco") return v !== null && v !== "";
  if (op === "contém") return displayOf(v).toLowerCase().includes(raw.toLowerCase());
  const target = convert(raw, type);
  if (v === null || target === null) return op === "<>" ? v !== target : op === "=" && v === target;
  const c = typeof v === "number" && typeof target === "number"
    ? v - target
    : String(v).localeCompare(String(target), "pt-BR", { numeric: true });
  switch (op) {
    case "=": return c === 0;
    case "<>": return c !== 0;
    case ">": return c > 0;
    case ">=": return c >= 0;
    case "<": return c < 0;
    case "<=": return c <= 0;
  }
}

/**
 * Detecta o tipo de uma coluna pelos valores (como o "Tipo Alterado"
 * automático do Power Query): número, data ou texto.
 */
export function detectType(values: unknown[]): ColumnType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (sample.length === 0) return "text";
  if (sample.every((v) => typeof v === "number" || (typeof v === "string" && isNumericText(v)))) return "number";
  if (sample.every((v) => v instanceof Date || (typeof v === "string" && parseDate(v) !== null))) return "date";
  return "text";
}

const isNumericText = (s: string) => s.trim() !== "" && !Number.isNaN(Number(normalizeNumber(s)));

/** Etapas iniciais que a importação cria sozinha: o "Tipo Alterado". */
export function autoTypeSteps(columns: Column[], rows: Row[]): QueryStep[] {
  return columns
    .map((c) => ({ c, type: detectType(rows.map((r) => r[c.name])) }))
    .filter(({ c, type }) => type !== c.type)
    .map(({ c, type }) => ({ kind: "type" as const, column: c.name, to: type, auto: true }));
}

const TYPE_LABEL: Record<ColumnType, string> = { text: "Texto", number: "Número", date: "Data" };

/** Nome da etapa, como aparece em "Etapas aplicadas". */
export function describeStep(step: QueryStep): string {
  switch (step.kind) {
    case "type":
      return `${step.auto ? "Tipo detectado" : "Tipo alterado"}: ${step.column} → ${TYPE_LABEL[step.to]}`;
    case "rename":
      return `Renomeada: ${step.column} → ${step.to}`;
    case "remove":
      return `Removida${step.columns.length > 1 ? "s" : ""}: ${step.columns.join(", ")}`;
    case "filter":
      return `Linhas filtradas: ${step.column} ${step.op}${step.op === "não está em branco" ? "" : ` "${step.value}"`}`;
    case "replace":
      return `Valor substituído em ${step.column}: "${step.from}" → "${step.to}"`;
    case "dedupe":
      return "Duplicatas removidas";
    case "removeBlank":
      return "Linhas em branco removidas";
  }
}
