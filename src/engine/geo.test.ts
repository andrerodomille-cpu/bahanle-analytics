import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { STATES, statesFor } from "../model/geo/geo";
import { Engine } from "./query";
import { runBubbles, runChoropleth } from "./geo";
import { sampleReport } from "../model/sampleData";
import { TextVisual } from "../components/MoreVisuals";

describe("estados", () => {
  it("27 UFs com contorno e rótulo dentro do Brasil", () => {
    expect(STATES).toHaveLength(27);
    for (const s of STATES) {
      expect(s.rings.length).toBeGreaterThan(0);
      expect(s.label[0]).toBeGreaterThan(-75);
      expect(s.label[0]).toBeLessThan(-28);
      expect(s.label[1]).toBeGreaterThan(-34);
      expect(s.label[1]).toBeLessThan(6);
    }
  });

  it("reconhece sigla, nome (com ou sem acento), código IBGE e região", () => {
    expect(statesFor("SP").map((s) => s.code)).toEqual([35]);
    expect(statesFor("sao paulo").map((s) => s.uf)).toEqual(["SP"]);
    expect(statesFor("Pará").map((s) => s.uf)).toEqual(["PA"]);
    expect(statesFor(43).map((s) => s.uf)).toEqual(["RS"]);
    expect(statesFor("Sul").map((s) => s.uf).sort()).toEqual(["PR", "RS", "SC"]);
    expect(statesFor("Centro-Oeste")).toHaveLength(4);
    expect(statesFor("Atlântida")).toEqual([]);
  });
});

describe("mapas do exemplo", () => {
  const report = sampleReport();
  const engine = new Engine(report);
  const v = (id: string) => report.visuals.find((x) => x.id === id)!;
  const fat = report.measures.find((m) => m.name === "Faturamento")!;

  it("coroplético por UF: só os estados com lojas têm valor, e a soma bate com o total", () => {
    const r = runChoropleth(engine, report, v("g1"));
    expect([...r.byState.keys()].sort()).toEqual([23, 26, 31, 33, 35, 41, 43]);
    const sum = [...r.byState.values()].reduce((a, s) => a + (s.value ?? 0), 0);
    expect(sum).toBeCloseTo(engine.evaluateMeasure(fat, [])!, 2);
    expect(r.unmatched).toEqual([]);
  });

  it("coroplético por região: todos os estados da região recebem o valor dela", () => {
    const r = runChoropleth(engine, report, v("g2"));
    expect(r.byState.get(42)?.category).toBe("Sul"); // SC não tem loja, mas é do Sul
    expect(r.byState.get(42)?.value).toBe(r.byState.get(43)?.value);
    expect(r.byState.has(51)).toBe(false); // Centro-Oeste: sem vendas
  });

  it("bolhas: posição pela latitude/longitude da loja, ou pelo centro da UF", () => {
    const r = runBubbles(engine, report, v("g3"), [fat]);
    expect(r.bubbles).toHaveLength(8);
    const aldeota = r.bubbles.find((b) => b.category === "Loja Aldeota")!;
    expect(aldeota.lat).toBeCloseTo(-3.737);
    const byUf = runBubbles(engine, report, { ...v("g3"), axis: { table: "Lojas", column: "UF" }, latField: undefined, lonField: undefined }, [fat]);
    expect(byUf.bubbles.map((b) => b.category).sort()).toEqual(["CE", "MG", "PE", "PR", "RJ", "RS", "SP"]);
    expect(byUf.unplaced).toEqual([]);
  });
});

describe("caixa de texto", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(TextVisual, { text }));

  it("listas, ênfase e links https", () => {
    const out = html("- um\n- **dois**\n*três* [IBGE](https://www.ibge.gov.br)");
    expect(out).toContain("<ul><li>um</li><li><strong>dois</strong></li></ul>");
    expect(out).toContain("<em>três</em>");
    expect(out).toContain('<a href="https://www.ibge.gov.br" target="_blank" rel="noopener noreferrer">IBGE</a>');
  });

  it("links que não são http(s) viram só texto", () => {
    const out = html("[clique](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("javascript:");
  });
});
