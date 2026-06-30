import { describe, expect, test } from 'bun:test';
import { fnCliUpdateShouldUpgrade } from '../../../../src/plugins/cli/core/fn.should-upgrade';

describe('fnCliUpdateShouldUpgrade', () => {
  test('returns true when latest version is newer', () => {
    const [decision, error] = fnCliUpdateShouldUpgrade({
      currentVersion: '1.2.3',
      latestVersion: '1.2.4',
    });

    expect(error).toBeNull();
    expect(decision).toEqual({ shouldUpgrade: true });
  });

  test('normalizes leading v prefix', () => {
    const [decision, error] = fnCliUpdateShouldUpgrade({
      currentVersion: 'v1.2.3',
      latestVersion: '1.2.3',
    });

    expect(error).toBeNull();
    expect(decision).toEqual({ shouldUpgrade: false });
  });

  test('treats stable releases as newer than prereleases', () => {
    const [decision, error] = fnCliUpdateShouldUpgrade({
      currentVersion: '1.2.3-beta',
      latestVersion: '1.2.3',
    });

    expect(error).toBeNull();
    expect(decision).toEqual({ shouldUpgrade: true });
  });

  test('returns validation error on missing version input', () => {
    const [decision, error] = fnCliUpdateShouldUpgrade({
      currentVersion: '',
      latestVersion: '1.2.3',
    });

    expect(decision).toBeNull();
    expect(error?.code).toBe('FN.CLI_UPDATE.VERSION_COMPARE.INVALID_INPUT');
    expect(error?.statusCode).toBe(400);
  });
});
