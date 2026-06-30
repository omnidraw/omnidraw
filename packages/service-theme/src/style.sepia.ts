import { THEME_ID_SEPIA } from "./builtins";
import { createColorScale, createThemeStyle } from "./style.shared";

export const STYLE_SEPIA = createThemeStyle({
  id: THEME_ID_SEPIA,
  palette: {
    base: createColorScale("#f2e8d8", "#d7c3a1", "#7c6549", "#6b4f2d", "#433422"),
    red: createColorScale("#f5ddd4", "#dc9f89", "#b8573d", "#8c3f2b", "#5b261c"),
    orange: createColorScale("#f7e4c8", "#ddb57b", "#c17b2e", "#8f541d", "#5d3410"),
    yellow: createColorScale("#f5ebc8", "#dec97a", "#b7791f", "#8a5d16", "#5a3d10"),
    green: createColorScale("#e0ead5", "#9db37d", "#4f8a4b", "#365f34", "#213b21"),
    teal: createColorScale("#d8ebe5", "#7fb6a5", "#3f8b78", "#2a6153", "#193e35"),
    blue: createColorScale("#dae8f1", "#8caecc", "#5d85a8", "#3d5975", "#27384d"),
    purple: createColorScale("#e5def2", "#b7a4d4", "#7f66b0", "#5a4780", "#392c53"),
    pink: createColorScale("#f0dde5", "#cf9ab0", "#a45d79", "#7a4059", "#512839"),
    brown: createColorScale("#efe2d3", "#d7b58f", "#9b6b3d", "#714b29", "#4b301a"),
  },
});
