// Consultas dos mapas. Usam o mesmo contexto de filtro dos outros visuais.

import { Engine, contextFor, runVisual, valueKey } from "./query";
import type { Measure, Report, Value, Visual } from "../model/types";
import { statesFor } from "../model/geo/geo";

export interface ChoroplethResult {
  /** Valor da medida por código IBGE da UF. */
  byState: Map<number, { value: number | null; category: Value }>;
  /** Valores do campo de localização que não correspondem a nenhuma UF ou região. */
  unmatched: Value[];
}

/**
 * Mapa coroplético: a medida por valor do campo de localização, pintando a UF
 * correspondente. Se o campo for a região, todos os estados dela recebem o
 * valor da região.
 */
export function runChoropleth(engine: Engine, report: Report, visual: Visual): ChoroplethResult {
  const result = runVisual(engine, report, visual);
  if (result.error) throw new Error(result.error);
  const byState = new Map<number, { value: number | null; category: Value }>();
  const unmatched: Value[] = [];
  for (const r of result.rows) {
    const states = statesFor(r.category);
    if (states.length === 0) unmatched.push(r.category);
    for (const s of states) byState.set(s.code, { value: r.values[0], category: r.category });
  }
  return { byState, unmatched };
}

export interface Bubble {
  category: Value;
  lon: number;
  lat: number;
  size: number | null;
  color: number | null;
}

export interface BubbleResult {
  bubbles: Bubble[];
  /** Categorias sem coordenadas (nem latitude/longitude nem UF reconhecida). */
  unplaced: Value[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Mapa de bolhas: uma bolha por valor do eixo, na posição da média da latitude
 * e longitude das linhas daquela categoria. Sem campos de latitude/longitude,
 * a bolha vai para o centro da UF (ou região) que o valor representa.
 */
export function runBubbles(engine: Engine, report: Report, visual: Visual, measures: Measure[]): BubbleResult {
  const result = runVisual(engine, report, visual);
  if (result.error) throw new Error(result.error);
  const axis = visual.axis!;
  const context = contextFor(report, visual);
  const { latField, lonField } = visual;
  const bubbles: Bubble[] = [];
  const unplaced: Value[] = [];
  const coord = (field: NonNullable<Visual["latField"]>, category: Value) => {
    const rows = engine.rows(field.table, [...context, { field: axis, keys: new Set([valueKey(category)]) }]);
    return avg(rows.map((r) => Number(r[field.column])).filter((n) => Number.isFinite(n)));
  };
  for (const r of result.rows) {
    let lat: number | null = null;
    let lon: number | null = null;
    if (latField && lonField) {
      lat = coord(latField, r.category);
      lon = coord(lonField, r.category);
    } else {
      const states = statesFor(r.category);
      if (states.length) {
        lon = avg(states.map((s) => s.label[0]));
        lat = avg(states.map((s) => s.label[1]));
      }
    }
    if (lat === null || lon === null) {
      unplaced.push(r.category);
      continue;
    }
    bubbles.push({ category: r.category, lat, lon, size: r.values[0], color: measures[1] ? r.values[1] : null });
  }
  return { bubbles: bubbles.sort((a, b) => (b.size ?? 0) - (a.size ?? 0)), unplaced };
}
