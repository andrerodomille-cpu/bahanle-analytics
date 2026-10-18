import Papa from "papaparse";
import type { Column, Row, Table } from "./types";

/** Lê um CSV e detecta o tipo de cada coluna (como o "Detectar tipo" do Power Query). */
export function parseCsv(name: string, text: string): Table {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0].message);
  }
  const headers = parsed.meta.fields ?? [];
  const isNumeric = (s: string) => s.trim() !== "" && !Number.isNaN(Number(normalizeNumber(s)));

  const columns: Column[] = headers.map((h) => {
    const sample = parsed.data.map((r) => r[h] ?? "").filter((s) => s.trim() !== "");
    return { name: h, type: sample.length > 0 && sample.every(isNumeric) ? "number" : "text" };
  });

  const rows: Row[] = parsed.data.map((r) => {
    const row: Row = {};
    for (const c of columns) {
      const raw = (r[c.name] ?? "").trim();
      row[c.name] = raw === "" ? null : c.type === "number" ? Number(normalizeNumber(raw)) : raw;
    }
    return row;
  });

  return { name, columns, rows };
}

/** Aceita "1.234,56" (pt-BR) além de "1234.56". */
function normalizeNumber(s: string): string {
  const t = s.trim();
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) {
    return t.replace(/\./g, "").replace(",", ".");
  }
  return t;
}
