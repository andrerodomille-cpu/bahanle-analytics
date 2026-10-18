import type { DatePart, RelativeDate, Value } from "./types";

// Datas circulam como texto ISO "AAAA-MM-DD": ordenam certo como texto,
// cabem no JSON do relatório e não sofrem com fuso horário.

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Converte para ISO aceitando "AAAA-MM-DD", "AAAA-MM-DDThh:mm…", "DD/MM/AAAA"
 * e objetos Date. Devolve null se não for uma data válida.
 */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

export const isIsoDate = (v: Value): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Valor de uma parte da data. Os textos foram escolhidos para ordenar certo. */
export function datePart(v: Value, part: DatePart): Value {
  if (!isIsoDate(v)) return null;
  const y = Number(v.slice(0, 4));
  const mo = Number(v.slice(5, 7));
  switch (part) {
    case "year":
      return y;
    case "quarter":
      return `T${Math.ceil(mo / 3)}`;
    case "month":
      return `${pad(mo)} ${MONTHS[mo - 1]}`;
    case "day":
      return v;
  }
}

export type DateUnit = "DAY" | "MONTH" | "QUARTER" | "YEAR";

/** Desloca uma data; meses curtos ajustam o dia (31/03 − 1 mês = 28 ou 29/02). */
export function shiftDate(iso: string, n: number, unit: DateUnit): string {
  let y = Number(iso.slice(0, 4));
  let m = Number(iso.slice(5, 7));
  let d = Number(iso.slice(8, 10));
  if (unit === "DAY") {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const months = unit === "YEAR" ? 12 * n : unit === "QUARTER" ? 3 * n : n;
  const total = y * 12 + (m - 1) + months;
  y = Math.floor(total / 12);
  m = (total % 12) + 1;
  d = Math.min(d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}

export const formatDateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// ---------- Datas relativas ----------

const UNIT: Record<RelativeDate["unit"], DateUnit> = { day: "DAY", month: "MONTH", year: "YEAR" };
const UNIT_LABEL: Record<RelativeDate["unit"], [string, string]> = {
  day: ["dia", "dias"], month: ["mês", "meses"], year: ["ano", "anos"],
};

const startOf = (iso: string, unit: RelativeDate["unit"]) =>
  unit === "year" ? `${iso.slice(0, 4)}-01-01` : unit === "month" ? `${iso.slice(0, 7)}-01` : iso;
const endOf = (iso: string, unit: RelativeDate["unit"]) =>
  unit === "day" ? iso : shiftDate(shiftDate(startOf(iso, unit), 1, UNIT[unit]), -1, "DAY");

/**
 * Intervalo de uma data relativa a partir da data de referência:
 * - "últimos N": de N unidades atrás (sem contar a referência) até a referência;
 * - "este": o período inteiro da referência (mês ou ano corrente);
 * - "anterior": o período completo anterior ao da referência.
 */
export function relativeRange(spec: RelativeDate, anchor: string): { min: string; max: string } {
  const n = Math.max(1, spec.n ?? 1);
  if (spec.kind === "last") return { min: shiftDate(shiftDate(anchor, -n, UNIT[spec.unit]), 1, "DAY"), max: anchor };
  if (spec.kind === "this") return { min: startOf(anchor, spec.unit), max: endOf(anchor, spec.unit) };
  const prev = shiftDate(startOf(anchor, spec.unit), -1, UNIT[spec.unit]);
  return { min: startOf(prev, spec.unit), max: endOf(prev, spec.unit) };
}

export function describeRelative(spec: RelativeDate): string {
  const [one, many] = UNIT_LABEL[spec.unit];
  const n = Math.max(1, spec.n ?? 1);
  if (spec.kind === "last") return n === 1 ? `Último ${one}` : `Últimos ${n} ${many}`;
  // dia, mês e ano são masculinos: "Este mês", "Ano anterior".
  return spec.kind === "this" ? `Este ${one}` : `${one[0].toUpperCase()}${one.slice(1)} anterior`;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
