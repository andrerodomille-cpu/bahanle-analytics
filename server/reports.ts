// Relatórios na nuvem: cada usuário (e-mail do login) salva e abre os seus
// relatórios num Postgres (Neon em produção). O relatório inteiro vai numa
// coluna jsonb; `version` impede que duas abas sobrescrevam uma à outra.

import { randomUUID } from "node:crypto";
import type { AuthedRequest } from "./auth.ts";
import { HttpError, json, readJson, type Next } from "./http.ts";
import { withSchema, type Pool } from "./db.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface ReportSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** Tamanho ocupado no banco, em bytes. */
  size: number;
}

export interface StoredReport extends ReportSummary {
  data: unknown;
}

export interface ReportStore {
  list(owner: string): Promise<ReportSummary[]>;
  get(owner: string, id: string): Promise<StoredReport | null>;
  create(owner: string, name: string, data: unknown): Promise<ReportSummary>;
  /** "missing": não existe (ou é de outra pessoa); "conflict": alguém salvou uma versão mais nova. */
  update(owner: string, id: string, patch: { name?: string; data?: unknown; version: number }): Promise<ReportSummary | "missing" | "conflict">;
  remove(owner: string, id: string): Promise<boolean>;
}

// ---------------- Postgres ----------------

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id         uuid        PRIMARY KEY,
  owner      text        NOT NULL,
  name       text        NOT NULL,
  data       jsonb       NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_owner_updated_idx ON reports (owner, updated_at DESC);
`;

const SUMMARY = "id, name, version, updated_at, pg_column_size(data) AS size";

interface Row {
  id: string;
  name: string;
  version: number;
  updated_at: Date;
  size: number;
  data?: unknown;
}

const summary = (r: Row): ReportSummary => ({
  id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at.toISOString(), size: Number(r.size),
});

/** Postgres não guarda o caractere nulo (\u0000) em jsonb: vira um erro claro em vez de 500. */
function toJsonb(data: unknown): string {
  const text = JSON.stringify(data);
  if (/(^|[^\\])(\\\\)*\\u0000/.test(text)) throw new HttpError(400, "O relatório tem um caractere nulo (\\u0000) em algum texto; o banco não aceita.");
  return text;
}

export function pgReportStore(pool: Pool): ReportStore {
  const q = withSchema(pool, SCHEMA);

  return {
    async list(owner) {
      const r = await q<Row>(`SELECT ${SUMMARY} FROM reports WHERE owner = $1 ORDER BY updated_at DESC`, [owner]);
      return r.rows.map(summary);
    },
    async get(owner, id) {
      const r = await q<Row>(`SELECT ${SUMMARY}, data FROM reports WHERE owner = $1 AND id = $2`, [owner, id]);
      return r.rows[0] ? { ...summary(r.rows[0]), data: r.rows[0].data } : null;
    },
    async create(owner, name, data) {
      const r = await q<Row>(
        `INSERT INTO reports (id, owner, name, data) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${SUMMARY}`,
        [randomUUID(), owner, name, toJsonb(data)],
      );
      return summary(r.rows[0]);
    },
    async update(owner, id, { name, data, version }) {
      const r = await q<Row>(
        `UPDATE reports SET name = COALESCE($3, name), data = COALESCE($4::jsonb, data), version = version + 1, updated_at = now()
         WHERE owner = $1 AND id = $2 AND version = $5 RETURNING ${SUMMARY}`,
        [owner, id, name ?? null, data === undefined ? null : toJsonb(data), version],
      );
      if (r.rows[0]) return summary(r.rows[0]);
      const exists = await q(`SELECT 1 FROM reports WHERE owner = $1 AND id = $2`, [owner, id]);
      return exists.rowCount ? "conflict" : "missing";
    },
    async remove(owner, id) {
      const r = await q(`DELETE FROM reports WHERE owner = $1 AND id = $2`, [owner, id]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}

// ---------------- Rotas ----------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name || name.length > 120) throw new HttpError(400, "Dê um nome de 1 a 120 caracteres ao relatório.");
  return name;
}

/** O mínimo para ser um relatório do Bahanle Analytics (o app completa o resto ao abrir, em migrate). */
function validReport(v: unknown): object {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.tables) || !Array.isArray(r.visuals) || !Array.isArray(r.measures)) {
    throw new HttpError(400, "Conteúdo não é um relatório do Bahanle Analytics.");
  }
  return r;
}

/**
 * /api/reports            GET lista · POST cria {name, data}
 * /api/reports/:id        GET abre · PUT salva {name?, data?, version} · DELETE exclui
 * Cada usuário só enxerga os próprios relatórios (dono = e-mail do login).
 */
export function reportsApi(store: ReportStore | null, opts: { maxBytes?: number } = {}) {
  const maxBytes = opts.maxBytes ?? 10 * 1_048_576;
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? "/").split("?")[0];
    const m = /^\/api\/reports(?:\/([^/]*))?\/?$/.exec(path);
    if (!path.startsWith("/api/reports")) return next();
    try {
      const user = (req as AuthedRequest).user;
      if (!user) throw new HttpError(401, "Faça login.");
      if (!store) throw new HttpError(503, "Relatórios na nuvem desligados: defina DATABASE_URL no .env.");
      if (!m) throw new HttpError(404, "Rota não encontrada.");
      const owner = user.email.toLowerCase();
      const id = m[1];

      if (id === undefined) {
        if (req.method === "GET") return json(res, 200, await store.list(owner));
        if (req.method === "POST") {
          const body = await readJson<{ name?: unknown; data?: unknown }>(req, maxBytes);
          return json(res, 201, await store.create(owner, validName(body.name), validReport(body.data)));
        }
        throw new HttpError(405, "Método não permitido.");
      }

      if (!UUID.test(id)) throw new HttpError(404, "Relatório não encontrado.");
      if (req.method === "GET") {
        const r = await store.get(owner, id);
        if (!r) throw new HttpError(404, "Relatório não encontrado.");
        return json(res, 200, r);
      }
      if (req.method === "PUT") {
        const body = await readJson<{ name?: unknown; data?: unknown; version?: unknown }>(req, maxBytes);
        if (!Number.isInteger(body.version)) throw new HttpError(400, "Informe a versão (version) que você abriu.");
        const r = await store.update(owner, id, {
          name: body.name === undefined ? undefined : validName(body.name),
          data: body.data === undefined ? undefined : validReport(body.data),
          version: body.version as number,
        });
        if (r === "missing") throw new HttpError(404, "Relatório não encontrado.");
        if (r === "conflict") throw new HttpError(409, "Este relatório foi salvo em outro lugar depois que você o abriu.");
        return json(res, 200, r);
      }
      if (req.method === "DELETE") {
        if (!(await store.remove(owner, id))) throw new HttpError(404, "Relatório não encontrado.");
        return json(res, 204, undefined);
      }
      throw new HttpError(405, "Método não permitido.");
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      next(e);
    }
  };
}
