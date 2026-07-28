import { describe, expect, test } from 'bun:test';
import { fnLocalRegistryNpmUserConfig } from '../src/fn.local-registry-npm-userconfig';

const join = (...paths: string[]) => paths.join('/');

describe('fnLocalRegistryNpmUserConfig', () => {
  test('uses the stable host-owned default outside VIBECANVAS_HOME', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      join,
    })).toBe('/Users/example/.local/share/vibecanvas/registry/npmrc');
  });

  test('honors explicit state and user-config overrides', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      stateDirectory: '/registry-state',
      join,
    })).toBe('/registry-state/npmrc');
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      stateDirectory: '/registry-state',
      userConfigPath: '/host/npmrc',
      join,
    })).toBe('/host/npmrc');
  });
});
