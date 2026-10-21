import { createContext, useContext } from "react";
import type { VisualType } from "./types";
import { allowedVisuals, planOfVisual, type Plan } from "./plans";

export interface PlanAccess {
  /** Visuais que a conta pode adicionar. */
  allowed: Set<VisualType>;
  /** Plano em que o visual é liberado (para a mensagem do cadeado). */
  requiredFor: (type: VisualType) => Plan;
}

export const planAccess = (role: string | undefined): PlanAccess => ({
  allowed: allowedVisuals(role),
  requiredFor: planOfVisual,
});

/**
 * Sem conta (relatório publicado ou servidor sem login), tudo liberado: o
 * bloqueio vale para quem está logado, conforme o plano.
 */
export const PlanContext = createContext<PlanAccess>(planAccess("admin"));

export const usePlan = () => useContext(PlanContext);
