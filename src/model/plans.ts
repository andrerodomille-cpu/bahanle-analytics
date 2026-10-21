// Planos (versões) e os visuais de cada um. Os planos são acumulativos: cada
// um inclui tudo o que o anterior tem. Usado pelo app (bloqueio no editor e
// na IA) e pelo site (página de planos e fichas dos visuais) — por isso este
// arquivo não importa nada além de tipos.

import type { VisualType } from "./types";

export type PlanId = "free" | "iniciante" | "intermediario" | "avancado";

export interface Plan {
  id: PlanId;
  name: string;
  /** Preço mensal em reais (0 = gratuito). */
  price: number;
  tagline: string;
  /** Visuais que este plano acrescenta aos do plano anterior. */
  adds: VisualType[];
}

export const PLANS: Plan[] = [
  {
    id: "free", name: "Gratuito", price: 0,
    tagline: "Para conhecer a ferramenta e montar os primeiros painéis.",
    adds: ["bar", "hbar", "line", "pie", "card", "table", "slicer", "text", "image"],
  },
  {
    id: "iniciante", name: "Iniciante", price: 4.99,
    tagline: "Para painéis do dia a dia, com indicadores e composição.",
    adds: ["stacked", "area", "combo", "treemap", "gauge", "kpi", "multicard", "matrix", "funnel", "button"],
  },
  {
    id: "intermediario", name: "Intermediário", price: 9.99,
    tagline: "Para análises com mapas, distribuição e comparação detalhada.",
    adds: ["stacked100", "area100", "waterfall", "pareto", "dumbbell", "scatter", "heatmap", "histogram", "calendar",
      "map", "bubblemap", "bullet", "fieldparam"],
  },
  {
    id: "avancado", name: "Avançado", price: 19.99,
    tagline: "Para análise completa: estatística, fluxos, simulação e análise automática.",
    adds: ["boxplot", "violin", "radar", "sankey", "sunburst", "waffle", "pictogram", "bump", "gantt",
      "influencers", "decomp", "narrative", "whatif"],
  },
];

export const PLAN_IDS = PLANS.map((p) => p.id);

export const planById = (id: string | undefined): Plan | undefined => PLANS.find((p) => p.id === id);

/** Plano em que o visual entra pela primeira vez. */
export function planOfVisual(type: VisualType): Plan {
  return PLANS.find((p) => p.adds.includes(type)) ?? PLANS[PLANS.length - 1];
}

/** Visuais liberados no plano (os dele e os dos anteriores). */
export function visualsOf(plan: PlanId): VisualType[] {
  const out: VisualType[] = [];
  for (const p of PLANS) {
    out.push(...p.adds);
    if (p.id === plan) break;
  }
  return out;
}

/**
 * Papel da conta → o que ela pode usar. Administradores usam tudo; papel
 * desconhecido (ou sem login) fica no gratuito.
 */
export function allowedVisuals(role: string | undefined): Set<VisualType> {
  if (role === "admin") return new Set(visualsOf("avancado"));
  return new Set(visualsOf(planById(role)?.id ?? "free"));
}

/** "R$ 4,99" (ou "Grátis"). */
export const formatPrice = (price: number) =>
  price === 0 ? "Grátis" : `R$ ${price.toFixed(2).replace(".", ",")}`;
