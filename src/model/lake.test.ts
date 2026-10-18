import { afterEach, describe, expect, it, vi } from "vitest";
import { LakeError, detectRelationships, fetchLakeTable, listLakeTables } from "./lake";
import { reducer } from "./store";
import { sampleReport } from "./sampleData";
import type { Table } from "./types";

const t = (name: string, cols: [string, "number" | "text"][], rows: (string | number | null)[][]): Table => ({
  name,
  columns: cols.map(([n, type]) => ({ name: n, type })),
  rows: rows.map((r) => Object.fromEntries(cols.map(([n], i) => [n, r[i]]))),
});

describe("detecção de relacionamentos", () => {
  const fato = t("fato_vendas", [["venda_id", "number"], ["loja_id", "number"], ["produto_id", "number"]],
    [[1, 1, 10], [2, 1, 11], [3, 2, 10]]);
  const lojas = t("dim_loja", [["loja_id", "number"], ["loja", "text"]], [[1, "A"], [2, "B"]]);
  const produtos = t("dim_produto", [["produto_id", "number"], ["produto", "text"]], [[10, "X"], [11, "Y"]]);

  it("liga a fato às dimensões pela chave única", () => {
    const rels = detectRelationships([fato, lojas, produtos], []);
    const pairs = rels.map((r) => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}`).sort();
    expect(pairs).toEqual(["fato_vendas.loja_id->dim_loja.loja_id", "fato_vendas.produto_id->dim_produto.produto_id"]);
  });

  it("ignora coincidências: colunas sem cara de chave e valores que não existem do outro lado", () => {
    const funil = t("Funil", [["Etapa", "text"], ["quantidade", "number"]], [["a", 1], ["b", 2], ["c", 3]]);
    const vendas = t("v", [["quantidade", "number"], ["cliente_id", "number"]], [[1, 7], [1, 8], [2, 9]]);
    const clientes = t("clientes", [["cliente_id", "number"]], [[1], [2], [3]]);
    expect(detectRelationships([vendas, funil], [])).toEqual([]);      // "quantidade" não é chave
    expect(detectRelationships([vendas, clientes], [])).toEqual([]);   // 7, 8 e 9 não existem em clientes
  });

  it("não duplica relacionamento existente nem liga duas chaves únicas", () => {
    const existing = [{ id: "x", from: { table: "fato_vendas", column: "loja_id" }, to: { table: "dim_loja", column: "loja_id" } }];
    expect(detectRelationships([fato, lojas], existing)).toEqual([]);
    const outra = t("dim_loja2", [["loja_id", "number"]], [[1], [2]]);
    expect(detectRelationships([lojas, outra], [])).toEqual([]);
  });
});

describe("API do mini-lake", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("importa tabela com tipos, origem e envia o token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      columns: [{ name: "ano_mes", type: "text" }, { name: "faturamento", type: "number" }, { name: "data", type: "date" }],
      rows: [["2026-01", 10.5, "2026-01-01"], ["2026-02", null, "2026-02-01"]],
      total: 2, truncated: false, updated_at: "2026-10-18T10:00:00+00:00",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { table, truncated } = await fetchLakeTable({ url: "http://lake:8000/", token: "abc" }, "gold", "vendas_mensais", "vendas_mensais");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://lake:8000/api/tables/gold/vendas_mensais?limit=500000");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc");
    expect(truncated).toBe(false);
    expect(table.columns.map((c) => `${c.name}:${c.type}`)).toEqual(["ano_mes:text", "faturamento:number", "data:date"]);
    expect(table.rows[1]).toEqual({ ano_mes: "2026-02", faturamento: null, data: "2026-02-01" });
    expect(table.remote).toEqual({ url: "http://lake:8000", layer: "gold", name: "vendas_mensais", updatedAt: "2026-10-18T10:00:00+00:00" });
    expect(table.query?.origin).toBe("mini-lake: gold.vendas_mensais");
  });

  it("erros viram mensagens claras", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(listLakeTables({ url: "http://x:1" })).rejects.toThrow(/minilake serve/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(listLakeTables({ url: "http://x:1" })).rejects.toBeInstanceOf(LakeError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Tabela gold.x não encontrada" }), { status: 404 })));
    await expect(listLakeTables({ url: "http://x:1" })).rejects.toThrow(/gold.x não encontrada/);
  });
});

describe("atualizar tabela do lake", () => {
  it("troca os dados, reaplica as etapas e mantém colunas calculadas e a origem", () => {
    const source = t("vendas_mensais", [["regiao", "text"], ["faturamento", "number"]], [["Sul", 10], ["Norte", 5]]);
    let r = reducer(sampleReport(), {
      type: "addTable",
      table: {
        ...source,
        query: { origin: "mini-lake: gold.vendas_mensais", source: { columns: source.columns, rows: source.rows }, steps: [] },
        remote: { url: "http://lake", layer: "gold", name: "vendas_mensais" },
      },
    });
    r = reducer(r, { type: "setSteps", table: "vendas_mensais", steps: [{ kind: "rename", column: "regiao", to: "Região" }] });
    r = reducer(r, { type: "upsertColumn", table: "vendas_mensais", name: "Dobro", expression: "vendas_mensais[faturamento] * 2" });
    const fresh = t("vendas_mensais", [["regiao", "text"], ["faturamento", "number"]], [["Sul", 100], ["Norte", 50], ["Leste", 1]]);
    r = reducer(r, {
      type: "refreshTable",
      table: {
        ...fresh,
        query: { origin: "mini-lake: gold.vendas_mensais", source: { columns: fresh.columns, rows: fresh.rows }, steps: [] },
        remote: { url: "http://lake", layer: "gold", name: "vendas_mensais", updatedAt: "novo" },
      },
    });
    const after = r.tables.find((x) => x.name === "vendas_mensais")!;
    expect(after.rows.length).toBe(3);
    expect(after.columns.map((c) => c.name)).toEqual(["Região", "faturamento", "Dobro"]);
    expect(after.rows[0]).toMatchObject({ "Região": "Sul", faturamento: 100, Dobro: 200 });
    expect(after.remote?.updatedAt).toBe("novo");
    expect(after.query?.steps).toHaveLength(1);
  });

  it("reaplicar etapas não apaga a origem SQL de uma tabela do notebook", () => {
    const r = sampleReport();
    const gold = r.tables.find((x) => x.name === "gold_vendas_mensais")!;
    expect(gold.sql).toBeTruthy();
    const after = reducer(r, { type: "setSteps", table: gold.name, steps: [{ kind: "rename", column: "regiao", to: "Região" }] });
    expect(after.tables.find((x) => x.name === gold.name)!.sql).toBe(gold.sql);
  });
});
