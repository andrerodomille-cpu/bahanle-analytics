import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { type Account } from "./App";
import { emptyReport, loadDraft, migrate } from "./model/store";
import { EMBED_ID } from "./model/publish";
import type { Report } from "./model/types";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

// Relatório publicado: o HTML traz os dados embutidos e abre só para leitura.
const embedded = document.getElementById(EMBED_ID)?.textContent;

async function start() {
  if (embedded) {
    root.render(<StrictMode><App initial={migrate(JSON.parse(embedded) as Report)} viewOnly /></StrictMode>);
    return;
  }
  // Quem está logado (o servidor só entrega o app depois do login).
  const account = await fetch("/api/auth/me")
    .then((r) => (r.ok ? (r.json() as Promise<Account>) : null))
    .catch(() => null);
  // O editor começa com o rascunho desta conta neste navegador (ou em branco); a
  // página inicial lista os relatórios salvos. Sem login (servidor sem auth), o exemplo.
  const draft = loadDraft(account?.email) ?? (account ? emptyReport() : undefined);
  root.render(<StrictMode><App account={account} initial={draft} /></StrictMode>);
}

void start();
