// Entrega do relatório: imagem, impressão/PDF e publicação como um único HTML.

import type { Report } from "./types";

const fileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "relatorio";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

/** Exporta a página atual (o canvas) como PNG. */
export async function exportPagePng(pageName: string) {
  const canvas = document.querySelector<HTMLElement>(".canvas");
  if (!canvas) throw new Error("Abra a aba Relatório para exportar a página.");
  const { toPng } = await import("html-to-image");
  const background = getComputedStyle(canvas).backgroundColor || "#ffffff";
  const url = await toPng(canvas, {
    backgroundColor: background,
    pixelRatio: 2,
    // Esconde os botões do cabeçalho dos visuais na imagem.
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains("frame-actions")),
  });
  download(url, `${fileName(pageName)}.png`);
}

/** Imprime só a página do relatório; no diálogo, "Salvar como PDF" gera o PDF. */
export function printPage() {
  window.print();
}

/** Marcador onde o relatório é embutido no HTML publicado. */
export const EMBED_ID = "minibi-report";

/**
 * Embute o relatório no HTML do visualizador, antes do ÚLTIMO </body>: o JS
 * embutido pode conter "</head>" ou "</body>" em textos, então a primeira
 * ocorrência não é confiável. O script do app é um módulo (roda depois que o
 * documento inteiro foi lido), então os dados já existem quando ele começa.
 */
export function embedReport(viewerHtml: string, report: Report): string {
  // "<" escapado impede que um texto dos dados feche a tag <script>.
  const json = JSON.stringify(report).replace(/</g, "\\u003c");
  const at = viewerHtml.lastIndexOf("</body>");
  if (at < 0) throw new Error("HTML do visualizador inválido");
  return `${viewerHtml.slice(0, at)}<script id="${EMBED_ID}" type="application/json">${json}</script>\n${viewerHtml.slice(at)}`;
}

/**
 * Publica o relatório como um arquivo HTML autossuficiente: o visualizador
 * (o próprio app compilado num arquivo só, por `npm run build:viewer`) com
 * os dados embutidos. Quem recebe abre no navegador, sem instalar nada.
 */
export async function publishReport(report: Report) {
  const res = await fetch(`${import.meta.env.BASE_URL}viewer/index.html`, { cache: "no-store" });
  const viewer = res.ok ? await res.text() : "";
  if (!viewer.includes("</body>")) {
    throw new Error("O visualizador ainda não foi gerado. Rode \"npm run build:viewer\" (ou reinicie com \"npm run dev\").");
  }
  const html = embedReport(viewer, { ...report, filters: [] });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  download(url, "Relatório - Mini BI.html");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
