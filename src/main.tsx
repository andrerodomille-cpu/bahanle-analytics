import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { migrate } from "./model/store";
import { EMBED_ID } from "./model/publish";
import type { Report } from "./model/types";
import "./styles.css";

// Relatório publicado: o HTML traz os dados embutidos e abre só para leitura.
const embedded = document.getElementById(EMBED_ID)?.textContent;
const initial = embedded ? migrate(JSON.parse(embedded) as Report) : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initial={initial} viewOnly={!!initial} />
  </StrictMode>,
);
