import { describe, expect, test } from 'bun:test';
import { fnLocalRegistryNpmUserConfig } from '../src/fn.local-registry-npm-userconfig';

const join = (...paths: string[]) => paths.join('/');

describe('fnLocalRegistryNpmUserConfig', () => {
  test('uses the product-neutral host-owned public npm config', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      join,
    })).toBe('/Users/example/.local/share/verdaccio/npmjs.npmrc');
  });

  test('honors explicit state and public npm-config overrides', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      stateDirectory: '/registry-state',
      join,
    })).toBe('/registry-state/npmjs.npmrc');
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      stateDirectory: '/registry-state',
      userConfigPath: '/host/npmrc',
      join,
    })).toBe('/host/npmrc');
  });
});
