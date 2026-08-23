import { describe, expect, test } from 'bun:test';
import sdkPackage from '@omnidraw/sdk/package.json';
import { SDK_PACKAGE_DEPENDENCY } from '../workspace/CONSTANTS';
import { fnResolveWidgetDependency } from '../workspace/fn.resolve-widget-dependency';

describe('standalone widget dependency resolution', () => {
  test('resolves a development catalog dependency to its registry version', () => {
    expect(fnResolveWidgetDependency({
      dependency: '@omnidraw/capsule',
      specifier: 'catalog:',
      catalog: { '@omnidraw/capsule': '0.11.0' },
    })).toBe('0.11.0');
  });

  test('preserves an existing registry-compatible specifier', () => {
    expect(fnResolveWidgetDependency({
      dependency: 'zod',
      specifier: '^4.0.0',
      catalog: {},
    })).toBe('^4.0.0');
  });

  test('rejects a missing catalog entry', () => {
    expect(() => fnResolveWidgetDependency({
      dependency: '@omnidraw/capsule',
      specifier: 'catalog:',
      catalog: {},
    })).toThrow('@omnidraw/capsule is absent from the root package catalog.');
  });

  test.each(['catalog:development', 'file:../sdk', 'link:../sdk', 'workspace:*'])(
    'rejects local-only specifier %s',
    (specifier) => {
      expect(() => fnResolveWidgetDependency({
        dependency: '@omnidraw/capsule',
        specifier,
        catalog: {},
      })).toThrow('standalone widgets require a registry-compatible specifier');
    },
  );

  test('scaffold constants publish only the current SDK release', () => {
    expect(SDK_PACKAGE_DEPENDENCY).toBe(sdkPackage.version);
    expect([SDK_PACKAGE_DEPENDENCY]).not.toContainEqual(
      expect.stringMatching(/^(?:catalog|file|link|workspace):/),
    );
  });
});
