import { describe, expect, test } from 'bun:test';
import { ThemeService, THEME_ID_DARK } from '@omnidraw/service-theme';
import { fnWidgetCapsuleTheme } from './fn.widget-capsule-theme';

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
});
