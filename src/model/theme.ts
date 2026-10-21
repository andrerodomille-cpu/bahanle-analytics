import { createContext, useContext } from "react";
import type { PaletteName } from "./types";

// Paletas de cores dos visuais (o "tema do relatório").

export const PALETTES: Record<PaletteName, { label: string; colors: string[] }> = {
  padrao: { label: "Padrão", colors: ["#118dff", "#12239e", "#e66c37", "#6b007b", "#e044a7", "#744ec2", "#d9b300", "#d64550"] },
  executivo: { label: "Executivo", colors: ["#3257a8", "#37a794", "#8b3d88", "#dd6b7f", "#6b91c9", "#f5c869", "#77c4a8", "#dea6cf"] },
  natureza: { label: "Natureza", colors: ["#2e7d32", "#81c784", "#f9a825", "#6d4c41", "#00838f", "#c0ca33", "#8d6e63", "#4db6ac"] },
  vibrante: { label: "Vibrante", colors: ["#ff4d6d", "#ff9f1c", "#2ec4b6", "#3a86ff", "#8338ec", "#ffbe0b", "#fb5607", "#06d6a0"] },
};

export const PaletteContext = createContext<string[]>(PALETTES.padrao.colors);

export const usePalette = () => useContext(PaletteContext);
