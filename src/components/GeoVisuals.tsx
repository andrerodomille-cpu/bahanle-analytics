import type { Measure, Value, Visual } from "../model/types";
import { fieldLabel } from "../model/types";
import { usePalette } from "../model/theme";
import { formatMeasure, formatValue } from "../model/format";
import { valueKey } from "../engine/query";
import type { BubbleResult, ChoroplethResult } from "../engine/geo";
import { STATES, STATE_PATHS, VIEWBOX, VIEW_WIDTH, project } from "../model/geo/geo";
import { colorScaleStyle, rangeOf } from "./MoreVisuals";

const multi = (e: React.MouseEvent) => e.ctrlKey || e.shiftKey || e.metaKey;

/** Siglas que não cabem dentro do próprio estado nesta escala. */
const NO_LABEL = new Set(["DF"]);

/** No mapa, o menor valor ainda precisa se destacar do cinza de "sem dados". */
const MAP_FLOOR = 0.3;

// ---------------- Mapa coroplético ----------------

export function ChoroplethVisual({ visual, measures, result, selected, onSelect }: {
  visual: Visual;
  measures: Measure[];
  result: ChoroplethResult;
  selected: Set<string>;
  onSelect: (category: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const m = measures[0];
  const { min, max } = rangeOf([...result.byState.values()].map((s) => s.value));
  const font = VIEW_WIDTH / 55;

  return (
    <div className="map-visual">
      <svg viewBox={VIEWBOX} preserveAspectRatio="xMidYMid meet" className="map-svg">
        {STATES.map((s) => {
          const d = result.byState.get(s.code);
          const style = d ? colorScaleStyle(d.value, min, max, palette[0], MAP_FLOOR) : undefined;
          const dim = d && selected.size > 0 && !selected.has(valueKey(d.category));
          const [lx, ly] = project(s.label[0], s.label[1]);
          return (
            <g
              key={s.code}
              className={d ? "map-state has-data" : "map-state"}
              opacity={dim ? 0.3 : 1}
              onClick={(e) => d && onSelect(d.category, multi(e))}
            >
              <title>
                {`${s.name} (${s.uf})`}
                {d && formatValue(d.category) !== s.uf && formatValue(d.category) !== s.name ? ` — ${formatValue(d.category)}` : ""}
                {`\n${m.name}: ${d ? formatMeasure(d.value, m.format) : "sem dados"}`}
              </title>
              <path d={STATE_PATHS.get(s.code)} style={{ fill: style?.background as string | undefined }} />
              {!NO_LABEL.has(s.uf) && (
                <text x={lx} y={ly} fontSize={font} textAnchor="middle" dominantBaseline="middle"
                  className={style?.color ? "map-label light" : "map-label"}>
                  {s.uf}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="heat-legend map-legend">
        <span>{formatMeasure(min, m.format, true)}</span>
        <span
          className="heat-gradient"
          style={{
            background: `linear-gradient(90deg, ${colorScaleStyle(min, min, max, palette[0], MAP_FLOOR)?.background}, ${colorScaleStyle(max, min, max, palette[0], MAP_FLOOR)?.background})`,
          }}
        />
        <span>{formatMeasure(max, m.format, true)}</span>
        <span className="map-nodata" /> <span>sem dados</span>
      </div>
      {result.unmatched.length > 0 && (
        <div className="map-warning" title={result.unmatched.map(formatValue).join(", ")}>
          {result.unmatched.length} valor(es) de {fieldLabel(visual.axis!)} não são UF, nome de estado, código IBGE ou região.
        </div>
      )}
    </div>
  );
}

// ---------------- Mapa de bolhas ----------------

export function BubbleMapVisual({ visual, measures, result, selected, onSelect }: {
  visual: Visual;
  measures: Measure[];
  result: BubbleResult;
  selected: Set<string>;
  onSelect: (category: Value, multi: boolean) => void;
}) {
  const palette = usePalette();
  const [sizeM, colorM] = measures;
  const maxSize = Math.max(...result.bubbles.map((b) => Math.abs(b.size ?? 0)), 1);
  const colorRange = rangeOf(result.bubbles.map((b) => b.color));
  // Área proporcional ao valor: o raio cresce com a raiz quadrada.
  const rMax = VIEW_WIDTH / 22;
  const radius = (v: number | null) => Math.max(VIEW_WIDTH / 250, Math.sqrt(Math.abs(v ?? 0) / maxSize) * rMax);

  return (
    <div className="map-visual">
      <svg viewBox={VIEWBOX} preserveAspectRatio="xMidYMid meet" className="map-svg">
        {STATES.map((s) => <path key={s.code} d={STATE_PATHS.get(s.code)} className="map-base" />)}
        {result.bubbles.map((b) => {
          const [x, y] = project(b.lon, b.lat);
          const dim = selected.size > 0 && !selected.has(valueKey(b.category));
          const fill = colorM
            ? (colorScaleStyle(b.color, colorRange.min, colorRange.max, palette[0], MAP_FLOOR)?.background as string)
            : palette[0];
          return (
            <circle
              key={valueKey(b.category)}
              cx={x}
              cy={y}
              r={radius(b.size)}
              className="map-bubble"
              style={{ fill }}
              opacity={dim ? 0.25 : 0.8}
              onClick={(e) => onSelect(b.category, multi(e))}
            >
              <title>
                {`${formatValue(b.category)}\n${sizeM.name}: ${formatMeasure(b.size, sizeM.format)}`}
                {colorM ? `\n${colorM.name}: ${formatMeasure(b.color, colorM.format)}` : ""}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="map-legend small muted">
        Tamanho: {sizeM.name}{colorM ? ` · cor: ${colorM.name}` : ""}
        {!visual.latField && " · posição: centro da UF/região"}
      </div>
      {result.unplaced.length > 0 && (
        <div className="map-warning" title={result.unplaced.map(formatValue).join(", ")}>
          {result.unplaced.length} item(ns) sem localização: escolha as colunas de latitude e longitude ou use UF/região no eixo.
        </div>
      )}
    </div>
  );
}

// ---------------- Imagem ----------------

export function ImageVisual({ visual }: { visual: Visual }) {
  const img = visual.image;
  if (!img?.src) return <div className="visual-msg">Escolha uma imagem no painel à direita.</div>;
  return <img className="image-visual" src={img.src} alt={img.alt ?? ""} style={{ objectFit: img.fit }} draggable={false} />;
}
