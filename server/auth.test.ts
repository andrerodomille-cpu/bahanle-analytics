import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { authMiddleware, configFromEnv, configProblems, createSession, isAllowed, readSession } from "./auth.ts";
import type { TokenVerifier } from "./auth.ts";
import { envPolicy } from "./users.ts";

const config = configFromEnv({
  GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com",
  ALLOWED_EMAILS: "ana@gmail.com, @empresa.com",
  SESSION_SECRET: "x".repeat(40),
});

describe("configuração e lista de permitidos", () => {
  it("lê o .env e aponta o que falta", () => {
    expect(configProblems(config)).toEqual([]);
    expect(configProblems(configFromEnv({}))).toHaveLength(3);
    expect(configProblems(configFromEnv({ GOOGLE_CLIENT_ID: "x", ADMIN_EMAILS: "a@b.com", SESSION_SECRET: "x".repeat(40) }))).toEqual([]);
  });

  it("aceita e-mails exatos e domínios, sem diferenciar maiúsculas", () => {
    expect(isAllowed("Ana@Gmail.com", config.allowed)).toBe(true);
    expect(isAllowed("bia@empresa.com", config.allowed)).toBe(true);
    expect(isAllowed("bia@empresa.com.br", config.allowed)).toBe(false);
    expect(isAllowed("ana@gmail.com.evil", config.allowed)).toBe(false);
    expect(isAllowed("ana@gmail.com", [])).toBe(false);
  });
});

describe("sessão", () => {
  const user = { email: "ana@gmail.com", name: "Ana" };

  it("assina, lê, expira e rejeita adulteração", () => {
    const s = createSession(user, config, 0);
    expect(readSession(s, config, 1000)).toEqual(user);
    expect(readSession(s, config, config.sessionHours * 3600_000 + 1)).toBeNull();
    const [data, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "bia@empresa.com", name: "B", exp: 9e15 })).toString("base64url");
    expect(readSession(`${forged}.${sig}`, config, 0)).toBeNull();
    expect(readSession(`${data}.${sig}x`, config, 0)).toBeNull();
    expect(readSession(s, { ...config, secret: "y".repeat(40) }, 0)).toBeNull();
  });


});

describe("middleware", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  /** Sobe um servidor de teste com o middleware e um "app" que responde "APP". */
  async function start(verify: TokenVerifier, cfg = config) {
    const mw = authMiddleware(cfg, envPolicy(cfg), verify);
    server = createServer((req, res) => void mw(req, res, () => res.end("APP")));
    await new Promise<void>((r) => server!.listen(0, r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  const google = (claims: Record<string, unknown>): TokenVerifier => async (token, aud) => {
    if (token !== "token-bom" || aud !== config.clientId) throw new Error("inválido");
    return claims;
  };

  it("sem sessão: página de login para navegação e 401 para o resto", async () => {
    const url = await start(google({}));
    const page = await fetch(url + "/", { headers: { accept: "text/html" } });
    const html = await page.text();
    expect(html).toContain("Use sua conta Google");
    expect(html).toContain(`data-client_id="${config.clientId}"`);
    expect(html).not.toContain("APP");
    expect((await fetch(url + "/src/main.tsx")).status).toBe(401);
    expect((await fetch(url + "/viewer/index.html", { headers: { accept: "*/*" } })).status).toBe(401);
    expect((await fetch(url + "/api/auth/me")).status).toBe(401);
  });

  it("login válido grava o cookie e libera o app", async () => {
    const url = await start(google({ email: "ana@gmail.com", email_verified: true, name: "Ana" }));
    const login = await fetch(url + "/api/auth/google", { method: "POST", body: JSON.stringify({ credential: "token-bom" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^minibi_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const session = cookie.split(";")[0];
    expect(await (await fetch(url + "/", { headers: { cookie: session, accept: "text/html" } })).text()).toBe("APP");
    expect(await (await fetch(url + "/api/auth/me", { headers: { cookie: session } })).json()).toMatchObject({ email: "ana@gmail.com" });

    const out = await fetch(url + "/api/auth/logout", { method: "POST", headers: { cookie: session } });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("sessão válida cai quando a política tira o acesso (e-mail saiu da lista)", async () => {
    const session = `minibi_session=${createSession({ email: "ana@gmail.com", name: "Ana" }, config)}`;
    let url = await start(google({}));
    expect(await (await fetch(url + "/api/auth/me", { headers: { cookie: session } })).json()).toMatchObject({ role: "user" });
    server!.close();
    url = await start(google({}), { ...config, allowed: ["@empresa.com"] });
    expect((await fetch(url + "/api/auth/me", { headers: { cookie: session } })).status).toBe(401);
    expect(await (await fetch(url + "/", { headers: { cookie: session, accept: "text/html" } })).text()).toContain("Use sua conta Google");
  });

  it("administrador do .env entra com papel admin", async () => {
    const url = await start(google({ email: "Chefe@Gmail.com", email_verified: true, name: "Chefe" }), { ...config, admins: ["chefe@gmail.com"] });
    const login = await fetch(url + "/api/auth/google", { method: "POST", body: JSON.stringify({ credential: "token-bom" }) });
    expect(await login.json()).toMatchObject({ role: "admin" });
  });

  it("recusa token inválido, e-mail fora da lista e e-mail não verificado", async () => {
    let url = await start(google({ email: "intruso@gmail.com", email_verified: true }));
    const post = (credential: string) => fetch(url + "/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) });
    expect((await post("token-ruim")).status).toBe(401);
    const denied = await post("token-bom");
    expect(denied.status).toBe(403);
    expect(denied.headers.get("set-cookie")).toBeNull();
    server!.close();

    url = await start(google({ email: "ana@gmail.com", email_verified: false }));
    expect((await post("token-bom")).status).toBe(403);
  });

  it("sem configuração, não deixa ninguém entrar e explica o que falta", async () => {
    const url = await start(google({ email: "ana@gmail.com", email_verified: true }), configFromEnv({}));
    expect(await (await fetch(url + "/", { headers: { accept: "text/html" } })).text()).toContain("GOOGLE_CLIENT_ID");
    expect((await fetch(url + "/api/auth/google", { method: "POST", body: "{}" })).status).toBe(503);
  });
});
