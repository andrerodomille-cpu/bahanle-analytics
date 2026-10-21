import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleReport } from "./sampleData";
import { reducer } from "./store";
import { CloudError, contentChanged, openCloudReport, saveCloudReport, toCloudData } from "./cloud";

const report = sampleReport();

describe("contentChanged", () => {
  it("ignora seleções nos gráficos e percebe edições", () => {
    expect(contentChanged(report, report)).toBe(false);
    const filtered = reducer(report, {
      type: "toggleFilter", multi: false,
      filter: { field: { table: "Lojas", column: "UF" }, values: ["SP"], sourceVisualId: report.visuals[0].id },
    });
    expect(filtered).not.toBe(report);
    expect(contentChanged(report, filtered)).toBe(false);
    const edited = reducer(filtered, { type: "renamePage", id: report.pages[0].id, name: "Outro nome" });
    expect(contentChanged(report, edited)).toBe(true);
  });

  it("não manda o estado da sessão para a nuvem", () => {
    const data = toCloudData({ ...report, filters: [{ field: { table: "Lojas", column: "UF" }, values: ["SP"], sourceVisualId: "x" }] });
    expect(data.filters).toEqual([]);
    expect(data.drillthrough).toBeUndefined();
  });
});

describe("cliente da API", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** fetch falso: devolve as respostas em ordem e guarda os pedidos. */
  function fake(...replies: [number, unknown][]) {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const [status, body] = replies[calls.length - 1];
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }));
    return calls;
  }

  const meta = { id: "a", name: "R", version: 3, updatedAt: "2026-10-20T00:00:00Z", size: 10 };

  it("salva com a versão aberta e devolve a nova", async () => {
    const calls = fake([200, { ...meta, version: 4 }]);
    const link = await saveCloudReport({ id: "a", name: "R", version: 3 }, report);
    expect(link.version).toBe(4);
    expect(calls[0]).toMatchObject({ url: "/api/reports/a", method: "PUT", body: { version: 3 } });
  });

  it("conflito vira CloudError 409; forçar busca a versão atual e salva por cima", async () => {
    fake([409, { error: "salvo em outro lugar" }]);
    const err = await saveCloudReport({ id: "a", name: "R", version: 1 }, report).catch((e) => e);
    expect(err).toBeInstanceOf(CloudError);
    expect(err).toMatchObject({ status: 409, message: "salvo em outro lugar" });

    const calls = fake([200, { ...meta, data: report }], [200, { ...meta, version: 4 }]);
    expect((await saveCloudReport({ id: "a", name: "R", version: 1 }, report, true)).version).toBe(4);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(calls[1].body).toMatchObject({ version: 3 });
  });

  it("abre e completa relatórios antigos; sessão expirada tem mensagem própria", async () => {
    const { pages: _pages, ...old } = report;
    fake([200, { ...meta, data: old }]);
    const { link, report: opened } = await openCloudReport("a");
    expect(link).toEqual({ id: "a", name: "R", version: 3 });
    expect(opened.pages.length).toBeGreaterThan(0);

    fake([401, { error: "Faça login." }]);
    await expect(openCloudReport("a")).rejects.toThrow("sessão expirou");
  });
});
