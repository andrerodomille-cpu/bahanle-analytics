import type { FormatRule } from "./types";

// Formatação condicional por regras: a primeira regra que bate define a cor
// (e o ícone) do valor. "good/warn/bad" viram verde/amarelo/vermelho.

export const RULE_COLORS: Record<FormatRule["style"], string> = { good: "#2e9d47", warn: "#d9a300", bad: "#d64550" };
export const RULE_ICONS: Record<FormatRule["style"], string> = { good: "▲", warn: "●", bad: "▼" };

export function matchRule(rules: FormatRule[] | undefined, measure: number, v: number | null): FormatRule | undefined {
  if (v === null || !rules) return undefined;
  return rules.find((r) => {
    if (r.measure !== measure) return false;
    switch (r.op) {
      case ">": return v > r.value;
      case ">=": return v >= r.value;
      case "<": return v < r.value;
      case "<=": return v <= r.value;
      case "between": return v >= r.value && v <= (r.value2 ?? r.value);
    }
  });
}
