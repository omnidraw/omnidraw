import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { ZInvokeFunctionInput } from '../packages/api/src/function/contract';

const REPO_ROOT = resolve(import.meta.dir, '..');

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

describe('M6 short-lived function runtime boundaries', () => {
  test('keeps the public runtime independent from API and database implementations', async () => {
    const root = join(REPO_ROOT, 'packages', 'function-runtime', 'src');
    const violations: string[] = [];
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, 'utf8');
      if (/@omnidraw\/(?:api|service-db)/.test(source)) {
        violations.push(relative(REPO_ROOT, file));
      }
    }
    expect(violations).toEqual([]);

    const packageJson = await Bun.file(
      join(REPO_ROOT, 'packages', 'function-runtime', 'package.json'),
    ).json() as { readonly exports?: Record<string, string> };
    expect(packageJson.exports?.['.']).toBe('./src/index.ts');
    expect(packageJson.exports?.['./local']).toBe('./src/local/index.ts');
  });

  test('requires exact canvas and filesystem-catalog identity without durable authority', () => {
    const base = {
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'widget-instance',
      widgetKey: 'settings',
      catalogGeneration: 7,
      functionName: 'updateSettings',
      input: { theme: 'dark' },
    };
    expect(ZInvokeFunctionInput.safeParse(base).success).toBe(true);
    for (const forbidden of [
      { orgId: 'foreign-org' },
      { accountId: 'foreign-account' },
      { widgetDefinitionId: 'caller-definition' },
      { widgetRevisionId: 'caller-revision' },
      { functionId: 'caller-function' },
      { resourceId: 'caller-resource' },
      { invocationId: 'caller-invocation' },
      { idempotencyKey: 'caller-key' },
      { waitUntilMs: 1 },
      { schedule: 'daily' },
      { durableContinuation: true },
    ]) {
      expect(ZInvokeFunctionInput.safeParse({ ...base, ...forbidden }).success).toBe(false);
    }
  });

  test('keeps physical resource authority out of the guest protocol', async () => {
    const workerTypes = await readFile(
      join(REPO_ROOT, 'packages', 'function-runtime', 'src', 'local', 'worker-types.ts'),
      'utf8',
    );
    const resourceCall = workerTypes.match(
      /type:\s*'resource_call'[\s\S]*?call:\s*TResourceCall;[\s\S]*?}>/,
    )?.[0] ?? '';
    expect(resourceCall).not.toContain('resourceId');
    expect(resourceCall).not.toContain('writeCapability');
    expect(resourceCall).not.toMatch(/(?:file|database|socket|host)Path/i);

    const runtimeFiles = await sourceFiles(
      join(REPO_ROOT, 'packages', 'function-runtime', 'src', 'local'),
    );
    const pathViolations: string[] = [];
    for (const file of runtimeFiles) {
      if (!file.endsWith(`${sep}worker-types.ts`) && !file.endsWith(`${sep}function-worker.ts`)) {
        continue;
      }
      const source = await readFile(file, 'utf8');
      if (/\b(?:data\.db|resourcesRoot|resourcePath|databasePath)\b/.test(source)) {
        pathViolations.push(relative(REPO_ROOT, file));
      }
    }
    expect(pathViolations).toEqual([]);
  });

  test('wires production through the direct catalog runtime and one-shot sandbox capability', async () => {
    const setup = await readFile(join(REPO_ROOT, 'apps', 'cli', 'src', 'setup-services.ts'), 'utf8');
    for (const token of [
      'BunChildSandboxDriver',
      'DirectFunctionExecutor',
      'EphemeralResourceWritePermitAuthority',
      'WidgetFilesystemRuntimeCatalog',
      "services.provide('functionInvocation'",
    ]) {
      expect(setup).toContain(token);
    }
    for (const removed of [
      'FunctionControlStoreTurso',
      'LocalFunctionDispatcher',
      'FunctionResourceGatewayFactory',
      'WidgetFunctionArtifactReader',
    ]) expect(setup).not.toContain(removed);

    const driver = await readFile(
      join(REPO_ROOT, 'packages', 'function-runtime', 'src', 'local', 'BunChildSandboxDriver.ts'),
      'utf8',
    );
    expect(driver).toMatch(/warmTtlMs\s*!==\s*0/);
    expect(driver).toMatch(/warm TTL is fixed at zero/);
  });
});
