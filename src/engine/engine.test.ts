import { describe, expect, it } from "vitest";
import { parse, ExprError } from "./expr";
import { Engine, runVisual, valueKey } from "./query";
import type { Report } from "../model/types";
import { parseCsv } from "../model/csv";

function model(): Report {
  return {
    tables: [
      {
        name: "Vendas",
        columns: [],
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
        columns: [],
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
  };
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
    const visual = {
      id: "v", type: "bar" as const, title: "", x: 0, y: 0, w: 0, h: 0,
      axis: { table: "Produtos", column: "Categoria" }, measureIds: ["fat"],
    };
    const r = runVisual(new Engine(m), m, visual);
    expect(r.rows.map((x) => [x.category, x.values[0]])).toEqual([["A", 30], ["B", 105]]);

    // Filtro vindo de outro visual restringe; o próprio visual não se filtra.
    m.filters = [{ field: { table: "Produtos", column: "Grupo" }, values: ["G2"], sourceVisualId: "outro" }];
    expect(runVisual(new Engine(m), m, visual).rows.map((x) => x.category)).toEqual(["B"]);
    m.filters = [{ field: { table: "Produtos", column: "Categoria" }, values: ["A"], sourceVisualId: "v" }];
    expect(runVisual(new Engine(m), m, visual).rows).toHaveLength(2);
  });
});

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
