import type { TThemeDefinition } from '@omnidraw/service-theme';
import type { TWidgetCapsuleTheme } from '@omnidraw/widget-contract';

/** Projects only fixed semantic presentation tokens into the guest channel. */
export function fnWidgetCapsuleTheme(
  theme: TThemeDefinition,
): TWidgetCapsuleTheme {
  return Object.freeze({
    format: 'omnidraw.widget-theme.v1',
    appearance: theme.appearance,
    tokens: Object.freeze({
      background: theme.ui.background,
      foreground: theme.ui.foreground,
      surface: theme.ui.card,
      surfaceForeground: theme.ui.cardForeground,
      muted: theme.ui.muted,
      mutedForeground: theme.ui.mutedForeground,
      primary: theme.ui.primary,
      primaryForeground: theme.ui.primaryForeground,
      accent: theme.ui.accent,
      accentForeground: theme.ui.accentForeground,
      destructive: theme.ui.destructive,
      success: theme.ui.success,
      border: theme.ui.border,
    }),
  });
}
