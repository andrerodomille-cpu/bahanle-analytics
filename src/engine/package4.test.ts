import { describe, expect, it } from "vitest";
import { Engine, axisOf, contextFor, runVisual } from "./query";
import { reducer } from "../model/store";
import { sampleReport } from "../model/sampleData";
import { describeRelative, relativeRange } from "../model/dates";
import { matchRule } from "../model/rules";
import { clearPerf, measure, perfStore } from "../model/perf";
import type { FormatRule, Report, Visual } from "../model/types";

describe("data relativa", () => {
  const anchor = "2026-12-15";
  it("últimos N dias/meses/anos terminam na referência", () => {
    expect(relativeRange({ kind: "last", n: 7, unit: "day", anchor: "data" }, anchor)).toEqual({ min: "2026-12-09", max: "2026-12-15" });
    expect(relativeRange({ kind: "last", n: 3, unit: "month", anchor: "data" }, anchor)).toEqual({ min: "2026-09-16", max: "2026-12-15" });
    expect(relativeRange({ kind: "last", n: 1, unit: "year", anchor: "data" }, "2024-02-29").min).toBe("2023-03-01");
  });

  it("este período e o período anterior completo", () => {
    expect(relativeRange({ kind: "this", unit: "month", anchor: "data" }, anchor)).toEqual({ min: "2026-12-01", max: "2026-12-31" });
    expect(relativeRange({ kind: "previous", unit: "month", anchor: "data" }, "2026-03-31")).toEqual({ min: "2026-02-01", max: "2026-02-28" });
    expect(relativeRange({ kind: "previous", unit: "year", anchor: "data" }, anchor)).toEqual({ min: "2025-01-01", max: "2025-12-31" });
  });

  it("descrição", () => {
    expect(describeRelative({ kind: "last", n: 30, unit: "day", anchor: "data" })).toBe("Últimos 30 dias");
    expect(describeRelative({ kind: "last", n: 1, unit: "month", anchor: "data" })).toBe("Último mês");
    expect(describeRelative({ kind: "this", unit: "year", anchor: "data" })).toBe("Este ano");
    expect(describeRelative({ kind: "previous", unit: "month", anchor: "data" })).toBe("Mês anterior");
  });
});

describe("regras de formatação", () => {
  const rules: FormatRule[] = [
    { id: "a", measure: 1, op: ">=", value: 0.2, style: "good", icon: true },
    { id: "b", measure: 1, op: "<", value: 0, style: "bad", icon: true },
    { id: "c", measure: 1, op: "between", value: 0, value2: 0.2, style: "warn", icon: false },
  ];
  it("a primeira regra que bate vale; outra medida ou BLANK não", () => {
    expect(matchRule(rules, 1, 0.25)?.style).toBe("good");
    expect(matchRule(rules, 1, 0.2)?.style).toBe("good");
    expect(matchRule(rules, 1, 0.1)?.style).toBe("warn");
    expect(matchRule(rules, 1, -0.01)?.style).toBe("bad");
    expect(matchRule(rules, 0, 0.5)).toBeUndefined();
    expect(matchRule(rules, 1, null)).toBeUndefined();
  });
});

describe("parâmetro de campo", () => {
  it("o eixo dos visuais ligados segue o campo escolhido e os filtros deles são limpos", () => {
    let r: Report = { ...sampleReport(), filters: [] };
    const bar = r.visuals.find((v) => v.id === "r3")!;
    expect(axisOf(r, bar)).toMatchObject({ column: "Região" });
    r = reducer(r, { type: "toggleFilter", multi: false, filter: { field: { table: "Lojas", column: "Região" }, values: ["Sul"], sourceVisualId: "r3" } });
    expect(r.filters).toHaveLength(1);
    r = reducer(r, { type: "updateVisual", id: "r2", patch: { paramIndex: 3 } });
    const after = r.visuals.find((v) => v.id === "r3")!;
    expect(axisOf(r, after)).toMatchObject({ column: "Produto" });
    expect(r.filters).toHaveLength(0);
    expect(runVisual(new Engine(r), r, after).rows).toHaveLength(10);
  });
});

describe("filtro por intervalo no Painel de Filtros", () => {
  it("entra no contexto e lista vazia + intervalo conta como ativo", () => {
    let r: Report = { ...sampleReport(), paneFilters: [] };
    r = reducer(r, { type: "addPaneFilter", filter: { id: "pf", scope: "report", field: { table: "Vendas", column: "Valor" }, values: [] } });
    const v: Visual = { id: "x", pageId: "p1", type: "card", title: "", x: 0, y: 0, w: 0, h: 0, measureIds: ["m2"] };
    expect(contextFor(r, v)).toHaveLength(0);
    r = reducer(r, { type: "updatePaneFilter", id: "pf", values: [], range: { min: 5000 } });
    expect(contextFor(r, v)).toEqual([{ field: { table: "Vendas", column: "Valor" }, range: { min: 5000 } }]);
    expect(runVisual(new Engine(r), r, v).rows[0].values[0]).toBe(1042);
  });
});

describe("analisador de desempenho", () => {
  it("conta linhas percorridas, acertos e erros de cache e medidas", () => {
    const r = sampleReport();
    const engine = new Engine(r);
    const v = r.visuals.find((x) => x.id === "v5")!; // Faturamento por Categoria
    clearPerf();
    measure(engine.stats, { visualId: "v5", title: "a", type: "bar" }, () => runVisual(engine, r, v));
    const cold = { ...engine.stats };
    expect(cold.measureEvals).toBe(4);
    // Uma única passada agrupa as 4.200 vendas por categoria; cada categoria
    // depois é só uma consulta ao grupo (antes eram 4 passadas, 16.800 linhas).
    expect(cold.rowsScanned).toBe(4200);
    const before = { ...engine.stats };
    runVisual(engine, r, v);
    expect(engine.stats.rowsScanned - before.rowsScanned).toBe(0); // tudo veio do cache
    expect(engine.stats.cacheHits - before.cacheHits).toBeGreaterThan(0);
  });

  it("duas medições coladas (StrictMode) guardam a passada fria", async () => {
    clearPerf();
    const stats = { rowsScanned: 0, cacheHits: 0, cacheMisses: 0, measureEvals: 0 };
    const info = { visualId: "z", title: "z", type: "bar" };
    measure(stats, info, () => { stats.cacheMisses += 5; stats.rowsScanned += 100; });
    measure(stats, info, () => { stats.cacheHits += 5; });
    await Promise.resolve();
    const [entry] = perfStore.getSnapshot();
    expect(entry).toMatchObject({ cacheMisses: 5, rowsScanned: 100 });
  });
});
