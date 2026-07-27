import { describe, expect, test } from 'bun:test';
import { fnWidgetBuildError } from '../src/build/fn.build-error';

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
});
