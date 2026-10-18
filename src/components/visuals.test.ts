import { describe, expect, it } from "vitest";
import { colorScaleStyle, rangeOf, waterfallSteps } from "./MoreVisuals";
import { Engine, fillTemplate, runTotals, runVisual } from "../engine/query";
import { sampleReport } from "../model/sampleData";
import { formatMeasure } from "../model/format";
import type { Measure } from "../model/types";

const m = (name: string): Measure => ({ id: name, name, table: "T", expression: "1", format: "number" });

describe("cascata", () => {
  it("com valor base: começa no total base, degraus = atual − base, termina no total atual", () => {
    const rows = [
      { category: "A", values: [150, 100] },
      { category: "B", values: [40, 60] },
      { category: "C", values: [10, 10] }, // sem variação: some
    ];
    const steps = waterfallSteps(rows, [200, 170], [m("2026"), m("2025")]);
    expect(steps.map((s) => [s.label, s.kind, s.base, s.size])).toEqual([
      ["2025", "total", 0, 170],
      ["A", "up", 170, 50],
      ["B", "down", 200, 20],
      ["2026", "total", 0, 200],
    ]);
  });

  it("com uma medida: cada categoria soma ao acumulado", () => {
    const steps = waterfallSteps([{ category: "A", values: [3] }, { category: "B", values: [-1] }], [2], [m("Total")]);
    expect(steps.map((s) => [s.kind, s.base, s.size])).toEqual([["up", 0, 3], ["down", 2, 1], ["total", 0, 2]]);
  });
});

describe("escala de cores", () => {
  it("intensidade proporcional e texto claro nos tons fortes", () => {
    const { min, max } = rangeOf([10, null, 30]);
    expect([min, max]).toEqual([10, 30]);
    const low = colorScaleStyle(10, min, max, "#118dff")!;
    const high = colorScaleStyle(30, min, max, "#118dff")!;
    expect(low.background).toBe("rgba(17, 141, 255, 0.080)");
    expect(high.background).toBe("rgba(17, 141, 255, 0.900)");
    expect(low.color).toBeUndefined();
    expect(high.color).toBe("#fff");
    expect(colorScaleStyle(null, min, max, "#118dff")).toBeUndefined();
  });
});

describe("exemplo: página Executivo", () => {
  const report = sampleReport();
  const engine = new Engine(report);
  const visual = (id: string) => report.visuals.find((v) => v.id === id)!;

  it("texto dinâmico usa o filtro da página (2026)", () => {
    const fat2026 = runTotals(engine, report, visual("e4"), runVisual(engine, report, visual("e4")))[0];
    const text = fillTemplate(engine, report, visual("e1"), "[Faturamento] / [Nada]", (v, mm) => formatMeasure(v, mm.format));
    expect(text).toBe(`${formatMeasure(fat2026, "currency")} / [Nada]`);
  });

  it("a cascata fecha: base 2025 + variações = total 2026", () => {
    const v = visual("e8");
    const result = runVisual(engine, report, v);
    const totals = runTotals(engine, report, v, result);
    const measures = v.measureIds.map((id) => report.measures.find((x) => x.id === id)!);
    const steps = waterfallSteps(result.rows, totals, measures);
    const sum = steps.slice(1, -1).reduce((acc, s) => acc + (s.kind === "up" ? s.size : -s.size), steps[0].size);
    expect(sum).toBeCloseTo(steps.at(-1)!.size, 2);
  });

  it("KPI: valor, comparação e minigráfico por mês de 2026", () => {
    const v = visual("e4");
    const result = runVisual(engine, report, v);
    expect(result.rows).toHaveLength(12);
    const [value, base] = runTotals(engine, report, v, result);
    expect(value!).toBeGreaterThan(base!);
  });
});
