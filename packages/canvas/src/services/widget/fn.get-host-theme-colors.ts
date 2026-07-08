import type { ThemeService } from "@vibecanvas/service-theme"
import type { THostThemeColors } from "./types"


export function fnGetHostThemeColors(themeService: ThemeService, widgetType: 'widget' | 'ui-widget' = 'widget'): THostThemeColors {
  const colors = themeService.getTheme().colors
  const isUiWidget = widgetType === 'ui-widget'

  return {
    headerFill: isUiWidget ? colors.accent : colors.muted,
    headerTitleFill: isUiWidget ? colors.accentForeground : colors.mutedForeground,
    bodyFill: colors.card,
    dividerFill: colors.border,
    windowStroke: colors.border,
    trafficLightStroke: colors.border,
    closeButtonFill: colors.destructive,
    minimizeButtonFill: colors.warning,
    maximizeButtonFill: colors.success,
  }
}
