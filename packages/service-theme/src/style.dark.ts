import { THEME_ID_DARK } from "./builtins";
import { createColorScale, createThemeStyle } from "./style.shared";

export const STYLE_DARK = createThemeStyle({
  id: THEME_ID_DARK,
  palette: {
    base: createColorScale("#292524", "#44403c", "#78716c", "#d6d3d1", "#fafaf9"),
    red: createColorScale("#3f1719", "#7f1d1d", "#dc2626", "#f87171", "#fee2e2"),
    orange: createColorScale("#431407", "#7c2d12", "#ea580c", "#fb923c", "#ffedd5"),
    yellow: createColorScale("#422006", "#713f12", "#eab308", "#facc15", "#fef9c3"),
    green: createColorScale("#052e16", "#14532d", "#16a34a", "#4ade80", "#dcfce7"),
    teal: createColorScale("#042f2e", "#134e4a", "#0f766e", "#2dd4bf", "#ccfbf1"),
    blue: createColorScale("#172554", "#1e3a8a", "#2563eb", "#60a5fa", "#dbeafe"),
    purple: createColorScale("#3b0764", "#581c87", "#9333ea", "#c084fc", "#f3e8ff"),
    pink: createColorScale("#500724", "#831843", "#db2777", "#f472b6", "#fce7f3"),
    brown: createColorScale("#2b1b14", "#5b3624", "#9a5b3a", "#d6a07c", "#f3e5d8"),
  },
});
