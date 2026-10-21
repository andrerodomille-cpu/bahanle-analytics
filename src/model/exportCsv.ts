import type { GridResult, VisualResult } from "../engine/query";
import { valueKey } from "../engine/query";
import type { Measure, Visual } from "./types";
import { formatValue } from "./format";

// "Exportar dados": os dados agregados que o visual mostra.
// Separador ";" e vírgula decimal para abrir direto no Excel em português.

const cell = (v: string | number | null): string => {
  if (v === null) return "";
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const line = (values: (string | number | null)[]) => values.map(cell).join(";");

export function visualToCsv(visual: Visual, measures: Measure[], result: VisualResult, grid?: GridResult): string {
  const lines: string[] = [];
  if (grid && visual.axis && visual.legend) {
    lines.push(line([visual.axis.column, visual.legend.column, ...measures.map((m) => m.name)]));
    for (const r of grid.rows) {
      for (const c of grid.cols) {
        const vals = grid.cells.get(valueKey(r))?.get(valueKey(c));
        if (vals?.some((v) => v !== null)) lines.push(line([formatValue(r), formatValue(c), ...vals]));
      }
    }
  } else {
    const head = visual.axis ? [visual.axis.column] : [];
    lines.push(line([...head, ...measures.map((m) => m.name)]));
    for (const r of result.rows) {
      lines.push(line([...(visual.axis ? [formatValue(r.category)] : []), ...r.values]));
    }
  }
  return lines.join("\r\n");
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  // BOM para o Excel reconhecer UTF-8 (acentos).
  const blob = new Blob(["﻿" + text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
