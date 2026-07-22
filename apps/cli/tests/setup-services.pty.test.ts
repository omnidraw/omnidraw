import { describe, expect, test } from 'bun:test';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import { join, resolve } from 'node:path';
import { setupServices } from '../src/setup-services';
import type { ICliConfig } from '../src/config';

function createConfig(overrides?: Partial<ICliConfig>): ICliConfig {
  const root = `/tmp/vibecanvas-test-${crypto.randomUUID()}`;
  const home = fnResolveVibecanvasHome({ join, resolve }, {
    cwd: process.cwd(),
    dataDir: root,
    env: {},
    homedir: '/tmp',
  });

  return {
    cwd: process.cwd(),
    dev: true,
    compiled: false,
    legacyActorEnabled: false,
    version: '0.0.0',
    command: 'serve',
    rawArgv: ['bun', 'run'],
    argv: [],
    port: 3000,
    home,
    helpRequested: false,
    versionRequested: false,
    ...overrides,
  };
}

describe('setupServices home and command wiring', () => {
  test('provides pty service in serve mode', async () => {
    const config = createConfig();
    const { services, dbService } = setupServices(config);
    const pty = services.get('pty');
    const dbConfig = (dbService as unknown as {
      config: { databasePath: string; dataDir: string; cacheDir: string };
    }).config;

    expect(pty?.name).toBe('pty');
    expect(dbConfig).toMatchObject({
      databasePath: config.home.mainDbPath,
      dataDir: config.home.homeDir,
      cacheDir: config.home.cacheRoot,
    });

    await pty?.stop?.();
    await services.get('db')?.stop?.();
  });

  test.each([
    ['upgrade', { command: 'upgrade' as const }],
    ['uninstall', { command: 'uninstall' as const }],
    ['unknown', { command: 'unknown' as const }],
    ['help', { helpRequested: true }],
    ['version', { versionRequested: true }],
  ])('does not provide stateful services for %s', (_label, overrides) => {
    const { services } = setupServices(createConfig(overrides));

    expect(services.get('eventPublisher')).toBeDefined();
    expect(services.get('db')).toBeUndefined();
    expect(services.get('filesystem')).toBeUndefined();
    expect(services.get('pty')).toBeUndefined();
    expect(services.get('automerge')).toBeUndefined();
    expect(services.get('actor')).toBeUndefined();
    expect(services.get('agent')).toBeUndefined();
  });
});
