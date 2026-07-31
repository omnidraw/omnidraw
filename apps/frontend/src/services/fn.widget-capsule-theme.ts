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
      background: theme.colors.background,
      foreground: theme.colors.foreground,
      surface: theme.colors.card,
      surfaceForeground: theme.colors.cardForeground,
      muted: theme.colors.muted,
      mutedForeground: theme.colors.mutedForeground,
      primary: theme.colors.primary,
      primaryForeground: theme.colors.primaryForeground,
      accent: theme.colors.accent,
      accentForeground: theme.colors.accentForeground,
      destructive: theme.colors.destructive,
      success: theme.colors.success,
      border: theme.colors.border,
    }),
  });
}
