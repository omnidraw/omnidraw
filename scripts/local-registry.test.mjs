/** @file Verifies dependency-ordered local publication for generated widget packages. */

import { describe, expect, test } from 'bun:test';
import {
  publishDecision,
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

  test('publishes an unoccupied version regardless of allowOverwrite (D9)', () => {
    expect(publishDecision(null, 'sha512-new', false)).toBe('publish');
    expect(publishDecision(null, 'sha512-new', true)).toBe('publish');
  });

  test('treats identical bytes at an occupied version as a no-op (D9)', () => {
    expect(publishDecision('sha512-same', 'sha512-same', false)).toBe('unchanged');
    expect(publishDecision('sha512-same', 'sha512-same', true)).toBe('unchanged');
  });

  test('rejects different bytes at an occupied version by default, matching real-npm immutability (D9)', () => {
    expect(publishDecision('sha512-old', 'sha512-new', false)).toBe('reject');
  });

  test('overwrites different bytes at an occupied version only when the caller opts in (D9)', () => {
    // This is what makes an edit to a workspace package's source never
    // require a manual `package.json` version bump just to unblock
    // `bun run dev` again: the internal workspace-sync path always opts in.
    expect(publishDecision('sha512-old', 'sha512-new', true)).toBe('overwrite');
  });
});
