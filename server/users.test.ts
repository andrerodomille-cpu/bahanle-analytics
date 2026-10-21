import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthedRequest } from "./auth.ts";
import { configFromEnv } from "./auth.ts";
import { dbPolicy, usersApi, type Role } from "./users.ts";

/** Rodam contra um Postgres de verdade: TEST_DATABASE_URL=postgres://… npm test */
const DB = process.env.TEST_DATABASE_URL;

const config = configFromEnv({
  GOOGLE_CLIENT_ID: "x", SESSION_SECRET: "x".repeat(40),
  ADMIN_EMAILS: "chefe@gmail.com", ALLOWED_EMAILS: "@empresa.com",
});
const p = (email: string) => ({ email, name: email.split("@")[0] });

describe.skipIf(!DB)("usuários (Postgres)", () => {
  let pool: pg.Pool;
  let policy: ReturnType<typeof dbPolicy>;
  let server: Server | undefined;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB! });
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    policy = dbPolicy(pool, config);
    await policy.q("DELETE FROM users");
  });
  afterEach(() => server?.close());

  it("admin do .env entra e fica registrado", async () => {
    expect(await policy.login(p("Chefe@gmail.com"))).toEqual({ ok: true, role: "admin" });
    expect(await policy.check("chefe@gmail.com")).toBe("admin");
    const row = (await policy.q("SELECT role, status, last_login_at FROM users WHERE email = 'chefe@gmail.com'")).rows[0];
    expect(row).toMatchObject({ role: "admin", status: "active" });
    expect(row.last_login_at).not.toBeNull();
  });

  it("desconhecido vira pedido de acesso; aprovado entra; bloqueado sai", async () => {
    const first = await policy.login(p("bia@gmail.com"));
    expect(first).toMatchObject({ ok: false, reason: expect.stringContaining("Pedido de acesso enviado") });
    expect(await policy.login(p("bia@gmail.com"))).toMatchObject({ ok: false });
    expect(await policy.check("bia@gmail.com")).toBeNull();

    await policy.q("UPDATE users SET status = 'active' WHERE email = 'bia@gmail.com'");
    policy.forget("bia@gmail.com");
    expect(await policy.login(p("bia@gmail.com"))).toEqual({ ok: true, role: "user" });
    expect(await policy.check("bia@gmail.com")).toBe("user");

    await policy.q("UPDATE users SET status = 'blocked' WHERE email = 'bia@gmail.com'");
    expect(await policy.check("bia@gmail.com")).toBe("user"); // ainda no cache…
    policy.forget("bia@gmail.com");
    expect(await policy.check("bia@gmail.com")).toBeNull(); // …até esquecer (a API faz isso sozinha)
    expect(await policy.login(p("bia@gmail.com"))).toMatchObject({ ok: false, reason: expect.stringContaining("bloqueado") });
  });

  it("domínio de ALLOWED_EMAILS entra direto, mas o bloqueio no banco vale mais", async () => {
    expect(await policy.login(p("caio@empresa.com"))).toEqual({ ok: true, role: "user" });
    await policy.q("UPDATE users SET status = 'blocked' WHERE email = 'caio@empresa.com'");
    policy.forget("caio@empresa.com");
    expect(await policy.check("caio@empresa.com")).toBeNull();
  });

  /** API com o usuário logado vindo do cabeçalho x-user ("email:papel"). */
  async function start() {
    const api = usersApi(policy, config);
    server = createServer((req, res) => {
      const [email, role] = String(req.headers["x-user"] ?? "").split(":");
      if (email) (req as AuthedRequest).user = { email, name: email, role: role as Role };
      void api(req, res, (err) => res.writeHead(err ? 500 : 404).end(String(err ?? "")));
    });
    await new Promise<void>((r) => server!.listen(0, r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    return (path: string, user: string, method = "GET", body?: unknown) =>
      fetch(base + path, { method, headers: { "x-user": user }, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  it("administrador convida, aprova, bloqueia, promove e remove", async () => {
    const api = await start();
    const admin = "chefe@gmail.com:admin";
    await policy.login(p("bia@gmail.com")); // pedido pendente

    const list = await (await api("/api/admin/users", admin)).json();
    expect(list[0]).toMatchObject({ email: "bia@gmail.com", status: "pending" });
    expect(list.find((u: { email: string }) => u.email === "chefe@gmail.com")).toMatchObject({ role: "admin", fromEnv: true });

    expect((await api("/api/admin/users/bia%40gmail.com", admin, "PATCH", { status: "active" })).status).toBe(200);
    expect(await policy.check("bia@gmail.com")).toBe("user");

    const invited = await api("/api/admin/users", admin, "POST", { email: " Davi@Gmail.com ", role: "admin" });
    expect(await invited.json()).toMatchObject({ email: "davi@gmail.com", role: "admin", status: "active" });
    expect(await policy.login(p("davi@gmail.com"))).toEqual({ ok: true, role: "admin" });

    expect((await api("/api/admin/users/bia@gmail.com", admin, "PATCH", { status: "blocked" })).status).toBe(200);
    expect(await policy.check("bia@gmail.com")).toBeNull();

    expect((await api("/api/admin/users/bia@gmail.com", admin, "DELETE")).status).toBe(204);
    expect((await api("/api/admin/users/bia@gmail.com", admin, "DELETE")).status).toBe(404);
  });

  it("protege contra erros e quem não é administrador", async () => {
    const api = await start();
    await policy.login(p("bia@empresa.com"));
    expect((await api("/api/admin/users", "bia@empresa.com:user")).status).toBe(403);
    expect((await api("/api/admin/users", "")).status).toBe(401);
    const admin = "davi@gmail.com:admin";
    expect((await api("/api/admin/users/davi@gmail.com", admin, "PATCH", { status: "blocked" })).status).toBe(400);
    expect((await api("/api/admin/users/chefe@gmail.com", admin, "PATCH", { role: "user" })).status).toBe(400);
    expect((await api("/api/admin/users/bia@empresa.com", admin, "PATCH", { role: "dono" })).status).toBe(400);
    expect((await api("/api/admin/users", admin, "POST", { email: "sem-arroba" })).status).toBe(400);
    expect((await api("/api/admin/users/ninguem@gmail.com", admin, "PATCH", { status: "active" })).status).toBe(404);
  });

  it("sem banco, a API avisa", async () => {
    server = createServer((req, res) => {
      (req as AuthedRequest).user = { email: "chefe@gmail.com", name: "c", role: "admin" };
      void usersApi(null, config)(req, res, () => res.end());
    });
    await new Promise<void>((r) => server!.listen(0, r));
    const r = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/admin/users`);
    expect(r.status).toBe(503);
  });
});
