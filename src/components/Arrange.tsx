import type { Dispatch } from "react";
import type { Visual } from "../model/types";
import { newId } from "../model/types";
import type { Action } from "../model/store";
import type { AlignMode, Patches } from "../engine/arrange";
import { alignPatches, distributePatches, sameSizePatches } from "../engine/arrange";

const ALIGN: [AlignMode, string, string][] = [
  ["left", "⇤", "Alinhar à esquerda"],
  ["center", "↔", "Centralizar na horizontal"],
  ["right", "⇥", "Alinhar à direita"],
  ["top", "⤒", "Alinhar ao topo"],
  ["middle", "↕", "Centralizar na vertical"],
  ["bottom", "⤓", "Alinhar à base"],
];

/**
 * Painel com vários visuais selecionados (Formatar › Organizar):
 * alinhar, distribuir, igualar tamanhos e agrupar. Cada botão é um único
 * passo de desfazer.
 */
export function ArrangePane({ visuals, dispatch, onSelect }: {
  visuals: Visual[];
  dispatch: Dispatch<Action>;
  onSelect: (ids: string[]) => void;
}) {
  const apply = (patches: Patches) => dispatch({ type: "updateVisuals", patches });
  const groups = new Set(visuals.map((v) => v.groupId).filter(Boolean));
  const allOneGroup = groups.size === 1 && visuals.every((v) => v.groupId);
  const anyGroup = groups.size > 0;
  return (
    <aside className="pane right arrange">
      <h3>{visuals.length} visuais selecionados</h3>
      <p className="muted small">Ctrl/Shift+clique no título acrescenta ou tira um visual. Arraste o título para mover todos.</p>

      <h3>Alinhar</h3>
      <div className="arrange-grid">
        {ALIGN.map(([mode, icon, label]) => (
          <button key={mode} title={label} onClick={() => apply(alignPatches(visuals, mode))}>
            <span className="arrange-icon">{icon}</span> {label.replace(/^(Alinhar|Centralizar) /, "")}
          </button>
        ))}
      </div>

      <h3>Distribuir</h3>
      <div className="arrange-grid two">
        <button disabled={visuals.length < 3} title="Espaços iguais entre os visuais (3 ou mais)"
          onClick={() => apply(distributePatches(visuals, "horizontal"))}>
          ⋯ Horizontal
        </button>
        <button disabled={visuals.length < 3} title="Espaços iguais entre os visuais (3 ou mais)"
          onClick={() => apply(distributePatches(visuals, "vertical"))}>
          ⋮ Vertical
        </button>
      </div>

      <h3>Tamanho (do maior)</h3>
      <div className="arrange-grid three">
        <button onClick={() => apply(sameSizePatches(visuals, "w"))}>Largura</button>
        <button onClick={() => apply(sameSizePatches(visuals, "h"))}>Altura</button>
        <button onClick={() => apply(sameSizePatches(visuals, "both"))}>Ambos</button>
      </div>

      <h3>Grupo</h3>
      <div className="arrange-grid two">
        <button
          disabled={allOneGroup}
          title="Agrupar: selecionar ou arrastar um membro leva o grupo inteiro"
          onClick={() => {
            const groupId = newId();
            apply(Object.fromEntries(visuals.map((v) => [v.id, { groupId }])));
          }}
        >
          ▣ Agrupar
        </button>
        <button disabled={!anyGroup} onClick={() => apply(Object.fromEntries(visuals.map((v) => [v.id, { groupId: undefined }])))}>
          ▢ Desagrupar
        </button>
      </div>

      <h3>Selecionados</h3>
      <ul className="arrange-list">
        {visuals.map((v) => (
          <li key={v.id}>
            <span>{v.title || v.type}</span>
            <button className="link" title="Tirar da seleção" onClick={() => onSelect(visuals.filter((x) => x.id !== v.id).map((x) => x.id))}>✕</button>
          </li>
        ))}
      </ul>
      <button className="danger" onClick={() => {
        dispatch({ type: "removeVisuals", ids: visuals.map((v) => v.id) });
        onSelect([]);
      }}>
        Excluir {visuals.length} visuais
      </button>
    </aside>
  );
}
