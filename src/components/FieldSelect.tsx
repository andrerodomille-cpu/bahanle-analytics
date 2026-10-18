import type { DatePart, FieldRef, Report } from "../model/types";
import { fieldKey, fieldLabel } from "../model/types";

const PARTS: DatePart[] = ["year", "quarter", "month", "day"];

/** Todos os campos do modelo; colunas de data também oferecem suas partes. */
export function allFields(report: Report, withParts = true): FieldRef[] {
  return report.tables.flatMap((t) =>
    t.columns.flatMap((c) => {
      const base: FieldRef = { table: t.name, column: c.name };
      return c.type === "date" && withParts ? [base, ...PARTS.map((part) => ({ ...base, part }))] : [base];
    }));
}

export function FieldSelect({ report, value, onChange, label, placeholder = "(nenhum)", className }: {
  report: Report;
  value: FieldRef | undefined;
  onChange: (f: FieldRef | undefined) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const fields = allFields(report);
  const select = (
    <select
      className={className}
      value={value ? fieldKey(value) : ""}
      onChange={(e) => onChange(fields.find((f) => fieldKey(f) === e.target.value))}
    >
      <option value="">{placeholder}</option>
      {report.tables.map((t) => (
        <optgroup key={t.name} label={t.name}>
          {fields.filter((f) => f.table === t.name).map((f) => {
            const col = t.columns.find((c) => c.name === f.column);
            const hint = col?.type === "date" && !f.part ? " (hierarquia de datas)" : "";
            return (
              <option key={fieldKey(f)} value={fieldKey(f)}>
                {f.part ? `   ${fieldLabel(f)}` : `${f.column}${hint}`}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <label className="field">
      {label}
      {select}
    </label>
  );
}
