import type { Visual } from "../model/types";

/**
 * Organizar visuais (menu Formatar › Alinhar/Distribuir do Power BI): cada
 * função recebe os visuais selecionados e devolve só as mudanças de posição
 * ou tamanho, prontas para a ação "updateVisuals" (um único passo de desfazer).
 */
export type Patches = Record<string, Partial<Visual>>;
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

type Box = Pick<Visual, "id" | "x" | "y" | "w" | "h">;

/** Só o que mudou: alinhar algo que já está alinhado não gera passo no histórico. */
function diff(visuals: Box[], next: (v: Box) => Partial<Box>): Patches {
  const out: Patches = {};
  for (const v of visuals) {
    const p = next(v);
    const changed = (Object.keys(p) as (keyof Box)[]).filter((k) => p[k] !== v[k]);
    if (changed.length) out[v.id] = Object.fromEntries(changed.map((k) => [k, p[k]]));
  }
  return out;
}

/** Alinha pela borda (ou centro) do conjunto, como o Power BI. */
export function alignPatches(visuals: Box[], mode: AlignMode): Patches {
  if (visuals.length < 2) return {};
  const left = Math.min(...visuals.map((v) => v.x));
  const right = Math.max(...visuals.map((v) => v.x + v.w));
  const top = Math.min(...visuals.map((v) => v.y));
  const bottom = Math.max(...visuals.map((v) => v.y + v.h));
  return diff(visuals, (v) => {
    switch (mode) {
      case "left": return { x: left };
      case "right": return { x: right - v.w };
      case "center": return { x: Math.round((left + right) / 2 - v.w / 2) };
      case "top": return { y: top };
      case "bottom": return { y: bottom - v.h };
      case "middle": return { y: Math.round((top + bottom) / 2 - v.h / 2) };
    }
  });
}

/**
 * Distribui com espaços iguais entre os visuais: o primeiro e o último ficam
 * onde estão e os do meio são reposicionados (precisa de 3 ou mais).
 */
export function distributePatches(visuals: Box[], axis: "horizontal" | "vertical"): Patches {
  if (visuals.length < 3) return {};
  const pos = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "w" : "h";
  const sorted = [...visuals].sort((a, b) => a[pos] - b[pos]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last[pos] + last[size] - first[pos];
  const used = sorted.reduce((a, v) => a + v[size], 0);
  const gap = (span - used) / (sorted.length - 1);
  const target = new Map<string, number>();
  let cursor = first[pos];
  for (const v of sorted) {
    target.set(v.id, Math.round(cursor));
    cursor += v[size] + gap;
  }
  return diff(visuals, (v) => (pos === "x" ? { x: target.get(v.id)! } : { y: target.get(v.id)! }));
}

/** Mesma largura e/ou altura do maior visual da seleção. */
export function sameSizePatches(visuals: Box[], dims: "w" | "h" | "both"): Patches {
  if (visuals.length < 2) return {};
  const w = Math.max(...visuals.map((v) => v.w));
  const h = Math.max(...visuals.map((v) => v.h));
  return diff(visuals, () => (dims === "w" ? { w } : dims === "h" ? { h } : { w, h }));
}

/** Move o conjunto inteiro (arrastar um grupo): mesma diferença para todos. */
export function movePatches(visuals: Box[], dx: number, dy: number, snap: (n: number) => number): Patches {
  // Ajusta pela grade a posição do conjunto, não de cada um: o grupo não se deforma.
  const left = Math.min(...visuals.map((v) => v.x));
  const top = Math.min(...visuals.map((v) => v.y));
  const sx = Math.max(0, snap(left + dx)) - left;
  const sy = Math.max(0, snap(top + dy)) - top;
  // Sem "diff": voltar ao ponto de partida também precisa ser aplicado.
  return Object.fromEntries(visuals.map((v) => [v.id, { x: v.x + sx, y: v.y + sy }]));
}

/** Visuais ids com os membros dos grupos incluídos (selecionar um membro seleciona o grupo). */
export function expandGroups(all: Pick<Visual, "id" | "groupId">[], ids: string[]): string[] {
  const groups = new Set(all.filter((v) => ids.includes(v.id) && v.groupId).map((v) => v.groupId));
  return all.filter((v) => ids.includes(v.id) || (v.groupId && groups.has(v.groupId))).map((v) => v.id);
}

/**
 * Ordem do layout para celular: visuais empilhados numa coluna, de cima para
 * baixo e, na mesma faixa, da esquerda para a direita. Dois visuais estão na
 * mesma faixa quando o topo de um cai dentro da metade de cima do outro.
 */
export function mobileOrder<T extends Box>(visuals: T[]): T[] {
  const sorted = [...visuals].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: T[][] = [];
  for (const v of sorted) {
    const band = bands[bands.length - 1];
    if (band && v.y < band[0].y + band[0].h / 2) band.push(v);
    else bands.push([v]);
  }
  return bands.flatMap((b) => b.sort((a, c) => a.x - c.x));
}
