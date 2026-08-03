import { describe, expect, test } from 'bun:test';
import { LocalWidgetPackageRegistrySync } from '../src/services/LocalWidgetPackageRegistrySync';

describe('LocalWidgetPackageRegistrySync', () => {
  test('coalesces concurrent requests and retains one successful process-local sync', async () => {
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = new LocalWidgetPackageRegistrySync({
      repositoryRoot: '/workspace',
      execute: async (command, args, options) => {
        calls += 1;
        expect(command).toBe('node');
        expect(args).toEqual([
          '/workspace/scripts/local-registry.mjs',
          'publish-widget-packages',
        ]);
        expect(options.cwd).toBe('/workspace');
        await blocked;
      },
    });

    const first = sync.sync();
    const second = sync.sync();
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    await sync.sync();
    expect(calls).toBe(1);
  });

  test('allows a failed synchronization to be retried', async () => {
    let calls = 0;
    const sync = new LocalWidgetPackageRegistrySync({
      repositoryRoot: '/workspace',
      execute: async () => {
        calls += 1;
        if (calls === 1) throw new Error('registry unavailable');
      },
    });

    await expect(sync.sync()).rejects.toThrow('registry unavailable');
    await expect(sync.sync()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
