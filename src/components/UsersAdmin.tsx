import { useEffect, useState } from "react";

type Role = "admin" | "user";
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

const STATUS: Record<Status, string> = { active: "ativo", pending: "pediu acesso", blocked: "bloqueado" };
const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca entrou");

/** "Usuários" (só administradores): pedidos de acesso, convites, bloqueio e papel de cada pessoa. */
export function UsersAdmin({ me, onClose }: { me: string; onClose: () => void }) {
  const [users, setUsers] = useState<UserInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>("Carregando…");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");

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
    if (!confirm(`Remover ${u.email}? Os relatórios dele continuam no banco; se entrar de novo, vira um pedido de acesso.`)) return;
    void run("Removendo…", async () => {
      await call(`/${encodeURIComponent(u.email)}`, "DELETE");
      setUsers((list) => list?.filter((x) => x.email !== u.email) ?? null);
    });
  };
  const invite = () => run("Convidando…", async () => {
    const u = await call<UserInfo>("", "POST", { email, role });
    setUsers((list) => [u, ...(list ?? []).filter((x) => x.email !== u.email)]);
    setEmail("");
  });

  const pending = users?.filter((u) => u.status === "pending") ?? [];
  const others = users?.filter((u) => u.status !== "pending") ?? [];

  const row = (u: UserInfo) => {
    const locked = u.fromEnv || u.email === me.toLowerCase();
    return (
      <li key={u.email} className={`user-row ${u.status}`}>
        {u.picture ? <img src={u.picture} alt="" referrerPolicy="no-referrer" /> : <span className="user-avatar">{(u.name || u.email)[0].toUpperCase()}</span>}
        <span className="user-main">
          <strong>{u.name || u.email}</strong>
          <span className="small muted">
            {u.name && `${u.email} · `}{u.role === "admin" ? "administrador" : "usuário"} · {STATUS[u.status]} · {fmtWhen(u.lastLoginAt)}
            {u.fromEnv && " · fixo no .env"}{u.email === me.toLowerCase() && " · você"}
          </span>
        </span>
        {u.status === "pending" ? (
          <>
            <button className="primary" disabled={!!busy} onClick={() => void patch(u, { status: "active" })}>Aprovar</button>
            <button disabled={!!busy} onClick={() => void patch(u, { status: "blocked" })}>Recusar</button>
          </>
        ) : !locked && (
          <>
            <select value={u.role} disabled={!!busy} title="Papel" onChange={(e) => void patch(u, { role: e.target.value as Role })}>
              <option value="user">Usuário</option>
              <option value="admin">Administrador</option>
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
        <form className="field-row users-invite" onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void invite();
        }}>
          <label className="field" style={{ flex: 2 }}>
            Convidar (conta Google)
            <input type="email" value={email} placeholder="nome@gmail.com" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Papel
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">Usuário</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={!!busy || !email.trim()}>Convidar</button>
        </form>
        <p className="small muted">
          Quem não foi convidado e entra com o Google vira um <strong>pedido de acesso</strong> aqui. Bloquear tira o acesso na hora, mesmo de quem está com o app aberto.
        </p>

        {pending.length > 0 && (
          <>
            <div className="users-title">Pedidos de acesso ({pending.length})</div>
            <ul className="users-list">{pending.map(row)}</ul>
          </>
        )}
        {users && (
          <>
            <div className="users-title">Com acesso ou bloqueados ({others.length})</div>
            <ul className="users-list">{others.map(row)}</ul>
          </>
        )}

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
