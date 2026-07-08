import { describe, expect, test } from 'bun:test';
import { fnBumpWidgetVersion } from '../src/core/fn.bump-widget-version';

describe('fnBumpWidgetVersion', () => {
  test('bumps numeric and semver versions', () => {
    expect(fnBumpWidgetVersion(undefined)).toBe('1');
    expect(fnBumpWidgetVersion('')).toBe('1');
    expect(fnBumpWidgetVersion('1')).toBe('2');
    expect(fnBumpWidgetVersion('1.2.3')).toBe('1.2.4');
  });

  test('keeps unknown formats and appends a numeric edit suffix', () => {
    expect(fnBumpWidgetVersion('beta')).toBe('beta.1');
  });
});
