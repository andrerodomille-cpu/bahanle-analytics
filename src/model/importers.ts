// Fontes de dados. Cada importação gera uma consulta: a fonte "crua" mais as
// etapas automáticas de tipo, como o Power Query faz ao conectar num arquivo.

import Papa from "papaparse";
import type { Column, Row, Table, TableQuery, Value } from "./types";
import { applySteps, autoTypeSteps } from "./transform";
import { parseDate } from "./dates";

/** Monta a tabela a partir de cabeçalho + linhas de valores brutos. */
function fromGrid(name: string, origin: string, header: unknown[], data: unknown[][]): Table {
  const names = uniqueNames(header.map((h, i) => (h === null || h === undefined || String(h).trim() === "" ? `Coluna${i + 1}` : String(h).trim())));
  const columns: Column[] = names.map((n) => ({ name: n, type: "text" }));
  const rows: Row[] = data
    .filter((r) => r.some((v) => v !== null && v !== undefined && v !== ""))
    .map((r) => Object.fromEntries(names.map((n, i) => [n, raw(r[i])])));
  return tableFromQuery(name, { origin, source: { columns, rows }, steps: autoTypeSteps(columns, rows) });
}

/** Aplica as etapas e devolve a tabela pronta (sem colunas calculadas). */
export function tableFromQuery(name: string, query: TableQuery): Table {
  const { columns, rows } = applySteps(query);
  return { name, columns, rows, query };
}

function raw(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return parseDate(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  const s = String(v).trim();
  return s === "" ? null : s;
}

function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((n) => {
    const count = used.get(n) ?? 0;
    used.set(n, count + 1);
    return count === 0 ? n : `${n} (${count + 1})`;
  });
}

const baseName = (file: string) => file.replace(/\.[^.]+$/, "");

// ---------- CSV ----------

/** Lê um CSV; o separador (",", ";", tab) é detectado sozinho. */
export function parseCsv(name: string, text: string, origin = `${name}.csv`): Table {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
  if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
  const [header = [], ...data] = parsed.data;
  if (header.length === 0) throw new Error("Arquivo vazio");
  return fromGrid(name, origin, header, data);
}

// ---------- Excel ----------

/** Lê todas as planilhas não vazias de um .xlsx; cada uma vira uma tabela. */
export async function parseXlsx(file: File): Promise<Table[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const filled = sheets.filter((s) => s.data.length > 0);
  if (filled.length === 0) throw new Error("A planilha está vazia");
  return filled.map((s) => {
    const [header, ...data] = s.data as unknown[][];
    const name = filled.length === 1 ? baseName(file.name) : s.sheet;
    return fromGrid(name, `${file.name} › ${s.sheet}`, header, data);
  });
}

// ---------- JSON ----------

/**
 * Aceita uma lista de objetos ou um objeto com uma lista dentro (ex.: { "dados": [...] }).
 * Objetos aninhados viram colunas "a.b"; listas viram texto JSON.
 */
export function parseJson(name: string, text: string, origin = `${name}.json`): Table {
  const data: unknown = JSON.parse(text);
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? Object.values(data).find(Array.isArray)
      : undefined;
  if (!list || list.length === 0) throw new Error("Não encontrei uma lista de registros no JSON");
  const records = list.map((item) => flatten(item));
  const header: string[] = [];
  for (const r of records) for (const k of Object.keys(r)) if (!header.includes(k)) header.push(k);
  return fromGrid(name, origin, header, records.map((r) => header.map((h) => r[h])));
}

function flatten(item: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    out[prefix || "valor"] = Array.isArray(item) ? JSON.stringify(item) : item;
    return out;
  }
  for (const [k, v] of Object.entries(item)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

// ---------- Arquivo qualquer ----------

export async function importFile(file: File): Promise<Table[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") return parseXlsx(file);
  const text = await file.text();
  if (ext === "json") return [parseJson(baseName(file.name), text, file.name)];
  if (ext === "csv" || ext === "txt" || ext === "tsv") return [parseCsv(baseName(file.name), text, file.name)];
  throw new Error(`Formato não suportado: .${ext} (use .csv, .xlsx ou .json)`);
}
