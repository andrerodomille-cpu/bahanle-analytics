// Servidor de produção: entrega o build (dist/) só para quem fez login.
//   npm run build && npm start      (lê o .env; porta em PORT, padrão 8080)

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { authMiddleware, configFromEnv, configProblems } from "./auth.ts";

const ROOT = resolve(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 8080;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json",
};

const config = configFromEnv(process.env);
for (const p of configProblems(config)) console.warn(`⚠ ${p}`);
const auth = authMiddleware(config);

createServer((req, res) => {
  void auth(req, res, async (err) => {
    if (err) {
      console.error(err);
      res.writeHead(500).end();
      return;
    }
    // Arquivo pedido dentro de dist/; caminhos sem arquivo caem no index.html (app de página única).
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
  });
}).listen(PORT, () => console.log(`Mini BI em http://localhost:${PORT}`));
