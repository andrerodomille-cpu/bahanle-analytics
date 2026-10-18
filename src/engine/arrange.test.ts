import { describe, expect, it } from "vitest";
import { alignPatches, distributePatches, expandGroups, mobileOrder, movePatches, sameSizePatches } from "./arrange";
import { historyReducer, reducer } from "../model/store";
import { sampleReport } from "../model/sampleData";
import { Engine, runVisual, whatIfParams } from "./query";
import { runMultiples } from "./lab";
import { allPaths, runDistributions, runHierarchy, runMatrixTree } from "./extra";
import type { Report } from "../model/types";

const box = (id: string, x: number, y: number, w = 100, h = 50) => ({ id, x, y, w, h });

describe("alinhar e distribuir", () => {
  const vs = [box("a", 10, 10), box("b", 200, 40, 50), box("c", 400, 100, 80, 80)];
  it("alinha pelas bordas do conjunto e só devolve o que muda", () => {
    expect(alignPatches(vs, "left")).toEqual({ b: { x: 10 }, c: { x: 10 } });
    expect(alignPatches(vs, "right")).toEqual({ a: { x: 380 }, b: { x: 430 } });
    expect(alignPatches(vs, "bottom")).toEqual({ a: { y: 130 }, b: { y: 130 } });
    expect(alignPatches([vs[0]], "left")).toEqual({});
  });
  it("distribui com espaços iguais, mantendo as pontas", () => {
    // Vão total 10..480 = 470, ocupado 230 → 2 espaços de 120.
    expect(distributePatches(vs, "horizontal")).toEqual({ b: { x: 230 } });
    expect(distributePatches(vs.slice(0, 2), "horizontal")).toEqual({});
  });
  it("mesmo tamanho do maior", () => {
    expect(sameSizePatches(vs, "both")).toEqual({ a: { h: 80 }, b: { w: 100, h: 80 }, c: { w: 100 } });
  });
  it("mover o conjunto ajusta pela grade sem deformar", () => {
    const snap = (n: number) => Math.round(n / 10) * 10;
    expect(movePatches(vs.slice(0, 2), 13, -30, snap)).toEqual({ a: { x: 20, y: 0 }, b: { x: 210, y: 30 } });
  });
  it("membro de grupo seleciona o grupo", () => {
    const all = [{ id: "a", groupId: "g" }, { id: "b" }, { id: "c", groupId: "g" }];
    expect(expandGroups(all, ["c"])).toEqual(["a", "c"]);
    expect(expandGroups(all, ["b"])).toEqual(["b"]);
  });
  it("celular: ordem de leitura por faixas", () => {
    const order = mobileOrder([box("d", 0, 300), box("b", 500, 20), box("a", 0, 10), box("c", 0, 100)]);
    expect(order.map((v) => v.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("ações em lote", () => {
  it("updateVisuals/removeVisuals; arrastar em lote é um passo de desfazer", () => {
    const r = sampleReport();
    const ids = ["cp1", "cp2"];
    let h = { past: [] as Report[], present: r, future: [] as Report[] };
    for (let dx = 10; dx <= 40; dx += 10) {
      h = historyReducer(h, { type: "updateVisuals", patches: { cp1: { x: 10 + dx }, cp2: { x: 470 + dx } } });
    }
    expect(h.past.length).toBe(1);
    expect(h.present.visuals.find((v) => v.id === "cp2")!.x).toBe(510);
    const removed = reducer(h.present, { type: "removeVisuals", ids });
    expect(removed.visuals.some((v) => ids.includes(v.id))).toBe(false);
  });
});

describe("novos visuais no exemplo", () => {
  const report: Report = { ...sampleReport(), filters: [] };
  const engine = new Engine({ ...report, params: whatIfParams(report) });
  const v = (id: string) => report.visuals.find((x) => x.id === id)!;
  const m = (id: string) => report.measures.find((x) => x.id === id)!;

  it("matriz hierárquica: subtotais batem com os filhos e o total geral", () => {
    const tree = runMatrixTree(engine, report, v("hd1"), [m("m1")]);
    const top = tree.rows.filter((r) => r.level === 0);
    const sumTop = top.reduce((a, r) => a + (r.values[0] ?? 0), 0);
    expect(sumTop).toBeCloseTo(tree.grandTotal[0] ?? 0, 2);
    const sudeste = top.find((r) => r.value === "Sudeste")!;
    expect(sudeste.expanded).toBe(true);
    const kids = tree.rows.filter((r) => r.level === 1 && r.path[0] === "Sudeste");
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.reduce((a, r) => a + (r.values[0] ?? 0), 0)).toBeCloseTo(sudeste.values[0] ?? 0, 2);
    // Expandir tudo abre regiões e lojas (não o último nível).
    expect(allPaths(engine, report, v("hd1")).length).toBeGreaterThan(top.length);
  });

  it("sunburst: cada anel soma o do pai", () => {
    const { total, nodes } = runHierarchy(engine, report, v("hd2"), m("m1"));
    expect(nodes.reduce((a, n) => a + n.measure, 0)).toBeCloseTo(total, 2);
    for (const n of nodes) expect(n.children.reduce((a, c) => a + c.measure, 0)).toBeCloseTo(n.measure, 2);
  });

  it("violino: valores por categoria; dispersão animada: um quadro por mês", () => {
    const d = runDistributions(engine, report, v("hd4"));
    expect(d.length).toBeGreaterThan(1);
    expect(d.every((x) => x.values.length > 0)).toBe(true);
    const frames = runMultiples(engine, report, v("cp7"), 60, v("cp7").playField);
    expect(frames.panels.length).toBe(24);
    const all = runVisual(engine, report, v("cp7"));
    expect(frames.panels[0].rows.length).toBeLessThanOrEqual(all.rows.length);
  });
});
