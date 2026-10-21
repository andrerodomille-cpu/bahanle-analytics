// Cliente da API de relatórios (server/reports.ts): salvar e abrir relatórios
// na conta do usuário logado. O app guarda qual relatório da nuvem está aberto
// (id, nome e versão) para o próximo "Salvar" atualizar o mesmo registro.

import type { Report } from "./types";
import { accountKey, migrate, readAccountItem } from "./store";

export interface CloudSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  size: number;
}

/** Relatório da nuvem aberto no editor. */
export interface CloudLink {
  id: string;
  name: string;
  version: number;
}

export class CloudError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/reports${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new CloudError(0, "Sem conexão com o servidor.");
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // resposta sem JSON
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Erro ${res.status}.`;
    throw new CloudError(res.status, res.status === 401 ? "Sua sessão expirou. Recarregue a página e entre de novo." : msg);
  }
  return body as T;
}

/**
 * O que vai para o banco: o relatório sem o estado da sessão (seleções nos
 * gráficos e drill-through ativo), como no "Salvar relatório (.json)".
 */
export function toCloudData(report: Report): Report {
  return { ...report, filters: [], drillthrough: undefined };
}

export const listCloudReports = () => call<CloudSummary[]>("");

export async function openCloudReport(id: string): Promise<{ link: CloudLink; report: Report }> {
  const r = await call<CloudSummary & { data: Report }>(`/${id}`);
  return { link: { id: r.id, name: r.name, version: r.version }, report: migrate({ ...r.data, filters: [] }) };
}

export async function createCloudReport(name: string, report: Report): Promise<CloudLink> {
  const r = await call<CloudSummary>("", { method: "POST", body: { name, data: toCloudData(report) } });
  return { id: r.id, name: r.name, version: r.version };
}

/** Salva por cima da versão aberta; 409 (CloudError) se alguém salvou depois. `force` sobrescreve mesmo assim. */
export async function saveCloudReport(link: CloudLink, report: Report, force = false): Promise<CloudLink> {
  let version = link.version;
  if (force) version = (await call<CloudSummary>(`/${link.id}`)).version;
  const r = await call<CloudSummary>(`/${link.id}`, { method: "PUT", body: { data: toCloudData(report), version } });
  return { id: r.id, name: r.name, version: r.version };
}

export async function renameCloudReport(id: string, name: string, version: number): Promise<CloudSummary> {
  return call<CloudSummary>(`/${id}`, { method: "PUT", body: { name, version } });
}

export const deleteCloudReport = (id: string) => call<void>(`/${id}`, { method: "DELETE" });

// O vínculo sobrevive a recarregar a página (o relatório em si já fica no
// localStorage), separado por conta como o rascunho.
const LINK_KEY = "mini-bi-cloud-link";

export function loadLink(owner?: string): CloudLink | null {
  try {
    const l = JSON.parse(readAccountItem(LINK_KEY, owner) ?? "null") as CloudLink | null;
    return l && typeof l.id === "string" && typeof l.version === "number" ? l : null;
  } catch {
    return null;
  }
}

export function storeLink(link: CloudLink | null, owner?: string) {
  try {
    if (link) localStorage.setItem(accountKey(LINK_KEY, owner), JSON.stringify(link));
    else localStorage.removeItem(accountKey(LINK_KEY, owner));
  } catch {
    // sem armazenamento: o vínculo vale só até recarregar
  }
}

/** Estado da sessão: muda ao clicar nos gráficos, mas não vai para a nuvem. */
const SESSION_KEYS = new Set<string>(["filters", "drillthrough"]);

/**
 * O conteúdo mudou desde `saved`? O reducer só troca a referência do que
 * mudou, então basta comparar campo a campo (sem percorrer os dados).
 */
export function contentChanged(saved: Report, current: Report): boolean {
  if (saved === current) return false;
  const a = saved as unknown as Record<string, unknown>;
  const b = current as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!SESSION_KEYS.has(k) && a[k] !== b[k]) return true;
  }
  return false;
}
