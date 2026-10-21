// Login com Google: só quem está na lista de e-mails permitidos abre o app.
//
// O botão "Entrar com Google" (Google Identity Services) devolve um ID token
// (JWT assinado pelo Google). O servidor confere a assinatura, o emissor, o
// público (nosso Client ID) e a lista de permitidos, e grava uma sessão num
// cookie HttpOnly assinado com HMAC. Sem sessão válida, nenhum arquivo do app
// é entregue: a resposta é a página de login.
//
// O mesmo middleware roda no `vite` (dev e preview) e no servidor de produção.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthConfig {
  /** Client ID OAuth do Google Cloud (tipo "Aplicativo da Web"). */
  clientId: string;
  /** E-mails permitidos; "@empresa.com" libera o domínio inteiro. Lista vazia = ninguém entra. */
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

/** Confere o ID token do Google e devolve as declarações (claims) dele. */
export type TokenVerifier = (token: string, clientId: string) => Promise<Record<string, unknown>>;

export const COOKIE = "minibi_session";

export function configFromEnv(env: Record<string, string | undefined>): AuthConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID?.trim() ?? "",
    allowed: (env.ALLOWED_EMAILS ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
    secret: env.SESSION_SECRET?.trim() ?? "",
    sessionHours: Number(env.SESSION_HOURS) > 0 ? Number(env.SESSION_HOURS) : 12,
  };
}

/** O que falta configurar (vazio = pronto). */
export function configProblems(c: AuthConfig): string[] {
  const out: string[] = [];
  if (!c.clientId) out.push("GOOGLE_CLIENT_ID não definido.");
  if (!c.allowed.length) out.push("ALLOWED_EMAILS vazio: ninguém conseguiria entrar.");
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
    // A lista pode ter mudado depois do login: confere de novo a cada pedido.
    if (!(s.exp > now) || !isAllowed(s.email, c.allowed)) return null;
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

type Next = (err?: unknown) => void;

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 16_384): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error("corpo grande demais");
  }
  return body;
}

/**
 * Middleware no formato do Connect (o mesmo do Vite): trata /api/auth/* e
 * barra todo o resto sem sessão. Navegações recebem a página de login;
 * os demais pedidos, 401.
 */
export function authMiddleware(c: AuthConfig, verify: TokenVerifier = verifyGoogleToken) {
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
        if (!isAllowed(email, c.allowed)) return json(res, 403, { error: `${email} não tem acesso a este Mini BI.` });
        const user: SessionUser = { email, name: String(claims.name ?? email), picture: claims.picture ? String(claims.picture) : undefined };
        return json(res, 200, user, { "Set-Cookie": sessionCookie(req, createSession(user, c), c.sessionHours * 3600) });
      }

      if (path === "/api/auth/logout" && req.method === "POST") {
        return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
      }

      const user = readSession(cookieValue(req, COOKIE), c);
      if (path === "/api/auth/me") return user ? json(res, 200, user) : json(res, 401, { error: "Sem sessão." });
      if (user) return next();

      const wantsPage = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
      if (wantsPage) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(loginPage(c.clientId, problems));
      }
      return json(res, 401, { error: "Faça login." });
    } catch (e) {
      next(e);
    }
  };
}

// ---------------- Página de login ----------------

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function loginPage(clientId: string, problems: string[]): string {
  const body = problems.length
    ? `<p class="err">O login ainda não está configurado:</p><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
       <p class="small">Preencha o arquivo <code>.env</code> (veja <code>.env.example</code>) e reinicie o servidor.</p>`
    : `<div id="g_id_onload" data-client_id="${esc(clientId)}" data-callback="onGoogleLogin" data-auto_prompt="false"></div>
       <div class="g_id_signin" data-type="standard" data-theme="outline" data-size="large" data-text="signin_with" data-locale="pt-BR"></div>
       <p id="msg" class="err" role="alert"></p>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Entrar · Mini BI</title>
<style>
  :root { color-scheme: light dark; --bg: #f3f2f1; --card: #fff; --text: #252423; --muted: #605e5c; --err: #c4314b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1a19; --card: #252423; --text: #f3f2f1; --muted: #a19f9d; --err: #f1707b; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { background: var(--card); padding: 32px 28px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.12); width: min(360px, calc(100vw - 32px)); box-sizing: border-box; text-align: center; }
  h1 { margin: 0 0 4px; font-size: 22px; } h1 span { color: #f2c811; }
  p { margin: 0 0 18px; color: var(--muted); }
  .g_id_signin { display: flex; justify-content: center; }
  .err { color: var(--err); margin: 14px 0 0; min-height: 1em; } ul { text-align: left; color: var(--err); }
  .small { font-size: 12px; } code { font-size: 12px; }
</style>
${problems.length ? "" : '<script src="https://accounts.google.com/gsi/client" async></script>'}
</head>
<body>
<main>
  <h1><span>Mini</span> BI</h1>
  <p>Entre com sua conta Google para continuar.</p>
  ${body}
</main>
<script>
  async function onGoogleLogin(r) {
    const msg = document.getElementById("msg");
    msg.textContent = "";
    try {
      const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: r.credential }) });
      if (res.ok) return location.reload();
      msg.textContent = (await res.json()).error || "Acesso negado.";
    } catch { msg.textContent = "Sem conexão com o servidor."; }
  }
</script>
</body>
</html>`;
}
