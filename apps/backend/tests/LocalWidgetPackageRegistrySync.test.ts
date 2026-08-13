import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalWidgetPackageRegistrySync } from '../src/shell/widget/LocalWidgetPackageRegistrySync';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalWidgetPackageRegistrySync', () => {
  test('coalesces concurrent requests and retains one successful process-local sync', async () => {
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markExecuting!: () => void;
    const executing = new Promise<void>((resolve) => {
      markExecuting = resolve;
    });
    const sync = new LocalWidgetPackageRegistrySync({
      repositoryRoot: '/workspace',
      stat: async () => ({ isFile: () => true }),
      execute: async (command, args, options) => {
        calls += 1;
        markExecuting();
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
    await executing;
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
      stat: async () => ({ isFile: () => true }),
      execute: async () => {
        calls += 1;
        if (calls === 1) throw new Error('registry unavailable');
      },
    });

    await expect(sync.sync()).rejects.toThrow('registry unavailable');
    await expect(sync.sync()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  test('rejects a missing registry script before spawning with one actionable path', async () => {
    let executed = false;
    const sync = new LocalWidgetPackageRegistrySync({
      repositoryRoot: '/workspace',
      stat: async () => {
        throw new Error('missing');
      },
      execute: async () => {
        executed = true;
      },
    });

    await expect(sync.sync()).rejects.toThrow(
      "expected the registry script at '/workspace/scripts/local-registry.mjs'",
    );
    expect(executed).toBe(false);
  });

  test('reports the command, process result, stdout, and stderr exactly once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-registry-sync-error-'));
    roots.push(root);
    const scripts = join(root, 'scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'local-registry.mjs'), [
      "process.stdout.write('sync stdout marker\\n');",
      "process.stderr.write('registry unavailable marker\\n');",
      'process.exit(7);',
      '',
    ].join('\n'));
    const sync = new LocalWidgetPackageRegistrySync({ repositoryRoot: root });

    const error = await sync.sync().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      `Command: node ${join(root, 'scripts', 'local-registry.mjs')} publish-widget-packages`,
    );
    expect(message).toContain('Process failed with code 7.');
    expect(message.match(/sync stdout marker/g)).toHaveLength(1);
    expect(message.match(/registry unavailable marker/g)).toHaveLength(1);
  });
});
