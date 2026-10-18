import type { ColumnType, Relationship, Row, Table, TableQuery, Value } from "./types";
import { newId } from "./types";
import { tableFromQuery } from "./importers";

/**
 * Conector do mini-lake: busca tabelas (silver/gold em Parquet) pela API HTTP
 * do pipeline. A tabela importada guarda de onde veio (`remote`), para o
 * "Atualizar" buscar de novo e reaplicar as etapas do editor de consultas.
 */

export interface LakeConnection {
  url: string;
  /** Token da API (MINILAKE_API_TOKEN). Fica só na sessão do navegador, nunca no relatório. */
  token?: string;
}

export interface LakeTableInfo {
  layer: string;
  name: string;
  rows: number;
  bytes: number;
  updated_at: string;
  columns: { name: string; type: ColumnType; source_type: string }[];
}

interface LakeTableData {
  columns: { name: string; type: ColumnType }[];
  rows: Value[][];
  total: number;
  truncated: boolean;
  updated_at: string;
}

/** Máximo de linhas por tabela trazidas para o navegador. */
export const LAKE_ROW_LIMIT = 500_000;

export class LakeError extends Error {}

const base = (url: string) => url.trim().replace(/\/+$/, "");

async function call<T>(conn: LakeConnection, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(conn.url) + path, { headers: conn.token ? { Authorization: `Bearer ${conn.token}` } : {} });
  } catch {
    throw new LakeError(`Não conectou em ${base(conn.url)}. O servidor está rodando (minilake serve) e libera esta origem no CORS (MINILAKE_CORS)?`);
  }
  if (res.status === 401) throw new LakeError("A API pediu um token válido (MINILAKE_API_TOKEN).");
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // resposta sem JSON
    }
    throw new LakeError(`Erro ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const listLakeTables = (conn: LakeConnection) => call<LakeTableInfo[]>(conn, "/api/tables");

/** Busca uma tabela e monta a tabela do modelo (com origem e etapas, como qualquer importação). */
export async function fetchLakeTable(conn: LakeConnection, layer: string, name: string, modelName: string, steps: TableQuery["steps"] = []) {
  const r = await call<LakeTableData>(conn, `/api/tables/${encodeURIComponent(layer)}/${encodeURIComponent(name)}?limit=${LAKE_ROW_LIMIT}`);
  const columns = r.columns.map((c) => ({ name: c.name, type: c.type }));
  const rows: Row[] = r.rows.map((row) => Object.fromEntries(columns.map((c, i) => [c.name, row[i] ?? null])));
  const query: TableQuery = { origin: `mini-lake: ${layer}.${name}`, source: { columns, rows }, steps };
  const table: Table = {
    ...tableFromQuery(modelName, query),
    remote: { url: base(conn.url), layer, name, updatedAt: r.updated_at },
  };
  return { table, truncated: r.truncated, total: r.total };
}

/** Nomes com cara de chave: loja_id, LojaID, cod_cliente, produto_sk… */
const KEY_NAME = /(id|_cod|^cod_|codigo|chave|_key|_sk)$|^(cod|codigo|chave)_/i;

/**
 * Detecção automática de relacionamentos (como a do Power BI): coluna com cara
 * de chave, de mesmo nome e tipo em duas tabelas, única e sem vazios de um lado
 * ("um") e repetida do outro ("muitos") — e os valores do lado "muitos" precisam
 * existir no lado "um" (90% ou mais dos distintos), como numa chave estrangeira.
 * Sem isso, "quantidade" ou "cidade" viram relacionamentos por coincidência.
 * Não cria um segundo relacionamento entre o mesmo par de tabelas.
 */
export function detectRelationships(tables: Table[], existing: Relationship[]): Relationship[] {
  const linked = (a: string, b: string, list: Relationship[]) =>
    list.some((r) => (r.from.table === a && r.to.table === b) || (r.from.table === b && r.to.table === a));
  const unique = new Map<string, boolean>();
  const isKey = (t: Table, col: string) => {
    const k = `${t.name}\u0001${col}`;
    if (!unique.has(k)) {
      const values = t.rows.map((r) => r[col]);
      unique.set(k, values.every((v) => v !== null) && new Set(values).size === values.length);
    }
    return unique.get(k)!;
  };
  const containment = (many: Table, mc: string, one: Table, oc: string) => {
    const keys = new Set(one.rows.map((r) => String(r[oc])));
    const values = new Set(many.rows.map((r) => r[mc]).filter((v) => v !== null).map(String));
    if (!values.size) return 0;
    let found = 0;
    for (const v of values) if (keys.has(v)) found++;
    return found / values.size;
  };
  const out: Relationship[] = [];
  for (const many of tables) {
    for (const one of tables) {
      if (many === one || linked(many.name, one.name, [...existing, ...out])) continue;
      for (const c of many.columns) {
        if (!KEY_NAME.test(c.name) || c.type === "date") continue;
        const o = one.columns.find((x) => x.name.toLowerCase() === c.name.toLowerCase() && x.type === c.type);
        if (!o || !isKey(one, o.name) || isKey(many, c.name) || containment(many, c.name, one, o.name) < 0.9) continue;
        out.push({ id: newId(), from: { table: many.name, column: c.name }, to: { table: one.name, column: o.name } });
        break;
      }
    }
  }
  return out;
}

// Token por URL, só na sessão do navegador (some ao fechar a aba).
const TOKEN_KEY = (url: string) => `mini-lake-token:${base(url)}`;

export function savedToken(url: string): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY(url)) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(url: string, token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY(url), token);
    else sessionStorage.removeItem(TOKEN_KEY(url));
  } catch {
    // armazenamento indisponível: o token vale só enquanto o diálogo estiver aberto
  }
}
