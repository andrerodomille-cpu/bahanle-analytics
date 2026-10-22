import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { authMiddleware, configFromEnv, configProblems } from "./server/auth.ts";
import { poolFromEnv } from "./server/db.ts";
import { pgReportStore, reportsApi } from "./server/reports.ts";
import { dbPolicy, envPolicy, usersApi } from "./server/users.ts";

/** Login com Google, usuários e relatórios também no `npm run dev` e no `vite preview` (ver server/). */
function googleLogin(env: Record<string, string>): Plugin {
  const config = configFromEnv(env);
  const pool = poolFromEnv(env);
  const users = pool ? dbPolicy(pool, config) : null;
  const middlewares = [
    authMiddleware(config, users ?? envPolicy(config)),
    usersApi(users, config),
    reportsApi(pool ? pgReportStore(pool) : null),
  ];
  return {
    name: "dantreun-google-login",
    configureServer(server) {
      for (const p of configProblems(config)) server.config.logger.warn(`⚠ Login: ${p}`);
      if (!pool) server.config.logger.warn("⚠ DATABASE_URL não definido: usuários não ficam guardados e relatórios na nuvem desligados.");
      for (const m of middlewares) server.middlewares.use(m);
    },
    configurePreviewServer(server) {
      for (const m of middlewares) server.middlewares.use(m);
    },
  };
}

// `vite build --mode viewer` gera o visualizador: o app inteiro num único
// index.html (JS e CSS embutidos), usado por "Publicar relatório".
export default defineConfig(({ mode }) =>
  mode === "viewer"
    ? {
        plugins: [react(), viteSingleFile()],
        publicDir: false,
        build: { outDir: "public/viewer", emptyOutDir: true },
      }
    : {
        plugins: [react(), googleLogin(loadEnv(mode, process.cwd(), ""))],
      },
);
