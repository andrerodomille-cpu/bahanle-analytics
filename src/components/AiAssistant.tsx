import { useEffect, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Report } from "../model/types";
import type { Action } from "../model/store";
import { DEFAULT_OLLAMA_URL, generateDashboard, listModels } from "../model/ai";
import { usePlan } from "../model/planContext";

const CONFIG_KEY = "mini-bi-ollama";

function loadConfig(): { url: string; model: string } {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as { url?: string; model?: string };
    return { url: c.url || DEFAULT_OLLAMA_URL, model: c.model ?? "" };
  } catch {
    return { url: DEFAULT_OLLAMA_URL, model: "" };
  }
}

function storeConfig(c: { url: string; model: string }) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    // sem armazenamento: só não lembra a escolha
  }
}

interface Message {
  role: "user" | "assistant";
  text: string;
  notes?: string[];
  problems?: string[];
  pageId?: string;
  error?: boolean;
}

const EXAMPLES = [
  "Total de vendas por estado",
  "Dashboard de vendas com totais, evolução mensal e top 5 produtos",
  "Ticket médio por categoria e região",
];

/** Painel "Criar com IA": pedidos em texto viram páginas, medidas e visuais (LLM local no Ollama). */
export function AiAssistant({ report, pageId, dispatch, onGoToPage, onClose }: {
  report: Report;
  pageId: string;
  dispatch: Dispatch<Action>;
  onGoToPage: (id: string) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState(loadConfig);
  const plan = usePlan();
  const [models, setModels] = useState<string[] | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [newPage, setNewPage] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const connect = async (url = config.url) => {
    setConnError(null);
    try {
      const list = await listModels(url);
      setModels(list);
      if (!list.length) setConnError("Nenhum modelo baixado. Rode, por exemplo: ollama pull qwen2.5:7b");
      // Mantém o modelo escolhido se ainda existir; senão, o primeiro da lista.
      if (list.length && !list.includes(config.model)) update({ url, model: list[0] });
    } catch (e) {
      setModels(null);
      setConnError(e instanceof Error ? e.message : String(e));
      setShowSettings(true);
    }
  };

  const update = (c: { url: string; model: string }) => {
    setConfig(c);
    storeConfig(c);
  };

  useEffect(() => {
    void connect();
    return () => abort.current?.abort();
    // só ao abrir o painel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status]);

  const send = async (text = input) => {
    const request = text.trim();
    if (!request || status || !config.model) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: request }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus("Pensando no dashboard");
    try {
      const r = await generateDashboard(report, request, config, {
        newPage,
        pageId,
        allowed: plan.allowed,
        signal: ctrl.signal,
        onStatus: setStatus,
      });
      if (r.visualCount > 0 || r.actions.length > 0) dispatch({ type: "batch", actions: r.actions });
      if (r.visualCount > 0) onGoToPage(r.pageId);
      setMessages((m) => [...m, {
        role: "assistant",
        text: r.visualCount > 0 ? r.reply : "Não consegui montar nenhum visual com os campos do modelo.",
        notes: r.notes,
        problems: r.problems,
        pageId: r.visualCount > 0 ? r.pageId : undefined,
        error: r.visualCount === 0,
      }]);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "AbortError";
      setMessages((m) => [...m, { role: "assistant", text: cancelled ? "Cancelado." : e instanceof Error ? e.message : String(e), error: !cancelled }]);
    } finally {
      abort.current = null;
      setStatus(null);
    }
  };

  const ready = !!config.model && !connError;

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <strong>✨ Criar com IA</strong>
        <span className="small muted ai-model" title="Modelo do Ollama">{config.model || "sem modelo"}</span>
        <span style={{ flex: 1 }} />
        <button className={showSettings ? "active" : ""} title="Configurar Ollama" onClick={() => setShowSettings(!showSettings)}>⚙</button>
        <button title="Fechar" onClick={onClose}>✕</button>
      </div>

      {showSettings && (
        <div className="ai-settings">
          <label className="field">
            Endereço do Ollama
            <input value={config.url} placeholder={DEFAULT_OLLAMA_URL}
              onChange={(e) => update({ ...config, url: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void connect()} />
          </label>
          <div className="field-row">
            <label className="field" style={{ flex: 1 }}>
              Modelo
              <select value={config.model} disabled={!models?.length} onChange={(e) => update({ ...config, model: e.target.value })}>
                {!models?.length && <option value="">—</option>}
                {models?.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <button style={{ alignSelf: "flex-end" }} onClick={() => void connect()}>↻ Conectar</button>
          </div>
          <p className="small muted">
            O modelo roda no seu computador. Modelos de 7B ou mais (ex.: <code>qwen2.5:7b</code>, <code>llama3.1:8b</code>)
            acertam bem mais os campos que os pequenos.
          </p>
        </div>
      )}
      {connError && <div className="error small ai-error">{connError}</div>}

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <p className="small muted">Descreva o dashboard. A IA conhece as tabelas, colunas e medidas do modelo.</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="ai-example" disabled={!ready || !!status} onClick={() => void send(ex)}>{ex}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}${m.error ? " error" : ""}`}>
            <div>{m.text}</div>
            {m.notes && m.notes.length > 0 && (
              <ul className="small">{m.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>
            )}
            {m.problems && m.problems.length > 0 && (
              <details className="small">
                <summary>{m.problems.length} {m.problems.length === 1 ? "item ignorado" : "itens ignorados"}</summary>
                <ul>{m.problems.map((p, j) => <li key={j}>{p}</li>)}</ul>
              </details>
            )}
            {m.pageId && report.pages.some((p) => p.id === m.pageId) && (
              <button className="link small" onClick={() => onGoToPage(m.pageId!)}>Ver página</button>
            )}
          </div>
        ))}
        {status && <div className="ai-msg assistant muted"><span className="ai-dots">{status}</span></div>}
      </div>

      <div className="ai-input">
        <textarea
          rows={2}
          value={input}
          placeholder="Ex.: total de vendas por estado"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-actions">
          <label className="check small">
            <input type="checkbox" checked={newPage} onChange={(e) => setNewPage(e.target.checked)} />
            Em nova página
          </label>
          <span style={{ flex: 1 }} />
          {status
            ? <button onClick={() => abort.current?.abort()}>Parar</button>
            : <button className="primary" disabled={!ready || !input.trim()} onClick={() => void send()}>Criar</button>}
        </div>
        <div className="small muted">Ctrl+Z desfaz tudo o que a IA criou de uma vez.</div>
      </div>
    </aside>
  );
}
