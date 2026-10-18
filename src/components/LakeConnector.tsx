import { useState } from "react";
import type { Dispatch } from "react";
import type { Report, Table } from "../model/types";
import type { Action } from "../model/store";
import type { LakeTableInfo } from "../model/lake";
import { LAKE_ROW_LIMIT, detectRelationships, fetchLakeTable, listLakeTables, saveToken, savedToken } from "../model/lake";

const DEFAULT_URL = "http://localhost:8000";
const URL_KEY = "nextop-lake-url";

function lastUrl() {
  try {
    return localStorage.getItem(URL_KEY) ?? DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

const fmtRows = (n: number) => n.toLocaleString("pt-BR");
const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`).replace(".", ",");
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** "Obter dados › nextop-lake": conecta na API do pipeline, escolhe tabelas e importa. */
export function LakeDialog({ report, dispatch, onClose }: { report: Report; dispatch: Dispatch<Action>; onClose: () => void }) {
  const [url, setUrl] = useState(lastUrl);
  const [token, setToken] = useState(() => savedToken(lastUrl()));
  const [tables, setTables] = useState<LakeTableInfo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [relations, setRelations] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const conn = { url, token: token || undefined };
  const key = (t: LakeTableInfo) => `${t.layer}.${t.name}`;

  const connect = async () => {
    setError(null);
    setBusy("Conectando…");
    try {
      const list = await listLakeTables(conn);
      setTables(list);
      try {
        localStorage.setItem(URL_KEY, url);
      } catch {
        // sem armazenamento: só não lembra a URL
      }
      saveToken(url, token);
      // Já marca as tabelas gold (as prontas para o BI).
      setPicked(new Set(list.filter((t) => t.layer === "gold").map(key)));
    } catch (e) {
      setTables(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importPicked = async () => {
    if (!tables) return;
    setError(null);
    const chosen = tables.filter((t) => picked.has(key(t)));
    const notes: string[] = [];
    const imported: Table[] = [];
    try {
      for (const t of chosen) {
        setBusy(`Importando ${key(t)}…`);
        // Mesmo nome de uma tabela que não veio deste lake: não sobrescreve, ganha sufixo.
        const clash = report.tables.find((x) => x.name === t.name && !(x.remote?.layer === t.layer && x.remote?.name === t.name));
        const modelName = clash ? `${t.name}_${t.layer}` : t.name;
        const existing = report.tables.find((x) => x.name === modelName);
        const { table, truncated, total } = await fetchLakeTable(conn, t.layer, t.name, modelName, existing?.query?.steps);
        dispatch(existing ? { type: "refreshTable", table } : { type: "addTable", table });
        imported.push(table);
        notes.push(`${existing ? "↻" : "✓"} ${modelName}: ${fmtRows(table.rows.length)} linhas` +
          (truncated ? ` (de ${fmtRows(total)}; limite de ${fmtRows(LAKE_ROW_LIMIT)} — agregue na gold)` : ""));
      }
      if (relations && imported.length) {
        const others = report.tables.filter((x) => !imported.some((i) => i.name === x.name));
        const rels = detectRelationships([...others, ...imported], report.relationships)
          .filter((r) => imported.some((i) => i.name === r.from.table || i.name === r.to.table));
        for (const rel of rels) {
          dispatch({ type: "addRelationship", rel });
          notes.push(`⇄ ${rel.from.table}[${rel.from.column}] → ${rel.to.table}[${rel.to.column}]`);
        }
      }
      setDone(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (notes.length) setDone(notes);
    } finally {
      setBusy(null);
    }
  };

  const layers = tables ? [...new Set(tables.map((t) => t.layer))] : [];

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal lake-dialog">
        <h3>🔌 Conectar ao nextop-lake</h3>
        <p className="small muted">
          Tabelas em Parquet das camadas silver e gold, servidas pela API do pipeline (<code>nextoplake serve</code>).
        </p>
        <div className="field-row">
          <label className="field" style={{ flex: 2 }}>
            URL da API
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_URL}
              onKeyDown={(e) => e.key === "Enter" && void connect()} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Token (opcional)
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </label>
        </div>
        <button className="primary" disabled={!!busy || !url.trim()} onClick={() => void connect()}>
          {tables ? "↻ Reconectar" : "Conectar"}
        </button>

        {tables && tables.length === 0 && (
          <p className="small muted">Nenhuma tabela publicada. Rode o pipeline (<code>nextoplake run</code>) e reconecte.</p>
        )}
        {tables && tables.length > 0 && (
          <div className="lake-list">
            {layers.map((layer) => (
              <div key={layer}>
                <div className="lake-layer">{layer === "gold" ? "🥇 gold — pronta para o BI" : layer === "silver" ? "🥈 silver — limpa" : layer}</div>
                {tables.filter((t) => t.layer === layer).map((t) => {
                  const inModel = report.tables.some((x) => x.remote?.layer === t.layer && x.remote?.name === t.name);
                  return (
                    <label key={key(t)} className="lake-item">
                      <input type="checkbox" checked={picked.has(key(t))} onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(key(t));
                        else next.delete(key(t));
                        setPicked(next);
                      }} />
                      <span className="lake-name">{t.name}{inModel && <span className="badge">no modelo</span>}</span>
                      <span className="small muted">{fmtRows(t.rows)} linhas · {t.columns.length} col. · {fmtBytes(t.bytes)} · {fmtWhen(t.updated_at)}</span>
                    </label>
                  );
                })}
              </div>
            ))}
            <label className="check">
              <input type="checkbox" checked={relations} onChange={(e) => setRelations(e.target.checked)} />
              Detectar relacionamentos (colunas de mesmo nome: chave única de um lado, repetida do outro)
            </label>
          </div>
        )}

        {busy && <div className="small muted">{busy}</div>}
        {error && <div className="error small">{error}</div>}
        {done.length > 0 && <ul className="lake-done small">{done.map((n, i) => <li key={i}>{n}</li>)}</ul>}

        <div className="modal-actions">
          {tables && tables.length > 0 && (
            <button className="primary" disabled={!!busy || picked.size === 0} onClick={() => void importPicked()}>
              Importar {picked.size} {picked.size === 1 ? "tabela" : "tabelas"}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>{done.length ? "Concluir" : "Cancelar"}</button>
        </div>
      </div>
    </div>
  );
}

/** "Atualizar" do Power BI: busca de novo todas as tabelas que vieram do nextop-lake. */
export async function refreshLakeTables(report: Report, dispatch: Dispatch<Action>): Promise<string> {
  const remote = report.tables.filter((t) => t.remote);
  if (!remote.length) return "Nenhuma tabela do nextop-lake no modelo.";
  let rows = 0;
  for (const t of remote) {
    const r = t.remote!;
    const { table } = await fetchLakeTable({ url: r.url, token: savedToken(r.url) || undefined }, r.layer, r.name, t.name, t.query?.steps);
    dispatch({ type: "refreshTable", table });
    rows += table.rows.length;
  }
  return `${remote.length} ${remote.length === 1 ? "tabela atualizada" : "tabelas atualizadas"} (${rows.toLocaleString("pt-BR")} linhas).`;
}
