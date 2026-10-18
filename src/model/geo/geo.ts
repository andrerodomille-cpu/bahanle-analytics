import { BRAZIL_STATES, type StateShape } from "./brazilStates";
import type { Value } from "../types";

// Projeção equirretangular com correção de latitude: longitude encolhida por
// cos(15°S), a latitude média do Brasil. Para um país, a distorção é pequena e
// a conta é trivial — o suficiente para mapas temáticos.

const COS = Math.cos((15 * Math.PI) / 180);
const SCALE = 20; // unidades do viewBox por grau de latitude

export const project = (lon: number, lat: number): [number, number] => [lon * COS * SCALE, -lat * SCALE];

const all = BRAZIL_STATES.flatMap((s) => s.rings.flat().map(([lon, lat]) => project(lon, lat)));
const PAD = 12;
const minX = Math.min(...all.map((p) => p[0])) - PAD;
const minY = Math.min(...all.map((p) => p[1])) - PAD;
const maxX = Math.max(...all.map((p) => p[0])) + PAD;
const maxY = Math.max(...all.map((p) => p[1])) + PAD;

/** viewBox do SVG que enquadra o Brasil. */
export const VIEWBOX = `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`;
export const VIEW_WIDTH = maxX - minX;

/** Caminho SVG de cada estado (calculado uma vez). */
export const STATE_PATHS: Map<number, string> = new Map(
  BRAZIL_STATES.map((s) => [
    s.code,
    s.rings
      .map((r) => "M" + r.map(([lon, lat]) => project(lon, lat).map((v) => v.toFixed(1)).join(",")).join("L") + "Z")
      .join(""),
  ]),
);

export const STATES = BRAZIL_STATES;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const BY_KEY = new Map<string, StateShape>();
for (const s of BRAZIL_STATES) {
  for (const k of [s.uf, s.name, String(s.code)]) BY_KEY.set(normalize(k), s);
}
const REGIONS = new Map<string, StateShape[]>();
for (const s of BRAZIL_STATES) {
  const k = normalize(s.region);
  REGIONS.set(k, [...(REGIONS.get(k) ?? []), s]);
}

/**
 * Estados representados por um valor do campo de localização: aceita sigla
 * ("SP"), nome ("São Paulo", com ou sem acento), código do IBGE (35) ou região
 * ("Sudeste" → todos os estados da região).
 */
export function statesFor(v: Value): StateShape[] {
  if (v === null || v === "") return [];
  const k = normalize(String(v));
  const one = BY_KEY.get(k);
  if (one) return [one];
  return REGIONS.get(k) ?? [];
}
