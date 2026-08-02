import { describe, expect, test } from 'bun:test';
import rootPackage from '../../../package.json';
import sdkPackage from '../../sdk/package.json';
import {
  SDK_CAPSULE_DEPENDENCY,
  SDK_PACKAGE_DEPENDENCY,
} from '../src/workspace/CONSTANTS';
import { fnResolveWidgetDependency } from '../src/workspace/fn.resolve-widget-dependency';

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

  test('scaffold constants resolve the current workspace SDK dependency closure', () => {
    expect(sdkPackage.dependencies['@omnidraw/capsule']).toBe('catalog:');
    expect(SDK_CAPSULE_DEPENDENCY).toBe(
      rootPackage.catalog['@omnidraw/capsule'],
    );
    expect(SDK_PACKAGE_DEPENDENCY).toBe(sdkPackage.version);
    expect([SDK_CAPSULE_DEPENDENCY, SDK_PACKAGE_DEPENDENCY]).not.toContainEqual(
      expect.stringMatching(/^(?:catalog|file|link|workspace):/),
    );
  });
});
