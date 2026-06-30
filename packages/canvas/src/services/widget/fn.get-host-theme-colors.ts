import type { ThemeService } from "@vibecanvas/service-theme"
import type { THostThemeColors } from "./types"


export function fnGetHostThemeColors(themeService: ThemeService): THostThemeColors {
  const colors = themeService.getTheme().colors

  return {
    headerFill: colors.muted,
    bodyFill: colors.card,
    dividerFill: colors.border,
    windowStroke: colors.border,
    trafficLightStroke: colors.border,
    closeButtonFill: colors.destructive,
    minimizeButtonFill: colors.warning,
    maximizeButtonFill: colors.success,
  }
}
