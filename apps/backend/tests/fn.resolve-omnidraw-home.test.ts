import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { fnResolveOmnidrawHome } from '../src/shell/config/fn.resolve-omnidraw-home';

const effects = { join, resolve };

describe('Omnidraw home selection', () => {
  test('defaults to ~/.omnidraw', () => {
    const home = fnResolveOmnidrawHome(effects, {
      cwd: '/workspace',
      homedir: '/users/release',
      env: {},
    });

    expect(home.homeDir).toBe('/users/release/.omnidraw');
    expect(home.mainDbPath).toBe('/users/release/.omnidraw/main.db');
  });

  test('uses OMNIDRAW_HOME when no CLI override is present', () => {
    const home = fnResolveOmnidrawHome(effects, {
      cwd: '/workspace',
      homedir: '/users/release',
      env: { OMNIDRAW_HOME: './environment-home' },
    });

    expect(home.homeDir).toBe('/workspace/environment-home');
  });

  test('--data-dir takes precedence over OMNIDRAW_HOME', () => {
    const home = fnResolveOmnidrawHome(effects, {
      cwd: '/workspace',
      homedir: '/users/release',
      env: { OMNIDRAW_HOME: './environment-home' },
      dataDir: './cli-home',
    });

    expect(home.homeDir).toBe('/workspace/cli-home');
  });
});
