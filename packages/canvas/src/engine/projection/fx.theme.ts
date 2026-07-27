import type { ThemeService } from "@vibecanvas/service-theme";
import type { TCanvasProjectionTheme } from "../typed";

export type TPortal = Pick<
  ThemeService,
  | "getCornerRadiusValueMap"
  | "getDefaultStyles"
  | "getFontSizeValueMap"
  | "getStrokeWidthValueMap"
  | "getTheme"
  | "getThemeColorValueMap"
>;

export type TArgs = Record<never, never>;

export function fxReadCanvasProjectionTheme(
  portal: TPortal,
  args: TArgs,
): TCanvasProjectionTheme {
  void args;
  const theme = portal.getTheme();

  return {
    id: theme.id,
    colors: { ...theme.colors },
    colorTokens: { ...portal.getThemeColorValueMap() },
    strokeWidths: { ...portal.getStrokeWidthValueMap() },
    cornerRadii: { ...portal.getCornerRadiusValueMap() },
    fontSizes: { ...portal.getFontSizeValueMap() },
    styleDefaults: portal.getDefaultStyles(),
  };
}
