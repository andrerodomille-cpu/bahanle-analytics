import { useEffect, useState } from "react";
import type { Report } from "../model/types";
import type { CloudLink, CloudSummary } from "../model/cloud";
import { deleteCloudReport, listCloudReports, openCloudReport, renameCloudReport } from "../model/cloud";

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`).replace(".", ",");

/** "Arquivo › Meus relatórios": os relatórios salvos na conta, para abrir, renomear ou excluir. */
export function CloudReports({ link, dirty, onOpen, onLinkChange, onClose }: {
  link: CloudLink | null;
  /** O relatório aberto tem alterações que não foram para a nuvem. */
  dirty: boolean;
  onOpen: (link: CloudLink, report: Report) => void;
  /** O relatório aberto foi renomeado (novo vínculo) ou excluído (null). */
  onLinkChange: (link: CloudLink | null) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CloudSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>("Carregando…");
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, task: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reload = () => run("Carregando…", async () => setItems(await listCloudReports()));
  useEffect(() => {
    void reload();
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (r: CloudSummary) => {
    if (dirty && !confirm("O relatório aberto tem alterações que não foram salvas na nuvem. Abrir outro mesmo assim?")) return;
    void run(`Abrindo ${r.name}…`, async () => {
      const { link: l, report } = await openCloudReport(r.id);
      onOpen(l, report);
      onClose();
    });
  };

  const rename = (r: CloudSummary) => {
    const name = prompt("Novo nome:", r.name)?.trim();
    if (!name || name === r.name) return;
    void run("Renomeando…", async () => {
      const s = await renameCloudReport(r.id, name, r.version);
      setItems((list) => list?.map((x) => (x.id === s.id ? s : x)) ?? null);
      if (link?.id === r.id) onLinkChange({ ...link, name: s.name, version: s.version });
    });
  };

  const remove = (r: CloudSummary) => {
    if (!confirm(`Excluir "${r.name}" da nuvem? Não dá para desfazer.`)) return;
    void run("Excluindo…", async () => {
      await deleteCloudReport(r.id);
      setItems((list) => list?.filter((x) => x.id !== r.id) ?? null);
      if (link?.id === r.id) onLinkChange(null);
    });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cloud-dialog">
        <h3>☁ Meus relatórios</h3>
        {items && items.length === 0 && (
          <p className="small muted">Nenhum relatório salvo ainda. Use <strong>Arquivo › Salvar na nuvem</strong>.</p>
        )}
        {items && items.length > 0 && (
          <ul className="cloud-list">
            {items.map((r) => (
              <li key={r.id} className={link?.id === r.id ? "current" : ""}>
                <button className="cloud-open" disabled={!!busy} onClick={() => open(r)} title="Abrir">
                  <span className="cloud-name">{r.name}{link?.id === r.id && <span className="badge">aberto</span>}</span>
                  <span className="small muted">{fmtWhen(r.updatedAt)} · {fmtSize(r.size)} · versão {r.version}</span>
                </button>
                <button className="menu-icon" disabled={!!busy} title="Renomear" onClick={() => rename(r)}>✎</button>
                <button className="menu-icon" disabled={!!busy} title="Excluir" onClick={() => remove(r)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        {busy && <div className="small muted">{busy}</div>}
        {error && <div className="error small">{error}</div>}
        <div className="modal-actions">
          <button disabled={!!busy} onClick={() => void reload()}>↻ Atualizar lista</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
