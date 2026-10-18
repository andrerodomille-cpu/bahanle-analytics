import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

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
        plugins: [react()],
      },
);
