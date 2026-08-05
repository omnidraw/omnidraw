import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnProjectWidgetExecutableManifest,
  fnWidgetExecutableInputDigest,
  type TWidgetCapsuleRuntimeDescriptor,
  type TWidgetManifestV1,
} from '@omnidraw/widget-contract';
import { EphemeralResourceWritePermitAuthority } from '@omnidraw/function-runtime/local';
import type { IDirectFunctionInvoker } from '@omnidraw/function-runtime';
import type { WidgetFilesystemBuildService } from '@omnidraw/service-agent';
import { WidgetPreviewService } from '../src/services/WidgetPreviewService';
import type { ResourceService } from '../src/services/ResourceService';
import type { WidgetFilesystemRuntimeCatalog } from '../src/services/WidgetFilesystemRuntimeCatalog';

const roots: string[] = [];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const MANIFEST: TWidgetManifestV1 = {
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Counter',
  slug: 'counter',
  description: 'Preview fixture.',
  tool: { label: 'Counter', group: null, priority: 0 },
  ui: {
    runtime: 'capsule',
    entry: 'src/main.tsx',
    apis: ['DOM'],
  },
};

function runtimeDescriptor(capsuleBytes: Uint8Array): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: `sha256:${sha256(capsuleBytes)}`,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: ['DOM'],
      bundleDigest: `sha256:${'b'.repeat(64)}`,
    },
    budgets: {},
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['preview-key'],
  };
}

async function harness(options: Readonly<{ withDraft?: boolean }> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-service-'));
  roots.push(root);
  const widgetsRoot = join(root, 'widgets');
  for (const directory of ['drafts', 'published', '.staging', '.preview', '.trash', '.quarantine']) {
    await mkdir(join(widgetsRoot, directory), { recursive: true });
  }
  if (options.withDraft !== false) {
    await mkdir(join(widgetsRoot, 'drafts', 'counter', 'src'), { recursive: true });
    await writeFile(
      join(widgetsRoot, 'drafts', 'counter', 'omnidraw.json'),
      `${JSON.stringify(MANIFEST)}\n`,
    );
    await writeFile(
      join(widgetsRoot, 'drafts', 'counter', 'src', 'main.tsx'),
      'export default 1;\n',
    );
  }

  const capsuleBytes = new Uint8Array([1, 2, 3, 4]);
  const builds: string[] = [];
  const builder = {
    async construct(request: {
      manifest: TWidgetManifestV1;
      expectedExecutableInputDigestSha256?: string;
    }) {
      builds.push(request.manifest.slug);
      return {
        executableInputDigestSha256: request.expectedExecutableInputDigestSha256
          ?? sha256(request.manifest.slug),
        executableManifestDigestSha256: 'a'.repeat(64),
        canonicalExecutableManifestJson: JSON.stringify(
          fnProjectWidgetExecutableManifest(request.manifest),
        ),
        distributionDigestSha256: 'b'.repeat(64),
        construction: {
          functionDescriptors: [],
          serverArtifact: null,
        },
        distFiles: [{ path: 'dist/main.js', bytes: new Uint8Array([1]) }],
      };
    },
    async sign() {
      return {
        capsule: {
          artifactBytes: capsuleBytes,
          artifactHash: `sha256:${sha256(capsuleBytes)}`,
          runtime: runtimeDescriptor(capsuleBytes),
        },
      };
    },
  } as unknown as WidgetFilesystemBuildService;

  const catalog = {
    async refresh() {
      return {
        generation: 1,
        digestSha256: 'c'.repeat(64),
        entries: options.withDraft === false ? {} : {
          counter: {
            draft: {
              health: 'healthy',
              manifest: MANIFEST,
              executable: fnProjectWidgetExecutableManifest(MANIFEST),
            },
          },
        },
      };
    },
  } as unknown as WidgetFilesystemRuntimeCatalog;

  const executor: IDirectFunctionInvoker = {
    invoke: async () => ({
      status: 'succeeded',
      output: { ok: true },
      diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
    }),
  };

  const service = new WidgetPreviewService({
    widgetsRoot,
    catalog,
    builder,
    resources: {
      getResource: async () => null,
      listResources: async () => [],
    } as unknown as ResourceService,
    executor,
    writePermits: new EphemeralResourceWritePermitAuthority({
      secret: new Uint8Array(32).fill(3),
    }),
    environment: {
      packageManager: { name: 'npm', version: 'test', lockfile: 'package-lock.json', lockFormat: 'npm-lock-v3' },
      sdkVersion: 'test',
      importMapDigestSha256: 'd'.repeat(64),
      transformsDigestSha256: 'e'.repeat(64),
      runner: { kind: 'host', identity: 'test' },
      platform: { os: 'test', architecture: 'test' },
      capsuleBuildIdentity: {
        packageName: '@omnidraw/capsule',
        packageVersion: 'test',
        packageDigest: `sha256:${'f'.repeat(64)}`,
        buildApiVersion: 'test',
        runtimeBuildDigest: `sha256:${'e'.repeat(64)}`,
      },
      buildPolicyId: 'test-policy',
    },
    compatibility: {
      builderIdentity: 'test-builder',
      buildPolicyId: 'test-policy',
      environmentIdentity: 'test-environment',
      capsuleBuildIdentity: {
        packageName: '@omnidraw/capsule',
        packageVersion: 'test',
        packageDigest: `sha256:${'f'.repeat(64)}`,
        buildApiVersion: 'test',
        runtimeBuildDigest: `sha256:${'e'.repeat(64)}`,
      },
    },
  });
  return { builds, capsuleBytes, service };
}

const sessionTarget = {
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetKey: 'counter',
};

describe('WidgetPreviewService', () => {
  test('builds once, reuses the construction, and stops cleanly', async () => {
    const { builds, capsuleBytes, service } = await harness();
    const first = await service.open(sessionTarget);
    expect(first.widgetKey).toBe('counter');
    expect(first.artifact.byteSize).toBe(capsuleBytes.byteLength);
    expect(first.artifact.digestSha256).toBe(sha256(capsuleBytes));
    expect(first.constructionReused).toBe(false);
    expect(first.runtimeDescriptor.signatureKeyIds).toEqual(['preview-key']);

    const second = await service.open(sessionTarget);
    expect(second.constructionReused).toBe(true);
    expect(builds).toEqual(['counter']);

    const loaded = await service.load(sessionTarget);
    expect(loaded.artifact).toEqual(first.artifact);

    await expect(service.close(sessionTarget)).resolves.toBe(true);
    await expect(service.load(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_NOT_FOUND',
    });
    await service.stop();
  });

  test('requires a healthy draft and reports a stopped session after restart', async () => {
    const missing = await harness({ withDraft: false });
    await expect(missing.service.open(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_DRAFT_MISSING',
    });
    await expect(missing.service.load(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_NOT_FOUND',
    });
    await missing.service.stop();

    const restarted = await harness();
    await expect(restarted.service.load(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_NOT_FOUND',
      message: 'Preview stopped — build again.',
    });
    await restarted.service.stop();
  });

  test('buildCheck constructs the current draft without opening a session', async () => {
    const { builds, service } = await harness();
    const result = await service.buildCheck({ widgetKey: 'counter' });
    expect(result).toEqual({ ok: true, errors: [] });
    expect(builds).toEqual(['counter']);
    await expect(service.load(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_NOT_FOUND',
    });
    await service.stop();
  });

  test('buildCheck reports a missing draft as a failed check without throwing', async () => {
    const { builds, service } = await harness({ withDraft: false });
    const result = await service.buildCheck({ widgetKey: 'counter' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(builds).toEqual([]);
    await service.stop();
  });

  test('rejects function invocation without a live preview session', async () => {
    const { service } = await harness();
    await expect(service.invoke({
      canvasId: 'canvas-a',
      elementId: 'element-a',
      functionName: 'increment',
      input: {},
    })).rejects.toMatchObject({ code: 'FUNCTION_NOT_FOUND' });
    await service.stop();
  });
});
