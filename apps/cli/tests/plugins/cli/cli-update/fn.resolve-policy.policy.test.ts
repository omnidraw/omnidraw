import { describe, expect, test } from 'bun:test';
import { fnCliUpdateResolvePolicy } from '../../../../src/plugins/cli/core/fn.resolve-policy';

describe('fnCliUpdateResolvePolicy', () => {
  test('env disable overrides all other inputs', () => {
    const [policy, error] = fnCliUpdateResolvePolicy({
      method: 'curl',
      envDisable: '1',
      configAutoupdate: true,
    });

    expect(error).toBeNull();
    expect(policy).toEqual({ mode: 'disabled', reason: 'env' });
  });

  test('config false disables updates', () => {
    const [policy] = fnCliUpdateResolvePolicy({
      method: 'curl',
      envDisable: undefined,
      configAutoupdate: false,
    });

    expect(policy).toEqual({ mode: 'disabled', reason: 'config' });
  });

  test('config notify preserves notify mode', () => {
    const [policy] = fnCliUpdateResolvePolicy({
      method: 'curl',
      envDisable: undefined,
      configAutoupdate: 'notify',
    });

    expect(policy).toEqual({ mode: 'notify', reason: 'config' });
  });

  test('non-curl installs fall back to notify mode', () => {
    const [policy] = fnCliUpdateResolvePolicy({
      method: 'npm',
      envDisable: undefined,
      configAutoupdate: undefined,
    });

    expect(policy).toEqual({ mode: 'notify', reason: 'method' });
  });

  test('curl installs default to install mode', () => {
    const [policy] = fnCliUpdateResolvePolicy({
      method: 'curl',
      envDisable: undefined,
      configAutoupdate: undefined,
    });

    expect(policy).toEqual({ mode: 'install', reason: 'default' });
  });
});
