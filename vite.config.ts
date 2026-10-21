import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { authMiddleware, configFromEnv, configProblems } from "./server/auth.ts";
import { reportsApi, storeFromEnv } from "./server/reports.ts";

/** Login com Google e API de relatórios também no `npm run dev` e no `vite preview` (ver server/). */
function googleLogin(env: Record<string, string>): Plugin {
  const config = configFromEnv(env);
  const store = storeFromEnv(env);
  return {
    name: "bahanle-google-login",
    configureServer(server) {
      for (const p of configProblems(config)) server.config.logger.warn(`⚠ Login: ${p}`);
      if (!store) server.config.logger.warn("⚠ DATABASE_URL não definido: relatórios na nuvem desligados.");
      server.middlewares.use(authMiddleware(config));
      server.middlewares.use(reportsApi(store));
    },
    configurePreviewServer(server) {
      server.middlewares.use(authMiddleware(config));
      server.middlewares.use(reportsApi(store));
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
