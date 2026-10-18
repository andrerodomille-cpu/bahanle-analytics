import type { MeasureFormat, Value } from "./types";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatMeasure(v: number | null, fmt: MeasureFormat, short = false): string {
  if (v === null) return "(em branco)";
  if (fmt === "percent") return percent.format(v);
  if (short) return (fmt === "currency" ? "R$ " : "") + compact.format(v);
  return fmt === "currency" ? currency.format(v) : number.format(v);
}

export const formatValue = (v: Value) => (v === null || v === "" ? "(em branco)" : String(v));
