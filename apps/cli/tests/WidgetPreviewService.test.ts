import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnProjectWidgetExecutableManifest,
  fnWidgetExecutableInputDigest,
  type TWidgetCapsuleRuntimeDescriptor,
  type TWidgetManifestV1,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';
import { EphemeralResourceWritePermitAuthority } from '@omnidraw/function-runtime/local';
import type { IDirectFunctionInvoker } from '@omnidraw/function-runtime';
import type { WidgetFilesystemBuildService } from '@omnidraw/service-agent';
import { WidgetPreviewService } from '../src/services/WidgetPreviewService';
import { fnDefaultWidgetPreviewInspectionTheme } from '../src/services/fn.widget-preview-inspection';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserPort,
  TPreviewInspectionBrowserResult,
} from '../src/services/preview-inspection/interface';
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

const SERVER_FUNCTION: TWidgetServerFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'run',
  modulePath: 'server/main.ts',
  effect: 'fn',
  inputSchema: { type: 'object', additionalProperties: false },
  outputSchema: { type: 'object', additionalProperties: false },
  resources: [],
  limits: {
    timeoutMs: 5_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
});

function runtimeDescriptor(
  capsuleBytes: Uint8Array,
  functions: readonly TWidgetServerFunctionDescriptor[] = [],
): TWidgetCapsuleRuntimeDescriptor {
  const descriptorDigest = sha256(
    fnCanonicalizeWidgetServerFunctionDescriptors(functions),
  );
  const browserFunctions = fnProjectWidgetBrowserFunctionDescriptors(functions);
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: `sha256:${sha256(capsuleBytes)}`,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: ['DOM'],
      bundleDigest: `sha256:${'b'.repeat(64)}`,
    },
    budgets: {},
    capabilityRequests: functions.length === 0 ? [] : [{
      id: `omnidraw.widget.functions.h${descriptorDigest}`,
      versionRange: '1.0.0',
      contractHash: `sha256:${descriptorDigest}`,
      operations: browserFunctions.map((descriptor) => descriptor.exportName),
      required: true,
    }],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['preview-key'],
  };
}

async function harness(options: Readonly<{
  withDraft?: boolean;
  withSourceMap?: boolean;
  withServerFunction?: boolean;
  holdSign?: boolean;
  holdHostConfiguration?: boolean;
  preflightInspection?: TPreviewInspectionBrowserPort['preflight'];
  invokeFunction?: (
    signal: AbortSignal | undefined,
  ) => ReturnType<IDirectFunctionInvoker['invoke']>;
  runInspection?: (
    job: TPreviewInspectionBrowserJob,
  ) => Promise<TPreviewInspectionBrowserResult>;
}> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-service-'));
  roots.push(root);
  const widgetsRoot = join(root, 'widgets');
  for (const directory of ['drafts', 'published', '.staging', '.preview', '.trash', '.quarantine']) {
    await mkdir(join(widgetsRoot, directory), { recursive: true });
  }
  const manifest: TWidgetManifestV1 = options.withServerFunction
    ? { ...MANIFEST, server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' } }
    : MANIFEST;
  if (options.withDraft !== false) {
    await mkdir(join(widgetsRoot, 'drafts', 'counter', 'src'), { recursive: true });
    if (options.withServerFunction) {
      await mkdir(join(widgetsRoot, 'drafts', 'counter', 'server'), { recursive: true });
    }
    await writeFile(
      join(widgetsRoot, 'drafts', 'counter', 'omnidraw.json'),
      `${JSON.stringify(manifest)}\n`,
    );
    await writeFile(
      join(widgetsRoot, 'drafts', 'counter', 'src', 'main.tsx'),
      'export default 1;\n',
    );
    if (options.withServerFunction) {
      await writeFile(
        join(widgetsRoot, 'drafts', 'counter', 'server', 'main.ts'),
        'export const run = async () => ({});\n',
      );
    }
  }

  const capsuleBytes = new Uint8Array([1, 2, 3, 4]);
  const sourceRevision = 'a'.repeat(64);
  const sourceMapBytes = new TextEncoder().encode(JSON.stringify({
    format: 'omnidraw.widget-source-maps.v1',
    sourceRevision,
    capsuleArtifactHash: `sha256:${sha256(capsuleBytes)}`,
    authoredPaths: ['src/main.ts'],
    maps: [{
      module: 'chunks/widget-generated.js',
      mapBase64: Buffer.from(JSON.stringify({
        version: 3,
        sources: ['src/main.ts'],
        names: [],
        mappings: 'AAAA',
      })).toString('base64'),
    }],
  }));
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
          functionDescriptors: options.withServerFunction ? [SERVER_FUNCTION] : [],
          serverArtifact: options.withServerFunction
            ? {
                runtimeAbi: 'bun-v1',
                bytes: new Uint8Array([5, 6, 7]),
                digestSha256: sha256(new Uint8Array([5, 6, 7])),
              }
            : null,
          sourceMapArtifact: options.withSourceMap
            ? {
                kind: 'source_map',
                digestSha256: sha256(sourceMapBytes),
                bytes: sourceMapBytes,
              }
            : null,
          distributionProvenance: {
            sourceRevision,
          },
        },
        distFiles: [{ path: 'dist/main.js', bytes: new Uint8Array([1]) }],
      };
    },
    async sign() {
      if (options.holdSign === true) {
        await new Promise<never>(() => undefined);
      }
      return {
        capsule: {
          artifactBytes: capsuleBytes,
          artifactHash: `sha256:${sha256(capsuleBytes)}`,
          runtime: runtimeDescriptor(
            capsuleBytes,
            options.withServerFunction ? [SERVER_FUNCTION] : [],
          ),
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
              manifest,
              executable: fnProjectWidgetExecutableManifest(manifest),
            },
          },
        },
      };
    },
  } as unknown as WidgetFilesystemRuntimeCatalog;

  const executor: IDirectFunctionInvoker = {
    invoke: options.invokeFunction === undefined
      ? async () => ({
          status: 'succeeded',
          output: { ok: true },
          diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
        })
      : async (request) => options.invokeFunction!(request.signal),
  };

  const inspectionJobs: TPreviewInspectionBrowserJob[] = [];
  const inspectionBrowser: TPreviewInspectionBrowserPort = {
    preflight: options.preflightInspection ?? (async () => ({
      ok: true,
      runtime: {
        packageName: 'playwright',
        packageVersion: '1.61.1',
        browserName: 'chromium',
      },
      executablePath: '/test/chromium',
      shellPath: '/test/inspection-shell',
    })),
    async run(job) {
      inspectionJobs.push(job);
      if (options.runInspection !== undefined) return options.runInspection(job);
      return {
        format: 'omnidraw.preview-inspection-browser-result.v1',
        jobId: job.jobId,
        artifactDigestSha256: job.artifact.digestSha256,
        capsuleArtifactHash: job.artifact.capsuleArtifactHash,
        runtimeGeneration: 1,
        lifecycleGeneration: 1,
        screenshotPng: new Uint8Array([137, 80, 78, 71]),
        screenshotDigestSha256: '9'.repeat(64),
        screenshotWidth: job.viewport.width * job.viewport.deviceScaleFactor,
        screenshotHeight: job.viewport.height * job.viewport.deviceScaleFactor,
        actionResults: [],
        targets: [],
        canvases: [],
        runtimeEvents: options.withSourceMap
          ? [{
              origin: 'guest.module',
              phase: 'vm',
              code: 'GUEST_EXCEPTION',
              severity: 'warning',
              message: 'guest.module GUEST_EXCEPTION',
              artifactHash: job.artifact.capsuleArtifactHash,
              runtimeGeneration: 1,
              lifecycleGeneration: 1,
              location: { module: 'chunks/widget-generated.js', line: 1, column: 0 },
            }]
          : [],
        scannedElements: 0,
        droppedCounts: { targets: 0, canvases: 0, runtimeEvents: 0 },
      };
    },
    stop: async () => undefined,
  };

  const service = new WidgetPreviewService({
    widgetsRoot,
    catalog,
    builder,
    resources: {
      getResource: async () => null,
      listResources: async () => [],
      createFunctionResourceGateway: () => ({
        gateway: {},
        bindings: {},
      }),
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
    hostConfiguration: {
      read: async () => {
        if (options.holdHostConfiguration === true) {
          await new Promise<never>(() => undefined);
        }
        return {
          generation: 'test-generation',
          allowedApis: ['DOM'],
          limits: {},
          previewSigningKeyId: 'preview-key',
          releaseSigningKeyId: 'release-key',
          signingKeys: [],
        };
      },
    },
    inspectionBrowser,
    inspectionTheme: fnDefaultWidgetPreviewInspectionTheme(),
  });
  return { builds, capsuleBytes, inspectionJobs, service };
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

  test('inspects one exact captured draft with narrowed fidelity and cleans up', async () => {
    const { capsuleBytes, inspectionJobs, service } = await harness();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-a',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect('result' in response).toBe(true);
    if (!('result' in response)) throw new Error('Expected an inspection result.');
    expect(response.result.status).toBe('completed');
    expect(response.result.identity).toMatchObject({
      name: 'Counter',
      widgetKey: 'counter',
      environmentIdentity: 'test-environment',
    });
    expect(response.result.status === 'completed' && response.result.fidelity).toEqual({
      source: 'exact',
      artifact: 'exact',
      runtimePolicy: 'narrowed',
      bindings: 'none',
      network: 'denied',
      overall: 'artifact_exact',
    });
    expect(response.screenshotPng).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(inspectionJobs).toHaveLength(1);
    expect(inspectionJobs[0]?.artifact.bytes).toEqual(capsuleBytes);
    expect(inspectionJobs[0]?.functionDescriptors).toEqual([]);
    await expect(service.load({
      canvasId: inspectionJobs[0]!.jobId,
      elementId: inspectionJobs[0]!.jobId,
      widgetKey: 'counter',
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_NOT_FOUND' });
    await service.stop();
  });

  test('rejects a stale draft digest before browser execution', async () => {
    const { inspectionJobs, service } = await harness();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-stale',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        expectedDraftDigestSha256: '0'.repeat(64),
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect(response).toMatchObject({
      toolError: {
        code: 'WIDGET_DRAFT_DIGEST_STALE',
        retryable: true,
      },
    });
    expect('toolError' in response && response.toolError.observedDraftDigestSha256)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(inspectionJobs).toHaveLength(0);
    await service.stop();
  });

  test('rejects a captured manifest identity that no longer matches the mounted name', async () => {
    const { inspectionJobs, service } = await harness();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-renamed',
      name: 'Counter Before Rename',
      widgetKey: 'counter',
      input: {
        name: 'Counter Before Rename',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect(response).toMatchObject({
      toolError: {
        code: 'WIDGET_DRAFT_IDENTITY_MISMATCH',
        retryable: true,
      },
    });
    expect(inspectionJobs).toHaveLength(0);
    await service.stop();
  });

  test('redacts browser paths and shell tokens from failed inspection results', async () => {
    const { service } = await harness({
      runInspection: async () => {
        throw new Error(
          'Target closed at /Users/private/chromium using http://127.0.0.1:4444/secret-token/',
        );
      },
    });
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-failed',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect('result' in response && response.result.status).toBe('failed');
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('/Users/private');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('127.0.0.1');
    await service.stop();
  });

  test('preserves structured browser failure stages in the terminal result union', async () => {
    for (const stage of ['settle', 'actions', 'capture_screenshot'] as const) {
      const { service } = await harness({
        runInspection: async () => {
          throw Object.assign(new Error('bounded browser failure'), {
            code: stage === 'capture_screenshot'
              ? 'SCREENSHOT_CAPTURE_FAILED'
              : 'BROWSER_OPERATION_FAILED',
            stage,
            retryable: false,
          });
        },
      });
      const response = await service.inspect({
        chatId: 'chat-a',
        toolCallId: `tool-${stage}`,
        name: 'Counter',
        widgetKey: 'counter',
        input: {
          name: 'Counter',
          viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
          settle: { frames: 2, timeoutMs: 5_000 },
          actions: [],
          continueOnActionError: false,
          timeoutMs: 120_000,
        },
      });

      expect('result' in response && response.result).toMatchObject({
        status: 'failed',
        stage,
      });
      await service.stop();
    }
  });

  test('keeps Capsule guest source families untrusted', async () => {
    const { service } = await harness({
      runInspection: async (job) => ({
        format: 'omnidraw.preview-inspection-browser-result.v1',
        jobId: job.jobId,
        artifactDigestSha256: job.artifact.digestSha256,
        capsuleArtifactHash: job.artifact.capsuleArtifactHash,
        runtimeGeneration: 7,
        lifecycleGeneration: 9,
        screenshotPng: new Uint8Array([137, 80, 78, 71]),
        screenshotDigestSha256: '9'.repeat(64),
        screenshotWidth: job.viewport.width * job.viewport.deviceScaleFactor,
        screenshotHeight: job.viewport.height * job.viewport.deviceScaleFactor,
        actionResults: [],
        targets: [],
        canvases: [],
        runtimeEvents: [{
          origin: 'guest.module',
          phase: 'vm',
          code: 'GUEST_EXCEPTION',
          severity: 'warning',
          message: 'guest.module GUEST_EXCEPTION',
          artifactHash: job.artifact.capsuleArtifactHash,
          runtimeGeneration: 7,
          lifecycleGeneration: 9,
        }],
        scannedElements: 0,
        droppedCounts: { targets: 0, canvases: 0, runtimeEvents: 0 },
      }),
    });
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-guest-diagnostic',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect('result' in response).toBe(true);
    if (!('result' in response)) throw new Error('Expected an inspection result.');
    expect(response.result.evidence?.diagnostics.entries).toEqual([
      expect.objectContaining({ origin: 'guest', trust: 'untrusted' }),
    ]);
    await service.stop();
  });

  test('maps only exact fenced generated coordinates through the process-local source map', async () => {
    const { service } = await harness({ withSourceMap: true });
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-source-map',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect('result' in response).toBe(true);
    if (!('result' in response)) throw new Error('Expected an inspection result.');
    expect(response.result.evidence?.diagnostics.entries).toEqual([
      expect.objectContaining({
        origin: 'guest',
        trust: 'untrusted',
        location: { file: 'widget://src/main.ts', line: 1, column: 1 },
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain('mapBase64');
    expect(JSON.stringify(response)).not.toContain('authoredPaths');
    await service.stop();
  });

  test('aborts and settles a fire-and-forget inspection function before returning', async () => {
    let invocationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { invocationStarted = resolve; });
    let invocationAborted = false;
    let invocationSettled = false;
    const { service } = await harness({
      withServerFunction: true,
      invokeFunction: (signal) => new Promise((resolve) => {
        invocationStarted?.();
        const finish = (): void => {
          invocationAborted = true;
          resolve({
            status: 'succeeded',
            output: {},
            diagnostics: {
              code: null,
              message: null,
              logByteSize: 0,
              truncated: false,
            },
          });
        };
        if (signal?.aborted) finish();
        else signal?.addEventListener('abort', finish, { once: true });
      }).finally(() => { invocationSettled = true; }),
      runInspection: async (job) => {
        void job.functionBridge.invoke({
          functionName: 'run',
          input: {},
          signal: job.signal,
        });
        await started;
        return {
          format: 'omnidraw.preview-inspection-browser-result.v1',
          jobId: job.jobId,
          artifactDigestSha256: job.artifact.digestSha256,
          capsuleArtifactHash: job.artifact.capsuleArtifactHash,
          runtimeGeneration: 1,
          lifecycleGeneration: 1,
          screenshotPng: new Uint8Array([137, 80, 78, 71]),
          screenshotDigestSha256: '9'.repeat(64),
          screenshotWidth: job.viewport.width * job.viewport.deviceScaleFactor,
          screenshotHeight: job.viewport.height * job.viewport.deviceScaleFactor,
          actionResults: [],
          targets: [],
          canvases: [],
          runtimeEvents: [],
          scannedElements: 0,
          droppedCounts: { targets: 0, canvases: 0, runtimeEvents: 0 },
        };
      },
    });
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-fire-and-forget',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 120_000,
      },
    });

    expect('result' in response && response.result.status).toBe('completed');
    expect(invocationAborted).toBe(true);
    expect(invocationSettled).toBe(true);
    await service.stop();
  });

  test('preserves a whole-call timeout reason after browser execution starts', async () => {
    let browserStarted = false;
    const { service } = await harness({
      runInspection: async (job) => {
        browserStarted = true;
        await new Promise<never>((_resolve, reject) => {
          const rejectAborted = () => reject(new Error('browser aborted'));
          if (job.signal.aborted) rejectAborted();
          else job.signal.addEventListener('abort', rejectAborted, { once: true });
        });
      },
    });
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-timeout',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 100,
      },
    });

    expect(browserStarted).toBe(true);
    expect('result' in response && response.result).toMatchObject({
      status: 'timed_out',
      failure: { code: 'PREVIEW_INSPECTION_TIMED_OUT' },
    });
    await service.stop();
  });

  test('enforces the whole-call timeout while browser preflight is still pending', async () => {
    const { service } = await harness({
      preflightInspection: () => new Promise(() => undefined),
    });
    const startedAt = Date.now();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preflight-timeout',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 50,
      },
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(response).toMatchObject({
      toolError: {
        code: 'PREVIEW_INSPECTION_TIMED_OUT',
        retryable: true,
      },
    });
    await service.stop();
  });

  test('enforces the whole-call timeout while Preview signing is pending', async () => {
    const { inspectionJobs, service } = await harness({ holdSign: true });
    const startedAt = Date.now();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-sign-timeout',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 50,
      },
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(response).toMatchObject({
      result: {
        status: 'timed_out',
        stage: 'sign',
        failure: { code: 'PREVIEW_INSPECTION_TIMED_OUT' },
      },
    });
    expect(inspectionJobs).toHaveLength(0);
    await service.stop();
  });

  test('enforces the whole-call timeout while host configuration is pending', async () => {
    const { inspectionJobs, service } = await harness({
      holdHostConfiguration: true,
    });
    const startedAt = Date.now();
    const response = await service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-host-config-timeout',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        name: 'Counter',
        viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
        settle: { frames: 2, timeoutMs: 5_000 },
        actions: [],
        continueOnActionError: false,
        timeoutMs: 50,
      },
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(response).toMatchObject({
      result: {
        status: 'timed_out',
        stage: 'mount',
        failure: { code: 'PREVIEW_INSPECTION_TIMED_OUT' },
      },
    });
    expect(inspectionJobs).toHaveLength(0);
    await service.stop();
  });
});
