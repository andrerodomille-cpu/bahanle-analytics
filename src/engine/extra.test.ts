import { describe, expect, it } from "vitest";
import { bumpRanks, kde, niceUnit, pathKey, waffleCounts } from "./extra";
import type { GridResult } from "./query";

describe("waffle", () => {
  it("maior resto: soma exatamente 100", () => {
    const c = waffleCounts([1, 1, 1]);
    expect(c.reduce((a, b) => a + b, 0)).toBe(100);
    expect(c).toEqual([34, 33, 33]);
    expect(waffleCounts([54.2, 30.1, 15.7])).toEqual([54, 30, 16]);
    expect(waffleCounts([0, 0])).toEqual([0, 0]);
  });
});

describe("pictograma", () => {
  it("valor por ícone redondo, ~20 ícones no maior", () => {
    expect(niceUnit(4_100_000)).toBe(500_000);
    expect(niceUnit(19)).toBe(1);
    expect(niceUnit(0)).toBe(1);
  });
});

describe("densidade (KDE)", () => {
  it("integra aproximadamente 1 e tem o pico perto da média", () => {
    const xs = [8, 9, 10, 10, 10, 11, 12];
    const pts = kde(xs, 0, 20, 201);
    const step = pts[1].x - pts[0].x;
    const area = pts.reduce((a, p) => a + p.d * step, 0);
    expect(area).toBeCloseTo(1, 1);
    const peak = pts.reduce((a, p) => (p.d > a.d ? p : a));
    expect(Math.abs(peak.x - 10)).toBeLessThan(0.5);
  });
});

describe("bump chart", () => {
  it("posição por período (1 = maior) e séries na ordem do último período", () => {
    const cell = (v: number | null): (number | null)[] => [v];
    const grid: GridResult = {
      rows: ["2026-02", "2026-01"],
      cols: ["A", "B", "C"],
      cells: new Map([
        ["2026-01", new Map([["A", cell(10)], ["B", cell(30)], ["C", cell(20)]])],
        ["2026-02", new Map([["A", cell(50)], ["B", cell(5)], ["C", cell(null)]])],
      ]),
      rowTotals: new Map(), colTotals: new Map(), grandTotal: [],
    };
    const r = bumpRanks(grid);
    expect(r.periods).toEqual(["2026-01", "2026-02"]);
    expect(r.ranks.get("A")).toEqual([3, 1]);
    expect(r.ranks.get("B")).toEqual([1, 2]);
    expect(r.ranks.get("C")).toEqual([2, null]);
    expect(r.series).toEqual(["A", "B", "C"]);
  });
});

describe("matriz hierárquica", () => {
  it("chave do caminho distingue níveis e valores", () => {
    expect(pathKey(["Sul", "Loja Batel"])).not.toBe(pathKey(["Sul Loja Batel"]));
    expect(pathKey([2026])).toBe(pathKey(["2026"]));
  });
});
