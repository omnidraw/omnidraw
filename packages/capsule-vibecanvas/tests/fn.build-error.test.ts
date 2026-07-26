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
      'Widget ui build failed: MODULE_NOT_FOUND at ui/main.tsx (./styles.css).',
    );
    expect(result.cause).toBe(cause);
    expect((result as Error & { code?: string }).code).toBe('WIDGET_BUILD_FAILED');
  });

  test('keeps the stable generic message when no structured diagnostic exists', () => {
    expect(fnWidgetBuildError('server', new Error('secret')).message)
      .toBe('Widget server build failed.');
  });

  test('surfaces a bounded OCI runner code when compilation never starts', () => {
    const cause = Object.assign(new Error('docker socket details'), {
      code: 'SANDBOX_IMAGE_IDENTITY_MISMATCH',
    });

    expect(fnWidgetBuildError('ui', cause).message).toBe(
      'Widget ui build failed: SANDBOX_IMAGE_IDENTITY_MISMATCH.',
    );
  });
});
