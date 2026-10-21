import { describe, expect, it } from "vitest";
import { VISUAL_TYPES } from "../components/Panels";
import { allowedVisuals, formatPrice, PLANS, planOfVisual, visualsOf } from "./plans";

describe("planos", () => {
  it("cada um dos 45 visuais está em exatamente um plano", () => {
    const all = PLANS.flatMap((p) => p.adds);
    expect(all).toHaveLength(45);
    expect(new Set(all).size).toBe(45);
    expect(new Set(all)).toEqual(new Set(VISUAL_TYPES.map((v) => v.type)));
  });

  it("os planos são acumulativos e têm os preços combinados", () => {
    expect(PLANS.map((p) => [p.id, p.price])).toEqual([["free", 0], ["iniciante", 4.99], ["intermediario", 9.99], ["avancado", 19.99]]);
    expect(visualsOf("free")).toHaveLength(9);
    expect(visualsOf("iniciante")).toHaveLength(19);
    expect(visualsOf("intermediario")).toHaveLength(32);
    expect(visualsOf("avancado")).toHaveLength(45);
    expect(planOfVisual("map").id).toBe("intermediario");
    expect(formatPrice(4.99)).toBe("R$ 4,99");
    expect(formatPrice(0)).toBe("Grátis");
  });

  it("papel → visuais liberados", () => {
    expect(allowedVisuals("admin").size).toBe(45);
    expect(allowedVisuals("avancado").size).toBe(45);
    expect(allowedVisuals("iniciante").has("kpi")).toBe(true);
    expect(allowedVisuals("iniciante").has("map")).toBe(false);
    expect(allowedVisuals(undefined).size).toBe(9);
    expect(allowedVisuals("papel-estranho").has("sankey")).toBe(false);
  });
});
