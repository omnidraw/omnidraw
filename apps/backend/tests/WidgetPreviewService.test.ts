import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnCreateWidgetServerModuleArtifact,
  fnProjectWidgetExecutableManifest,
  fnWidgetExecutableInputDigest,
  type TWidgetRuntimeDescriptor,
  type TWidgetManifestV1,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import { EphemeralResourceWritePermitAuthority } from '#backend/shell/function-execution/local';
import type { IDirectFunctionInvoker } from '#backend/shell/function-execution';
import {
  NodeWidgetFilesystemWorkspace,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import { WidgetPreviewService } from '../src/shell/widget/WidgetPreviewService';
import {
  fnDefaultWidgetPreviewInspectionTheme,
  fnProjectWidgetPreviewInspectionFailure,
} from '../src/shell/widget/fn.widget-preview-inspection';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserPort,
  TPreviewInspectionBrowserResult,
} from '../src/shell/preview/interface';
import type { ResourceService } from '../src/shell/resources/ResourceService';
import type { WidgetFilesystemRuntimeCatalog } from '../src/shell/widget/WidgetFilesystemRuntimeCatalog';
import type { WidgetBuildGenerationService } from '../src/shell/widget/WidgetBuildGenerationService';

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
): TWidgetRuntimeDescriptor {
  const descriptorDigest = sha256(
    fnCanonicalizeWidgetServerFunctionDescriptors(functions),
  );
  return {
    format: 'omnidraw.capsule-runtime.v2',
    artifactHash: `sha256:${sha256(capsuleBytes)}`,
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
      operations: functions.map((descriptor) => descriptor.exportName),
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
  functionEffect?: 'fn' | 'fx' | 'tx';
  failLiveSign?: boolean;
  holdSign?: boolean;
  holdLiveSign?: boolean;
  holdHostConfiguration?: boolean;
  preflightInspection?: TPreviewInspectionBrowserPort['preflight'];
  invokeFunction?: (
    signal: AbortSignal | undefined,
  ) => ReturnType<IDirectFunctionInvoker['invoke']>;
  runInspection?: (
    job: TPreviewInspectionBrowserJob,
  ) => Promise<TPreviewInspectionBrowserResult>;
  manifestResource?: Readonly<{
    resourceId?: string;
    kind?: 'kv' | 'db';
  }>;
  availableResource?: Readonly<{
    id: string;
    kind: 'kv' | 'db';
    status: 'ready' | 'migrating';
  }> | null;
  buildPhase?: 'unbuilt' | 'build_required' | 'building' | 'validating' | 'ready' | 'rejected';
  buildCurrent?: boolean;
  buildDiagnostics?: readonly Readonly<{ code: string; message: string; path: string | null }>[];
  supersedeDuringInspection?: boolean;
  scopeCurrent?: boolean;
  previewFrame?: 'exact' | 'absent';
  scopeErrorCode?: string;
}> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-service-'));
  roots.push(root);
  const widgetsRoot = join(root, 'widgets');
  for (const directory of ['drafts', 'published', '.staging', '.preview', '.trash', '.quarantine']) {
    await mkdir(join(widgetsRoot, directory), { recursive: true });
  }
  const manifest: TWidgetManifestV1 = {
    ...MANIFEST,
    ...(options.withServerFunction
      ? { server: { entry: 'server/main.server.ts' } }
      : {}),
    ...(options.manifestResource === undefined ? {} : {
      resources: [{
        slot: 'store',
        kind: options.manifestResource.kind ?? 'kv',
        effect: 'read',
        required: true,
        ...(options.manifestResource.resourceId === undefined
          ? {}
          : { resourceId: options.manifestResource.resourceId }),
      }],
    }),
  };
  const serverFunction: TWidgetServerFunctionDescriptor = Object.freeze({
    ...SERVER_FUNCTION,
    effect: options.functionEffect ?? (options.manifestResource === undefined ? 'fn' : 'fx'),
    resources: options.manifestResource === undefined
      ? Object.freeze([])
      : Object.freeze([{ slot: 'store', effect: 'read' as const }]),
  });
  const serverArtifact = options.withServerFunction
    ? fnCreateWidgetServerModuleArtifact({
        moduleBytes: new Uint8Array([5, 6, 7]),
        functionDescriptors: [serverFunction],
        digestSha256: sha256,
      })
    : null;
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
        join(widgetsRoot, 'drafts', 'counter', 'server', 'main.server.ts'),
        'export const run = async () => ({});\n',
      );
    }
  }

  const capsuleBytes = new Uint8Array([1, 2, 3, 4]);
  let markLiveSignStarted = (): void => undefined;
  const liveSignStarted = new Promise<void>((resolve) => {
    markLiveSignStarted = resolve;
  });
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
  let signCalls = 0;
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
          functionDescriptors: serverArtifact?.functionDescriptors ?? [],
          functionDescriptorsDigestSha256: sha256(
            fnCanonicalizeWidgetServerFunctionDescriptors(
              serverArtifact?.functionDescriptors ?? [],
            ),
          ),
          serverArtifact,
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
      signCalls += 1;
      if (options.holdSign === true) {
        await new Promise<never>(() => undefined);
      }
      if (options.holdLiveSign === true && signCalls > 1) {
        markLiveSignStarted();
        await new Promise<never>(() => undefined);
      }
      if (options.failLiveSign === true && signCalls > 1) {
        throw Object.assign(new Error('Preview startup rejected during signing.'), {
          code: 'PREVIEW_SIGN_FAILED',
        });
      }
      return {
        capsule: {
          artifactBytes: capsuleBytes,
          artifactHash: `sha256:${sha256(capsuleBytes)}`,
          runtime: runtimeDescriptor(
            capsuleBytes,
            options.withServerFunction ? [serverFunction] : [],
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

  const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetsRoot });
  let accepted: Awaited<ReturnType<WidgetBuildGenerationService['requireCurrent']>> | null = null;
  const buildAccepted = async () => {
    const capture = await workspace.captureDraftBuildInput({
      slug: 'counter',
      signal: new AbortController().signal,
    });
    const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
      manifest: capture.manifest,
      files: capture.files,
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
        signingPolicyId: 'test-signing-policy',
      },
      digestSha256: sha256,
    });
    const construction = await builder.construct({
      manifest: capture.manifest,
      files: capture.files,
      expectedExecutableInputDigestSha256: executableInputDigestSha256,
    });
    accepted = {
      widgetKey: 'counter',
      generation: 1,
      receipt: { buildIdentity: '1'.repeat(64) },
      capture,
      construction,
      signed: await builder.sign(construction, 'preview'),
      acceptedAtMs: Date.now(),
    } as Awaited<ReturnType<WidgetBuildGenerationService['requireCurrent']>>;
    return accepted;
  };
  const generationListeners = new Set<(event: Readonly<{
    widgetKey: string;
    generation: number;
    buildIdentity: string;
  }>) => void>();
  const buildGenerations = {
    activate() {
      return () => undefined;
    },
    async requireCurrent() {
      if (options.withDraft === false) {
        throw Object.assign(new Error('Widget draft is missing or unhealthy.'), {
          code: 'WIDGET_DRAFT_MISSING',
        });
      }
      return accepted ?? buildAccepted();
    },
    async view() {
      if (options.withDraft === false) {
        return {
          widgetKey: 'counter',
          phase: 'unbuilt',
          acceptedGeneration: null,
          acceptedBuildIdentity: null,
          current: false,
          diagnostics: [],
        };
      }
      if (options.buildPhase !== undefined && options.buildPhase !== 'ready') {
        return {
          widgetKey: 'counter',
          phase: options.buildPhase,
          acceptedGeneration: null,
          acceptedBuildIdentity: null,
          current: false,
          diagnostics: options.buildDiagnostics ?? [],
        };
      }
      const current = accepted ?? await buildAccepted();
      return {
        widgetKey: 'counter',
        phase: options.buildPhase ?? 'ready',
        acceptedGeneration: current.generation,
        acceptedBuildIdentity: current.receipt.buildIdentity,
        current: options.buildCurrent ?? true,
        diagnostics: options.buildDiagnostics ?? [],
      };
    },
    subscribe(listener: (event: Readonly<{
      widgetKey: string;
      generation: number;
      buildIdentity: string;
    }>) => void) {
      generationListeners.add(listener);
      return () => generationListeners.delete(listener);
    },
    async rebuild() {
      if (options.withDraft === false) {
        throw Object.assign(new Error('Widget draft is missing or unhealthy.'), {
          code: 'WIDGET_DRAFT_MISSING',
        });
      }
      accepted = null;
      return buildAccepted();
    },
  } as unknown as WidgetBuildGenerationService;

  let functionInvocations = 0;
  const functionInvocationRequests: Parameters<IDirectFunctionInvoker['invoke']>[0][] = [];
  const executor: IDirectFunctionInvoker = {
    invoke: async (request) => {
      functionInvocations += 1;
      functionInvocationRequests.push(request);
      return options.invokeFunction === undefined
        ? ({
          status: 'succeeded',
          output: { ok: true },
          diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
        })
        : options.invokeFunction(request.signal);
    },
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
      if (options.supersedeDuringInspection === true) {
        for (const listener of generationListeners) {
          listener({ widgetKey: 'counter', generation: 2, buildIdentity: '2'.repeat(64) });
        }
      }
      if (options.runInspection !== undefined) return options.runInspection(job);
      return {
        format: 'omnidraw.preview-inspection-browser-result.v1',
        jobId: job.jobId,
        artifactDigestSha256: job.artifact.digestSha256,
        artifactHash: job.artifact.artifactHash,
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
              artifactHash: job.artifact.artifactHash,
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

  const resourceReads: string[] = [];
  let resourceLists = 0;
  const service = new WidgetPreviewService({
    widgetsRoot,
    catalog,
    buildGenerations,
    builder,
    resources: {
      getResource: async (resourceId: string) => {
        resourceReads.push(resourceId);
        return options.availableResource ?? null;
      },
      listResources: async () => {
        resourceLists += 1;
        return [];
      },
      createFunctionResourceGateway: () => ({
        gateway: {},
        bindings: {},
      }),
    } as unknown as ResourceService,
    executor,
    writePermits: new EphemeralResourceWritePermitAuthority({
      secret: new Uint8Array(32).fill(3),
      nowMs: () => 1,
      createId: () => 'preview-permit',
      createNonce: () => 'preview-nonce',
    }),
    nowMs: () => 1,
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
      signingPolicyId: 'test-signing-policy',
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
    inspectionScope: {
      async resolve(args) {
        if (options.scopeErrorCode !== undefined) {
          throw Object.assign(new Error('Preview scope resolution failed.'), {
            code: options.scopeErrorCode,
          });
        }
        if (options.previewFrame === 'absent') {
          return {
            ...args,
            previewFrame: 'absent' as const,
          };
        }
        return {
          ...args,
          previewFrame: 'exact' as const,
          previewElementId: sessionTarget.elementId,
          previewInstanceId: 'preview-instance-a',
        };
      },
      async assertCurrent() {
        if (options.scopeCurrent === false) {
          throw Object.assign(new Error('Preview scope changed.'), {
            code: 'PREVIEW_GENERATION_CHANGED',
          });
        }
      },
    },
  });
  return {
    builds,
    capsuleBytes,
    functionInvocationRequests,
    functionInvocations: () => functionInvocations,
    inspectionJobs,
    liveSignStarted,
    resourceLists: () => resourceLists,
    resourceReads,
    serverArtifact,
    service,
  };
}

const sessionTarget = {
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetKey: 'counter',
};

function inspectionInput(
  mode: 'artifact' | 'preview',
  actions: TPreviewInspectionBrowserJob['actions'] = [],
) {
  return {
    name: 'Counter',
    mode,
    viewport: { width: 512, height: 384, deviceScaleFactor: 1 as const },
    settle: { frames: 2, timeoutMs: 5_000 },
    actions,
    continueOnActionError: false,
    timeoutMs: 120_000,
  };
}

function successfulBrowserResult(
  job: TPreviewInspectionBrowserJob,
  overrides: Partial<TPreviewInspectionBrowserResult> = {},
): TPreviewInspectionBrowserResult {
  return {
    format: 'omnidraw.preview-inspection-browser-result.v1',
    jobId: job.jobId,
    artifactDigestSha256: job.artifact.digestSha256,
    artifactHash: job.artifact.artifactHash,
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
    ...overrides,
  };
}

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

  test('retires every live session and cached construction for one deleted widget', async () => {
    const { builds, service } = await harness();
    await service.open(sessionTarget);
    await service.close(sessionTarget);
    await service.open(sessionTarget);
    expect(builds).toEqual(['counter']);

    await service.retireWidget('counter');

    await expect(service.load(sessionTarget)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_NOT_FOUND',
    });
    const reopened = await service.open(sessionTarget);
    expect(reopened.constructionReused).toBe(false);
    expect(builds).toEqual(['counter']);
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

  test('opens only with the manifest-owned exact ready resource and never searches candidates', async () => {
    const ready = await harness({
      manifestResource: { resourceId: 'resource-a' },
      availableResource: { id: 'resource-a', kind: 'kv', status: 'ready' },
    });
    await expect(ready.service.open(sessionTarget)).resolves.toMatchObject({ widgetKey: 'counter' });
    expect(ready.resourceReads).toEqual(['resource-a']);
    expect(ready.resourceLists()).toBe(0);
    await ready.service.stop();

    for (const scenario of [
      { manifestResource: {}, availableResource: null, code: 'WIDGET_RESOURCE_BINDING_REQUIRED' },
      { manifestResource: { resourceId: 'missing-a' }, availableResource: null, code: 'WIDGET_RESOURCE_BINDING_STALE' },
      {
        manifestResource: { resourceId: 'resource-a' },
        availableResource: { id: 'resource-a', kind: 'kv' as const, status: 'migrating' as const },
        code: 'WIDGET_RESOURCE_NOT_READY',
      },
      {
        manifestResource: { resourceId: 'resource-a' },
        availableResource: { id: 'resource-a', kind: 'db' as const, status: 'ready' as const },
        code: 'WIDGET_RESOURCE_KIND_MISMATCH',
      },
    ]) {
      const setup = await harness(scenario);
      await expect(setup.service.open(sessionTarget)).rejects.toMatchObject({ code: scenario.code });
      expect(setup.resourceLists()).toBe(0);
      await setup.service.stop();
    }
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
        mode: 'artifact',
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
      bindings: 'unavailable',
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

  test('inspects the exact live generation with manifest resources and a real read bridge', async () => {
    const setup = await harness({
      withServerFunction: true,
      manifestResource: { resourceId: 'resource-private-a', kind: 'db' },
      availableResource: { id: 'resource-private-a', kind: 'db', status: 'ready' },
      runInspection: async (job) => {
        const output = await job.functionBridge.invoke({
          functionName: 'run',
          input: {},
          signal: job.signal,
        });
        expect(output).toEqual({ ok: true });
        return successfulBrowserResult(job, {
          actionResults: [{
            index: 0,
            type: 'assertText',
            status: 'passed',
            matchedCount: 1,
            message: 'Expected text was observed.',
          }],
        });
      },
    });
    await setup.service.open(sessionTarget);
    const response = await setup.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-read',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview', [{
        type: 'assertText',
        target: { by: 'label', text: 'Loaded' },
        text: 'Loaded',
      }]),
    });

    expect('result' in response && response.result).toMatchObject({
      status: 'completed',
      fidelity: {
        runtimePolicy: 'preview',
        bindings: 'manifest',
        overall: 'preview_policy_exact',
      },
      verification: {
        surface: 'preview',
        resources: 'manifest_bound',
        canvasParity: 'same_runtime_policy',
        visibleFrame: 'not_claimed',
        functional: 'observed',
      },
    });
    expect(setup.functionInvocations()).toBe(1);
    expect(setup.functionInvocationRequests[0]?.artifact)
      .toBe(setup.serverArtifact?.moduleBytes);
    expect(setup.functionInvocationRequests[0]?.definition.serverModule).toMatchObject({
      format: 'omnidraw.widget-server-module.v1',
      abi: 'omnidraw.widget-server-abi.v1',
      moduleDigestSha256: setup.serverArtifact?.moduleDigestSha256,
      functionDescriptors: [expect.objectContaining({ exportName: 'run' })],
    });
    expect(setup.functionInvocationRequests[0]?.definition.serverModule)
      .not.toHaveProperty('moduleBytes');
    expect(setup.inspectionJobs[0]?.functionDescriptors)
      .toEqual(setup.serverArtifact?.functionDescriptors);
    expect(setup.resourceReads.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(response)).not.toContain('resource-private-a');
    expect(JSON.stringify(setup.inspectionJobs[0]?.artifact)).not.toContain('resource-private-a');
    await setup.service.stop();
  });

  test('inspects the exact retained generation after the visible Preview fails before ready', async () => {
    const setup = await harness({ failLiveSign: true, withServerFunction: true });
    await expect(setup.service.open(sessionTarget)).rejects.toMatchObject({
      code: 'PREVIEW_SIGN_FAILED',
    });

    const response = await setup.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-failed-session',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });

    expect('result' in response && response.result).toMatchObject({
      status: 'completed_with_errors',
      verification: {
        surface: 'preview',
        visibleFrame: 'not_claimed',
        executionTarget: 'diagnostic_clone',
        previewState: 'failed',
        nextAction: 'repair_visible_preview',
        functional: 'failed',
      },
      evidence: {
        diagnostics: {
          entries: [
            expect.anything(),
            expect.objectContaining({
              origin: 'lifecycle',
              phase: 'visible_preview_startup',
              code: 'PREVIEW_FAILED',
              severity: 'error',
              trust: 'trusted',
              message: 'Preview startup rejected during signing.',
            }),
          ],
        },
      },
    });
    expect(setup.inspectionJobs).toHaveLength(1);
    await expect(setup.service.invoke({
      canvasId: sessionTarget.canvasId,
      elementId: sessionTarget.elementId,
      functionName: 'run',
      input: {},
    })).rejects.toMatchObject({ code: 'FUNCTION_NOT_FOUND' });
    await setup.service.stop();
  });

  test('runs an exact manifest-bound diagnostic clone when the visible Preview frame is absent', async () => {
    const setup = await harness({
      previewFrame: 'absent',
      withServerFunction: true,
      manifestResource: { resourceId: 'resource-private-a', kind: 'db' },
      availableResource: { id: 'resource-private-a', kind: 'db', status: 'ready' },
      runInspection: async (job) => {
        await job.functionBridge.invoke({
          functionName: 'run',
          input: {},
          signal: job.signal,
        });
        return successfulBrowserResult(job);
      },
    });

    const response = await setup.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-absent-frame',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });

    expect('result' in response && response.result).toMatchObject({
      status: 'completed',
      verification: {
        surface: 'preview',
        resources: 'manifest_bound',
        visibleFrame: 'not_claimed',
        executionTarget: 'diagnostic_clone',
        previewState: 'absent',
        nextAction: 'repair_visible_preview',
      },
    });
    expect(setup.inspectionJobs).toHaveLength(1);
    expect(setup.functionInvocations()).toBe(1);
    expect(JSON.stringify(response)).not.toContain('resource-private-a');
    expect(JSON.stringify(response)).not.toContain('canvas-a');
    expect(JSON.stringify(response)).not.toContain('element-a');
    await setup.service.stop();
  });

  test('runs automation preview inspection without any Canvas or AI Chat scope', async () => {
    const setup = await harness({
      withServerFunction: true,
      manifestResource: { resourceId: 'resource-private-a', kind: 'db' },
      availableResource: { id: 'resource-private-a', kind: 'db', status: 'ready' },
      runInspection: async (job) => {
        await job.functionBridge.invoke({
          functionName: 'run',
          input: {},
          signal: job.signal,
        });
        return successfulBrowserResult(job);
      },
    });

    const response = await setup.service.inspect({
      subject: {
        kind: 'automation',
        operationId: 'operation-headless',
      },
      name: 'Counter',
      widgetKey: 'counter',
      input: inspectionInput('preview'),
    });

    expect('result' in response && response.result).toMatchObject({
      status: 'completed',
      verification: {
        surface: 'preview',
        resources: 'manifest_bound',
        visibleFrame: 'not_claimed',
        executionTarget: 'diagnostic_clone',
        previewState: 'absent',
      },
    });
    expect(setup.inspectionJobs).toHaveLength(1);
    expect(setup.inspectionJobs[0]?.ownerKey).toMatch(/^automation-/);
    expect(setup.functionInvocations()).toBe(1);
    expect(JSON.stringify(response)).not.toContain('resource-private-a');
    await setup.service.stop();
  });

  test('reports retired and ambiguous visible Preview states with distinct next actions', async () => {
    const retired = await harness();
    const retiredResponse = await retired.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-retired',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });
    expect(retiredResponse).toMatchObject({
      toolError: {
        code: 'PREVIEW_SESSION_RETIRED',
        previewState: 'retired',
        nextAction: 'reopen_preview',
      },
    });
    await retired.service.stop();

    const ambiguous = await harness({ scopeErrorCode: 'PREVIEW_FRAME_AMBIGUOUS' });
    const ambiguousResponse = await ambiguous.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-ambiguous',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });
    expect(ambiguousResponse).toMatchObject({
      toolError: {
        code: 'PREVIEW_FRAME_AMBIGUOUS',
        previewState: 'ambiguous',
        nextAction: 'remove_duplicate_previews',
      },
    });
    await ambiguous.service.stop();
  });

  test('reports a still-starting visible Preview as mounting without dispatching a clone', async () => {
    const setup = await harness({ holdLiveSign: true });
    expect(await setup.service.buildCheck({ widgetKey: 'counter' })).toMatchObject({ ok: true });
    const opening = setup.service.open(sessionTarget).catch((error: unknown) => error);
    await setup.liveSignStarted;

    const response = await setup.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-mounting',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });

    expect(response).toMatchObject({
      toolError: {
        code: 'PREVIEW_SESSION_MOUNTING',
        previewState: 'mounting',
        nextAction: 'retry_after_settle',
      },
    });
    expect(setup.inspectionJobs).toHaveLength(0);
    await setup.service.stop();
    await opening;
  });

  test('reports distinct manifest resource failures before browser dispatch', async () => {
    const scenarios = [
      {
        manifestResource: {},
        availableResource: null,
        code: 'RESOURCE_REFERENCE_REQUIRED',
      },
      {
        manifestResource: { resourceId: 'resource-missing-a' },
        availableResource: null,
        code: 'RESOURCE_REFERENCE_STALE',
      },
      {
        manifestResource: { resourceId: 'resource-private-a' },
        availableResource: { id: 'resource-private-a', kind: 'kv' as const, status: 'migrating' as const },
        code: 'RESOURCE_NOT_READY',
      },
      {
        manifestResource: { resourceId: 'resource-private-a' },
        availableResource: { id: 'resource-private-a', kind: 'db' as const, status: 'ready' as const },
        code: 'RESOURCE_KIND_MISMATCH',
      },
    ];
    for (const scenario of scenarios) {
      const setup = await harness(scenario);
      const response = await setup.service.inspect({
        chatId: 'chat-a',
        toolCallId: `tool-${scenario.code}`,
        name: 'Counter',
        widgetKey: 'counter',
        scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
        input: inspectionInput('preview'),
      });
      expect(response).toMatchObject({ toolError: { code: scenario.code } });
      expect(setup.inspectionJobs).toHaveLength(0);
      expect(setup.functionInvocations()).toBe(0);
      expect(JSON.stringify(response)).not.toContain('resource-private-a');
      expect(JSON.stringify(response)).not.toContain('resource-missing-a');
      await setup.service.stop();
    }
  });

  test('never auto-executes a protected diagnostic write', async () => {
    const setup = await harness({
      withServerFunction: true,
      functionEffect: 'tx',
      runInspection: async (job) => {
        await expect(job.functionBridge.invoke({
          functionName: 'run',
          input: {},
          signal: job.signal,
        })).rejects.toMatchObject({ code: 'INSPECTION_WRITE_APPROVAL_REQUIRED' });
        return successfulBrowserResult(job, {
          actionResults: [{
            index: 0,
            type: 'click',
            status: 'passed',
            matchedCount: 1,
            message: 'Button activated.',
          }],
          runtimeEvents: [{
            origin: 'capability',
            phase: 'function',
            code: 'INSPECTION_WRITE_APPROVAL_REQUIRED',
            severity: 'warning',
            message: 'write approval required',
            artifactHash: job.artifact.artifactHash,
            runtimeGeneration: 1,
            lifecycleGeneration: 1,
          }],
        });
      },
    });
    await setup.service.open(sessionTarget);
    const response = await setup.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-preview-write',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview', [{
        type: 'click',
        target: { by: 'role', role: 'button', name: 'Save' },
      }]),
    });
    expect('result' in response && response.result).toMatchObject({
      status: 'completed_with_errors',
      verification: { functional: 'blocked_write_approval' },
    });
    expect(setup.functionInvocations()).toBe(0);
    await setup.service.stop();
  });

  test('returns safe build state families and never runs the browser', async () => {
    const scenarios = [
      { buildPhase: 'build_required' as const, code: 'BUILD_REQUIRED' },
      { buildPhase: 'building' as const, code: 'BUILD_PENDING' },
      { buildPhase: 'ready' as const, buildCurrent: false, code: 'BUILD_STALE' },
      { buildPhase: 'rejected' as const, code: 'BUILD_IMPORT_FAILED' },
    ];
    for (const scenario of scenarios) {
      const setup = await harness({
        ...scenario,
        buildDiagnostics: scenario.buildPhase === 'rejected'
          ? [{
              code: 'BUILD_IMPORT_FAILED',
              message: 'Failed at /Users/private/widget token=secret-value',
              path: 'src/main.tsx',
            }]
          : [],
      });
      const response = await setup.service.inspect({
        chatId: 'chat-a',
        toolCallId: `tool-${scenario.code}`,
        name: 'Counter',
        widgetKey: 'counter',
        input: inspectionInput('artifact'),
      });
      expect(response).toMatchObject({ toolError: { code: scenario.code } });
      expect(setup.inspectionJobs).toHaveLength(0);
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('/Users/private');
      expect(serialized).not.toContain('secret-value');
      if (scenario.code === 'BUILD_IMPORT_FAILED') {
        expect(response).toMatchObject({
          toolError: {
            diagnostics: [{ location: { file: 'widget://src/main.tsx' } }],
          },
        });
      }
      await setup.service.stop();
    }
  });

  test('fails closed on expected-generation, supersession, and Preview-scope races', async () => {
    const expectedMismatch = await harness();
    const expectedResponse = await expectedMismatch.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-expected-generation',
      name: 'Counter',
      widgetKey: 'counter',
      input: {
        ...inspectionInput('artifact'),
        expectedAcceptedGeneration: 2,
      },
    });
    expect(expectedResponse).toMatchObject({
      toolError: { code: 'PREVIEW_GENERATION_CHANGED' },
    });
    expect(expectedMismatch.inspectionJobs).toHaveLength(0);
    await expectedMismatch.service.stop();

    const superseded = await harness({ supersedeDuringInspection: true });
    const supersededResponse = await superseded.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-superseded',
      name: 'Counter',
      widgetKey: 'counter',
      input: inspectionInput('artifact'),
    });
    expect(supersededResponse).toMatchObject({
      toolError: { code: 'PREVIEW_GENERATION_CHANGED' },
    });
    expect(superseded.inspectionJobs).toHaveLength(1);
    await superseded.service.stop();

    const replacedScope = await harness({ scopeCurrent: false });
    await replacedScope.service.open(sessionTarget);
    const replacedResponse = await replacedScope.service.inspect({
      chatId: 'chat-a',
      toolCallId: 'tool-replaced-scope',
      name: 'Counter',
      widgetKey: 'counter',
      scope: { canvasId: sessionTarget.canvasId, aiChatElementId: 'ai-chat-a' },
      input: inspectionInput('preview'),
    });
    expect(replacedResponse).toMatchObject({
      toolError: { code: 'PREVIEW_GENERATION_CHANGED' },
    });
    expect(replacedScope.inspectionJobs).toHaveLength(0);
    await replacedScope.service.stop();
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
        mode: 'artifact',
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
        mode: 'artifact',
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
        mode: 'artifact',
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

  test('projects validated mount-failure evidence with a safe widget source location', () => {
    const result = fnProjectWidgetPreviewInspectionFailure({
      surface: 'artifact',
      error: Object.assign(new Error('mount failed'), {
        code: 'BROWSER_MOUNT_FAILED',
        stage: 'mount',
        retryable: false,
      }),
      stage: 'mount',
      identity: {
        name: 'Counter',
        widgetKey: 'counter',
        draftDigestSha256: 'a'.repeat(64),
        executableInputDigestSha256: 'b'.repeat(64),
        environmentIdentity: 'test-environment',
      },
      artifact: {
        artifactDigestSha256: 'c'.repeat(64),
        artifactHash: `sha256:${'d'.repeat(64)}`,
        constructionReused: false,
      },
      durationMs: 10,
      cancelled: false,
      previewState: 'not_applicable',
      browserEvidence: {
        artifactHash: `sha256:${'d'.repeat(64)}`,
        runtimeGeneration: 3,
        lifecycleGeneration: 4,
        droppedRuntimeEventCount: 0,
        runtimeEvents: [{
          origin: 'guest.module',
          phase: 'startup',
          code: 'GUEST_EXCEPTION',
          severity: 'error',
          message: 'failed at /Users/private/source.ts token=secret-value',
          artifactHash: `sha256:${'d'.repeat(64)}`,
          runtimeGeneration: 3,
          lifecycleGeneration: 4,
          location: { module: 'chunks/widget-generated.js', line: 7, column: 3 },
        }],
      },
      digestSha256: sha256,
      mapLocation: () => ({ file: 'widget://src/main.ts', line: 12, column: 5 }),
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'BROWSER_MOUNT_FAILED' },
      verification: {
        resources: 'not_available',
        executionTarget: 'diagnostic_clone',
        previewState: 'not_applicable',
        nextAction: 'use_preview_mode_for_resources',
      },
      evidence: {
        diagnostics: {
          entries: [{
            code: 'GUEST_EXCEPTION',
            trust: 'untrusted',
            location: { file: 'widget://src/main.ts', line: 12, column: 5 },
          }],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('/Users/private');
    expect(JSON.stringify(result)).not.toContain('secret-value');
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
          mode: 'artifact',
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
        artifactHash: job.artifact.artifactHash,
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
          artifactHash: job.artifact.artifactHash,
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
        mode: 'artifact',
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
        mode: 'artifact',
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
          artifactHash: job.artifact.artifactHash,
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
        mode: 'artifact',
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
        mode: 'artifact',
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
        mode: 'artifact',
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
        mode: 'artifact',
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
        mode: 'artifact',
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
