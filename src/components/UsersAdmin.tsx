import { useEffect, useMemo, useState } from "react";

type Role = "admin" | "user" | "free";
type Status = "active" | "pending" | "blocked";

interface UserInfo {
  email: string;
  name: string;
  picture?: string;
  role: Role;
  status: Status;
  lastLoginAt?: string;
  fromEnv: boolean;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/users${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Erro ${res.status}.`);
  return data as T;
}

/** Papéis na ordem em que aparecem nas listas; "free" é o de quem se cadastra sozinho. */
const ROLES: [Role, string][] = [["free", "Gratuito (free)"], ["user", "Usuário (user)"], ["admin", "Administrador"]];
const ROLE_LABEL: Record<Role, string> = { free: "gratuito", user: "usuário", admin: "administrador" };
const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca entrou");

/** "Usuários" (só administradores): quem entrou, papel de cada pessoa e bloqueio. */
export function UsersAdmin({ me, onClose }: { me: string; onClose: () => void }) {
  const [users, setUsers] = useState<UserInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>("Carregando…");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("free");
  const [search, setSearch] = useState("");

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

  const reload = () => run("Carregando…", async () => setUsers(await call<UserInfo[]>("")));
  useEffect(() => {
    void reload();
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replace = (u: UserInfo) => setUsers((list) => list?.map((x) => (x.email === u.email ? u : x)) ?? null);
  const patch = (u: UserInfo, body: Partial<Pick<UserInfo, "role" | "status">>) =>
    run("Salvando…", async () => replace(await call<UserInfo>(`/${encodeURIComponent(u.email)}`, "PATCH", body)));
  const remove = (u: UserInfo) => {
    if (!confirm(`Remover ${u.email}? Os relatórios dele continuam no banco; se entrar de novo, é cadastrado outra vez como gratuito.`)) return;
    void run("Removendo…", async () => {
      await call(`/${encodeURIComponent(u.email)}`, "DELETE");
      setUsers((list) => list?.filter((x) => x.email !== u.email) ?? null);
    });
  };
  const add = () => run("Cadastrando…", async () => {
    const u = await call<UserInfo>("", "POST", { email, role });
    setUsers((list) => [u, ...(list ?? []).filter((x) => x.email !== u.email)]);
    setEmail("");
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => !q || u.email.includes(q) || u.name.toLowerCase().includes(q));
  }, [users, search]);
  const counts = useMemo(() => {
    const c = { free: 0, user: 0, admin: 0, blocked: 0 };
    for (const u of users ?? []) {
      if (u.status === "blocked") c.blocked++;
      else c[u.role]++;
    }
    return c;
  }, [users]);

  const row = (u: UserInfo) => {
    const locked = u.fromEnv || u.email === me.toLowerCase();
    return (
      <li key={u.email} className={`user-row ${u.status}`}>
        {u.picture ? <img src={u.picture} alt="" referrerPolicy="no-referrer" /> : <span className="user-avatar">{(u.name || u.email)[0].toUpperCase()}</span>}
        <span className="user-main">
          <strong>{u.name || u.email}</strong>
          <span className="small muted">
            {u.name && `${u.email} · `}<span className={`role-tag ${u.role}`}>{ROLE_LABEL[u.role]}</span>
            {u.status === "blocked" && " · bloqueado"} · {fmtWhen(u.lastLoginAt)}
            {u.fromEnv && " · fixo no .env"}{u.email === me.toLowerCase() && " · você"}
          </span>
        </span>
        {!locked && (
          <>
            <select value={u.role} disabled={!!busy} title="Papel" onChange={(e) => void patch(u, { role: e.target.value as Role })}>
              {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
            </select>
            <button disabled={!!busy} onClick={() => void patch(u, { status: u.status === "blocked" ? "active" : "blocked" })}>
              {u.status === "blocked" ? "Desbloquear" : "Bloquear"}
            </button>
            <button className="menu-icon" disabled={!!busy} title="Remover" onClick={() => remove(u)}>✕</button>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal users-dialog">
        <h3>👥 Usuários</h3>
        <p className="small muted">
          Qualquer conta Google pode entrar: no primeiro acesso a pessoa é cadastrada como <strong>gratuito (free)</strong>.
          Aqui você troca o papel e bloqueia — o bloqueio vale na hora, mesmo para quem está com o app aberto.
        </p>
        {users && (
          <div className="users-counts">
            <span><b>{counts.free}</b> gratuitos</span>
            <span><b>{counts.user}</b> usuários</span>
            <span><b>{counts.admin}</b> administradores</span>
            {counts.blocked > 0 && <span><b>{counts.blocked}</b> bloqueados</span>}
          </div>
        )}
        <form className="field-row users-invite" onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void add();
        }}>
          <label className="field" style={{ flex: 2 }}>
            Cadastrar antes do primeiro acesso (conta Google)
            <input type="email" value={email} placeholder="nome@gmail.com" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Papel
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
            </select>
          </label>
          <button className="primary" type="submit" disabled={!!busy || !email.trim()}>Cadastrar</button>
        </form>

        {users && users.length > 6 && (
          <input className="users-search" type="search" placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {users && <ul className="users-list">{shown.map(row)}</ul>}
        {users && shown.length === 0 && <div className="small muted">Ninguém encontrado.</div>}

        {busy && <div className="small muted">{busy}</div>}
        {error && <div className="error small">{error}</div>}
        <div className="modal-actions">
          <button disabled={!!busy} onClick={() => void reload()}>↻ Atualizar</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
