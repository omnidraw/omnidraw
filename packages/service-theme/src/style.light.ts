import { THEME_ID_LIGHT } from "./builtins";
import { createColorScale, createThemeStyle } from "./style.shared";

export const STYLE_LIGHT = createThemeStyle({
  id: THEME_ID_LIGHT,
  palette: {
    base: createColorScale("#f5f5f4", "#d6d3d1", "#78716c", "#44403c", "#1c1917"),
    red: createColorScale("#fee2e2", "#fca5a5", "#ef4444", "#b91c1c", "#7f1d1d"),
    orange: createColorScale("#ffedd5", "#fdba74", "#f97316", "#c2410c", "#7c2d12"),
    yellow: createColorScale("#fef9c3", "#fde047", "#eab308", "#a16207", "#713f12"),
    green: createColorScale("#dcfce7", "#86efac", "#22c55e", "#15803d", "#14532d"),
    teal: createColorScale("#ccfbf1", "#5eead4", "#14b8a6", "#0f766e", "#134e4a"),
    blue: createColorScale("#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"),
    purple: createColorScale("#f3e8ff", "#d8b4fe", "#a855f7", "#7e22ce", "#581c87"),
    pink: createColorScale("#fce7f3", "#f9a8d4", "#ec4899", "#be185d", "#831843"),
    brown: createColorScale("#f3e5d8", "#d6b08b", "#a16207", "#7c2d12", "#431407"),
  },
});
