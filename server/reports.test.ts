import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthedRequest } from "./auth.ts";
import pg from "pg";
import { pgReportStore, reportsApi, type ReportStore } from "./reports.ts";

/** Rodam contra um Postgres de verdade: TEST_DATABASE_URL=postgres://… npm test */
const DB = process.env.TEST_DATABASE_URL;

const report = (title = "x") => ({ pages: [{ id: "p1", name: title }], tables: [], visuals: [], measures: [] });

describe.skipIf(!DB)("API de relatórios (Postgres)", () => {
  let pool: pg.Pool;
  let store: ReportStore;
  let server: Server | undefined;
  // Um dono por execução: os testes não enxergam dados de execuções anteriores.
  const ana = `ana-${randomUUID()}@gmail.com`;
  const bia = `bia-${randomUUID()}@empresa.com`;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB! });
    store = pgReportStore(pool);
  });
  afterAll(() => pool.end());
  afterEach(() => server?.close());

  /** Servidor de teste: o cabeçalho x-user faz o papel do login. */
  async function start(s: ReportStore | null = store, maxBytes?: number) {
    const api = reportsApi(s, { maxBytes });
    server = createServer((req, res) => {
      const email = req.headers["x-user"];
      if (typeof email === "string") (req as AuthedRequest).user = { email, name: email, role: "user" };
      void api(req, res, (err) => {
        res.writeHead(err ? 500 : 404).end(err ? String(err) : "fora da API");
      });
    });
    await new Promise<void>((r) => server!.listen(0, r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    return (path: string, user: string | null, init: { method?: string; body?: unknown } = {}) =>
      fetch(base + path, {
        method: init.method ?? "GET",
        headers: user ? { "x-user": user } : {},
        body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
      });
  }

  it("cria, lista, abre, salva e exclui", async () => {
    const api = await start();
    const created = await api("/api/reports", ana, { method: "POST", body: { name: " Vendas ", data: report("a") } });
    expect(created.status).toBe(201);
    const meta = await created.json();
    expect(meta).toMatchObject({ name: "Vendas", version: 1 });
    expect(meta.size).toBeGreaterThan(0);

    const list = await (await api("/api/reports", ana)).json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([meta.id]);

    const opened = await (await api(`/api/reports/${meta.id}`, ana)).json();
    expect(opened.data).toEqual(report("a"));

    const saved = await api(`/api/reports/${meta.id}`, ana, { method: "PUT", body: { data: report("b"), version: 1 } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ name: "Vendas", version: 2 });
    expect((await (await api(`/api/reports/${meta.id}`, ana)).json()).data).toEqual(report("b"));

    const renamed = await api(`/api/reports/${meta.id}`, ana, { method: "PUT", body: { name: "Vendas 2026", version: 2 } });
    expect(await renamed.json()).toMatchObject({ name: "Vendas 2026", version: 3 });

    expect((await api(`/api/reports/${meta.id}`, ana, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/reports/${meta.id}`, ana)).status).toBe(404);
    expect(await (await api("/api/reports", ana)).json()).toEqual([]);
  });

  it("cada usuário só enxerga os próprios relatórios", async () => {
    const api = await start();
    const { id } = await (await api("/api/reports", ana, { method: "POST", body: { name: "Da Ana", data: report() } })).json();
    expect(await (await api("/api/reports", bia)).json()).toEqual([]);
    expect((await api(`/api/reports/${id}`, bia)).status).toBe(404);
    expect((await api(`/api/reports/${id}`, bia, { method: "PUT", body: { data: report("hack"), version: 1 } })).status).toBe(404);
    expect((await api(`/api/reports/${id}`, bia, { method: "DELETE" })).status).toBe(404);
    expect((await (await api(`/api/reports/${id}`, ana)).json()).data).toEqual(report());
    // O dono é o e-mail sem diferenciar maiúsculas.
    expect((await api(`/api/reports/${id}`, ana.toUpperCase())).status).toBe(200);
  });

  it("recusa salvar por cima de uma versão mais nova", async () => {
    const api = await start();
    const { id } = await (await api("/api/reports", ana, { method: "POST", body: { name: "R", data: report() } })).json();
    expect((await api(`/api/reports/${id}`, ana, { method: "PUT", body: { data: report("aba 1"), version: 1 } })).status).toBe(200);
    const stale = await api(`/api/reports/${id}`, ana, { method: "PUT", body: { data: report("aba 2"), version: 1 } });
    expect(stale.status).toBe(409);
    expect((await (await api(`/api/reports/${id}`, ana)).json()).data).toEqual(report("aba 1"));
  });

  it("valida entrada, login, tamanho e banco ausente", async () => {
    let api = await start(store, 2_000);
    expect((await api("/api/reports", null)).status).toBe(401);
    expect((await api("/api/reports", ana, { method: "POST", body: "{" })).status).toBe(400);
    expect((await api("/api/reports", ana, { method: "POST", body: { name: "", data: report() } })).status).toBe(400);
    expect((await api("/api/reports", ana, { method: "POST", body: { name: "R", data: { a: 1 } } })).status).toBe(400);
    expect((await api("/api/reports", ana, { method: "POST", body: { name: "R", data: { ...report(), tables: [{ name: "a\u0000b" }] } } })).status).toBe(400);
    expect((await api("/api/reports", ana, { method: "POST", body: { name: "R", data: { ...report(), big: "x".repeat(3_000) } } })).status).toBe(413);
    expect((await api("/api/reports/nao-e-uuid", ana)).status).toBe(404);
    expect((await api("/api/reports/x/y", ana)).status).toBe(404);
    expect((await api("/api/reports", ana, { method: "PATCH" })).status).toBe(405);
    expect(await (await api("/outra", ana)).text()).toBe("fora da API");
    server!.close();

    api = await start(null);
    const off = await api("/api/reports", ana);
    expect(off.status).toBe(503);
    expect((await off.json()).error).toContain("DATABASE_URL");
  });
});
