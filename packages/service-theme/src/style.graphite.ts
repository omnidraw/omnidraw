import { THEME_ID_GRAPHITE } from "./builtins";
import { createColorScale, createThemeStyle } from "./style.shared";

export const STYLE_GRAPHITE = createThemeStyle({
  id: THEME_ID_GRAPHITE,
  palette: {
    base: createColorScale("#1f2937", "#334155", "#64748b", "#cbd5e1", "#f8fafc"),
    red: createColorScale("#3f1d24", "#7f1d1d", "#ef4444", "#fca5a5", "#fee2e2"),
    orange: createColorScale("#3b2216", "#9a3412", "#f97316", "#fdba74", "#ffedd5"),
    yellow: createColorScale("#3d3014", "#a16207", "#eab308", "#fde047", "#fef9c3"),
    green: createColorScale("#142b1c", "#166534", "#22c55e", "#86efac", "#dcfce7"),
    teal: createColorScale("#132d2e", "#0f766e", "#14b8a6", "#5eead4", "#ccfbf1"),
    blue: createColorScale("#152947", "#1d4ed8", "#3b82f6", "#93c5fd", "#dbeafe"),
    purple: createColorScale("#2a1946", "#7e22ce", "#a855f7", "#d8b4fe", "#f3e8ff"),
    pink: createColorScale("#431c34", "#be185d", "#ec4899", "#f9a8d4", "#fce7f3"),
    brown: createColorScale("#33241d", "#7c4a2b", "#a16207", "#d6b08b", "#f3e5d8"),
  },
});
