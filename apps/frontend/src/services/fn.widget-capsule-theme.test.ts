import { describe, expect, test } from 'bun:test';
import { ThemeService, THEME_ID_DARK } from '@omnidraw/service-theme';
import {
  fnWidgetCapsuleTheme,
  fnWidgetPreviewTitleBarColor,
} from './fn.widget-capsule-theme';

describe('widget Capsule theme projection', () => {
  test('exposes only the fixed safe semantic token set', () => {
    const service = new ThemeService({ initialThemeId: THEME_ID_DARK });
    const projected = fnWidgetCapsuleTheme(service.getTheme());

    expect(projected).toMatchObject({
      format: 'omnidraw.widget-theme.v1',
      appearance: 'dark',
      tokens: {
        background: service.getTheme().ui.background,
        foreground: service.getTheme().ui.foreground,
        surface: service.getTheme().ui.card,
      },
    });
    expect(Object.keys(projected).sort()).toEqual([
      'appearance',
      'format',
      'tokens',
    ]);
    expect(Object.keys(projected.tokens).sort()).toEqual([
      'accent',
      'accentForeground',
      'background',
      'border',
      'destructive',
      'foreground',
      'muted',
      'mutedForeground',
      'primary',
      'primaryForeground',
      'success',
      'surface',
      'surfaceForeground',
    ]);
  });

  test('projects the exact sidebar Preview warning color for canvas chrome', () => {
    const service = new ThemeService();
    expect(fnWidgetPreviewTitleBarColor(service.getTheme())).toEqual({
      space: 'srgb',
      r: 217 / 255,
      g: 119 / 255,
      b: 6 / 255,
      a: 1,
    });
  });

  test('accepts common CSS warning colors and safely falls back for browser-only forms', () => {
    const service = new ThemeService();
    const theme = service.getTheme();
    expect(fnWidgetPreviewTitleBarColor({
      ...theme,
      ui: { ...theme.ui, warning: 'rgb(64 128 255 / 50%)' },
    })).toEqual({
      space: 'srgb',
      r: 64 / 255,
      g: 128 / 255,
      b: 1,
      a: 0.5,
    });
    expect(fnWidgetPreviewTitleBarColor({
      ...theme,
      ui: { ...theme.ui, warning: 'oklch(70% 0.2 80)' },
    })).toEqual(theme.canvas.colors.yellow.ink);
  });
});
