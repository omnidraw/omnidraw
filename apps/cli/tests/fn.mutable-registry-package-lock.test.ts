import { describe, expect, test } from 'bun:test';
import { fnMutableRegistryPackageLock } from '../src/services/fn.mutable-registry-package-lock';

describe('fnMutableRegistryPackageLock', () => {
  test('drops integrity only for Omnidraw packages from the mutable registry', () => {
    const source = `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/@omnidraw/sdk': {
          resolved: 'http://127.0.0.1:4873/@omnidraw/sdk/-/sdk-0.10.0.tgz',
          integrity: 'sha512-stale-sdk',
        },
        'node_modules/tool/node_modules/@omnidraw/widget-contract': {
          resolved: 'http://127.0.0.1:4873/@omnidraw/widget-contract/-/widget-contract-0.12.0.tgz',
          integrity: 'sha512-stale-contract',
        },
        'node_modules/@omnidraw/public-package': {
          resolved: 'https://registry.npmjs.org/@omnidraw/public-package/-/public-package-1.0.0.tgz',
          integrity: 'sha512-public',
        },
        'node_modules/third-party': {
          resolved: 'http://127.0.0.1:4873/third-party/-/third-party-1.0.0.tgz',
          integrity: 'sha512-third-party',
        },
      },
    }, null, 2)}\n`;

    const refreshed = JSON.parse(fnMutableRegistryPackageLock({
      source,
      registryUrl: 'http://127.0.0.1:4873/',
    }));

    expect(refreshed.packages['node_modules/@omnidraw/sdk'].integrity).toBeUndefined();
    expect(
      refreshed.packages['node_modules/tool/node_modules/@omnidraw/widget-contract'].integrity,
    ).toBeUndefined();
    expect(refreshed.packages['node_modules/@omnidraw/public-package'].integrity)
      .toBe('sha512-public');
    expect(refreshed.packages['node_modules/third-party'].integrity)
      .toBe('sha512-third-party');
  });

  test('preserves the exact source when no mutable entry needs refreshing', () => {
    const source = '{"lockfileVersion":3,"packages":{"":{}}}';
    expect(fnMutableRegistryPackageLock({
      source,
      registryUrl: 'http://127.0.0.1:4873/',
    })).toBe(source);
  });
});
