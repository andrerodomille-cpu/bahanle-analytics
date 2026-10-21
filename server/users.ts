// Quem pode entrar: qualquer conta Google. No primeiro login a pessoa é
// cadastrada na hora, ativa, no plano "free". O papel de cada conta é o plano
// dela (free, iniciante, intermediario ou avancado — ver src/model/plans.ts)
// ou "admin". Administradores vêm do .env (ADMIN_EMAILS) ou da tela Usuários,
// onde também se troca o plano e se bloqueia alguém.
//
// Sem banco, vale o mesmo, mas nada fica guardado: ADMIN_EMAILS são
// administradores, ALLOWED_EMAILS entram no plano avançado e o resto no free.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthConfig, AuthedRequest } from "./auth.ts";
import { isAllowed } from "./auth.ts";
import { withSchema, type Pool } from "./db.ts";
import { HttpError, json, readJson, type Next } from "./http.ts";
import { PLAN_IDS, type PlanId } from "../src/model/plans.ts";

/** O plano da conta ou "admin". "free" é o de quem se cadastra sozinho. */
export type Role = "admin" | PlanId;
/** "pending" só existe em cadastros antigos (antes do cadastro aberto); a migração os ativa. */
export type UserStatus = "active" | "pending" | "blocked";

export const ROLES: Role[] = ["admin", ...PLAN_IDS];
export const DEFAULT_ROLE: Role = "free";

export interface Profile {
  email: string;
  name: string;
  picture?: string;
}

export type LoginResult =
  | { ok: true; role: Role }
  /** pending: aviso que não é erro (mantido para o site, que mostra em amarelo). */
  | { ok: false; reason: string; pending?: boolean };

/** Regras de acesso usadas pelo login. */
export interface AccessPolicy {
  /** No login com o Google: entra (com qual papel) ou por que não. */
  login(profile: Profile): Promise<LoginResult>;
  /** A cada pedido: o papel atual do e-mail, ou null se perdeu o acesso. */
  check(email: string): Promise<Role | null>;
}

const lower = (e: string) => e.trim().toLowerCase();
const BLOCKED = "Seu acesso ao Bahanle Analytics foi bloqueado.";

/** Papel de quem não está no banco: admin do .env, avançado por ALLOWED_EMAILS ou "free". */
const envRole = (email: string, c: AuthConfig): Role =>
  c.admins.includes(lower(email)) ? "admin" : isAllowed(email, c.allowed) ? "avancado" : DEFAULT_ROLE;

/** Só o .env (sem banco): todo mundo entra; nada fica guardado. */
export function envPolicy(c: AuthConfig): AccessPolicy {
  return {
    async login(p) {
      return { ok: true, role: envRole(p.email, c) };
    },
    async check(email) {
      return envRole(email, c);
    },
  };
}

// ---------------- Banco ----------------

/**
 * Tabela e migrações (idempotentes, rodam na primeira consulta): os papéis
 * passam a ser os planos e "admin"; quem era "user" vai para o avançado (antes
 * de recriar a regra, que recusaria o papel antigo); o padrão é "free" e
 * "active"; pedidos antigos ainda pendentes viram contas ativas "free".
 */
export const USERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  email         text        PRIMARY KEY,
  name          text        NOT NULL DEFAULT '',
  picture       text,
  role          text        NOT NULL DEFAULT 'free'   CHECK (role IN ('admin', 'free', 'iniciante', 'intermediario', 'avancado')),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'blocked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'avancado' WHERE role = 'user';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'free', 'iniciante', 'intermediario', 'avancado'));
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'free';
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
UPDATE users SET status = 'active', role = 'free' WHERE status = 'pending';
`;

export interface UserRow {
  email: string;
  name: string;
  picture: string | null;
  role: Role;
  status: UserStatus;
  created_at: Date;
  last_login_at: Date | null;
}

export interface UserInfo {
  email: string;
  name: string;
  picture?: string;
  role: Role;
  status: UserStatus;
  createdAt?: string;
  lastLoginAt?: string;
  /** Administrador definido em ADMIN_EMAILS: não dá para mudar pela tela. */
  fromEnv: boolean;
}

/** Quanto tempo o papel de um e-mail fica em memória (mudanças pela tela limpam na hora). */
const CACHE_MS = 30_000;

export function dbPolicy(pool: Pool, c: AuthConfig) {
  const q = withSchema(pool, USERS_SCHEMA);
  const cache = new Map<string, { role: Role | null; at: number }>();

  const get = async (email: string) =>
    (await q<UserRow>("SELECT * FROM users WHERE email = $1", [email])).rows[0] as UserRow | undefined;

  /** Papel atual: admin do .env manda; no banco, bloqueado não entra; sem registro, o do .env (ou "free"). */
  const resolve = (email: string, row: UserRow | undefined): Role | null => {
    if (c.admins.includes(email)) return "admin";
    if (row) return row.status === "blocked" ? null : row.role;
    return envRole(email, c);
  };

  const policy: AccessPolicy & { forget(email: string): void; q: typeof q } = {
    q,
    forget: (email) => cache.delete(lower(email)),

    async login(p) {
      const email = lower(p.email);
      const row = await get(email);
      cache.delete(email);
      const role = resolve(email, row);
      if (!role) return { ok: false, reason: BLOCKED };
      // Primeiro login: cadastra, ativo, com o papel resolvido ("free" para quem chega sozinho).
      // Depois: só atualiza nome, foto e último acesso (o papel é o que está no banco).
      await q(
        `INSERT INTO users (email, name, picture, role, status, last_login_at) VALUES ($1, $2, $3, $4, 'active', now())
         ON CONFLICT (email) DO UPDATE SET name = $2, picture = $3, last_login_at = now(),
           role = CASE WHEN $5 THEN 'admin' ELSE users.role END`,
        [email, p.name, p.picture ?? null, role, c.admins.includes(email)],
      );
      return { ok: true, role };
    },

    async check(email) {
      const e = lower(email);
      const hit = cache.get(e);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.role;
      try {
        const role = resolve(e, await get(e));
        cache.set(e, { role, at: Date.now() });
        return role;
      } catch (err) {
        // Banco fora do ar por um instante: segue com o último papel conhecido.
        if (hit) return hit.role;
        throw err;
      }
    },
  };
  return policy;
}

// ---------------- Rotas de administração ----------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asRole = (v: unknown): Role | undefined => (ROLES.includes(v as Role) ? (v as Role) : undefined);

const info = (r: UserRow, c: AuthConfig): UserInfo => ({
  email: r.email,
  name: r.name,
  picture: r.picture ?? undefined,
  role: c.admins.includes(r.email) ? "admin" : r.role,
  status: c.admins.includes(r.email) ? "active" : r.status,
  createdAt: r.created_at.toISOString(),
  lastLoginAt: r.last_login_at?.toISOString(),
  fromEnv: c.admins.includes(r.email),
});

/**
 * /api/admin/users          GET lista · POST cadastra {email, role} (padrão "free"; role = plano ou "admin")
 * /api/admin/users/:email   PATCH {role?, status?} · DELETE remove
 * Só administradores. Ninguém muda o próprio acesso nem os administradores do .env.
 */
export function usersApi(policy: ReturnType<typeof dbPolicy> | null, c: AuthConfig) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? "/").split("?")[0];
    if (!path.startsWith("/api/admin/users")) return next();
    try {
      const me = (req as AuthedRequest).user;
      if (!me) throw new HttpError(401, "Faça login.");
      if (me.role !== "admin") throw new HttpError(403, "Só administradores gerenciam usuários.");
      if (!policy) throw new HttpError(503, "Gestão de usuários desligada: defina DATABASE_URL no .env.");
      const m = /^\/api\/admin\/users(?:\/([^/]+))?\/?$/.exec(path);
      if (!m) throw new HttpError(404, "Rota não encontrada.");
      const target = m[1] === undefined ? undefined : lower(decodeURIComponent(m[1]));
      const { q } = policy;

      if (target === undefined) {
        if (req.method === "GET") {
          const rows = (await q<UserRow>(`SELECT * FROM users ORDER BY last_login_at DESC NULLS LAST, email`)).rows;
          const list = rows.map((r) => info(r, c));
          // Administradores do .env que ainda não entraram aparecem também.
          for (const email of c.admins) {
            if (!list.some((u) => u.email === email)) list.push({ email, name: "", role: "admin", status: "active", fromEnv: true });
          }
          return json(res, 200, list);
        }
        if (req.method === "POST") {
          const body = await readJson<{ email?: unknown; role?: unknown }>(req);
          const email = lower(String(body.email ?? ""));
          if (!EMAIL.test(email)) throw new HttpError(400, "E-mail inválido.");
          const role = body.role === undefined ? DEFAULT_ROLE : asRole(body.role);
          if (!role) throw new HttpError(400, "Papel inválido.");
          // Cadastrar alguém que já existe (ou estava bloqueado) libera e ajusta o papel.
          const r = await q<UserRow>(
            `INSERT INTO users (email, role, status) VALUES ($1, $2, 'active')
             ON CONFLICT (email) DO UPDATE SET role = $2, status = 'active' RETURNING *`,
            [email, role],
          );
          policy.forget(email);
          return json(res, 201, info(r.rows[0], c));
        }
        throw new HttpError(405, "Método não permitido.");
      }

      if (!EMAIL.test(target)) throw new HttpError(404, "Usuário não encontrado.");
      if (target === lower(me.email)) throw new HttpError(400, "Você não pode mudar o seu próprio acesso.");
      if (c.admins.includes(target)) throw new HttpError(400, "Este administrador está em ADMIN_EMAILS; mude por lá.");

      if (req.method === "PATCH") {
        const body = await readJson<{ role?: unknown; status?: unknown }>(req);
        const role = body.role === undefined ? null : asRole(body.role);
        const status = body.status === undefined ? null : body.status === "active" || body.status === "blocked" ? body.status : undefined;
        if (role === undefined || status === undefined) throw new HttpError(400, "Papel ou situação inválidos.");
        const r = await q<UserRow>(
          "UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status) WHERE email = $1 RETURNING *",
          [target, role, status],
        );
        if (!r.rows[0]) throw new HttpError(404, "Usuário não encontrado.");
        policy.forget(target);
        return json(res, 200, info(r.rows[0], c));
      }
      if (req.method === "DELETE") {
        const r = await q("DELETE FROM users WHERE email = $1", [target]);
        if (!r.rowCount) throw new HttpError(404, "Usuário não encontrado.");
        policy.forget(target);
        return json(res, 204, undefined);
      }
      throw new HttpError(405, "Método não permitido.");
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      next(e);
    }
  };
}
