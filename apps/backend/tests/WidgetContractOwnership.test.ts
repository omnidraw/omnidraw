import { describe, expect, test } from 'bun:test';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ZOmnidrawToolIcon,
  ZWidgetManifestV1,
  type TSdkValidator,
} from '@omnidraw/sdk/contract';
import { sdkSchema } from '#backend/shell/api/sdk-schema';

const ROOT = resolve(import.meta.dir, '../../..');
const BACKEND = join(ROOT, 'apps/backend');

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  }))).flat();
}

function moduleSpecifiers(source: string): readonly string[] {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g),
  ].map((match) => match[1]!);
}

const PORTABLE_SDK_INVENTORY = Object.freeze({
  manifest: 'packages/sdk/src/manifest.ts',
  artifact: 'packages/sdk/src/artifact.ts',
  guestAbi: 'packages/sdk/src/guest.ts',
  hostBridge: 'packages/sdk/src/host.ts',
  resources: 'packages/sdk/src/resource.ts',
  functions: 'packages/sdk/src/function.ts',
  state: 'packages/sdk/src/state.ts',
  validationAndCanonicalizers: 'packages/sdk/src/contracts/index.ts',
  conformance: 'packages/sdk/src/conformance.ts',
});

const BACKEND_ONLY_OWNER_INVENTORY = Object.freeze({
  sourceProjection: 'apps/backend/src/shell/widget-domain/local',
  filesystemAuthority: 'apps/backend/src/shell/agent/widget-filesystem',
  buildAndExecutionPolicy: 'apps/backend/src/shell/widget-runtime',
  previewSigningAndPublication: 'apps/backend/src/shell/widget',
  functionExecution: 'apps/backend/src/shell/function-execution',
});

describe('widget contract ownership', () => {
  test('classifies every widget area under one portable or backend-only owner', async () => {
    for (const path of Object.values(PORTABLE_SDK_INVENTORY)) {
      expect(await exists(join(ROOT, path)), path).toBe(true);
    }
    for (const path of Object.values(BACKEND_ONLY_OWNER_INVENTORY)) {
      expect(await exists(join(ROOT, path)), path).toBe(true);
    }
    expect(await exists(join(BACKEND, 'src/core/widget-domain'))).toBe(false);

    const manifest = JSON.parse(await readFile(join(BACKEND, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).not.toHaveProperty('lucide-static');
  });

  test('uses only supported SDK package entrypoints and never its source tree', async () => {
    const sdkManifest = JSON.parse(await readFile(join(ROOT, 'packages/sdk/package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const supported = new Set(Object.keys(sdkManifest.exports).map((key) => (
      key === '.' ? '@omnidraw/sdk' : `@omnidraw/sdk${key.slice(1)}`
    )));

    for (const path of await sourceFiles(join(BACKEND, 'src'))) {
      const source = await readFile(path, 'utf8');
      expect(source, path).not.toContain('packages/sdk/src');
      expect(source, path).not.toContain('#backend/core/widget-domain');
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier.startsWith('@omnidraw/sdk')) {
          expect(supported.has(specifier), `${path}: ${specifier}`).toBe(true);
        }
      }
    }
  });

  test('projects SDK validation into private Zod transport without changing acceptance', () => {
    const cases: readonly Readonly<{
      validator: TSdkValidator<unknown>;
      values: readonly unknown[];
    }>[] = [
      {
        validator: ZOmnidrawToolIcon,
        values: [{ lucidIcon: 'Cloud' }, {}, { lucidIcon: 'not-a-real-icon' }],
      },
      {
        validator: ZWidgetManifestV1,
        values: [{
          $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
          schemaVersion: 1,
          name: 'Parity',
          slug: 'parity',
          description: 'SDK projection parity.',
          tool: { label: 'Parity', group: null, priority: 0 },
          ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
        }, { schemaVersion: 1 }],
      },
    ];

    for (const entry of cases) {
      const projected = sdkSchema(entry.validator);
      for (const value of entry.values) {
        const portable = entry.validator.safeParse(value);
        const server = projected.safeParse(value);
        expect(server.success).toBe(portable.success);
        if (portable.success && server.success) expect(server.data).toEqual(portable.data);
      }
    }
  });
});
