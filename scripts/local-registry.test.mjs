/** @file Verifies dependency-ordered local publication for generated widget packages. */

import { describe, expect, test } from 'bun:test';
import {
  widgetPackagePublishOrder,
  widgetPackageSyncSource,
} from './local-registry.mjs';

function entry(name, dependencies = {}, extras = {}) {
  return Object.freeze({
    name,
    version: '1.0.0',
    directory: `/workspace/${name}`,
    manifest: Object.freeze({
      name,
      version: '1.0.0',
      dependencies,
      ...extras,
    }),
  });
}

describe('local widget package publication', () => {
  test('publishes the SDK workspace dependency closure in dependency order', () => {
    const packages = [
      entry('@omnidraw/sdk', {
        '@omnidraw/capsule': '0.11.0',
        '@omnidraw/widget-contract': 'workspace:*',
      }),
      entry('@omnidraw/widget-contract', {
        '@omnidraw/resource-runtime': 'workspace:*',
        zod: '4.4.3',
      }),
      entry('@omnidraw/resource-runtime'),
      entry('@omnidraw/unrelated'),
    ];

    expect(widgetPackagePublishOrder(packages).map(({ name }) => name)).toEqual([
      '@omnidraw/resource-runtime',
      '@omnidraw/widget-contract',
      '@omnidraw/sdk',
    ]);
  });

  test('includes local optional and peer dependencies but leaves registry packages alone', () => {
    const packages = [
      entry('@omnidraw/sdk', {}, {
        optionalDependencies: { '@omnidraw/local-optional': 'workspace:*' },
        peerDependencies: {
          '@omnidraw/local-peer': 'workspace:*',
          react: '^19.0.0',
        },
      }),
      entry('@omnidraw/local-optional'),
      entry('@omnidraw/local-peer'),
    ];

    expect(widgetPackagePublishOrder(packages).map(({ name }) => name)).toEqual([
      '@omnidraw/local-optional',
      '@omnidraw/local-peer',
      '@omnidraw/sdk',
    ]);
  });

  test('rejects a missing root or a versioned dependency cycle', () => {
    expect(() => widgetPackagePublishOrder([])).toThrow('is not a versioned workspace package');
    expect(() => widgetPackagePublishOrder([
      entry('@omnidraw/sdk', { '@omnidraw/widget-contract': 'workspace:*' }),
      entry('@omnidraw/widget-contract', { '@omnidraw/sdk': 'workspace:*' }),
    ])).toThrow('dependency cycle');
  });

  test('verifies local-only versions and rebuilds missing or conflicting versions', () => {
    expect(widgetPackageSyncSource('sha512-local', null)).toBe('workspace');
    expect(widgetPackageSyncSource('sha512-public', 'sha512-public')).toBe('upstream');
    expect(widgetPackageSyncSource('sha512-local', undefined)).toBe('available');
    expect(widgetPackageSyncSource(null, null)).toBe('workspace');
    expect(widgetPackageSyncSource('sha512-local', 'sha512-public')).toBe('workspace');
  });
});
