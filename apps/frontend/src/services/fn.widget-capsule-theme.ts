import type {
  TThemeDefinition,
  TThemeSrgbColor,
} from '@omnidraw/service-theme';
import type { TWidgetCapsuleTheme } from '@omnidraw/widget-contract';

export function fnWidgetPreviewTitleBarColor(
  theme: TThemeDefinition,
): TThemeSrgbColor {
  const normalized = theme.ui.warning.trim().toLowerCase();
  const hex = normalized === 'transparent'
    ? '00000000'
    : normalized.startsWith('#')
      ? normalized.slice(1)
      : '';
  const expanded = hex.length === 3 || hex.length === 4
    ? [...hex].map((part) => `${part}${part}`).join('')
    : hex;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(expanded)) {
    const channel = (offset: number) => (
      Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255
    );
    return Object.freeze({
      space: 'srgb',
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: expanded.length === 8 ? channel(6) : 1,
    });
  }

  const rgb = normalized.match(/^rgba?\((.*)\)$/);
  if (rgb !== null) {
    const sections = rgb[1]!.split('/');
    const parts = sections[0]!.trim().split(/[\s,]+/).filter(Boolean);
    const legacyAlpha = parts.length === 4 ? parts.pop() : undefined;
    const alphaText = sections[1]?.trim() ?? legacyAlpha;
    const channel = (value: string): number => value.endsWith('%')
      ? Math.min(1, Math.max(0, Number.parseFloat(value) / 100))
      : Math.min(1, Math.max(0, Number.parseFloat(value) / 255));
    const alpha = (value: string | undefined): number => value === undefined
      ? 1
      : value.endsWith('%')
        ? Math.min(1, Math.max(0, Number.parseFloat(value) / 100))
        : Math.min(1, Math.max(0, Number.parseFloat(value)));
    const values = parts.map(channel);
    const opacity = alpha(alphaText);
    if (
      values.length === 3
      && values.every(Number.isFinite)
      && Number.isFinite(opacity)
    ) {
      return Object.freeze({
        space: 'srgb',
        r: values[0]!,
        g: values[1]!,
        b: values[2]!,
        a: opacity,
      });
    }
  }

  // Theme UI roles may use browser-resolved CSS forms such as oklch() or
  // var(). Canvas paint is numeric, so keep custom themes safe with their
  // closest guaranteed warning-palette fallback instead of throwing.
  return Object.freeze({ ...theme.canvas.colors.yellow.ink });
}

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
