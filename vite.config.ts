import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { authMiddleware, configFromEnv, configProblems } from "./server/auth.ts";

/** Login com Google também no `npm run dev` e no `vite preview` (ver server/auth.ts). */
function googleLogin(env: Record<string, string>): Plugin {
  const config = configFromEnv(env);
  return {
    name: "mini-bi-google-login",
    configureServer(server) {
      for (const p of configProblems(config)) server.config.logger.warn(`⚠ Login: ${p}`);
      server.middlewares.use(authMiddleware(config));
    },
    configurePreviewServer(server) {
      server.middlewares.use(authMiddleware(config));
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
