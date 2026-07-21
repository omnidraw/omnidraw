import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetControlStore,
  TWidgetArtifactDescriptor,
  TWidgetManifestV2,
} from '../src';
import { fnCanonicalizeWidgetManifest } from '../src';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactBuilderBun,
  WidgetArtifactReadAuthority,
  WidgetArtifactService,
  WidgetSourceSnapshot,
} from '../src/local';

const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibecanvas-widget-artifact-'));
  roots.add(root);
  return root;
}

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
});

const foreignTenant: TTenantContext = Object.freeze({
  ...tenant,
  orgId: 'org-b',
  requestId: 'request-b',
});

async function writeSource(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
}

function envelopeText(bytes: Uint8Array): string {
  const envelope = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
    outputs: Array<{ bytesBase64: string }>;
  };
  return envelope.outputs
    .map((output) => Buffer.from(output.bytesBase64, 'base64').toString('utf8'))
    .join('\n');
}

function buildOutput(sourceText: string): Bun.BuildOutput {
  const output = Object.assign(new Blob([sourceText]), {
    path: '/virtual/widget-output.js',
    kind: 'entry-point' as const,
    loader: 'js' as const,
    hash: 'test-output',
    sourcemap: null,
  });
  return {
    success: true,
    outputs: [output],
    logs: [],
  };
}

describe('local immutable widget source and build runtime', () => {
  test('captures one deterministic sorted source snapshot and rejects symlinks', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    await mkdir(source);
    await writeSource(source, {
      'src/z.ts': 'export const z = 1;',
      'src/a.ts': 'export const a = 2;',
    });
    const snapshots = new WidgetSourceSnapshot();
    const first = await snapshots.capture(source, { id: 'source-a', createdAtMs: 1 });
    const second = await snapshots.capture(source, { id: 'source-b', createdAtMs: 2 });

    expect(first.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/z.ts']);
    expect(first.digestSha256).toBe(second.digestSha256);
    expect(first.byteSize).toBeGreaterThan(0);

    const outside = join(root, 'outside.ts');
    await writeFile(outside, 'export const escaped = true;');
    await symlink(outside, join(source, 'src', 'linked.ts'));
    await expect(snapshots.capture(source)).rejects.toThrow('symlink');

    const linkedRoot = join(root, 'linked-source-root');
    await symlink(source, linkedRoot);
    await expect(snapshots.capture(linkedRoot)).rejects.toThrow('real directory');
  });

  test('rejects a directory identity replacement while a source capture is in flight', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    const tree = join(source, 'tree');
    await mkdir(tree, { recursive: true });
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => (
      writeFile(join(tree, `file-${String(index).padStart(4, '0')}.ts`), `export const v${index} = ${index};`)
    )));

    const captureOutcome = new WidgetSourceSnapshot().capture(source).then(
      () => 'captured' as const,
      () => 'rejected' as const,
    );
    await Bun.sleep(1);
    await rename(tree, join(source, 'displaced-tree'));
    await mkdir(tree, { recursive: true });
    await writeFile(join(tree, 'replacement.ts'), 'export const replacement = true;');

    expect(await captureOutcome).toBe('rejected');
  });

  test('rejects a pathname swap at the no-follow file-open checkpoint', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    const sourceFile = join(source, 'src', 'ui.ts');
    const displacedFile = join(root, 'displaced-ui.ts');
    const outsideFile = join(root, 'outside.ts');
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(sourceFile, 'export const safe = true;');
    await writeFile(outsideFile, 'export const escaped = true;');
    let swapped = false;
    const snapshots = new WidgetSourceSnapshot({
      checkpoint: async ({ phase, path }) => {
        if (swapped || phase !== 'before_file_open' || path !== 'src/ui.ts') return;
        swapped = true;
        await rename(sourceFile, displacedFile);
        await symlink(outsideFile, sourceFile);
      },
    });

    await expect(snapshots.capture(source)).rejects.toThrow('opened');
    expect(swapped).toBe(true);
  });

  test('rejects a FIFO swap without blocking on the replacement entry', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    const sourceFile = join(source, 'src', 'ui.ts');
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(sourceFile, 'export const safe = true;');
    const snapshots = new WidgetSourceSnapshot({
      checkpoint: async ({ phase, path }) => {
        if (phase !== 'before_file_open' || path !== 'src/ui.ts') return;
        await rename(sourceFile, join(root, 'displaced-fifo-source.ts'));
        const child = Bun.spawn(['mkfifo', sourceFile], { stdout: 'ignore', stderr: 'pipe' });
        if (await child.exited !== 0) {
          throw new Error(await new Response(child.stderr).text());
        }
      },
    });

    const outcome = await Promise.race([
      snapshots.capture(source).then(() => 'captured', () => 'rejected'),
      Bun.sleep(1_000).then(() => 'timed_out'),
    ]);
    expect(outcome).toBe('rejected');
  });

  test('builds deterministic separate UI/server envelopes and excludes server bytes from UI', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    await mkdir(source);
    await writeSource(source, {
      'src/ui.ts': 'export const uiMarker = "UI_MARKER";',
      'src/server.server.ts': 'export const serverMarker = "SERVER_SECRET_MARKER";',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(source, {
      id: 'source-a',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Built widget',
      slug: 'built-widget',
      ui: { entry: 'src/ui.ts' },
      server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:1' },
    };
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
    });
    const request = {
      snapshot,
      manifest,
      canonicalManifestJson: JSON.stringify(manifest),
      builderIdentity: 'bun-test-v1',
    };
    const first = await builder.build(tenant, request);
    const second = await builder.build(tenant, request);

    expect(first.uiArtifact.digestSha256).toBe(second.uiArtifact.digestSha256);
    expect(first.serverArtifact?.digestSha256).toBe(second.serverArtifact?.digestSha256);
    expect(envelopeText(first.uiArtifact.bytes)).toContain('UI_MARKER');
    expect(envelopeText(first.uiArtifact.bytes)).not.toContain('SERVER_SECRET_MARKER');
    expect(envelopeText(first.serverArtifact!.bytes)).toContain('SERVER_SECRET_MARKER');
  });

  test('emits no server artifact for UI-only builds and rejects UI imports of server modules', async () => {
    const root = await tempRoot();
    const source = join(root, 'source');
    await mkdir(source);
    await writeSource(source, {
      'src/ui.ts': 'export const view = "browser-only";',
      'src/server.server.ts': 'export const secret = "SERVER_ONLY";',
    });
    const snapshots = new WidgetSourceSnapshot();
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
    });
    const browserSnapshot = await snapshots.capture(source, { id: 'browser', createdAtMs: 1 });
    const browserManifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Browser only',
      slug: 'browser-only',
      ui: { entry: 'src/ui.ts' },
    };
    const browser = await builder.build(tenant, {
      snapshot: browserSnapshot,
      manifest: browserManifest,
      canonicalManifestJson: JSON.stringify(browserManifest),
      builderIdentity: 'bun-test-v1',
    });
    expect(browser.serverArtifact).toBeNull();

    await writeFile(join(source, 'src', 'ui.ts'), 'export { secret } from "./server.server.ts";');
    const invalidSnapshot = await snapshots.capture(source, { id: 'invalid', createdAtMs: 2 });
    const invalidManifest: TWidgetManifestV2 = {
      ...browserManifest,
      server: { entry: 'src/server.server.ts', runtimeAbi: 'vibecanvas:1' },
    };
    await expect(builder.build(tenant, {
      snapshot: invalidSnapshot,
      manifest: invalidManifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(invalidManifest),
      builderIdentity: 'bun-test-v1',
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_FAILED' });
  });

  test('rejects host, traversal, scheme, and ambient imports for both build targets', async () => {
    const cases = [
      { target: 'ui', source: 'import "/tmp/host-secret.ts";' },
      { target: 'ui', source: 'import "../../outside.ts";' },
      { target: 'ui', source: 'import "ambient-package";' },
      { target: 'ui', source: 'import "node:fs";' },
      { target: 'ui', source: 'import "bun:test";' },
      { target: 'server', source: 'import "/tmp/host-secret.ts";' },
      { target: 'server', source: 'import "../../outside.ts";' },
      { target: 'server', source: 'import "ambient-package";' },
      { target: 'server', source: 'import "node:fs";' },
      { target: 'server', source: 'import "bun:test";' },
    ] as const;

    for (const testCase of cases) {
      const root = await tempRoot();
      const sourceRoot = join(root, 'source');
      await mkdir(sourceRoot);
      await writeSource(sourceRoot, {
        'src/ui.ts': testCase.target === 'ui' ? testCase.source : 'export const ui = true;',
        'src/server.ts': testCase.target === 'server'
          ? testCase.source
          : 'export const server = true;',
      });
      const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
        id: `invalid-${testCase.target}`,
        createdAtMs: 1,
      });
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name: 'Boundary test',
        slug: 'boundary-test',
        ui: { entry: 'src/ui.ts' },
        ...(testCase.target === 'server'
          ? { server: { entry: 'src/server.ts', runtimeAbi: 'vibecanvas:1' } }
          : {}),
      };
      const builder = new WidgetArtifactBuilderBun({
        tempRoot: join(root, 'temp'),
        builderIdentity: 'bun-test-v1',
      });

      await expect(builder.build(tenant, {
        snapshot,
        manifest,
        canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
        builderIdentity: 'bun-test-v1',
      })).rejects.toMatchObject({
        code: 'WIDGET_BUILD_FAILED',
        message: `Widget ${testCase.target} build failed.`,
      });
    }
  });

  test('rejects import macros before invoking Bun', async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, {
      'src/ui.ts': 'import macro from "./macro.ts" with { type: "macro" }; export { macro };',
      'src/macro.ts': 'export default () => "host execution";',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'macro-source',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Macro test',
      slug: 'macro-test',
      ui: { entry: 'src/ui.ts' },
    };
    let buildCalled = false;
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
      build: (async () => {
        buildCalled = true;
        throw new Error('Bun build must not run for forbidden import syntax.');
      }) as typeof Bun.build,
    });

    await expect(builder.build(tenant, {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    })).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
      message: 'Widget source build failed.',
    });
    expect(buildCalled).toBe(false);
  });

  test('rejects import.meta.require in UI and server sources before invoking Bun', async () => {
    for (const target of ['ui', 'server'] as const) {
      const root = await tempRoot();
      const sourceRoot = join(root, 'source');
      await mkdir(sourceRoot);
      await writeSource(sourceRoot, {
        'src/ui.ts': target === 'ui'
          ? 'export const fs = import.meta.require("node:fs");'
          : 'export const ui = true;',
        'src/backend.ts': target === 'server'
          ? 'export const fs = import.meta.require("node:fs");'
          : 'export const backend = true;',
      });
      const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
        id: `alternate-loader-${target}`,
        createdAtMs: 1,
      });
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name: 'Alternate loader',
        slug: `alternate-loader-${target}`,
        ui: { entry: 'src/ui.ts' },
        ...(target === 'server'
          ? { server: { entry: 'src/backend.ts', runtimeAbi: 'vibecanvas:1' } }
          : {}),
      };
      let buildCalled = false;
      const builder = new WidgetArtifactBuilderBun({
        tempRoot: join(root, 'temp'),
        builderIdentity: 'bun-test-v1',
        build: (async () => {
          buildCalled = true;
          return buildOutput('export const unexpected = true;');
        }) as typeof Bun.build,
      });

      await expect(builder.build(tenant, {
        snapshot,
        manifest,
        canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
        builderIdentity: 'bun-test-v1',
      })).rejects.toMatchObject({ code: 'WIDGET_BUILD_FAILED' });
      expect(buildCalled).toBe(false);
    }
  });

  test('rejects computed import.meta loader access before invoking Bun', async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, {
      'src/ui.ts': 'const loader = "re" + "quire"; export const fs = import.meta[loader]("node:fs");',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'computed-loader',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Computed loader',
      slug: 'computed-loader',
      ui: { entry: 'src/ui.ts' },
    };
    let buildCalled = false;
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
      build: (async () => {
        buildCalled = true;
        return buildOutput('export const unexpected = true;');
      }) as typeof Bun.build,
    });

    await expect(builder.build(tenant, {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_FAILED' });
    expect(buildCalled).toBe(false);
  });

  test('allows harmless require text in comments and string literals', async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, {
      'src/ui.ts': '// require is documentation, not a loader\nexport const label = "require";',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'harmless-loader-text',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Harmless loader text',
      slug: 'harmless-loader-text',
      ui: { entry: 'src/ui.ts' },
    };
    const result = await new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
    }).build(tenant, {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    });

    expect(result.uiArtifact.kind).toBe('ui');
  });

  test('rejects forbidden module loaders injected into emitted UI and server output', async () => {
    for (const target of ['ui', 'server'] as const) {
      const root = await tempRoot();
      const sourceRoot = join(root, 'source');
      await mkdir(sourceRoot);
      await writeSource(sourceRoot, {
        'src/ui.ts': 'export const ui = true;',
        'src/backend.ts': 'export const backend = true;',
      });
      const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
        id: `emitted-loader-${target}`,
        createdAtMs: 1,
      });
      const manifest: TWidgetManifestV2 = {
        schemaVersion: 2,
        name: 'Emitted loader',
        slug: `emitted-loader-${target}`,
        ui: { entry: 'src/ui.ts' },
        ...(target === 'server'
          ? { server: { entry: 'src/backend.ts', runtimeAbi: 'vibecanvas:1' } }
          : {}),
      };
      let callCount = 0;
      const builder = new WidgetArtifactBuilderBun({
        tempRoot: join(root, 'temp'),
        builderIdentity: 'bun-test-v1',
        build: (async () => {
          callCount += 1;
          const inject = target === 'ui' || callCount === 2;
          return buildOutput(inject
            ? 'export const fs = import.meta.require("node:fs");'
            : 'export const ui = true;');
        }) as typeof Bun.build,
      });

      await expect(builder.build(tenant, {
        snapshot,
        manifest,
        canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
        builderIdentity: 'bun-test-v1',
      })).rejects.toMatchObject({
        code: 'WIDGET_BUILD_FAILED',
        message: `Widget ${target} build failed.`,
      });
    }
  });

  test('rejects overlap between UI and server transitive dependency closures', async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export { internal } from "./internal.ts";',
      'src/backend.ts': 'export { internal } from "./internal.ts";',
      'src/internal.ts': 'export const internal = "SERVER_TRANSITIVE_SECRET";',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'transitive-overlap',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Transitive overlap',
      slug: 'transitive-overlap',
      ui: { entry: 'src/ui.ts' },
      server: { entry: 'src/backend.ts', runtimeAbi: 'vibecanvas:1' },
    };
    let buildCalled = false;
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
      build: (async () => {
        buildCalled = true;
        return buildOutput('export const unexpected = true;');
      }) as typeof Bun.build,
    });

    await expect(builder.build(tenant, {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    })).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
      message: 'Widget ui build failed.',
    });
    expect(buildCalled).toBe(false);
  });

  test('allows an explicit shared-safe namespace in both dependency closures', async () => {
    const root = await tempRoot();
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, {
      'src/ui.ts': 'export { schema } from "./shared/schema.ts";',
      'src/backend.ts': 'export { schema } from "./shared/schema.ts";',
      'src/shared/schema.ts': 'export const schema = Object.freeze({ version: 1 });',
    });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'shared-safe-overlap',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Shared safe overlap',
      slug: 'shared-safe-overlap',
      ui: { entry: 'src/ui.ts' },
      server: { entry: 'src/backend.ts', runtimeAbi: 'vibecanvas:1' },
    };
    const builder = new WidgetArtifactBuilderBun({
      tempRoot: join(root, 'temp'),
      builderIdentity: 'bun-test-v1',
    });

    const result = await builder.build(tenant, {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    });
    expect(result.uiArtifact.kind).toBe('ui');
    expect(result.serverArtifact?.kind).toBe('server');
  });

  test('rejects symlinked build-temp ancestors and a replaced pinned temp root', async () => {
    const root = await tempRoot();
    const outside = join(root, 'outside');
    const linkedParent = join(root, 'linked-parent');
    const linkedTempRoot = join(linkedParent, 'temp');
    await mkdir(linkedTempRoot.replace(linkedParent, outside), { recursive: true });
    await symlink(outside, linkedParent);
    const sourceRoot = join(root, 'source');
    await mkdir(sourceRoot);
    await writeSource(sourceRoot, { 'src/ui.ts': 'export const ui = true;' });
    const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
      id: 'temp-root',
      createdAtMs: 1,
    });
    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Temp root',
      slug: 'temp-root',
      ui: { entry: 'src/ui.ts' },
    };
    const request = {
      snapshot,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
      builderIdentity: 'bun-test-v1',
    };
    const linkedBuilder = new WidgetArtifactBuilderBun({
      tempRoot: linkedTempRoot,
      builderIdentity: 'bun-test-v1',
    });
    await expect(linkedBuilder.build(tenant, request)).rejects.toThrow('symlinked ancestor');

    const pinnedTempRoot = join(root, 'pinned-temp');
    const pinnedBuilder = new WidgetArtifactBuilderBun({
      tempRoot: pinnedTempRoot,
      builderIdentity: 'bun-test-v1',
    });
    await pinnedBuilder.build(tenant, request);
    await rename(pinnedTempRoot, join(root, 'displaced-temp'));
    await mkdir(pinnedTempRoot);
    await expect(pinnedBuilder.build(tenant, request)).rejects.toThrow('identity changed');
  });
});

describe('local artifact integrity and authorization', () => {
  test('propagates parent sync failure after rename and leaves a recoverable orphan', async () => {
    const root = await tempRoot();
    const artifactsRoot = join(root, 'artifacts');
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
      createNonce: () => 'sync-failure',
      syncDirectory: async () => {
        throw new Error('injected directory sync failure');
      },
    });

    const request = {
      kind: 'ui',
      bytes: Buffer.from('orphan after sync failure'),
    } as const;
    await expect(blobs.writeArtifact(request)).rejects.toThrow('injected directory sync failure');
    await expect(blobs.writeArtifact(request)).rejects.toThrow('injected directory sync failure');
    expect(await blobs.listBlobCandidates()).toMatchObject([{ form: 'final' }]);
  });

  test('parent-syncs fresh, existing, and rename-recovery write success paths', async () => {
    const root = await tempRoot();
    const normalArtifactsRoot = join(root, 'normal-artifacts');
    const normalSyncs: string[] = [];
    const normal = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: normalArtifactsRoot,
      createNonce: () => 'normal-sync',
      syncDirectory: async (path) => {
        normalSyncs.push(path);
      },
    });
    const request = { kind: 'ui' as const, bytes: Buffer.from('durable success') };
    const first = await normal.writeArtifact(request);
    const canonicalNormalArtifactsRoot = await realpath(normalArtifactsRoot);
    expect(normalSyncs.map((path) => relative(canonicalNormalArtifactsRoot, path) || '.')).toEqual([
      join('blobs', 'sha256', first.digestSha256.slice(0, 2)),
      join('blobs', 'sha256'),
      'blobs',
      '.',
      '..',
    ]);
    await normal.writeArtifact(request);
    expect(normalSyncs).toHaveLength(10);

    const recoverySyncs: string[] = [];
    const recoveredArtifactsRoot = join(root, 'recovered-artifacts');
    const recovered = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: recoveredArtifactsRoot,
      createNonce: () => 'rename-recovery',
      renameArtifact: async (source, target) => {
        await rename(source, target);
        throw new Error('injected uncertain rename outcome');
      },
      syncDirectory: async (path) => {
        recoverySyncs.push(path);
      },
    });
    await recovered.writeArtifact(request);
    expect(recoverySyncs).toHaveLength(5);
  });

  test('rejects symlinked blob ancestors for write, read, and delete', async () => {
    const root = await tempRoot();
    const artifactsRoot = join(root, 'artifacts');
    const outside = join(root, 'outside');
    await mkdir(artifactsRoot);
    await mkdir(outside);
    await symlink(outside, join(artifactsRoot, 'blobs'));
    const redirected = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
      createNonce: () => 'redirected',
    });
    await expect(redirected.writeArtifact({
      kind: 'ui',
      bytes: Buffer.from('must stay inside'),
    })).rejects.toThrow('real directory');
    expect(await readdir(outside)).toEqual([]);

    await rm(join(artifactsRoot, 'blobs'));
    const pinned = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
      createNonce: () => 'pinned',
    });
    const stored = await pinned.writeArtifact({ kind: 'ui', bytes: Buffer.from('pinned bytes') });
    const descriptor: TWidgetArtifactDescriptor = {
      orgId: tenant.orgId,
      id: 'pinned-artifact',
      kind: 'ui',
      digestSha256: stored.digestSha256,
      byteSize: stored.byteSize,
      retentionState: 'pinned',
      retainUntilMs: null,
      createdAtMs: 1,
    };
    const displacedBlobs = join(root, 'displaced-blobs');
    await rename(join(artifactsRoot, 'blobs'), displacedBlobs);
    await symlink(outside, join(artifactsRoot, 'blobs'));
    await expect(pinned.readArtifact(descriptor)).rejects.toThrow('real directory');
    await expect(pinned.deleteArtifact(descriptor)).rejects.toThrow('real directory');
    expect(await readdir(outside)).toEqual([]);

    await rm(join(artifactsRoot, 'blobs'));
    await mkdir(join(artifactsRoot, 'blobs', 'sha256'), { recursive: true });
    await expect(pinned.readArtifact(descriptor)).rejects.toThrow('identity changed');
  });

  test('rehashes bytes on read and fails closed after tampering', async () => {
    const root = await tempRoot();
    const artifactsRoot = join(root, 'artifacts');
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot,
      createNonce: () => 'nonce-a',
    });
    const stored = await blobs.writeArtifact({
      kind: 'ui',
      bytes: Buffer.from('immutable bytes'),
    });
    const descriptor: TWidgetArtifactDescriptor = {
      orgId: tenant.orgId,
      id: 'artifact-a',
      kind: 'ui',
      digestSha256: stored.digestSha256,
      byteSize: stored.byteSize,
      retentionState: 'pinned',
      retainUntilMs: null,
      createdAtMs: 1,
    };
    expect(Buffer.from(await blobs.readArtifact(descriptor)).toString()).toBe('immutable bytes');

    const path = join(
      artifactsRoot,
      'blobs',
      'sha256',
      stored.digestSha256.slice(0, 2),
      stored.digestSha256,
    );
    await writeFile(path, 'tampered');
    await expect(blobs.readArtifact(descriptor)).rejects.toMatchObject({
      code: 'WIDGET_ARTIFACT_INTEGRITY_FAILED',
    });
  });

  test('derives an exact tenant audience and denies foreign, other-account, or bare claims', async () => {
    const root = await tempRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
      createNonce: () => 'nonce-a',
    });
    const nowMs = 1_000;
    const authority = new WidgetArtifactReadAuthority({
      secret: Buffer.alloc(32, 7),
      maximumTtlMs: 10_000,
      now: () => nowMs,
    });
    let persisted: TWidgetArtifactDescriptor | null = null;
    const controlStore = {
      resolveArtifactReference: async (_tenant: TTenantContext, request: { artifactId: string }) => (
        persisted?.id === request.artifactId ? persisted : null
      ),
    } as unknown as IWidgetControlStore;
    const artifacts = new WidgetArtifactService({
      controlStore,
      blobs,
      capabilityIssuer: authority,
      capabilityVerifier: authority,
      now: () => nowMs,
      createNonce: () => 'read-a',
    });
    persisted = await artifacts.putArtifact(tenant, {
      id: 'artifact-a',
      kind: 'ui',
      digestSha256: '04dd9c7e9464019a848b69db2ed9a9b2a7def45b169e44627e7e613d67ff18ce',
      bytes: Buffer.from('authorized'),
      retentionState: 'pinned',
      retainUntilMs: null,
      createdAtMs: 1,
    });
    const capability = await artifacts.issueBrowserUiArtifactReadCapability(tenant, {
      definitionId: 'definition-a',
      revisionId: 'revision-a',
      artifactId: persisted.id,
      artifactKind: persisted.kind,
      digestSha256: persisted.digestSha256,
      expiresAtMs: nowMs + 5_000,
    });
    const claims = JSON.parse(
      Buffer.from(capability.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { audience: string; nonce: string };
    expect(claims.nonce).toBe('read-a');
    expect(claims.audience).toBe('account:org-a:account-a:browser_ui');
    const request = {
      artifactId: persisted.id,
      readCapability: capability,
      purpose: 'browser_ui' as const,
    };
    expect(Buffer.from((await artifacts.readArtifact(tenant, request))!).toString()).toBe('authorized');
    expect(await artifacts.readArtifact(foreignTenant, request)).toBeNull();
    expect(await artifacts.readArtifact({ ...tenant, accountId: 'account-b' }, request)).toBeNull();
    expect(await artifacts.readArtifact(tenant, {
      ...request,
      readCapability: persisted.digestSha256,
    })).toBeNull();
    expect(await artifacts.readArtifact(tenant, {
      ...request,
      readCapability: `${'a'.repeat(4_096)}.x`,
    })).toBeNull();
    expect(await artifacts.readArtifact(tenant, {
      ...request,
      readCapability: `${capability.split('.')[0]}.${'x'.repeat(4_096)}`,
    })).toBeNull();
  });

  test('enforces artifact purpose/kind policy before signing and after verification', async () => {
    const root = await tempRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
      createNonce: () => 'blob-nonce',
    });
    const nowMs = 2_000;
    const authority = new WidgetArtifactReadAuthority({
      secret: Buffer.alloc(32, 9),
      maximumTtlMs: 10_000,
      now: () => nowMs,
    });
    const descriptors: readonly TWidgetArtifactDescriptor[] = [
      {
        orgId: tenant.orgId,
        id: 'artifact-ui',
        kind: 'ui',
        digestSha256: 'a'.repeat(64),
        byteSize: 1,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 1,
      },
      {
        orgId: tenant.orgId,
        id: 'artifact-server',
        kind: 'server',
        digestSha256: 'b'.repeat(64),
        byteSize: 1,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 1,
      },
      {
        orgId: tenant.orgId,
        id: 'artifact-source',
        kind: 'source',
        digestSha256: 'c'.repeat(64),
        byteSize: 1,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 1,
      },
      {
        orgId: tenant.orgId,
        id: 'artifact-source-map',
        kind: 'source_map',
        digestSha256: 'd'.repeat(64),
        byteSize: 1,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 1,
      },
    ];
    const controlStore = {
      resolveArtifactReference: async (
        _tenant: TTenantContext,
        request: {
          artifactId: string;
          kind: string;
          digestSha256: string;
        },
      ) => descriptors.find((descriptor) => (
        descriptor.id === request.artifactId
        && descriptor.kind === request.kind
        && descriptor.digestSha256 === request.digestSha256
      )) ?? null,
    } as unknown as IWidgetControlStore;
    const artifacts = new WidgetArtifactService({
      controlStore,
      blobs,
      capabilityIssuer: authority,
      capabilityVerifier: authority,
      now: () => nowMs,
      createNonce: () => 'service-nonce',
    });
    const invalidIssuers = [
      {
        descriptor: descriptors[0]!,
        issue: artifacts.issueServerExecutionArtifactReadCapability.bind(artifacts),
      },
      {
        descriptor: descriptors[1]!,
        issue: artifacts.issueBrowserUiArtifactReadCapability.bind(artifacts),
      },
      {
        descriptor: descriptors[2]!,
        issue: artifacts.issueUiPreviewArtifactReadCapability.bind(artifacts),
      },
      {
        descriptor: descriptors[3]!,
        issue: artifacts.issueSourceBuildArtifactReadCapability.bind(artifacts),
      },
    ] as const;

    for (const { descriptor, issue } of invalidIssuers) {
      await expect(issue(tenant, {
        definitionId: 'definition-a',
        revisionId: 'revision-a',
        artifactId: descriptor.id,
        artifactKind: descriptor.kind,
        digestSha256: descriptor.digestSha256,
        expiresAtMs: nowMs + 5_000,
      })).rejects.toMatchObject({ code: 'WIDGET_ARTIFACT_NOT_FOUND' });
    }

    const serverPreviewCapability = await artifacts.issueServerPreviewArtifactReadCapability(
      tenant,
      {
        definitionId: 'definition-a',
        revisionId: 'revision-a',
        artifactId: descriptors[1]!.id,
        artifactKind: descriptors[1]!.kind,
        digestSha256: descriptors[1]!.digestSha256,
        expiresAtMs: nowMs + 5_000,
      },
    );
    const serverPreviewClaims = JSON.parse(
      Buffer.from(serverPreviewCapability.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { audience: string; purpose: string };
    expect(serverPreviewClaims).toMatchObject({
      audience: 'cell:org-a:cell-a:1:preview_server',
      purpose: 'preview_server',
    });

    const uiPreviewCapability = await artifacts.issueUiPreviewArtifactReadCapability(tenant, {
      definitionId: 'definition-a',
      revisionId: 'revision-a',
      artifactId: descriptors[0]!.id,
      artifactKind: descriptors[0]!.kind,
      digestSha256: descriptors[0]!.digestSha256,
      expiresAtMs: nowMs + 5_000,
    });
    const uiPreviewClaims = JSON.parse(
      Buffer.from(uiPreviewCapability.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { audience: string; purpose: string };
    expect(uiPreviewClaims).toMatchObject({
      audience: 'account:org-a:account-a:preview_ui',
      purpose: 'preview_ui',
    });

    const uiDescriptor = descriptors[0]!;
    const forgedCapability = await authority.issueArtifactReadCapability(tenant, {
      definitionId: 'definition-a',
      revisionId: 'revision-a',
      artifactId: uiDescriptor.id,
      artifactKind: uiDescriptor.kind,
      digestSha256: uiDescriptor.digestSha256,
      purpose: 'server_execution',
      audience: 'cell:org-a:cell-a:1:server_execution',
      expiresAtMs: nowMs + 5_000,
      nonce: 'forged-nonce',
    });
    expect(await artifacts.getArtifact(tenant, {
      artifactId: uiDescriptor.id,
      readCapability: forgedCapability,
      purpose: 'server_execution',
    })).toBeNull();
  });
});
