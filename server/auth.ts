// Login com Google: só quem tem acesso (ver server/users.ts) abre o app.
//
// O botão "Entrar com Google" (Google Identity Services) devolve um ID token
// (JWT assinado pelo Google). O servidor confere a assinatura, o emissor, o
// público (nosso Client ID) e as regras de acesso, e grava uma sessão num
// cookie HttpOnly assinado com HMAC. Sem sessão válida, nenhum arquivo do app
// é entregue: a resposta é o site público (server/site.ts), com o "Entrar com
// Google" no topo de cada página. O acesso é conferido de novo a
// cada pedido: bloquear alguém derruba a sessão dele.
//
// O mesmo middleware roda no `vite` (dev e preview) e no servidor de produção.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { json, readBody, type Next } from "./http.ts";
import { SITE_PATHS, sitePage } from "./site.ts";
import type { AccessPolicy, Role } from "./users.ts";

export interface AuthConfig {
  /** Client ID OAuth do Google Cloud (tipo "Aplicativo da Web"). */
  clientId: string;
  /** Administradores fixos (ADMIN_EMAILS): sempre entram e gerenciam os usuários. */
  admins: string[];
  /** Usuários liberados pelo .env (ALLOWED_EMAILS); "@empresa.com" libera o domínio inteiro. */
  allowed: string[];
  /** Segredo da assinatura do cookie de sessão. */
  secret: string;
  /** Duração da sessão, em horas. */
  sessionHours: number;
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
}

/** Pedido que passou pelo login: as rotas seguintes leem o usuário (e o papel atual) daqui. */
export type AuthedRequest = IncomingMessage & { user?: SessionUser & { role: Role } };

/** Confere o ID token do Google e devolve as declarações (claims) dele. */
export type TokenVerifier = (token: string, clientId: string) => Promise<Record<string, unknown>>;

export const COOKIE = "minibi_session";

const emailList = (v: string | undefined) => (v ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

export function configFromEnv(env: Record<string, string | undefined>): AuthConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID?.trim() ?? "",
    admins: emailList(env.ADMIN_EMAILS),
    allowed: emailList(env.ALLOWED_EMAILS),
    secret: env.SESSION_SECRET?.trim() ?? "",
    sessionHours: Number(env.SESSION_HOURS) > 0 ? Number(env.SESSION_HOURS) : 12,
  };
}

/** O que falta configurar (vazio = pronto). */
export function configProblems(c: AuthConfig): string[] {
  const out: string[] = [];
  if (!c.clientId) out.push("GOOGLE_CLIENT_ID não definido.");
  if (c.secret.length < 32) out.push("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
  return out;
}

export function isAllowed(email: string, allowed: string[]): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@"));
  return allowed.some((a) => (a.startsWith("@") ? a === domain : a === e));
}

// ---------------- Verificação do token do Google ----------------

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const verifyGoogleToken: TokenVerifier = async (token, clientId) => {
  const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  return payload as Record<string, unknown>;
};

// ---------------- Sessão (cookie assinado) ----------------

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function createSession(user: SessionUser, c: AuthConfig, now = Date.now()): string {
  const data = b64(JSON.stringify({ ...user, exp: now + c.sessionHours * 3600_000 }));
  return `${data}.${sign(data, c.secret)}`;
}

export function readSession(value: string | undefined, c: AuthConfig, now = Date.now()): SessionUser | null {
  if (!value || !c.secret) return null;
  const [data, sig] = value.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data, c.secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionUser & { exp: number };
    if (!(s.exp > now)) return null;
    return { email: s.email, name: s.name, picture: s.picture };
  } catch {
    return null;
  }
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const isHttps = (req: IncomingMessage) =>
  !!(req.socket as { encrypted?: boolean }).encrypted || req.headers["x-forwarded-proto"] === "https";

function sessionCookie(req: IncomingMessage, value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
}

// ---------------- Middleware ----------------

/**
 * Middleware no formato do Connect (o mesmo do Vite): trata /api/auth/* e
 * barra todo o resto sem sessão. Navegações recebem a página de login;
 * os demais pedidos, 401. `policy` decide quem entra (envPolicy ou dbPolicy).
 */
export function authMiddleware(c: AuthConfig, policy: AccessPolicy, verify: TokenVerifier = verifyGoogleToken) {
  const problems = configProblems(c);
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    try {
      const path = (req.url ?? "/").split("?")[0];

      if (path === "/api/auth/google" && req.method === "POST") {
        if (problems.length) return json(res, 503, { error: problems.join(" ") });
        let claims: Record<string, unknown>;
        try {
          const { credential } = JSON.parse(await readBody(req)) as { credential?: string };
          claims = await verify(String(credential ?? ""), c.clientId);
        } catch {
          return json(res, 401, { error: "Não foi possível validar o login do Google. Tente de novo." });
        }
        const email = String(claims.email ?? "");
        if (!email || claims.email_verified !== true) return json(res, 403, { error: "A conta Google não tem e-mail verificado." });
        const user: SessionUser = { email, name: String(claims.name ?? email), picture: claims.picture ? String(claims.picture) : undefined };
        const access = await policy.login(user);
        if (!access.ok) return json(res, 403, { error: access.reason, pending: access.pending ?? false });
        return json(res, 200, { ...user, role: access.role }, {
          "Set-Cookie": sessionCookie(req, createSession(user, c), c.sessionHours * 3600),
        });
      }

      if (path === "/api/auth/logout" && req.method === "POST") {
        return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      }

      const session = readSession(cookieValue(req, COOKIE), c);
      const role = session ? await policy.check(session.email) : null;
      const user = session && role ? { ...session, role } : null;
      if (path === "/api/auth/me") return user ? json(res, 200, user) : json(res, 401, { error: "Sem sessão." });

      // Site público: as páginas de apresentação abrem com ou sem login; o "/" é o app para quem entrou.
      const wantsPage = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
      if (wantsPage && SITE_PATHS.has(path) && (path !== "/" || !user)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(sitePage(path, { clientId: c.clientId, problems, user }));
      }
      if (user) {
        (req as AuthedRequest).user = user;
        return next();
      }

      // Sem sessão, qualquer outro endereço de navegação mostra o início do site.
      if (wantsPage) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(sitePage("/", { clientId: c.clientId, problems }));
      }
      return json(res, 401, { error: "Faça login." });
    } catch (e) {
      next(e);
    }
  };
}
