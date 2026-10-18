import { describe, expect, it, vi } from "vitest";
import { sampleReport } from "./sampleData";
import { reducer } from "./store";
import { describeModel, generateDashboard, layout, PAGE_WIDTH, planToActions, resolveField } from "./ai";
import type { Plan } from "./ai";

const report = sampleReport();
const page = report.pages[0].id;

describe("resolveField", () => {
  it("aceita Tabela[Coluna], aspas, ponto e só o nome da coluna", () => {
    expect(resolveField(report, "Lojas[UF]")).toEqual({ table: "Lojas", column: "UF" });
    expect(resolveField(report, "'Lojas'[UF]")).toEqual({ table: "Lojas", column: "UF" });
    expect(resolveField(report, "lojas.uf")).toEqual({ table: "Lojas", column: "UF" });
    expect(resolveField(report, "Regiao")).toMatchObject({ column: "Região" });
    expect(resolveField(report, "Vendas[Data]", "month")).toEqual({ table: "Vendas", column: "Data", part: "month" });
    expect(resolveField(report, "Lojas[Estado]")).toBeNull();
  });
});

describe("planToActions", () => {
  it("cria página, medida nova e visuais que existem no modelo", () => {
    const plan: Plan = {
      reply: "ok",
      pageName: "Vendas por estado",
      measures: [{ name: "Total de Vendas", table: "Vendas", expression: "SUM(Vendas[Valor])", format: "currency" }],
      visuals: [
        { type: "card", title: "Total", axis: "", measures: ["Total de Vendas"] },
        { type: "map", title: "Vendas por UF", axis: "Lojas[UF]", measures: ["[Total de Vendas]"] },
        { type: "hbar", title: "Ranking", axis: "UF", measures: ["Faturamento"], sort: "value_desc", topN: 5 },
      ],
    };
    const r = planToActions(report, plan, { newPage: true, pageId: page });
    expect(r.problems).toEqual([]);
    expect(r.visualCount).toBe(3);
    const next = reducer(report, { type: "batch", actions: r.actions });
    expect(next.pages.find((p) => p.id === r.pageId)?.name).toBe("Vendas por estado");
    const created = next.visuals.filter((v) => v.pageId === r.pageId);
    expect(created.map((v) => v.type)).toEqual(["card", "map", "hbar"]);
    const total = next.measures.find((m) => m.name === "Total de Vendas")!;
    expect(created[1].measureIds).toEqual([total.id]);
    expect(created[2]).toMatchObject({ sort: { by: 0, desc: true }, topN: 5, axis: { table: "Lojas", column: "UF" } });
  });

  it("descarta o que não existe e explica por quê", () => {
    const plan: Plan = {
      reply: "ok",
      measures: [{ name: "Ruim", table: "Vendas", expression: "SUM(Vendas[Inexistente])", format: "number" }],
      visuals: [
        { type: "bar", title: "A", axis: "Lojas[Estado]", measures: ["Faturamento"] },
        { type: "bar", title: "B", axis: "Lojas[UF]", measures: ["Ruim"] },
        { type: "rosquinha", title: "C", axis: "Lojas[UF]", measures: ["Faturamento"] },
      ],
    };
    const r = planToActions(report, plan, { newPage: false, pageId: page });
    expect(r.visualCount).toBe(0);
    expect(r.problems).toHaveLength(5);
  });

  it("reaproveita medidas existentes e transforma expressão no lugar do nome em medida", () => {
    const plan: Plan = {
      reply: "ok",
      measures: [{ name: "faturamento", table: "Vendas", expression: "SUM(Vendas[Quantidade])", format: "number" }],
      visuals: [{ type: "bar", title: "X", axis: "Produtos[Categoria]", measures: ["faturamento", "AVERAGE(Vendas[Valor])"] }],
    };
    const r = planToActions(report, plan, { newPage: false, pageId: page });
    expect(r.problems).toEqual([]);
    const measures = r.actions.filter((a) => a.type === "upsertMeasure");
    expect(measures).toHaveLength(1); // só a expressão virou medida; "faturamento" já existia
    const v = r.actions.find((a) => a.type === "addVisual");
    expect(v && v.type === "addVisual" && v.visual.measureIds[0]).toBe("m1");
    // Na página atual, os visuais vão abaixo dos que já existem.
    const bottom = Math.max(...report.visuals.filter((x) => x.pageId === page).map((x) => x.y + x.h));
    expect(v && v.type === "addVisual" && v.visual.y).toBeGreaterThan(bottom);
  });
});

describe("layout", () => {
  it("põe indicadores no topo e estica as linhas até a largura da página", () => {
    const pos = layout([{ type: "bar" }, { type: "card" }, { type: "card" }, { type: "line" }]);
    expect(pos[1].y).toBe(pos[2].y);
    expect(pos[0].y).toBeGreaterThan(pos[1].y);
    expect(pos[2].x + pos[2].w).toBeCloseTo(PAGE_WIDTH + 10, -1);
    expect(pos[3].y).toBeGreaterThan(pos[0].y);
  });
});

describe("generateDashboard", () => {
  it("manda o esquema ao Ollama e pede correção quando o plano tem problemas", async () => {
    const replies: Plan[] = [
      { reply: "1", pageName: "P", measures: [], visuals: [{ type: "bar", title: "A", axis: "Lojas[Estado]", measures: ["Faturamento"] }] },
      { reply: "Vendas por UF", pageName: "P", measures: [], visuals: [{ type: "bar", title: "A", axis: "Lojas[UF]", measures: ["Faturamento"] }] },
    ];
    const bodies: { messages: { content: string }[]; format: unknown }[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ message: { content: JSON.stringify(replies[bodies.length - 1]) } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await generateDashboard(report, "vendas por estado", { url: "http://x/", model: "m" }, { newPage: true, pageId: page });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe("http://x/api/chat");
      expect(bodies[0].format).toBeTruthy();
      expect(bodies[0].messages[0].content).toContain("Lojas [");
      expect(bodies[1].messages.at(-1)!.content).toContain("Lojas[Estado]");
      expect(r.reply).toBe("Vendas por UF");
      expect(r.visualCount).toBe(1);
      expect(r.problems).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("descreve tabelas, relacionamentos e medidas", () => {
    const d = describeModel(report);
    expect(d).toContain("UF (text)");
    expect(d).toContain("Vendas[LojaID] → Lojas[LojaID]");
    expect(d).toContain("Faturamento = SUM(Vendas[Valor])");
  });
});
