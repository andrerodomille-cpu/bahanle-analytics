import { describe, expect, it } from "vitest";
import { Session, parseScript, planText, tokenize } from "./sql";
import type { PlanNode } from "./sql";
import { sampleReport } from "../model/sampleData";
import type { Table } from "../model/types";

const report = sampleReport();
const session = () => new Session(report.tables);

/** Executa e devolve o último resultado (falha o teste se houver erro). */
function run(sql: string, s = session()) {
  const r = s.run(sql);
  if (r.error) throw new Error(r.error.message);
  return r.results[r.results.length - 1];
}

function runError(sql: string) {
  const r = session().run(sql);
  expect(r.error).toBeDefined();
  return r.error!.message;
}

const vendas = report.tables.find((t) => t.name === "Vendas")!;
const total = vendas.rows.reduce((a, r) => a + (r.Valor as number), 0);

function find(p: PlanNode, op: string): PlanNode | undefined {
  if (p.op.startsWith(op)) return p;
  for (const c of p.children) {
    const f = find(c, op);
    if (f) return f;
  }
  return undefined;
}

describe("análise léxica e sintática", () => {
  it("tokens: crases, aspas com escape, comentários e números", () => {
    const t = tokenize("SELECT `Minha col`, 'it''s', 1.5e2 -- fim\n/* bloco */ FROM x");
    expect(t.map((x) => x.v)).toEqual(["SELECT", "Minha col", ",", "it's", ",", "1.5e2", "FROM", "x", ""]);
  });
  it("vários comandos separados por ponto e vírgula, com o texto de cada um", () => {
    const s = parseScript("SELECT 1; ; SELECT 2 AS dois;");
    expect(s.map((x) => x.text)).toEqual(["SELECT 1", "SELECT 2 AS dois"]);
  });
  it("erros apontam a posição", () => {
    const r = session().run("SELECT FROM Vendas");
    expect(r.error?.message).toMatch(/expressão/);
  });
});

describe("consultas", () => {
  it("SELECT sem FROM, aritmética, CASE e funções", () => {
    const r = run("SELECT 1 + 2 * 3 AS x, CASE WHEN 2 > 1 THEN 'sim' ELSE 'não' END AS y, UPPER('ação') u, ROUND(2.345, 2) r, 10 / 0 AS d");
    expect(r.rows).toEqual([[7, "sim", "AÇÃO", 2.35, null]]);
    expect(r.columns.map((c) => c.name)).toEqual(["x", "y", "u", "r", "d"]);
  });

  it("agregação sem GROUP BY bate com a soma das linhas", () => {
    const r = run("SELECT COUNT(*) AS n, SUM(Valor) AS total, MIN(Data) primeira FROM Vendas");
    expect(r.rows[0][0]).toBe(vendas.rows.length);
    expect(r.rows[0][1] as number).toBeCloseTo(total, 4);
    expect(r.rows[0][2]).toBe(vendas.rows.map((x) => x.Data as string).sort()[0]);
  });

  it("JOIN + GROUP BY + ORDER BY bate com a medida do BI", () => {
    const r = run(`
      SELECT l.Região, SUM(v.Valor) AS faturamento, COUNT(DISTINCT v.LojaID) lojas
      FROM Vendas v JOIN Lojas l ON v.LojaID = l.LojaID
      GROUP BY l.Região
      ORDER BY faturamento DESC`);
    const sum = r.rows.reduce((a, x) => a + (x[1] as number), 0);
    expect(sum).toBeCloseTo(total, 4);
    expect(r.rows[0][0]).toBe("Sudeste");
    const values = r.rows.map((x) => x[1] as number);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("predicate pushdown e hash join aparecem no plano", () => {
    const r = run(`
      SELECT p.Categoria, SUM(v.Valor) FROM Vendas v
      JOIN Produtos p ON p.ProdutoID = v.ProdutoID
      WHERE v.Valor >= 5000 AND p.Categoria <> 'Telefonia'
      GROUP BY 1`);
    const plan = r.plan!;
    const pushed = find(plan, "Filtro empurrado")!;
    expect(pushed).toBeDefined();
    expect(find(plan, "Hash join INNER")).toBeDefined();
    // Nenhum filtro sobrou depois da junção: os dois desceram até as leituras.
    const ops: string[] = [];
    const visit = (n: PlanNode) => { ops.push(n.op); n.children.forEach(visit); };
    visit(plan);
    expect(ops).not.toContain("Filtro");
    expect(ops.filter((o) => o.startsWith("Filtro empurrado"))).toHaveLength(2);
    expect(planText(plan)).toMatch(/└─/);
    expect(r.rows.every((x) => x[0] !== "Telefonia")).toBe(true);
  });

  it("LEFT JOIN mantém quem não tem par, e o filtro do lado opcional não desce", () => {
    const s = new Session([
      ...report.tables,
      { name: "A", columns: [{ name: "id", type: "number" }], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] } as Table,
      { name: "B", columns: [{ name: "id", type: "number" }, { name: "x", type: "text" }], rows: [{ id: 1, x: "um" }, { id: 3, x: "três" }] } as Table,
    ]);
    const r = run("SELECT a.id, b.x FROM A a LEFT JOIN B b ON a.id = b.id ORDER BY a.id", s);
    expect(r.rows).toEqual([[1, "um"], [2, null], [3, "três"]]);
    const f = run("SELECT a.id FROM A a LEFT JOIN B b ON a.id = b.id WHERE b.x IS NULL", s);
    expect(f.rows).toEqual([[2]]);
    const full = run("SELECT COUNT(*) FROM B b FULL JOIN A a ON a.id = b.id", s);
    expect(full.rows).toEqual([[3]]);
  });

  it("WITH, HAVING, IN com subconsulta, BETWEEN, LIKE e DISTINCT", () => {
    const r = run(`
      WITH grandes AS (SELECT ProdutoID, SUM(Valor) AS v FROM Vendas GROUP BY ProdutoID HAVING SUM(Valor) > 1000000)
      SELECT DISTINCT Categoria FROM Produtos
      WHERE ProdutoID IN (SELECT ProdutoID FROM grandes) AND Produto LIKE '%e%' AND Preço BETWEEN 100 AND 100000
      ORDER BY 1`);
    expect(r.rows.length).toBeGreaterThan(0);
    const cats = r.rows.map((x) => x[0]);
    expect(new Set(cats).size).toBe(cats.length);
  });

  it("funções de janela: ranking por partição e acumulado", () => {
    const r = run(`
      SELECT l.Região, l.Loja, SUM(v.Valor) AS fat,
             RANK() OVER (PARTITION BY l.Região ORDER BY SUM(v.Valor) DESC) AS pos,
             SUM(SUM(v.Valor)) OVER (PARTITION BY l.Região) AS total_regiao
      FROM Vendas v JOIN Lojas l ON v.LojaID = l.LojaID
      GROUP BY l.Região, l.Loja
      ORDER BY l.Região, pos`);
    const regions = new Map<string, { pos: number[]; fat: number; total: number }>();
    for (const [reg, , fat, pos, tot] of r.rows) {
      const g = regions.get(reg as string) ?? { pos: [], fat: 0, total: tot as number };
      g.pos.push(pos as number);
      g.fat += fat as number;
      regions.set(reg as string, g);
    }
    for (const g of regions.values()) {
      expect(g.pos[0]).toBe(1);
      expect(g.fat).toBeCloseTo(g.total, 4);
    }
    const acc = run("SELECT x, SUM(x) OVER (ORDER BY x) s, LAG(x) OVER (ORDER BY x) ant, ROW_NUMBER() OVER (ORDER BY x DESC) n FROM (SELECT 1 x UNION ALL SELECT 2 UNION ALL SELECT 2 UNION ALL SELECT 3) t ORDER BY x, n");
    // Empates entram juntos no acumulado (moldura RANGE).
    expect(acc.rows.map((x) => x[1])).toEqual([1, 5, 5, 8]);
    expect(acc.rows.map((x) => x[2])).toEqual([null, 1, 2, 2]);
  });

  it("datas: funções, DATE_TRUNC e aritmética de dias", () => {
    const r = run("SELECT YEAR(d), MONTH(d), QUARTER(d), DATE_TRUNC('month', d), d + 30, DATEDIFF('2026-03-01', d), DATE_FORMAT(d, 'MM/yyyy') FROM (SELECT DATE '2026-02-15' AS d) t");
    expect(r.rows[0]).toEqual([2026, 2, 1, "2026-02-01", "2026-03-17", 14, "02/2026"]);
    expect(r.columns[3].type).toBe("date");
  });

  it("NULL em três valores, COALESCE, CAST e TRY_CAST", () => {
    const r = run("SELECT NULL = NULL, NULL OR TRUE, NULL AND FALSE, COALESCE(NULL, 'b'), CAST('42' AS INT) + 1, TRY_CAST('x' AS INT), CAST(1.005 AS DECIMAL(10,2))");
    expect(r.rows[0]).toEqual([null, "true", "false", "b", 43, null, 1.01]);
  });

  it("mensagens de erro claras", () => {
    expect(runError("SELECT Loja, SUM(Valor) FROM Vendas JOIN Lojas ON Vendas.LojaID = Lojas.LojaID")).toMatch(/GROUP BY/);
    expect(runError("SELECT LojaID FROM Vendas JOIN Lojas ON Vendas.LojaID = Lojas.LojaID")).toMatch(/ambígua/);
    expect(runError("SELECT * FROM Nada")).toMatch(/não encontrada/);
    expect(runError("SELECT Valr FROM Vendas")).toMatch(/Valor/);
    expect(runError("SELECT * FROM Vendas WHERE SUM(Valor) > 1")).toMatch(/HAVING/);
  });
});

describe("comandos e sessão", () => {
  it("CREATE TABLE AS devolve a tabela para o modelo; a sessão já enxerga", () => {
    const s = session();
    const r = s.run(`
      CREATE OR REPLACE TABLE gold_mensal AS
        SELECT DATE_TRUNC('month', Data) AS mes, SUM(Valor) AS faturamento FROM Vendas GROUP BY 1;
      SELECT COUNT(*), SUM(faturamento) FROM gold_mensal`);
    expect(r.error).toBeUndefined();
    const created = r.results[0].effect;
    expect(created?.kind).toBe("createTable");
    const t = (created as { table: Table }).table;
    expect(t.columns).toEqual([{ name: "mes", type: "date" }, { name: "faturamento", type: "number" }]);
    expect(t.sql).toMatch(/^CREATE OR REPLACE TABLE gold_mensal/);
    expect(r.results[1].rows[0][0]).toBe(24);
    expect(r.results[1].rows[0][1] as number).toBeCloseTo(total, 4);
    expect(s.run("CREATE TABLE gold_mensal AS SELECT 1").error?.message).toMatch(/já existe/);
  });

  it("visão temporária, SHOW TABLES, DESCRIBE e DROP", () => {
    const s = session();
    run("CREATE TEMP VIEW caras AS SELECT * FROM Produtos WHERE Preço > 1000", s);
    expect(run("SELECT COUNT(*) FROM caras", s).rows[0][0]).toBeGreaterThan(0);
    const show = run("SHOW TABLES", s);
    expect(show.rows.find((x) => x[0] === "caras")?.[1]).toBe("visão temporária");
    const desc = run("DESCRIBE Vendas", s);
    expect(desc.rows.find((x) => x[0] === "Valor")?.[1]).toBe("double");
    expect(desc.rows.find((x) => x[0] === "Data")?.[1]).toBe("date");
    expect(run("DROP VIEW caras", s).message).toMatch(/removida/);
    expect(s.run("SELECT * FROM caras").error).toBeDefined();
    expect(run("DROP TABLE IF EXISTS nao_existe", s).message).toMatch(/Nada/);
  });

  it("EXPLAIN mostra o plano em texto", () => {
    const r = run("EXPLAIN SELECT Loja FROM Lojas WHERE Região = 'Sul' ORDER BY Loja LIMIT 2");
    const text = r.rows.map((x) => x[0]).join("\n");
    expect(text).toMatch(/^Limite/);
    expect(text).toMatch(/Ordenação/);
    expect(text).toMatch(/Leitura \[Lojas\]/);
  });
});
