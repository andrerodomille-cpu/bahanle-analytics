// Colunas calculadas: são avaliadas UMA vez por linha
// (contexto de linha) e o resultado fica gravado na tabela — ao contrário
// das medidas, que são recalculadas a cada contexto de filtro.

import { parse } from "../engine/expr";
import { Engine, type Scalar } from "../engine/query";
import type { Column, ColumnType, Report, Row, Table, Value } from "./types";

export interface ColumnPreview {
  values: Value[];
  type: ColumnType;
  error?: string;
}

/** Avalia a expressão em todas as linhas de `tableName` com o modelo atual. */
export function evaluateColumn(report: Report, tableName: string, columnName: string, expression: string): ColumnPreview {
  const ast = parse(expression);
  // A própria coluna não existe no modelo enquanto é avaliada (evita autorreferência).
  const tables = report.tables.map((t) =>
    t.name === tableName ? { ...t, columns: t.columns.filter((c) => c.name !== columnName) } : t);
  const engine = new Engine({ ...report, tables });
  const table = tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`Tabela não encontrada: ${tableName}`);

  let error: string | undefined;
  const values = table.rows.map((row) => {
    if (error) return null;
    try {
      return toValue(engine.evaluate(ast, [], [], { table: tableName, row }));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }
  });
  const nonBlank = values.filter((v) => v !== null);
  const type: ColumnType = nonBlank.length > 0 && nonBlank.every((v) => typeof v === "number") ? "number" : "text";
  return { values: error ? values.map(() => null) : values, type, error };
}

const toValue = (v: Scalar): Value => (typeof v === "boolean" ? (v ? "VERDADEIRO" : "FALSO") : v);

/**
 * Recalcula todas as colunas calculadas do relatório. São duas passadas para
 * resolver dependências entre tabelas (ex.: uma coluna que usa RELATED de
 * outra coluna calculada da dimensão).
 */
export function materialize(report: Report): Report {
  let current = report;
  const hasCalculated = report.tables.some((t) => t.columns.some((c) => c.expression));
  if (!hasCalculated) return report;
  for (let pass = 0; pass < 2; pass++) {
    for (const t of current.tables) {
      for (const col of t.columns) {
        if (!col.expression) continue;
        current = setColumn(current, t.name, col, col.expression);
      }
    }
  }
  return current;
}

/** Cria ou atualiza uma coluna calculada e grava os valores nas linhas. */
export function setColumn(report: Report, tableName: string, col: Pick<Column, "name">, expression: string, oldName?: string): Report {
  let preview: ColumnPreview;
  try {
    preview = evaluateColumn(report, tableName, oldName ?? col.name, expression);
  } catch (e) {
    preview = { values: [], type: "text", error: e instanceof Error ? e.message : String(e) };
  }
  return {
    ...report,
    tables: report.tables.map((t): Table => {
      if (t.name !== tableName) return t;
      const column: Column = { name: col.name, type: preview.type, expression, error: preview.error };
      const exists = t.columns.some((c) => c.name === (oldName ?? col.name));
      const columns = exists
        ? t.columns.map((c) => (c.name === (oldName ?? col.name) ? column : c))
        : [...t.columns, column];
      const rows = t.rows.map((r, i): Row => {
        const copy = { ...r };
        if (oldName && oldName !== col.name) delete copy[oldName];
        copy[col.name] = preview.values[i] ?? null;
        return copy;
      });
      return { ...t, columns, rows };
    }),
  };
}

export function removeColumn(report: Report, tableName: string, name: string): Report {
  return {
    ...report,
    tables: report.tables.map((t) => {
      if (t.name !== tableName) return t;
      return {
        ...t,
        columns: t.columns.filter((c) => c.name !== name),
        rows: t.rows.map((r) => {
          const copy = { ...r };
          delete copy[name];
          return copy;
        }),
      };
    }),
  };
}
