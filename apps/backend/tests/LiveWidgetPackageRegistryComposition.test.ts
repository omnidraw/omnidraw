import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { SOURCE_REPOSITORY_ROOT } from '../src/shell/cli/main-app';
import { createLiveLocalWidgetPackageRegistrySync } from '../src/shell/runtime/layer.live-mechanics';

describe('live widget package registry composition', () => {
  test('uses the tracked root registry script in local development', async () => {
    const calls: Array<Readonly<{
      command: string;
      args: readonly string[];
      cwd: string;
    }>> = [];
    const sync = createLiveLocalWidgetPackageRegistrySync({
      localDevelopment: true,
      repositoryRoot: SOURCE_REPOSITORY_ROOT,
      execute: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
      },
    });

    await sync?.sync();

    const scriptPath = join(SOURCE_REPOSITORY_ROOT, 'scripts', 'local-registry.mjs');
    expect(calls).toEqual([{
      command: 'node',
      args: [scriptPath, 'publish-widget-packages'],
      cwd: SOURCE_REPOSITORY_ROOT,
    }]);
    expect(scriptPath).not.toContain('/apps/backend/scripts/local-registry.mjs');
  });

  test('does not require a repository root outside local development', () => {
    expect(createLiveLocalWidgetPackageRegistrySync({
      localDevelopment: false,
    })).toBeNull();
  });
});
