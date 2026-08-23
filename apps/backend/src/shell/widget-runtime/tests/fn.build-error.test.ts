import { describe, expect, test } from 'bun:test';
import { fnWidgetBuildError } from '../build/fn.build-error';

describe('fnWidgetBuildError', () => {
  test('surfaces bounded Capsule diagnostics without exposing an unbounded cause', () => {
    const cause = Object.assign(new Error('internal compiler details'), {
      diagnostic: {
        code: 'MODULE_NOT_FOUND',
        path: 'ui/main.tsx',
        specifier: './styles.css',
      },
    });

    const result = fnWidgetBuildError('ui', cause);

    expect(result.message).toBe(
      'Widget ui build failed: MODULE_NOT_FOUND at ui/main.tsx [specifier="./styles.css"].',
    );
    expect(result.cause).toBe(cause);
    expect((result as Error & { code?: string }).code).toBe('WIDGET_BUILD_FAILED');
  });

  test('keeps the stable generic message when no structured diagnostic exists', () => {
    expect(fnWidgetBuildError('server', new Error('secret')).message)
      .toBe('Widget server build failed.');
  });

  test('surfaces a bounded host builder code when compilation never starts', () => {
    const cause = Object.assign(new Error('npm process details'), {
      code: 'NPM_BUILD_TIMEOUT',
    });

    expect(fnWidgetBuildError('ui', cause).message).toBe(
      'Widget ui build failed: NPM_BUILD_TIMEOUT.',
    );
  });

  test('surfaces the actionable head and bounded tail of a structured host command failure', () => {
    const reason = `prefix-${'x'.repeat(500)}-npm ci cannot resolve linked package`;
    const cause = Object.assign(new Error('host command details'), {
      diagnostic: {
        code: 'WIDGET_COMMAND_FAILED',
        construct: 'npm ci',
        reason,
      },
    });

    const result = fnWidgetBuildError('ui', cause);

    expect(result.message).toContain('Widget ui build failed: WIDGET_COMMAND_FAILED');
    expect(result.message).toContain('construct="npm ci"');
    expect(result.message).toContain('prefix-');
    expect(result.message).toContain('npm ci cannot resolve linked package');
    expect(result.message.length).toBeLessThan(600);
  });

  test('preserves actionable CSS profile diagnostics and source location', () => {
    const diagnostic = {
      code: 'CSS_PROFILE_REQUIRED',
      path: 'assets/main.css',
      line: 12,
      column: 7,
      construct: 'clamp()',
      activeCssProfile: 'capsule-css-conservative-v1',
      requiredProfile: 'shadow-browser-css-v1',
      reason: 'clamp() requires shadow-browser-css-v1',
    };
    const cause = Object.assign(new Error('internal parser details'), {
      diagnostic,
    });

    const result = fnWidgetBuildError('ui', cause) as Error & {
      diagnostic?: Readonly<Record<string, unknown>>;
    };

    expect(result.message).toBe(
      'Widget ui build failed: CSS_PROFILE_REQUIRED at assets/main.css:12:7'
      + ' [construct="clamp()", activeCssProfile="capsule-css-conservative-v1",'
      + ' requiredProfile="shadow-browser-css-v1",'
      + ' reason="clamp() requires shadow-browser-css-v1"].',
    );
    expect(result.diagnostic).toEqual(diagnostic);
    expect(Object.isFrozen(result.diagnostic)).toBe(true);
  });

  test('prioritizes a widget-relative compiler error over verbose build output', () => {
    const cause = Object.assign(new Error('host command details'), {
      diagnostic: {
        code: 'WIDGET_COMMAND_FAILED',
        construct: 'npm run build',
        reason: [
          '> widget build',
          'vite building client environment for production',
          'error during build: Build failed with 1 error:',
          '[widget-workspace]/ui/main.ts:28:11: ERROR: Expected expression but found ";"',
          'at verbose internal stack frame',
        ].join('\n'),
      },
    });

    const result = fnWidgetBuildError('ui', cause);

    expect(result.message).toContain('ui/main.ts:28:11: ERROR: Expected expression');
    expect(result.message).not.toContain('widget-workspace');
    expect(result.message).not.toContain('internal stack');
  });
});
