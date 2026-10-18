import { describe, expect, it } from "vitest";
import {
  boxStats, histogram, keyInfluencers, linearForecast, movingForecast, nextLabels, quantile, referenceValue, runBoxplot,
  runDecomposition,
} from "./analytics";
import { Engine } from "./query";
import type { Report, Visual } from "../model/types";
import { sampleReport } from "../model/sampleData";

describe("estatística", () => {
  it("quantis com interpolação (como QUARTIL.INC)", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(quantile(xs, 0.5)).toBe(4.5);
    expect(quantile(xs, 0.25)).toBe(2.75);
    expect(quantile([5], 0.9)).toBe(5);
  });

  it("box plot: quartis, bigodes de Tukey e outliers", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100])!;
    expect([b.q1, b.median, b.q3]).toEqual([3, 5, 7]);
    expect(b.low).toBe(1);
    expect(b.high).toBe(8);
    expect(b.outliers).toEqual([100]);
    expect(boxStats([])).toBeNull();
  });

  it("histograma: faixas iguais, o máximo cai na última", () => {
    const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 10], 5);
    expect(bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 2]);
    expect(bins[0]).toMatchObject({ x0: 0, x1: 2 });
    expect(histogram([3, 3, 3])).toEqual([{ x0: 3, x1: 3, count: 3 }]);
    // Regra de Sturges: 1 + log2(16) = 5 faixas.
    expect(histogram(Array.from({ length: 16 }, (_, i) => i))).toHaveLength(5);
  });

  it("linhas de referência", () => {
    const vs = [4, null, 1, 7];
    expect(referenceValue({ id: "a", kind: "average" }, vs)).toBe(4);
    expect(referenceValue({ id: "a", kind: "median" }, vs)).toBe(4);
    expect(referenceValue({ id: "a", kind: "max" }, vs)).toBe(7);
    expect(referenceValue({ id: "a", kind: "constant", value: 5 }, vs)).toBe(5);
    expect(referenceValue({ id: "a", kind: "min" }, [null])).toBeNull();
  });
});

describe("previsão", () => {
  it("linear: série perfeita é prevista sem erro", () => {
    const f = linearForecast([10, 20, 30, 40], 2);
    expect(f.map((p) => p.y)).toEqual([50, 60]);
    expect(f[0].high - f[0].low).toBeCloseTo(0);
  });

  it("linear: a faixa alarga com o horizonte e com mais confiança", () => {
    const ys = [10, 14, 9, 16, 13, 18, 15, 21];
    const f95 = linearForecast(ys, 3, 0.95);
    const f80 = linearForecast(ys, 3, 0.8);
    const width = (p: { low: number; high: number }) => p.high - p.low;
    expect(width(f95[2])).toBeGreaterThan(width(f95[0]));
    expect(width(f80[0])).toBeLessThan(width(f95[0]));
    expect(linearForecast([1, 2], 3)).toEqual([]);
  });

  it("média móvel projeta a média dos últimos períodos", () => {
    const f = movingForecast([1, 2, 3, 4, 5, 6], 2, 0.95, 3);
    expect(f[0].y).toBe(5);
    expect(f[1].high - f[1].low).toBeGreaterThan(f[0].high - f[0].low);
  });

  it("rótulos dos próximos períodos", () => {
    expect(nextLabels(["2026-11", "2026-12"], 2)).toEqual(["2027-01", "2027-02"]);
    expect(nextLabels([2025, 2026], 1)).toEqual([2027]);
    expect(nextLabels(["2026-03-01", "2026-03-08"], 1)).toEqual(["2026-03-15"]);
    expect(nextLabels(["A"], 2)).toEqual(["+1", "+2"]);
  });
});

describe("análises sobre o exemplo", () => {
  const report: Report = sampleReport();
  const engine = new Engine(report);
  const measure = (name: string) => report.measures.find((m) => m.name === name)!;
  const v = (patch: Partial<Visual>): Visual => ({
    id: "x", pageId: "zz", type: "bar", title: "", x: 0, y: 0, w: 0, h: 0, measureIds: [], ...patch,
  });

  it("box plot por categoria, ordenado pela mediana", () => {
    const rows = runBoxplot(engine, report, v({
      type: "boxplot", axis: { table: "Produtos", column: "Categoria" }, valueField: { table: "Vendas", column: "Valor" },
    }));
    expect(rows.map((r) => r.category)).toContain("Informática");
    expect(rows[0].stats.median).toBeGreaterThanOrEqual(rows[rows.length - 1].stats.median);
    expect(rows.reduce((a, r) => a + r.stats.n, 0)).toBe(4200);
  });

  it("influenciadores: Informática aumenta o ticket; amostras pequenas ficam de fora", () => {
    const r = keyInfluencers(engine, report, v({
      type: "influencers",
      explainBy: [{ table: "Produtos", column: "Categoria" }, { table: "Produtos", column: "Produto" }],
    }), measure("Ticket Médio"));
    expect(r.totalRows).toBe(4200);
    expect(r.minRows).toBe(84);
    expect(r.up[0].ratio).toBeGreaterThan(1);
    expect(r.up.some((i) => i.value === "Informática")).toBe(true);
    expect(r.down.every((i) => i.ratio < 1 && i.rows >= r.minRows)).toBe(true);
  });

  it("árvore de decomposição: cada nó escolhido filtra o nível seguinte", () => {
    const regiao = { table: "Lojas", column: "Região" };
    const loja = { table: "Lojas", column: "Loja" };
    const cat = { table: "Produtos", column: "Categoria" };
    const base = v({ type: "decomp", explainBy: [regiao, loja, cat] });
    const fat = measure("Faturamento");

    const one = runDecomposition(engine, report, { ...base, decomp: [{ field: regiao }] }, fat);
    expect(one.levels).toHaveLength(1);
    expect(one.levels[0].nodes.reduce((a, n) => a + (n.measure ?? 0), 0)).toBeCloseTo(one.total!, 2);
    expect(one.available.map((f) => f.column)).toEqual(["Loja", "Categoria"]);

    const two = runDecomposition(engine, report, { ...base, decomp: [{ field: regiao, value: "Sul" }, { field: loja }] }, fat);
    expect(two.levels[1].nodes.map((n) => n.value).sort()).toEqual(["Loja Batel", "Loja Moinhos"]);
    const sul = two.levels[0].nodes.find((n) => n.value === "Sul")!.measure!;
    expect(two.levels[1].nodes.reduce((a, n) => a + (n.measure ?? 0), 0)).toBeCloseTo(sul, 2);
  });
});
