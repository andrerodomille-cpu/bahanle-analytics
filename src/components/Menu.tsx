import { useEffect, useRef, useState } from "react";

/** Menu suspenso simples: abre no clique, fecha ao clicar fora, em Esc ou ao escolher um item. */
export function Menu({ label, align = "left", children }: {
  label: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className={open ? "active" : ""} onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div
          className={`menu-panel ${align}`}
          onClick={(e) => {
            // Fecha ao escolher um item (botões), mas não ao clicar em textos.
            if ((e.target as HTMLElement).closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
