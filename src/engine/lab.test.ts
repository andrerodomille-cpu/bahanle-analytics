import { describe, expect, it } from "vitest";
import { Engine, runVisual, whatIfParams } from "./query";
import { runCalendar, runDetails, runGantt, runMultiples } from "./lab";
import { sampleReport } from "../model/sampleData";
import type { Report, Visual } from "../model/types";

const report: Report = { ...sampleReport(), filters: [] };
const engine = new Engine({ ...report, params: whatIfParams(report) });
const v = (id: string) => report.visuals.find((x) => x.id === id)!;
const m = (name: string) => report.measures.find((x) => x.name === name)!;

describe("parâmetro \"e se\"", () => {
  it("as medidas leem o valor atual do parâmetro", () => {
    const fat = engine.evaluateMeasure(m("Faturamento"), [])!;
    const sim = engine.evaluateMeasure(m("Faturamento simulado"), [])!;
    // +10% de preço, elasticidade 1,2 → demanda −12%.
    expect(sim).toBeCloseTo(fat * 1.1 * (1 - 1.2 * 0.1), 2);
    const r2: Report = {
      ...report,
      visuals: report.visuals.map((x) => (x.id === "sm1" ? { ...x, whatif: { ...x.whatif!, value: 0 } } : x)),
    };
    const e2 = new Engine({ ...r2, params: whatIfParams(r2) });
    expect(e2.evaluateMeasure(m("Faturamento simulado"), [])).toBeCloseTo(fat, 2);
  });

  it("sem o parâmetro, a medida dá erro claro", () => {
    expect(() => new Engine(report).evaluateMeasure(m("Faturamento simulado"), [])).toThrow(/Aumento de preço|Elasticidade/);
  });
});

describe("marcador", () => {
  it("meta por região vem da tabela Metas pelo relacionamento", () => {
    const rows = runVisual(engine, report, v("lb1")).rows;
    const sul = rows.find((r) => r.category === "Sul")!;
    expect(sul.values[1]).toBe(1_900_000);
    expect(sul.values[0]).toBeGreaterThan(1_000_000);
  });
});

describe("pequenos múltiplos", () => {
  it("um painel por região, mesma escala, e cada painel soma a região", () => {
    const res = runMultiples(engine, report, v("lb3"));
    expect(res.panels.map((p) => p.value)).toEqual(["Nordeste", "Sudeste", "Sul"]);
    const maxOf = Math.max(...res.panels.flatMap((p) => p.rows.map((r) => r.values[0] ?? 0)));
    expect(res.max).toBe(maxOf);
    const total = res.panels.reduce((a, p) => a + p.rows.reduce((b, r) => b + (r.values[0] ?? 0), 0), 0);
    expect(total).toBeCloseTo(engine.evaluateMeasure(m("Faturamento"), [])!, 2);
  });
});

describe("calendário de calor", () => {
  it("um valor por dia do ano mais recente; a soma bate com o ano", () => {
    const res = runCalendar(engine, report, v("lb5"), m("Pedidos"));
    expect(res.years).toEqual([2025, 2026]);
    expect(res.year).toBe(2026);
    expect(res.days.size).toBe(365);
    const sum = [...res.days.values()].reduce<number>((a, x) => a + (x ?? 0), 0);
    const ano = engine.evaluateMeasure(m("Pedidos"), [{ field: { table: "Calendário", column: "Ano" }, keys: new Set(["2026"]) }]);
    expect(sum).toBe(ano);
    const prev = runCalendar(engine, report, { ...v("lb5"), calendarYear: 2025 }, m("Pedidos"));
    expect(prev.year).toBe(2025);
  });
});

describe("Gantt", () => {
  it("tarefas ordenadas por início, com fim, progresso e grupo", () => {
    const tasks = runGantt(engine, report, v("sm7"));
    expect(tasks).toHaveLength(8);
    expect(tasks[0]).toMatchObject({ task: "1. Estudo de mercado", start: "2026-07-01", end: "2026-07-31", progress: 1, group: "Planejamento" });
    expect(tasks.map((t) => t.start)).toEqual([...tasks.map((t) => t.start)].sort());
  });
});

describe("dica de ferramenta com detalhes", () => {
  it("medidas extras e minigráfico por categoria", () => {
    const vis: Visual = v("lb4");
    const rows = runVisual(engine, report, vis).rows;
    const det = runDetails(engine, report, vis, vis.axis!, rows);
    const info = det.get("Informática")!;
    expect(info.extra).toHaveLength(2);
    expect(info.trend).toHaveLength(24);
    const sumTrend = info.trend.reduce((a, p) => a + (p.value ?? 0), 0);
    expect(sumTrend).toBeCloseTo(rows.find((r) => r.category === "Informática")!.values[0]!, 2);
  });
});
