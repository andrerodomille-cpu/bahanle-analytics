import { describe, expect, it } from "vitest";
import { parse, ExprError } from "./expr";
import { Engine, runGrid, runTotals, runVisual, valueKey } from "./query";
import type { Report, Visual } from "../model/types";
import { historyReducer, migrate, reducer, type History } from "../model/store";
import { evaluateColumn } from "../model/calculated";
import { visualToCsv } from "../model/exportCsv";
import { parseCsv } from "../model/importers";

function model(): Report {
  return {
    pages: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }],
    tables: [
      {
        name: "Vendas",
        columns: cols("ProdutoID", "Valor", "Qtd"),
        rows: [
          { ProdutoID: 1, Valor: 10, Qtd: 1 },
          { ProdutoID: 1, Valor: 20, Qtd: 2 },
          { ProdutoID: 2, Valor: 5, Qtd: 1 },
          { ProdutoID: "3", Valor: 100, Qtd: 4 }, // chave como texto (CSV)
          { ProdutoID: 99, Valor: 7, Qtd: 1 }, // sem produto correspondente
        ],
      },
      {
        name: "Produtos",
        columns: cols("ProdutoID", "Categoria", "Grupo"),
        rows: [
          { ProdutoID: 1, Categoria: "A", Grupo: "G1" },
          { ProdutoID: 2, Categoria: "B", Grupo: "G1" },
          { ProdutoID: 3, Categoria: "B", Grupo: "G2" },
          { ProdutoID: 4, Categoria: "C", Grupo: "G2" }, // sem vendas
        ],
      },
    ],
    relationships: [
      { id: "r", from: { table: "Vendas", column: "ProdutoID" }, to: { table: "Produtos", column: "ProdutoID" } },
    ],
    measures: [
      { id: "fat", name: "Fat", table: "Vendas", expression: "SUM(Vendas[Valor])", format: "number" },
      { id: "ped", name: "Ped", table: "Vendas", expression: "COUNTROWS(Vendas)", format: "number" },
      { id: "tm", name: "TM", table: "Vendas", expression: "DIVIDE([Fat], [Ped], 0)", format: "number" },
    ],
    visuals: [],
    filters: [],
    paneFilters: [],
    bookmarks: [],
    theme: { mode: "light", palette: "padrao" },
  };
}

function cols(...names: string[]) {
  return names.map((name) => ({ name, type: "number" as const }));
}

const keys = (...v: (string | number)[]) => new Set(v.map(valueKey));

describe("parser", () => {
  it("respeita precedência e parênteses", () => {
    const e = new Engine(model());
    expect(e.evaluate(parse("1 + 2 * 3"), [])).toBe(7);
    expect(e.evaluate(parse("(1 + 2) * 3"), [])).toBe(9);
    expect(e.evaluate(parse("-2 * -3"), [])).toBe(6);
  });

  it("aceita tabela entre aspas", () => {
    expect(parse("SUM('Minhas Vendas'[Valor])")).toEqual({
      kind: "agg", fn: "SUM", table: "Minhas Vendas", column: "Valor",
    });
  });

  it("rejeita expressões inválidas", () => {
    expect(() => parse("SUM(Vendas)")).toThrow(ExprError);
    expect(() => parse("FOO(1)")).toThrow(/desconhecida/);
    expect(() => parse("1 +")).toThrow(ExprError);
    expect(() => parse("1 2")).toThrow(/Sobrou/);
  });
});

describe("motor", () => {
  it("agrega sem filtros", () => {
    const e = new Engine(model());
    expect(e.evaluateMeasure(model().measures[0], [])).toBe(142);
    expect(e.evaluateMeasure(model().measures[1], [])).toBe(5);
  });

  it("propaga filtro da dimensão para o fato (inclui chave texto x número)", () => {
    const e = new Engine(model());
    const f = [{ field: { table: "Produtos", column: "Categoria" }, keys: keys("B") }];
    expect(e.evaluateMeasure(model().measures[0], f)).toBe(105);
  });

  it("não propaga filtro do fato para a dimensão (direção única)", () => {
    const e = new Engine(model());
    const f = [{ field: { table: "Vendas", column: "Valor" }, keys: keys(5) }];
    expect(e.distinct({ table: "Produtos", column: "Categoria" }, f)).toEqual(["A", "B", "C"]);
  });

  it("BLANK: medidas sem linhas viram null e DIVIDE usa o alternativo", () => {
    const e = new Engine(model());
    const f = [{ field: { table: "Produtos", column: "Categoria" }, keys: keys("C") }];
    expect(e.evaluateMeasure(model().measures[0], f)).toBeNull();
    expect(e.evaluateMeasure(model().measures[2], f)).toBe(0);
  });

  it("detecta referência circular", () => {
    const m = model();
    m.measures.push({ id: "x", name: "X", table: "Vendas", expression: "[X] + 1", format: "number" });
    expect(() => new Engine(m).evaluateMeasure(m.measures[3], [])).toThrow(/circular/);
  });

  it("visual agrupa por categoria, esconde categorias em branco e respeita filtros cruzados", () => {
    const m = model();
    const visual = bar("v", "p1", { table: "Produtos", column: "Categoria" });
    m.visuals = [visual, bar("outro", "p1"), bar("longe", "p2")];
    const r = runVisual(new Engine(m), m, visual);
    expect(r.rows.map((x) => [x.category, x.values[0]])).toEqual([["A", 30], ["B", 105]]);

    // Filtro vindo de outro visual da mesma página restringe.
    m.filters = [{ field: { table: "Produtos", column: "Grupo" }, values: ["G2"], sourceVisualId: "outro" }];
    expect(runVisual(new Engine(m), m, visual).rows.map((x) => x.category)).toEqual(["B"]);
    // O próprio visual não se filtra (só destaca).
    m.filters = [{ field: { table: "Produtos", column: "Categoria" }, values: ["A"], sourceVisualId: "v" }];
    expect(runVisual(new Engine(m), m, visual).rows).toHaveLength(2);
    // Filtro de visual de outra página não vaza.
    m.filters = [{ field: { table: "Produtos", column: "Grupo" }, values: ["G2"], sourceVisualId: "longe" }];
    expect(runVisual(new Engine(m), m, visual).rows).toHaveLength(2);
  });

  it("matriz: células, totais por linha/coluna reavaliados (não somados)", () => {
    const m = model();
    // Coluna da matriz: o próprio fato, por Qtd.
    const visual = { ...bar("mx", "p1", { table: "Produtos", column: "Categoria" }), type: "matrix" as const,
      legend: { table: "Vendas", column: "Qtd" }, measureIds: ["fat", "tm"] };
    m.visuals = [visual];
    const g = runGrid(new Engine(m), m, visual);
    // "C" aparece: não tem vendas, mas DIVIDE(..., 0) devolve 0 em vez de BLANK.
    expect(g.rows).toEqual(["A", "B", "C"]);
    expect(g.rowTotals.get("C")).toEqual([null, 0]);
    expect([...g.cols].sort()).toEqual([1, 2, 4]);
    expect(g.cells.get("A")!.get("2")![0]).toBe(20);
    expect(g.cells.get("A")!.get("4")![0]).toBeNull();
    expect(g.rowTotals.get("B")![0]).toBe(105);
    // Ticket médio do total = 142 / 5, não a soma dos tickets das linhas.
    expect(g.grandTotal[1]).toBeCloseTo(142 / 5);
    expect(g.colTotals.get("1")![0]).toBe(22);
  });
});

describe("páginas", () => {
  it("migra relatórios antigos para uma Página 1", () => {
    const old = { ...model(), pages: undefined, visuals: [{ ...bar("v", ""), pageId: undefined }] } as unknown as Report;
    const r = migrate(old);
    expect(r.pages).toEqual([{ id: "p1", name: "Página 1" }]);
    expect(r.visuals[0].pageId).toBe("p1");
  });

  it("excluir página remove visuais e filtros dela, mas nunca a última", () => {
    const m = model();
    m.visuals = [bar("a", "p1"), bar("b", "p2")];
    m.filters = [{ field: { table: "Produtos", column: "Grupo" }, values: ["G1"], sourceVisualId: "b" }];
    const r = reducer(m, { type: "removePage", id: "p2" });
    expect(r.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(r.visuals.map((v) => v.id)).toEqual(["a"]);
    expect(r.filters).toEqual([]);
    expect(reducer(r, { type: "removePage", id: "p1" })).toBe(r);
  });
});

function bar(id: string, pageId: string, axis?: { table: string; column: string }): Visual {
  return { id, pageId, type: "bar", title: "", x: 0, y: 0, w: 0, h: 0, axis, measureIds: ["fat"] };
}

describe("CSV", () => {
  it("detecta tipos e números no formato brasileiro", () => {
    // CSV brasileiro usa ";" como separador; o delimitador é detectado sozinho.
    const t = parseCsv("T", "Nome;Valor;Obs\nA;1.234,50;x\nB;10;\n");
    expect(t.columns.map((c) => c.type)).toEqual(["text", "number", "text"]);
    expect(t.rows[0].Valor).toBe(1234.5);
    expect(t.rows[1].Obs).toBeNull();
    const t2 = parseCsv("T", "Nome,Valor\nA,3.5\nB,10\n");
    expect(t2.rows[0].Valor).toBe(3.5);
  });
});

describe("DAX: CALCULATE, IF, comparações e texto", () => {
  const catB = () => [{ field: { table: "Produtos", column: "Categoria" }, keys: keys("B") }];
  const ev = (expr: string, filters: ReturnType<typeof catB> = []) => new Engine(model()).evaluate(parse(expr), filters);

  it("CALCULATE com valor substitui o filtro da mesma coluna", () => {
    expect(ev('CALCULATE([Fat], Produtos[Categoria] = "A")', catB())).toBe(30);
    expect(ev('CALCULATE([Fat], Produtos[Categoria] IN {"A", "B"})', catB())).toBe(135);
  });

  it("CALCULATE com <> exclui o valor", () => {
    expect(ev('CALCULATE([Fat], Produtos[Categoria] <> "A")')).toBe(105);
  });

  it("ALL(Tabela) remove os filtros da dimensão: % do total", () => {
    expect(ev("CALCULATE([Fat], ALL(Produtos))", catB())).toBe(142);
    expect(ev("DIVIDE([Fat], CALCULATE([Fat], ALL(Produtos)))", catB())).toBeCloseTo(105 / 142);
    // ALL só da coluna Grupo mantém o filtro de Categoria.
    expect(ev("CALCULATE([Fat], ALL(Produtos[Grupo]))", catB())).toBe(105);
  });

  it("ALL na tabela fato remove filtros das dimensões ligadas (tabela expandida)", () => {
    expect(ev("CALCULATE([Fat], ALL(Vendas))", catB())).toBe(142);
  });

  it("IF, comparações e concatenação", () => {
    expect(ev('IF([Fat] > 100, "alto", "baixo")')).toBe("alto");
    expect(ev('IF([Fat] > 200, "alto", "baixo")', catB())).toBe("baixo");
    expect(ev("IF([Fat] < 0, 1)")).toBeNull();
    expect(ev('"Total: " & [Ped]')).toBe("Total: 5");
    expect(ev('"b" = "b"')).toBe(true);
  });

  it("erros claros: coluna sem agregação, ALL fora do CALCULATE, coluna inexistente", () => {
    expect(() => ev("Vendas[Valor]")).toThrow(/sem agregação/);
    expect(() => parse("ALL(Produtos)")).toThrow(/CALCULATE/);
    expect(() => ev("SUM(Vendas[Nada])")).toThrow(/não encontrada/);
  });

  it("medida que devolve texto é rejeitada", () => {
    const m = model();
    m.measures.push({ id: "t", name: "T", table: "Vendas", expression: '"oi"', format: "number" });
    expect(() => new Engine(m).evaluateMeasure(m.measures[3], [])).toThrow(/texto/);
  });
});

describe("colunas calculadas", () => {
  it("avalia no contexto de linha, com RELATED e IF", () => {
    const m = model();
    const unit = evaluateColumn(m, "Vendas", "Unit", "Vendas[Valor] / Vendas[Qtd]");
    expect(unit.values).toEqual([10, 10, 5, 25, 7]);
    expect(unit.type).toBe("number");
    const cat = evaluateColumn(m, "Vendas", "Cat", "RELATED(Produtos[Categoria])");
    expect(cat.values).toEqual(["A", "A", "B", "B", null]);
    const faixa = evaluateColumn(m, "Vendas", "Faixa", 'IF(Vendas[Valor] >= 20, "alto", "baixo")');
    expect(faixa.type).toBe("text");
    expect(faixa.values.filter((v) => v === "alto")).toHaveLength(2);
  });

  it("RELATED na direção errada dá erro", () => {
    const r = evaluateColumn(model(), "Produtos", "X", "RELATED(Vendas[Valor])");
    expect(r.error).toMatch(/relacionamento/);
  });

  it("a coluna gravada vira campo de eixo; renomear e excluir", () => {
    let m = reducer(model(), { type: "upsertColumn", table: "Vendas", name: "Cat", expression: "RELATED(Produtos[Categoria])" });
    expect(m.tables[0].columns.at(-1)).toMatchObject({ name: "Cat", type: "text", expression: "RELATED(Produtos[Categoria])" });
    const visual = bar("v", "p1", { table: "Vendas", column: "Cat" });
    m = { ...m, visuals: [visual] };
    const rows = runVisual(new Engine(m), m, visual).rows.map((r) => [r.category, r.values[0]]);
    expect(rows).toEqual(expect.arrayContaining([["A", 30], ["B", 105], [null, 7]]));
    m = reducer(m, {
      type: "upsertColumn", table: "Vendas", name: "Categoria", expression: "RELATED(Produtos[Categoria])", oldName: "Cat",
    });
    expect(m.tables[0].rows[0]).toMatchObject({ Categoria: "A" });
    expect(m.tables[0].rows[0]).not.toHaveProperty("Cat");
    m = reducer(m, { type: "removeColumn", table: "Vendas", name: "Categoria" });
    expect(m.tables[0].columns.map((c) => c.name)).toEqual(["ProdutoID", "Valor", "Qtd"]);
  });
});

describe("Top N, totais e Painel de Filtros", () => {
  it("Top N mantém as maiores e o total considera só elas", () => {
    const m = model();
    const visual: Visual = { ...bar("v", "p1", { table: "Vendas", column: "Valor" }), type: "table", topN: 2 };
    m.visuals = [visual];
    const engine = new Engine(m);
    const result = runVisual(engine, m, visual);
    expect(result.rows.map((r) => r.category).sort()).toEqual([100, 20]);
    expect(runTotals(engine, m, visual, result)).toEqual([120]);
  });

  it("filtros do painel valem por visual, página ou relatório", () => {
    const m = model();
    const a = bar("a", "p1");
    const b = bar("b", "p1");
    const c = bar("c", "p2");
    m.visuals = [a, b, c];
    const fat = (v: Visual) => runVisual(new Engine(m), m, v).rows[0].values[0];
    const f = (scope: "visual" | "page" | "report", targetId?: string) => ({
      id: scope, scope, targetId, field: { table: "Produtos", column: "Categoria" }, values: ["A"],
    });
    m.paneFilters = [f("visual", "a")];
    expect([fat(a), fat(b), fat(c)]).toEqual([30, 142, 142]);
    m.paneFilters = [f("page", "p1")];
    expect([fat(a), fat(b), fat(c)]).toEqual([30, 30, 142]);
    m.paneFilters = [f("report")];
    expect([fat(a), fat(b), fat(c)]).toEqual([30, 30, 30]);
    // Filtro sem valores marcados = "Todos".
    m.paneFilters = [{ ...f("report"), values: [] }];
    expect(fat(a)).toBe(142);
  });
});

describe("exportar dados", () => {
  it("gera CSV com ; e vírgula decimal (Excel em português)", () => {
    const m = model();
    m.measures[0].name = "Fat; total";
    const visual = bar("v", "p1", { table: "Produtos", column: "Categoria" });
    m.visuals = [visual];
    m.measures.push({ id: "media", name: "Média", table: "Vendas", expression: "AVERAGE(Vendas[Valor])", format: "number" });
    visual.measureIds = ["fat", "media"];
    const csv = visualToCsv(visual, [m.measures[0], m.measures[3]], runVisual(new Engine(m), m, visual));
    expect(csv.split("\r\n")).toEqual(['Categoria;"Fat; total";Média', "A;30;15", "B;105;52,5"]);
  });
});

describe("desfazer / refazer", () => {
  const start = (): History => ({ past: [], present: model(), future: [] });

  it("desfaz e refaz alterações; seleção não entra no histórico", () => {
    let h = start();
    h = historyReducer(h, { type: "addPage", page: { id: "p3", name: "P3" } });
    h = historyReducer(h, {
      type: "toggleFilter", multi: false,
      filter: { field: { table: "Produtos", column: "Categoria" }, values: ["A"], sourceVisualId: "x" },
    });
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.pages).toHaveLength(2);
    h = historyReducer(h, { type: "redo" });
    expect(h.present.pages).toHaveLength(3);
  });

  it("arrastar um visual vira um único passo", () => {
    let h: History = { ...start(), present: { ...model(), visuals: [bar("v", "p1")] } };
    for (let x = 10; x <= 50; x += 10) h = historyReducer(h, { type: "updateVisual", id: "v", patch: { x, y: 0 } });
    expect(h.past).toHaveLength(1);
    expect(h.present.visuals[0].x).toBe(50);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.visuals[0].x).toBe(0);
    expect(h.past).toHaveLength(0);
  });
});
