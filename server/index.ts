// Servidor de produção: entrega o build (dist/) e a API só para quem fez login.
//   npm run build && npm start      (lê o .env; porta em PORT, padrão 8080)

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { authMiddleware, configFromEnv, configProblems } from "./auth.ts";
import { poolFromEnv } from "./db.ts";
import { pgReportStore, reportsApi } from "./reports.ts";
import { dbPolicy, envPolicy, usersApi } from "./users.ts";

const ROOT = resolve(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 8080;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json",
};

const config = configFromEnv(process.env);
for (const p of configProblems(config)) console.warn(`⚠ ${p}`);
const pool = poolFromEnv(process.env);
if (!pool) console.warn("⚠ DATABASE_URL não definido: usuários não ficam guardados e relatórios na nuvem desligados.");
const users = pool ? dbPolicy(pool, config) : null;
const auth = authMiddleware(config, users ?? envPolicy(config));
const admin = usersApi(users, config);
const reports = reportsApi(pool ? pgReportStore(pool) : null);

/** Arquivo pedido dentro de dist/; caminhos sem arquivo caem no index.html (app de página única). */
async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT + sep)) file = join(ROOT, "index.html");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) file = join(ROOT, "index.html");
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    // Arquivos com hash no nome (assets/) podem ficar em cache; o resto, não.
    "Cache-Control": file.includes(`${sep}assets${sep}`) ? "private, max-age=31536000, immutable" : "no-store",
  });
  createReadStream(file).pipe(res);
}

function fail(res: ServerResponse, err: unknown) {
  console.error(err);
  if (!res.headersSent) res.writeHead(500);
  res.end();
}

// /healthz (aberto, para o health check do Render) → login → usuários → relatórios → arquivos do app.
createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("ok");
    return;
  }
  void auth(req, res, (err) => {
    if (err) return fail(res, err);
    void admin(req, res, (err) => {
      if (err) return fail(res, err);
      void reports(req, res, (err) => (err ? fail(res, err) : void serveStatic(req, res).catch((e) => fail(res, e))));
    });
  });
}).listen(PORT, () => console.log(`Dantreun Analytics em http://localhost:${PORT}`));
