import { describe, expect, it } from "vitest";
import { parse } from "./expr";
import { Engine, axisOf, contextFor, hierarchyOf, runGrid, runVisual, valueKey } from "./query";
import type { Report, Table, Visual } from "../model/types";
import { captureBookmark, reducer } from "../model/store";
import { datePart, parseDate, shiftDate } from "../model/dates";
import { applySteps, detectType } from "../model/transform";
import { parseCsv, parseJson } from "../model/importers";
import { sampleReport } from "../model/sampleData";
import { formatValue } from "../model/format";
import { embedReport } from "../model/publish";

// Modelo pequeno com tabela de datas: 2025 e 2026, dois produtos.
function model(): Report {
  const cal: Table = {
    name: "Cal",
    columns: [{ name: "Data", type: "date" }, { name: "Ano", type: "number" }],
    rows: ["2025-01-10", "2025-02-10", "2025-03-10", "2026-01-10", "2026-02-10", "2026-03-10"].map((d) => ({
      Data: d, Ano: Number(d.slice(0, 4)),
    })),
  };
  const vendas: Table = {
    name: "Vendas",
    columns: [{ name: "Data", type: "date" }, { name: "Prod", type: "text" }, { name: "Qtd", type: "number" }, { name: "Valor", type: "number" }],
    rows: [
      { Data: "2025-01-10", Prod: "A", Qtd: 1, Valor: 10 },
      { Data: "2025-02-10", Prod: "B", Qtd: 2, Valor: 20 },
      { Data: "2025-03-10", Prod: "A", Qtd: 1, Valor: 30 },
      { Data: "2026-01-10", Prod: "A", Qtd: 3, Valor: 15 },
      { Data: "2026-02-10", Prod: "B", Qtd: 1, Valor: 40 },
      { Data: "2026-03-10", Prod: "B", Qtd: 2, Valor: 50 },
    ],
  };
  return {
    pages: [{ id: "p1", name: "P1" }],
    tables: [vendas, cal],
    relationships: [{ id: "r", from: { table: "Vendas", column: "Data" }, to: { table: "Cal", column: "Data" } }],
    measures: [
      { id: "fat", name: "Fat", table: "Vendas", expression: "SUM(Vendas[Valor])", format: "number" },
      { id: "ytd", name: "YTD", table: "Vendas", expression: "TOTALYTD([Fat], Cal[Data])", format: "number" },
      { id: "aa", name: "AA", table: "Vendas", expression: "CALCULATE([Fat], SAMEPERIODLASTYEAR(Cal[Data]))", format: "number" },
      { id: "ant", name: "MesAnt", table: "Vendas", expression: "CALCULATE([Fat], DATEADD(Cal[Data], -1, MONTH))", format: "number" },
    ],
    visuals: [],
    filters: [],
    paneFilters: [],
    bookmarks: [],
    theme: { mode: "light", palette: "padrao" },
  };
}

const visual = (patch: Partial<Visual>): Visual => ({
  id: "v", pageId: "p1", type: "bar", title: "", x: 0, y: 0, w: 0, h: 0, measureIds: ["fat"], ...patch,
});

const only = (table: string, column: string, value: string | number, part?: "year" | "month") => ({
  field: { table, column, part }, keys: new Set([valueKey(value)]),
});

describe("datas", () => {
  it("converte formatos comuns e calcula partes", () => {
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("05/03/2026")).toBe("2026-03-05");
    expect(parseDate("2026-03-05T10:00:00Z")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(datePart("2026-03-05", "year")).toBe(2026);
    expect(datePart("2026-03-05", "quarter")).toBe("T1");
    expect(datePart("2026-03-05", "month")).toBe("03 mar");
    expect(formatValue("2026-03-05")).toBe("05/03/2026");
  });

  it("desloca datas ajustando fim de mês e ano bissexto", () => {
    expect(shiftDate("2026-03-31", -1, "MONTH")).toBe("2026-02-28");
    expect(shiftDate("2024-02-29", -1, "YEAR")).toBe("2023-02-28");
    expect(shiftDate("2026-01-01", -1, "DAY")).toBe("2025-12-31");
  });
});

describe("hierarquia de datas e drill-down", () => {
  it("coluna de data vira Ano › Trimestre › Mês › Dia", () => {
    const m = model();
    const v = visual({ axis: { table: "Cal", column: "Data" } });
    expect(hierarchyOf(m, v).map((f) => f.part)).toEqual(["year", "quarter", "month", "day"]);
    expect(runVisual(new Engine(m), m, v).rows.map((r) => [r.category, r.values[0]])).toEqual([[2025, 60], [2026, 105]]);
  });

  it("drill desce filtrando pelo item; próximo nível sem item agrega todos", () => {
    const m = model();
    const down = visual({ axis: { table: "Cal", column: "Data" }, drill: { level: 2, path: [2026, undefined] } });
    expect(axisOf(m, down)).toMatchObject({ part: "month" });
    expect(runVisual(new Engine(m), m, down).rows.map((r) => [r.category, r.values[0]]))
      .toEqual([["01 jan", 15], ["02 fev", 40], ["03 mar", 50]]);
    const all = visual({ axis: { table: "Cal", column: "Data" }, drill: { level: 2, path: [undefined, undefined] } });
    expect(runVisual(new Engine(m), m, all).rows.find((r) => r.category === "01 jan")?.values[0]).toBe(25);
  });

  it("hierarquia de campos comuns usa drillFields", () => {
    const m = model();
    const v = visual({ axis: { table: "Cal", column: "Ano" }, drillFields: [{ table: "Vendas", column: "Prod" }] });
    expect(hierarchyOf(m, v)).toHaveLength(2);
    const down = { ...v, drill: { level: 1, path: [2025] } };
    expect(contextFor(m, down)).toHaveLength(1);
    expect(runVisual(new Engine(m), m, down).rows.map((r) => [r.category, r.values[0]])).toEqual([["A", 40], ["B", 20]]);
  });

  it("mudar o drill limpa o filtro cruzado criado pelo visual", () => {
    let m = model();
    m = { ...m, visuals: [visual({ axis: { table: "Cal", column: "Data" } })] };
    m = reducer(m, { type: "toggleFilter", multi: false, filter: { field: { table: "Cal", column: "Data", part: "year" }, values: [2025], sourceVisualId: "v" } });
    expect(m.filters).toHaveLength(1);
    m = reducer(m, { type: "updateVisual", id: "v", patch: { drill: { level: 1, path: [2025] } } });
    expect(m.filters).toHaveLength(0);
  });
});

describe("inteligência de tempo", () => {
  const ev = (measure: number, filters: ReturnType<typeof only>[]) => {
    const m = model();
    return new Engine(m).evaluateMeasure(m.measures[measure], filters);
  };

  it("TOTALYTD acumula do início do ano até a última data visível", () => {
    expect(ev(1, [only("Cal", "Data", "2026-02-10")])).toBe(55);
    expect(ev(1, [only("Cal", "Ano", 2025)])).toBe(60);
  });

  it("SAMEPERIODLASTYEAR troca os filtros da tabela de datas", () => {
    expect(ev(2, [only("Cal", "Ano", 2026)])).toBe(60);
    // Março de 2026 (filtro na parte "mês" da data + ano) → março de 2025.
    expect(ev(2, [only("Cal", "Ano", 2026), only("Cal", "Data", "03 mar", "month")])).toBe(30);
    expect(ev(2, [only("Cal", "Ano", 2025)])).toBeNull();
  });

  it("DATEADD desloca as datas visíveis", () => {
    expect(ev(3, [only("Cal", "Data", "2026-03-10")])).toBe(40);
  });

  it("funções de data fora do CALCULATE dão erro claro", () => {
    expect(() => parse("SAMEPERIODLASTYEAR(Cal[Data])")).toThrow(/CALCULATE/);
    expect(() => parse("CALCULATE([Fat], DATEADD(Cal[Data], -1, SEMANA))")).toThrow(/DAY, MONTH/);
  });
});

describe("iteradores e FILTER", () => {
  const ev = (expr: string, filters: ReturnType<typeof only>[] = []) => new Engine(model()).evaluate(parse(expr), filters);

  it("SUMX avalia a expressão linha a linha", () => {
    expect(ev("SUMX(Vendas, Vendas[Qtd] * Vendas[Valor])")).toBe(10 + 40 + 30 + 45 + 40 + 100);
    expect(ev("AVERAGEX(Vendas, Vendas[Valor])", [only("Cal", "Ano", 2025)])).toBe(20);
    expect(ev("MAXX(Vendas, Vendas[Qtd])")).toBe(3);
  });

  it("FILTER e ALL como tabelas", () => {
    expect(ev("COUNTROWS(FILTER(Vendas, Vendas[Valor] >= 30))")).toBe(3);
    expect(ev('SUMX(FILTER(Vendas, Vendas[Prod] = "B"), Vendas[Valor])')).toBe(110);
    // ALL ignora o contexto de filtro.
    expect(ev("COUNTROWS(ALL(Vendas))", [only("Cal", "Ano", 2025)])).toBe(6);
    expect(() => parse("FILTER(Vendas, 1)")).toThrow(/tabela/);
  });
});

describe("editor de consultas", () => {
  it("CSV: detecta tipos como etapas e aplica transformações em ordem", () => {
    const t = parseCsv("T", "Data;Loja;Valor\n05/03/2026;Centro;1.234,50\n06/03/2026;Norte;10\n06/03/2026;Norte;10\n;;\n");
    expect(t.query?.steps.map((s) => s.kind)).toEqual(["type", "type"]);
    expect(t.columns.map((c) => c.type)).toEqual(["date", "text", "number"]);
    expect(t.rows[0]).toEqual({ Data: "2026-03-05", Loja: "Centro", Valor: 1234.5 });

    const steps = [
      ...t.query!.steps,
      { kind: "rename" as const, column: "Loja", to: "Filial" },
      { kind: "dedupe" as const },
      { kind: "filter" as const, column: "Valor", op: ">" as const, value: "100" },
    ];
    const r = applySteps({ ...t.query!, steps });
    expect(r.errors.every((e) => !e)).toBe(true);
    expect(r.rows).toEqual([{ Data: "2026-03-05", Filial: "Centro", Valor: 1234.5 }]);
  });

  it("etapa que depende de coluna removida é pulada com erro", () => {
    const t = parseCsv("T", "A,B\n1,x\n");
    const r = applySteps({
      ...t.query!,
      steps: [{ kind: "remove", columns: ["B"] }, { kind: "rename", column: "B", to: "C" }],
    });
    expect(r.errors[1]).toMatch(/não existe/);
    expect(r.columns.map((c) => c.name)).toEqual(["A"]);
  });

  it("JSON: lista dentro de objeto e campos aninhados", () => {
    const t = parseJson("J", JSON.stringify({ dados: [{ id: 1, cliente: { nome: "Ana", uf: "SP" }, tags: ["a"] }] }));
    expect(t.columns.map((c) => c.name)).toEqual(["id", "cliente.nome", "cliente.uf", "tags"]);
    expect(t.rows[0]).toMatchObject({ id: 1, "cliente.nome": "Ana", tags: '["a"]' });
  });

  it("detectType", () => {
    expect(detectType(["1", "2,5", null])).toBe("number");
    expect(detectType(["2026-01-01", "05/03/2026"])).toBe("date");
    expect(detectType(["2026-03", "x"])).toBe("text");
  });

  it("transformar tabela sem consulta cria a consulta e preserva colunas calculadas", () => {
    let m = model();
    m = reducer(m, { type: "upsertColumn", table: "Vendas", name: "Dobro", expression: "Vendas[Valor] * 2" });
    m = reducer(m, { type: "setSteps", table: "Vendas", steps: [{ kind: "filter", column: "Prod", op: "=", value: "A" }] });
    const v = m.tables.find((t) => t.name === "Vendas")!;
    expect(v.query?.origin).toBe("Dados do modelo");
    expect(v.rows).toHaveLength(3);
    expect(v.columns.at(-1)).toMatchObject({ name: "Dobro", expression: "Vendas[Valor] * 2" });
    expect(v.rows.map((r) => r.Dobro)).toEqual([20, 60, 30]);
    // Desfazer a etapa traz as linhas de volta (a fonte não foi alterada).
    m = reducer(m, { type: "setSteps", table: "Vendas", steps: [] });
    expect(m.tables.find((t) => t.name === "Vendas")!.rows).toHaveLength(6);
  });
});

describe("indicadores", () => {
  it("salva e reaplica filtros e drill", () => {
    let m = { ...model(), visuals: [visual({ axis: { table: "Cal", column: "Data" } })] };
    m = reducer(m, { type: "updateVisual", id: "v", patch: { drill: { level: 1, path: [2026] } } });
    m = reducer(m, { type: "addPaneFilter", filter: { id: "pf", scope: "report", field: { table: "Vendas", column: "Prod" }, values: ["A"] } });
    m = reducer(m, { type: "addBookmark", bookmark: captureBookmark(m, "b", "Meu", "p1") });
    m = reducer(m, { type: "updateVisual", id: "v", patch: { drill: undefined } });
    m = reducer(m, { type: "removePaneFilter", id: "pf" });
    m = reducer(m, { type: "applyBookmark", id: "b" });
    expect(m.visuals[0].drill).toEqual({ level: 1, path: [2026] });
    expect(m.paneFilters.map((f) => f.id)).toEqual(["pf"]);
  });
});

describe("publicação", () => {
  it("embute o relatório antes do último </body>, mesmo com </head> e </body> dentro do JS", () => {
    const viewer = '<html><head><script type="module">const a="</head>";const b="</body>";</script></head><body><div id="root"></div></body></html>';
    const r = model();
    r.tables[1].rows[0].Ano = "</script><b>"; // texto malicioso nos dados
    const html = embedReport(viewer, r);
    expect(html.startsWith('<html><head><script type="module">const a="</head>";const b="</body>";</script></head>')).toBe(true);
    const json = html.match(/<script id="minibi-report" type="application\/json">(.*)<\/script>\n<\/body><\/html>$/)?.[1];
    expect(json).toBeDefined();
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json!).tables[1].rows[0].Ano).toBe("</script><b>");
  });
});

describe("relatório de exemplo", () => {
  it("todas as medidas calculam sem erro e o crescimento faz sentido", () => {
    const r = sampleReport();
    const engine = new Engine(r);
    for (const m of r.measures) expect(() => engine.evaluateMeasure(m, [])).not.toThrow();
    const y2026 = [only("Calendário", "Ano", 2026)];
    const growth = engine.evaluateMeasure(r.measures.find((m) => m.name === "Crescimento %")!, y2026)!;
    expect(growth).toBeGreaterThan(0);
    const discount = engine.evaluateMeasure(r.measures.find((m) => m.name === "Desconto Médio %")!, [])!;
    expect(discount).toBeGreaterThan(0);
    expect(discount).toBeLessThan(0.15);
  });

  it("todos os visuais do exemplo rodam sem erro", () => {
    const r = sampleReport();
    const engine = new Engine(r);
    for (const v of r.visuals) {
      expect(runVisual(engine, r, v).error, v.title).toBeUndefined();
      if (v.legend) expect(runGrid(engine, r, v).error, v.title).toBeUndefined();
    }
  });
});
