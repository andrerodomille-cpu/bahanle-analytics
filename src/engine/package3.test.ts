import { describe, expect, it } from "vitest";
import { Engine, contextFor, passes, runVisual } from "./query";
import { detectAnomalies, generateNarrative, paretoRows } from "./analytics";
import { reducer } from "../model/store";
import { sampleReport } from "../model/sampleData";
import { formatMeasure, formatValue } from "../model/format";
import type { Report, Visual } from "../model/types";

const report: Report = sampleReport();
const engine = new Engine(report);
const fat = report.measures.find((m) => m.name === "Faturamento")!;
const visual = (patch: Partial<Visual>): Visual => ({
  id: "v", pageId: "p1", type: "card", title: "", x: 0, y: 0, w: 0, h: 0, measureIds: ["m1"], ...patch,
});
const valor = { table: "Vendas", column: "Valor" };
const data = { table: "Calendário", column: "Data" };

describe("filtro por intervalo", () => {
  it("números e datas, limites inclusivos, máximo aberto e BLANK fora", () => {
    expect(passes({ field: valor, range: { min: 10, max: 20 } }, 20)).toBe(true);
    expect(passes({ field: valor, range: { min: 10, max: 20, maxOpen: true } }, 20)).toBe(false);
    expect(passes({ field: valor, range: { min: 10 } }, 1e9)).toBe(true);
    expect(passes({ field: valor, range: { max: 10 } }, null)).toBe(false);
    expect(passes({ field: data, range: { min: "2026-01-01", max: "2026-03-31" } }, "2026-03-31")).toBe(true);
    expect(passes({ field: data, range: { min: "2026-01-01" } }, "2025-12-31")).toBe(false);
  });

  it("intervalo de datas no Calendário filtra as vendas pelo relacionamento", () => {
    const q1 = [{ field: data, range: { min: "2026-01-01", max: "2026-03-31" } }];
    const byMonth = [
      { field: { table: "Calendário", column: "Mês" }, keys: new Set(["2026-01", "2026-02", "2026-03"]) },
    ];
    expect(engine.evaluateMeasure(fat, q1)).toBeCloseTo(engine.evaluateMeasure(fat, byMonth)!, 2);
  });

  it("filtro cruzado com intervalo entra no contexto dos outros visuais da página", () => {
    let r = { ...report, visuals: [visual({ id: "a" }), visual({ id: "b" })] };
    r = reducer(r, { type: "setFilter", sourceVisualId: "a", filter: { field: valor, values: [], range: { min: 5000 }, sourceVisualId: "a" } });
    const ctx = contextFor(r, r.visuals[1]);
    expect(ctx).toEqual([{ field: valor, range: { min: 5000 } }]);
    const big = report.measures.find((m) => m.name === "Vendas Grandes")!;
    expect(engine.evaluateMeasure(report.measures.find((m) => m.name === "Pedidos")!, ctx))
      .toBe(engine.evaluateMeasure(big, []));
  });
});

describe("drill-through", () => {
  it("a página de destino vê só o item; as outras páginas não", () => {
    const produto = { table: "Produtos", column: "Produto" };
    let r: Report = { ...report, visuals: [visual({ id: "src", pageId: "p1" }), visual({ id: "dst", pageId: "p9" })] };
    r = reducer(r, { type: "drillthrough", state: { pageId: "p9", field: produto, value: "Notebook", fromPageId: "p1" } });
    expect(contextFor(r, r.visuals[1])).toHaveLength(1);
    expect(contextFor(r, r.visuals[0])).toHaveLength(0);
    const nb = runVisual(new Engine(r), r, r.visuals[1]).rows[0].values[0];
    const all = runVisual(new Engine(r), r, r.visuals[0]).rows[0].values[0];
    expect(nb).toBeLessThan(all!);
    r = reducer(r, { type: "clearDrillthrough" });
    expect(r.drillthrough).toBeUndefined();
  });
});

describe("anomalias e Pareto", () => {
  it("marca só o ponto que foge da tendência", () => {
    const ys = [10, 11, 12, 13, 40, 15, 16, 17];
    const a = detectAnomalies(ys, 2);
    expect(a.flags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0)).toEqual([4]);
    expect(detectAnomalies([1, 2, 3], 2).flags).toEqual([false, false, false]);
    expect(detectAnomalies([5, 5, 5, 5], 2).flags.every((f) => !f)).toBe(true);
  });

  it("Pareto: ordem decrescente e acumulado até 100%", () => {
    const p = paretoRows([
      { category: "a", values: [10] }, { category: "b", values: [60] }, { category: "c", values: [30] }, { category: "z", values: [0] },
    ]);
    expect(p.map((r) => r.category)).toEqual(["b", "c", "a"]);
    expect(p.map((r) => r.cumulative)).toEqual([0.6, 0.9, 1]);
  });
});

describe("narrativa", () => {
  it("total, comparação, evolução e líder por dimensão", () => {
    const v = visual({
      type: "narrative", measureIds: ["m1", "m8"], axis: { table: "Calendário", column: "Mês" },
      explainBy: [{ table: "Produtos", column: "Categoria" }],
    });
    const measures = v.measureIds.map((id) => report.measures.find((m) => m.id === id)!);
    const text = generateNarrative(engine, { ...report, visuals: [v] }, v, measures,
      (x, m, short) => formatMeasure(x, m.format, short), formatValue);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^\*\*Faturamento\*\*: \*\*R\$/);
    expect(text).toContain("Contra Faturamento Ano Anterior");
    expect(text).toMatch(/Entre 2025-01 e 2026-12/);
    expect(text).toMatch(/tendência no período é de \*\*(alta|queda|estabilidade)\*\*/);
    expect(text).toMatch(/Por Categoria, \*\*Informática\*\* lidera com .*% do total/);
  });

  it("medida não aditiva não mostra participação no total", () => {
    const v = visual({ type: "narrative", measureIds: ["m3"], explainBy: [{ table: "Produtos", column: "Categoria" }] });
    const text = generateNarrative(engine, { ...report, visuals: [v] }, v, [report.measures.find((m) => m.id === "m3")!],
      (x, m, short) => formatMeasure(x, m.format, short), formatValue);
    expect(text).toContain("lidera com");
    expect(text).not.toContain("do total");
  });
});
