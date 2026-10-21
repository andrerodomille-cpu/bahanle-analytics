import { useEffect, useMemo, useState } from "react";
import type { CloudSummary } from "../model/cloud";
import { deleteCloudReport, listCloudReports, renameCloudReport } from "../model/cloud";

/** Marca: três barras crescentes. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="17" width="7" height="12" rx="1.5" />
      <rect x="12.5" y="10" width="7" height="19" rx="1.5" />
      <rect x="22" y="3" width="7" height="26" rx="1.5" />
    </svg>
  );
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "há 5 minutos", "ontem", "em 3 de out." */
export function editedAgo(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return "agora há pouco";
  if (abs < 3600) return relative.format(Math.round(s / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86400) return relative.format(Math.round(s / 86400), "day");
  return `em ${new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: abs > 300 * 86400 ? "numeric" : undefined })}`;
}

/**
 * Miniatura de cada relatório nas cores da marca: a variante (fundo amarelo ou
 * vermelho, linha ou só colunas) e as alturas saem do id, sempre iguais para o
 * mesmo relatório.
 */
function Thumb({ seed }: { seed: string }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const variant = h % 4;
  const bars = Array.from({ length: 6 }, (_, i) => 30 + ((h >>> (i * 3)) % 60));
  const line = bars.map((b, i) => `${19.5 + i * 23},${78 - b * 0.55}`).join(" ");
  return (
    <svg className={`thumb v${variant}`} viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">
      <rect className="thumb-bg" width="160" height="90" />
      <rect className="thumb-card" x="10" y="10" width="44" height="22" rx="3" />
      <rect className="thumb-card" x="58" y="10" width="44" height="22" rx="3" />
      <rect className="thumb-card" x="106" y="10" width="44" height="22" rx="3" />
      {bars.map((b, i) => (
        <rect key={i} className={i % 2 ? "thumb-bar alt" : "thumb-bar"} x={12 + i * 23} y={84 - b * 0.7} width="15" height={b * 0.7} rx="2" />
      ))}
      {variant % 2 === 0 && <polyline className="thumb-line" points={line} />}
    </svg>
  );
}

export interface HomeProps {
  firstName: string;
  /** O que está aberto no editor (para o "Continuar de onde parou"). */
  current: { id?: string; name: string; unsaved: boolean } | null;
  onContinue: () => void;
  onOpen: (r: CloudSummary) => void;
  onCreate: (from: "blank" | "example") => void;
  /** Pede um nome numa janela do app (null = cancelou). */
  askName: (title: string, initial: string, action: string) => Promise<string | null>;
  /** O relatório aberto no editor foi renomeado ou excluído aqui. */
  onCurrentChanged: (r: CloudSummary | null) => void;
}

/** Página inicial: criar relatórios e abrir os da conta. */
export function Home({ firstName, current, onContinue, onOpen, onCreate, askName, onCurrentChanged }: HomeProps) {
  const [items, setItems] = useState<CloudSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");

  const load = () => {
    setError(null);
    listCloudReports().then(setItems).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  const shown = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const list = (items ?? []).filter((r) => !q || r.name.toLocaleLowerCase("pt-BR").includes(q));
    return sort === "name"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      : [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, search, sort]);

  const act = async (id: string, task: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const rename = async (r: CloudSummary) => {
    const name = await askName("Renomear relatório", r.name, "Renomear");
    if (!name || name === r.name) return;
    void act(r.id, async () => {
      const s = await renameCloudReport(r.id, name, r.version);
      setItems((list) => list?.map((x) => (x.id === s.id ? s : x)) ?? null);
      if (current?.id === s.id) onCurrentChanged(s);
    });
  };

  const remove = (r: CloudSummary) => {
    if (!confirm(`Excluir "${r.name}"? Não dá para desfazer.`)) return;
    void act(r.id, async () => {
      await deleteCloudReport(r.id);
      setItems((list) => list?.filter((x) => x.id !== r.id) ?? null);
      if (current?.id === r.id) onCurrentChanged(null);
    });
  };

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-hero">
          <div>
            <span className="home-eyebrow">Meus relatórios</span>
            <h1>Olá, <em>{firstName}</em></h1>
            <p>Crie um relatório ou continue de onde parou.</p>
          </div>
          <button className="primary big" onClick={() => onCreate("blank")}>+ Novo relatório</button>
        </header>

        {current && (
          <button className="home-continue" onClick={onContinue}>
            <span className="home-continue-icon">↺</span>
            <span>
              <strong>Continuar de onde parou</strong>
              <span className="muted">
                {current.name}{current.unsaved ? " · alterações ainda não salvas" : ""}
              </span>
            </span>
            <span className="home-continue-go">Abrir →</span>
          </button>
        )}

        <section>
          <h2>Começar</h2>
          <div className="tpl-grid">
            <button className="tpl" onClick={() => onCreate("blank")}>
              <span className="tpl-art blank"><span>+</span></span>
              <span className="tpl-text">
                <strong>Relatório em branco</strong>
                <span className="muted">Comece do zero: importe CSV, Excel ou JSON e monte os visuais.</span>
              </span>
            </button>
            <button className="tpl" onClick={() => onCreate("example")}>
              <span className="tpl-art example"><Thumb seed="modelo-de-vendas" /></span>
              <span className="tpl-text">
                <strong>Modelo de vendas</strong>
                <span className="muted">Exemplo completo: medidas, mapas, análises e mais de 40 tipos de visual.</span>
              </span>
            </button>
          </div>
        </section>

        <section>
          <div className="home-list-head">
            <h2>Meus relatórios {items && items.length > 0 && <span className="count">{items.length}</span>}</h2>
            {items && items.length > 0 && (
              <div className="home-tools">
                <input type="search" placeholder="Buscar por nome" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")} aria-label="Ordenar">
                  <option value="recent">Mais recentes</option>
                  <option value="name">Nome (A–Z)</option>
                </select>
              </div>
            )}
          </div>

          {error && (
            <div className="home-error">
              {error} <button className="link" onClick={load}>Tentar de novo</button>
            </div>
          )}
          {!items && !error && (
            <div className="report-grid">{[0, 1, 2].map((i) => <div key={i} className="report-card skeleton" />)}</div>
          )}
          {items && items.length === 0 && (
            <div className="home-empty">
              <BrandMark size={36} />
              <strong>Você ainda não tem relatórios</strong>
              <span className="muted">Crie um em branco ou comece pelo modelo de vendas. Tudo o que você fizer é salvo sozinho.</span>
              <button className="primary" onClick={() => onCreate("blank")}>+ Novo relatório</button>
            </div>
          )}
          {items && items.length > 0 && shown.length === 0 && (
            <div className="home-empty small"><span className="muted">Nenhum relatório com "{search}".</span></div>
          )}
          {shown.length > 0 && (
            <div className="report-grid">
              {shown.map((r) => (
                <div key={r.id} className={"report-card" + (busy === r.id ? " busy" : "")}>
                  <button className="report-open" onClick={() => onOpen(r)} disabled={!!busy} title={`Abrir ${r.name}`}>
                    <Thumb seed={r.id} />
                    <span className="report-name">{r.name}</span>
                    <span className="report-meta muted">
                      Editado {editedAgo(r.updatedAt)}{current?.id === r.id && <span className="badge-open">aberto</span>}
                    </span>
                  </button>
                  <div className="report-actions">
                    <button title="Renomear" aria-label={`Renomear ${r.name}`} disabled={!!busy} onClick={() => void rename(r)}>✎</button>
                    <button title="Excluir" aria-label={`Excluir ${r.name}`} disabled={!!busy} onClick={() => remove(r)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Janela para dar nome a um relatório (no lugar do prompt do navegador). */
export function NameDialog({ title, initial, action, onDone }: {
  title: string;
  initial: string;
  action: string;
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0 && name.trim().length <= 120;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form className="modal name-dialog" onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDone(name.trim());
      }}>
        <h3>{title}</h3>
        <label className="field">
          Nome
          <input autoFocus value={name} maxLength={120} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onDone(null)} />
        </label>
        <div className="modal-actions">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onDone(null)}>Cancelar</button>
          <button type="submit" className="primary" disabled={!ok}>{action}</button>
        </div>
      </form>
    </div>
  );
}
