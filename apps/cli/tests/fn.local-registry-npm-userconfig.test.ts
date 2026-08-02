import { describe, expect, test } from 'bun:test';
import { fnLocalRegistryNpmUserConfig } from '../src/fn.local-registry-npm-userconfig';

const join = (...paths: string[]) => paths.join('/');

describe('fnLocalRegistryNpmUserConfig', () => {
  test('uses the local registry config during development', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      localDevelopment: true,
      join,
    })).toBe('/Users/example/.local/share/verdaccio/npmrc');
  });

  test('uses the public npm config outside local development', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      localDevelopment: false,
      stateDirectory: '/registry-state',
      join,
    })).toBe('/registry-state/npmjs.npmrc');
  });

  test('honors explicit state and npm-config overrides', () => {
    expect(fnLocalRegistryNpmUserConfig({
      homeDirectory: '/Users/example',
      localDevelopment: false,
      stateDirectory: '/registry-state',
      userConfigPath: '/host/npmrc',
      join,
    })).toBe('/host/npmrc');
  });
});
