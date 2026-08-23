import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SHELL_ROOT = fileURLToPath(new URL('../', import.meta.url));

const ambientFallback = /(?:\?\?|\|\|)\s*\(?\s*(?:Bun\.(?:spawn|which|resolveSync|serve|build)|process\.(?:execPath|env|platform|arch)|Date\.now|crypto\.randomUUID|randomUUID|randomBytes|setTimeout|setInterval|fetch\b|globalThis\.)/;

const optionalWorldHandle = /readonly\s+(?:nowMs|createId|createNonce|createOperationToken|createToken|randomUUID|randomBytes|spawn|executable|workerPath|tempRoot|readRssBytes|readCpuMs|runProcess|scheduleIdleSweep|databaseFactory|timers|processGroups|resolveTrustedPackageImport)\?:/;

async function source(relativePath: string): Promise<string> {
  return Bun.file(join(SHELL_ROOT, relativePath)).text();
}

describe('backend shell explicit world handles', () => {
  test('production shell sources never make an ambient world fallback', async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob('**/*.ts');
    for await (const relativePath of glob.scan({ cwd: SHELL_ROOT, onlyFiles: true })) {
      if (
        relativePath.endsWith('.test.ts')
        || relativePath.includes('/tests/')
        || relativePath.includes('/fixtures/')
      ) continue;
      const text = await source(relativePath);
      if (ambientFallback.test(text)) violations.push(`${relativePath}: ambient fallback`);
      if (optionalWorldHandle.test(text)) violations.push(`${relativePath}: optional world handle`);
    }
    expect(violations).toEqual([]);
  });

  test('stateful adapters declare their replaceable world dependencies as required', async () => {
    const requirements: Readonly<Record<string, readonly string[]>> = {
      'function-execution/local/BunChildFunctionProcessDriver.ts': [
        'executable: string',
        'workerPath: string',
        'tempRoot: string',
        'spawn: typeof Bun.spawn',
        'nowMs: () => number',
        'createId: () => string',
        'timers: Readonly',
        'readRssBytes: (pid: number) => Promise<number>',
        'readCpuMs: (pid: number) => Promise<number>',
        'createCage: (tempRoot: string)',
        'terminateChild(',
        'processGroups: TBunChildProcessGroupController',
      ],
      'function-execution/local/BunChildFunctionDescriptorExtractor.ts': [
        'executable: string',
        'workerPath: string',
        'tempRoot: string',
        'timers: Readonly',
        'readRssBytes: (pid: number) => Promise<number>',
        'createCage: (tempRoot: string)',
        'terminateChild(',
      ],
      'function-execution/local/DirectFunctionExecutor.ts': [
        'nowMs: () => number',
        'createId: () => string',
      ],
      'function-execution/local/EphemeralResourceWritePermitAuthority.ts': [
        'nowMs: () => number',
        'createId: () => string',
        'createNonce: () => string',
      ],
      'widget/WidgetNpmDistributionBuild.ts': [
        'runProcess: TRunProcess',
        'createId: () => string',
      ],
      'widget/WidgetFilesystemManagementService.ts': [
        'createOperationToken: () => string',
      ],
      'widget/WidgetFilesystemRuntimeCatalog.ts': [
        'barrier: PublicationReadWriteBarrier',
        'filesystem: NodeWidgetCatalogFilesystem',
        'hash: NodeWidgetCatalogHash',
      ],
      'widget-runtime/build/WidgetArtifactBuilderCapsule.ts': [
        'resolveTrustedPackageImport: (specifier: string) => string',
      ],
      'preview/PreviewInspectionShellServer.ts': [
        'createToken: () => string',
      ],
      'resources/ResourceService.ts': [
        "crypto: Pick<Crypto, 'randomUUID'>",
        'randomBytes: (length: number) => Uint8Array',
        'databaseFactory: TDatabaseFactory',
        'nowMs: () => number',
        'scheduleIdleSweep: TResourceIdleSweepScheduler',
      ],
      'resources/local/ResourceKeyValueStore.ts': [
        'databaseFactory: TResourceKeyValueDatabaseFactory',
        'nowMs: () => number',
        'scheduleIdleSweep: TResourceIdleSweepScheduler',
      ],
      'resources/local/DbResource.ts': [
        'databaseFactory: TDatabaseFactory',
        'nowMs: () => number',
        'scheduleIdleSweep: TResourceIdleSweepScheduler',
      ],
      'resources/local/ResourceStoreService.ts': [
        'nowMs: () => number',
      ],
      'resources/local/SecretStoreKeyProvider.ts': [
        'randomBytes: (length: number) => Uint8Array',
        'randomUUID: () => string',
      ],
      'resources/local/DbResourceCoordinator.ts': [
        'nowMs: () => number',
      ],
    };

    for (const [relativePath, requiredFragments] of Object.entries(requirements)) {
      const text = await source(relativePath);
      for (const fragment of requiredFragments) {
        expect(text, `${relativePath} must require ${fragment}`).toContain(fragment);
      }
    }
  });
});
