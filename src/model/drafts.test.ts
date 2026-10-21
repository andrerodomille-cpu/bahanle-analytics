import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReport, loadDraft, loadReport, reducer, saveReport } from "./store";
import { loadLink, storeLink } from "./cloud";
import { Engine } from "../engine/query";

/** localStorage em memória (os testes rodam no Node). */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("rascunho por conta", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cada conta tem o seu rascunho e o seu vínculo com a nuvem", () => {
    const ana = { ...emptyReport(), pages: [{ id: "a", name: "Da Ana" }] };
    saveReport(ana, "Ana@Gmail.com");
    storeLink({ id: "1", name: "R", version: 2 }, "ana@gmail.com");
    expect(loadDraft("ana@gmail.com")?.pages[0].name).toBe("Da Ana");
    expect(loadLink("ana@gmail.com")).toEqual({ id: "1", name: "R", version: 2 });
    expect(loadDraft("bia@gmail.com")).toBeNull();
    expect(loadLink("bia@gmail.com")).toBeNull();
    expect(loadReport("bia@gmail.com").pages.length).toBeGreaterThan(1); // sem rascunho: o exemplo
  });

  it("o rascunho antigo (sem conta) vai para a primeira conta que entra, e só para ela", () => {
    storage.setItem("mini-bi-report-v1", JSON.stringify({ ...emptyReport(), pages: [{ id: "x", name: "Antigo" }] }));
    storage.setItem("mini-bi-cloud-link", JSON.stringify({ id: "9", name: "Antigo", version: 1 }));
    expect(loadDraft("ana@gmail.com")?.pages[0].name).toBe("Antigo");
    expect(loadLink("ana@gmail.com")?.id).toBe("9");
    expect(storage.getItem("mini-bi-report-v1")).toBeNull();
    expect(loadDraft("bia@gmail.com")).toBeNull();
    expect(loadLink("bia@gmail.com")).toBeNull();
  });
});

describe("relatório em branco", () => {
  it("tem uma página e aceita uma tabela e um visual", () => {
    const r = emptyReport();
    expect(r.pages).toHaveLength(1);
    expect(r.visuals).toEqual([]);
    const withTable = reducer(r, {
      type: "addTable",
      table: { name: "T", columns: [{ name: "v", type: "number" }], rows: [{ v: 2 }, { v: 3 }] },
    });
    const withMeasure = reducer(withTable, { type: "upsertMeasure", measure: { id: "m", name: "Soma", table: "T", expression: "SUM(T[v])", format: "number" } });
    expect(new Engine(withMeasure).evaluateMeasure(withMeasure.measures[0], [])).toBe(5);
  });
});
