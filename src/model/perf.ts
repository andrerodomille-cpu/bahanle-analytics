// Analisador de desempenho: cada visual registra quanto tempo levou para
// consultar o motor e quanto trabalho o motor fez (linhas percorridas, acertos
// e erros do cache de linhas filtradas, medidas avaliadas).
//
// Os registros acontecem durante a renderização; o painel é avisado depois
// (microtarefa), para não atualizar um componente enquanto outro renderiza.

export interface PerfEntry {
  visualId: string;
  title: string;
  type: string;
  /** Tempo da consulta (cálculo), sem o desenho do gráfico. */
  ms: number;
  rowsScanned: number;
  cacheHits: number;
  cacheMisses: number;
  measureEvals: number;
}

const entries = new Map<string, PerfEntry>();
const listeners = new Set<() => void>();
let snapshot: PerfEntry[] = [];
let scheduled = false;

const recordedAt = new Map<string, number>();

export function recordPerf(entry: PerfEntry) {
  // Em desenvolvimento, o StrictMode do React renderiza duas vezes seguidas: a
  // 2ª passada já encontra o cache cheio. Registros colados no tempo são a mesma
  // renderização; fica o que fez mais trabalho (a passada "fria").
  const now = performance.now();
  const prev = entries.get(entry.visualId);
  const sameRender = prev && now - (recordedAt.get(entry.visualId) ?? 0) < 50;
  recordedAt.set(entry.visualId, now);
  if (sameRender && prev.cacheMisses > entry.cacheMisses) return;
  entries.set(entry.visualId, entry);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    snapshot = [...entries.values()];
    listeners.forEach((l) => l());
  });
}

export function clearPerf() {
  entries.clear();
  snapshot = [];
  listeners.forEach((l) => l());
}

export const perfStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => snapshot,
};

type Stats = { rowsScanned: number; cacheHits: number; cacheMisses: number; measureEvals: number };

/** Mede uma função que consulta o motor e registra o resultado. */
export function measure<T>(stats: Stats, info: { visualId: string; title: string; type: string }, fn: () => T): T {
  const before = { ...stats };
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    recordPerf({
      ...info,
      ms: performance.now() - t0,
      rowsScanned: stats.rowsScanned - before.rowsScanned,
      cacheHits: stats.cacheHits - before.cacheHits,
      cacheMisses: stats.cacheMisses - before.cacheMisses,
      measureEvals: stats.measureEvals - before.measureEvals,
    });
  }
}
