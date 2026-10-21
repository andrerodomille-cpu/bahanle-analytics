// Login com Google: só quem tem acesso (ver server/users.ts) abre o app.
//
// O botão "Entrar com Google" (Google Identity Services) devolve um ID token
// (JWT assinado pelo Google). O servidor confere a assinatura, o emissor, o
// público (nosso Client ID) e as regras de acesso, e grava uma sessão num
// cookie HttpOnly assinado com HMAC. Sem sessão válida, nenhum arquivo do app
// é entregue: a resposta é a página de login. O acesso é conferido de novo a
// cada pedido: bloquear alguém derruba a sessão dele.
//
// O mesmo middleware roda no `vite` (dev e preview) e no servidor de produção.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { json, readBody, type Next } from "./http.ts";
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
  if (!c.admins.length && !c.allowed.length) out.push("Defina ADMIN_EMAILS (quem administra os usuários): sem ele, ninguém entra.");
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
      if (user) {
        (req as AuthedRequest).user = user;
        return next();
      }

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

/** Marca: três barras crescentes (a mesma do logotipo do exemplo). */
const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="17" width="7" height="12" rx="1.5"/><rect x="12.5" y="10" width="7" height="19" rx="1.5"/><rect x="22" y="3" width="7" height="26" rx="1.5"/></svg>`;

/** Ilustração do painel da esquerda: colunas e uma linha de tendência. */
const COLS = [62, 88, 74, 110, 96, 132, 118, 150, 140, 172];
const TREND = [52, 70, 62, 92, 86, 112, 104, 132, 128, 156];
const ART = `<svg class="art" viewBox="0 0 420 200" aria-hidden="true">
  <g class="grid">${[40, 80, 120, 160].map((y) => `<line x1="0" x2="420" y1="${y}" y2="${y}"/>`).join("")}</g>
  <g class="cols">${COLS.map((h, i) => `<rect x="${12 + i * 41}" y="${190 - h}" width="24" height="${h}" rx="4"/>`).join("")}</g>
  <polyline class="trend" points="${TREND.map((h, i) => `${24 + i * 41},${180 - h}`).join(" ")}"/>
  ${TREND.map((h, i) => `<circle cx="${24 + i * 41}" cy="${180 - h}" r="3.5"/>`).join("")}
</svg>`;

const CHECK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='%23f2c811' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

export function loginPage(clientId: string, problems: string[]): string {
  const body = problems.length
    ? `<div class="alert err"><strong>O login ainda não está configurado.</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
       Preencha o arquivo <code>.env</code> (veja <code>.env.example</code>) e reinicie o servidor.</div>`
    : `<div id="g_id_onload" data-client_id="${esc(clientId)}" data-callback="onGoogleLogin" data-auto_prompt="false"></div>
       <div class="g_id_signin" data-type="standard" data-shape="pill" data-theme="outline" data-size="large"
         data-text="continue_with" data-logo_alignment="left" data-width="300" data-locale="pt-BR"></div>
       <div id="msg" class="alert" role="alert" hidden></div>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Entrar · Bahanle Analytics</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f4f2; --card: #ffffff; --text: #1f1e1d; --muted: #6b6966; --line: #e6e3df;
    --brand: #f2c811; --err: #c4314b; --err-bg: #fdecef; --info: #0b5cad; --info-bg: #e8f2fd;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141312; --card: #1f1e1d; --text: #f3f2f1; --muted: #a19f9d; --line: #34322f;
      --err: #ff8b98; --err-bg: #3a1d22; --info: #8cc8ff; --info-bg: #15283c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
  .shell { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }

  .hero { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 40px; padding: 44px 56px;
    color: #f3f2f1; background:
      radial-gradient(900px 500px at 110% -10%, rgba(242, 200, 17, .22), transparent 60%),
      radial-gradient(700px 500px at -20% 120%, rgba(17, 141, 255, .18), transparent 60%),
      linear-gradient(160deg, #23211f 0%, #151413 100%); }
  .logo { display: flex; align-items: center; gap: 12px; font-size: 19px; font-weight: 600; letter-spacing: -.01em; }
  .logo svg { width: 34px; height: 34px; fill: var(--brand); }
  .logo span { color: #c8c6c4; font-weight: 400; }
  .pitch { margin-top: auto; max-width: 30rem; }
  .pitch h1 { margin: 0 0 14px; font-size: clamp(30px, 3.4vw, 44px); line-height: 1.1; letter-spacing: -.02em; font-weight: 700; }
  .pitch h1 em { font-style: normal; color: var(--brand); }
  .pitch p { margin: 0 0 22px; color: #c8c6c4; font-size: 16px; }
  .pitch ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .pitch li { display: flex; gap: 10px; align-items: flex-start; color: #e1dfdd; }
  .pitch li::before { content: ""; flex: none; width: 18px; height: 18px; margin-top: 2px; border-radius: 50%;
    background: rgba(242, 200, 17, .16) url("${CHECK}") center/12px no-repeat; }
  .art { width: 100%; max-width: 30rem; height: auto; margin-bottom: auto; }
  .art .grid line { stroke: rgba(255, 255, 255, .07); }
  .art .cols rect { fill: rgba(242, 200, 17, .85); }
  .art .cols rect:nth-child(odd) { fill: rgba(242, 200, 17, .45); }
  .art .trend { fill: none; stroke: #4aa8ff; stroke-width: 2.5; stroke-linejoin: round; }
  .art circle { fill: #151413; stroke: #4aa8ff; stroke-width: 2; }
  .hero small { color: #8a8886; font-size: 12px; }

  .panel { display: grid; place-items: center; padding: 40px 24px; }
  .card { width: min(380px, 100%); }
  .card h2 { margin: 0 0 6px; font-size: 28px; letter-spacing: -.02em; }
  .card > p { margin: 0 0 28px; color: var(--muted); }
  .g_id_signin { min-height: 44px; }
  .alert { margin-top: 18px; padding: 12px 14px; border-radius: 10px; font-size: 14px; background: var(--err-bg); color: var(--err); }
  .alert.info { background: var(--info-bg); color: var(--info); }
  .alert ul { margin: 8px 0; padding-left: 18px; }
  .note { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  code { font-size: 12px; }

  @media (max-width: 860px) {
    .shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .hero { padding: 28px 24px 32px; gap: 20px; }
    .pitch { margin-top: 8px; }
    .pitch h1 { font-size: 28px; }
    .pitch ul, .art, .hero small { display: none; }
    .panel { place-items: start center; padding: 32px 16px 48px; }
  }
</style>
${problems.length ? "" : '<script src="https://accounts.google.com/gsi/client" async></script>'}
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="logo">${MARK}<div>Bahanle <span>Analytics</span></div></div>
    <div class="pitch">
      <h1>Seus dados viram <em>decisões</em>.</h1>
      <p>Monte dashboards interativos, crie medidas e compartilhe relatórios, direto do navegador.</p>
      <ul>
        <li>Visuais, filtros cruzados e drill-down no estilo Power BI</li>
        <li>Relatórios salvos na sua conta, de qualquer computador</li>
        <li>Assistente de IA que monta o painel a partir de um pedido em texto</li>
      </ul>
    </div>
    ${ART}
    <small>© ${new Date().getFullYear()} Bahanle Analytics</small>
  </section>
  <main class="panel">
    <div class="card">
      <h2>Entrar</h2>
      <p>Use sua conta Google para acessar seus relatórios.</p>
      ${body}
      <p class="note">Acesso por convite. No primeiro acesso, seu pedido vai para um administrador aprovar.</p>
    </div>
  </main>
</div>
<script>
  async function onGoogleLogin(r) {
    const msg = document.getElementById("msg");
    const show = (text, info) => { msg.textContent = text; msg.className = info ? "alert info" : "alert"; msg.hidden = false; };
    msg.hidden = true;
    try {
      const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: r.credential }) });
      if (res.ok) return location.reload();
      const data = await res.json();
      show(data.error || "Acesso negado.", data.pending);
    } catch { show("Sem conexão com o servidor. Tente de novo."); }
  }
</script>
</body>
</html>`;
}
