import { describe, expect, test } from 'bun:test';
import { setupServices } from '../src/setup-services';
import type { ICliConfig } from '../src/config';

function createConfig(overrides?: Partial<ICliConfig>): ICliConfig {
  const root = `/tmp/vibecanvas-test-${crypto.randomUUID()}`;

  return {
    cwd: process.cwd(),
    dev: true,
    compiled: false,
    version: '0.0.0',
    command: 'serve',
    rawArgv: ['bun', 'run'],
    argv: [],
    port: 3000,
    dbPath: `/tmp/vibecanvas-test-${crypto.randomUUID()}.sqlite`,
    xdgPaths: {
      cacheDirPath: `${root}/cache`,
      configDirPath: `${root}/config`,
      dataDirPath: `${root}/data`,
      stateDirPath: `${root}/state`,
    },
    helpRequested: false,
    versionRequested: false,
    ...overrides,
  };
}

describe('setupServices PTY wiring', () => {
  test('provides pty service in serve mode', async () => {
    const { services } = setupServices(createConfig());
    const pty = services.get('pty');

    expect(pty?.name).toBe('pty');

    await pty?.stop?.();
    await services.get('db')?.stop?.();
  });

  test('does not provide pty service outside serve mode', async () => {
    const { services } = setupServices(createConfig({ command: 'upgrade' }));
    const pty = services.get('pty');

    expect(pty).toBeUndefined();
  });

  test('does not provide pty service during uninstall', async () => {
    const { services } = setupServices(createConfig({ command: 'uninstall' }));
    const pty = services.get('pty');

    expect(pty).toBeUndefined();
  });
});
