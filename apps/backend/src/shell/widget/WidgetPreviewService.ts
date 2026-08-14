import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type {
  TDirectFunctionView,
  TFunctionInputs,
} from '#backend/shell/api/function';
import type {
  TWidgetPreviewDiagnosticView,
  TWidgetPreviewMountView,
  TWidgetPreviewSessionInput,
} from '#backend/shell/api/widget';
import type { IDirectFunctionInvoker } from '#backend/shell/function-execution';
import {
  DirectInvocationResourceGateway,
  type EphemeralResourceWritePermitAuthority,
} from '#backend/shell/function-execution/local';
import {
  decodeAndVerifyWidgetSourceMap,
  type TVerifiedWidgetSourceMap,
} from '#backend/shell/widget/source-map/decode-and-verify-widget-source-map';
import {
  fnRuntimeDiagnosticSource,
} from '#backend/shell/widget/source-map/fn.runtime-diagnostic-source';
import type { TResourceEffect, TResourceRequirement } from '#backend/shell/resources';
import {
  EphemeralPreviewService,
  type TInspectArtifact,
  type TInspectDiagnostic,
  type TInspectIdentity,
  type TInspectStage,
  type TInspectVerification,
  type TPreviewConstructionCompatibility,
  type TPreviewPorts,
  type TWidgetPreviewInspectionRequest,
  type TWidgetPreviewInspectionResponse,
  type TWidgetFilesystemConstruction,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  fnProjectWidgetExecutableManifest,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetExecutableInputDigest,
  fnWidgetServerFunctionCapabilityRequestMatches,
  type TWidgetBrowserFunctionDescriptor,
  type TWidgetBuildEnvironment,
  type TWidgetRuntimeDescriptor,
  type TWidgetTheme,
  type TWidgetManifestV1,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';

import type { ResourceService } from '../resources/ResourceService';
import type { WidgetFilesystemRuntimeCatalog } from './WidgetFilesystemRuntimeCatalog';
import type {
  TAcceptedWidgetBuildGeneration,
  WidgetBuildGenerationService,
} from './WidgetBuildGenerationService';
import type { WidgetCapsuleHostConfigurationService } from './WidgetCapsuleHostConfigurationService';
import {
  fnProjectWidgetPreviewInspectionCompleted,
  fnProjectWidgetPreviewInspectionFailure,
} from './fn.widget-preview-inspection';
import { isPreviewInspectionBrowserServiceError } from '../preview/PreviewInspectionBrowserService';
import {
  PREVIEW_INSPECTION_JOB_FORMAT,
} from '../preview/CONSTANTS';
import type {
  TPreviewInspectionBrowserPort,
  TPreviewInspectionFunctionBridge,
  TPreviewInspectionRuntimeEvent,
} from '../preview/interface';

type TWidgetPreviewOpenInput = TWidgetPreviewSessionInput & Readonly<{
  signal?: AbortSignal;
}>;

type TWidgetPreviewResourceBinding = Readonly<{
  slot: string;
  resourceId: string;
  kind: TResourceRequirement['kind'];
  allowRead: boolean;
  allowWrite: boolean;
}>;

type TWidgetPreviewServerMount = Readonly<{
  runtimeAbi: string;
  entryBytes: Uint8Array;
  artifactDigestSha256: string;
  runtimeDescriptor: TWidgetRuntimeDescriptor;
  descriptors: readonly TWidgetServerFunctionDescriptor[];
  requirements: readonly TResourceRequirement[];
  bindings: readonly TWidgetPreviewResourceBinding[];
}>;

type TWidgetPreviewSignedArtifact = Readonly<{
  widgetKey: string;
  manifest: Omit<TWidgetManifestV1, 'server'>;
  capsuleBytes: Uint8Array;
  artifactDigestSha256: string;
  runtimeDescriptor: TWidgetRuntimeDescriptor;
  browserFunctionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  constructionReused: boolean;
  diagnostics: readonly TWidgetPreviewDiagnosticView[];
  server: TWidgetPreviewServerMount | null;
  sourceMap: null | Readonly<{
    digestSha256: string;
    bytes: Uint8Array;
    sourceRevision: string;
  }>;
}>;

type TWidgetPreviewConstruction = Readonly<{
  manifest: TWidgetManifestV1;
  construction: TWidgetFilesystemConstruction;
}>;

type TWidgetPreviewMountHandle = Readonly<{
  sessionId: string;
}>;

type TWidgetPreviewServiceConfig = Readonly<{
  widgetsRoot: string;
  catalog: WidgetFilesystemRuntimeCatalog;
  buildGenerations: WidgetBuildGenerationService;
  builder: WidgetFilesystemBuildService;
  resources: ResourceService;
  executor: IDirectFunctionInvoker;
  writePermits: EphemeralResourceWritePermitAuthority;
  nowMs: () => number;
  environment: Omit<TWidgetBuildEnvironment, 'serverRuntimeAbi'>;
  compatibility: Omit<TPreviewConstructionCompatibility, 'serverRuntimeAbi'>;
  hostConfiguration: Pick<WidgetCapsuleHostConfigurationService, 'read'>;
  inspectionBrowser: TPreviewInspectionBrowserPort;
  inspectionTheme: TWidgetTheme;
  inspectionScope?: Readonly<{
    resolve(args: Readonly<{
      chatId: string;
      canvasId: string;
      aiChatElementId: string;
      widgetKey: string;
    }>): Promise<TPreviewInspectionScopeResolution>;
    assertCurrent(resolution: TPreviewInspectionScopeResolution): Promise<void>;
  }>;
}>;

type TPreviewInspectionScopeResolution = Readonly<{
  chatId: string;
  canvasId: string;
  aiChatElementId: string;
  widgetKey: string;
}> & (
  | Readonly<{ previewFrame: 'absent' }>
  | Readonly<{
      previewFrame: 'exact';
      previewElementId: string;
      previewInstanceId: string;
    }>
);

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function previewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function inspectionError(
  code: string,
  message: string,
  retryable = false,
): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function inspectionBrowserStage(error: unknown): TInspectStage | undefined {
  if (error === null || typeof error !== 'object' || !('stage' in error)) {
    return undefined;
  }
  const stage = error.stage;
  return stage === 'mount'
    || stage === 'settle'
    || stage === 'actions'
    || stage === 'capture_screenshot'
    ? stage
    : undefined;
}

function awaitInspectionSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(inspectionError(
      signal.reason === 'inspection-timeout'
        ? 'PREVIEW_INSPECTION_TIMED_OUT'
        : signal.reason === 'inspection-generation-changed'
          ? 'PREVIEW_GENERATION_CHANGED'
          : 'PREVIEW_INSPECTION_CANCELLED',
      signal.reason === 'inspection-timeout'
        ? 'Preview inspection exceeded its whole-call timeout.'
        : signal.reason === 'inspection-generation-changed'
          ? 'The widget source, accepted generation, or exact Preview changed during inspection.'
          : 'Preview inspection was cancelled.',
      true,
    ));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(inspectionError(
        signal.reason === 'inspection-timeout'
          ? 'PREVIEW_INSPECTION_TIMED_OUT'
          : signal.reason === 'inspection-generation-changed'
            ? 'PREVIEW_GENERATION_CHANGED'
            : 'PREVIEW_INSPECTION_CANCELLED',
        signal.reason === 'inspection-timeout'
          ? 'Preview inspection exceeded its whole-call timeout.'
          : signal.reason === 'inspection-generation-changed'
            ? 'The widget source, accepted generation, or exact Preview changed during inspection.'
            : 'Preview inspection was cancelled.',
        true,
      ));
    };
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

async function settleInspectionCleanup(
  operation: void | Promise<void>,
  timeoutMs = 5_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([
    Promise.resolve(operation).catch(() => undefined),
    timeout,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

function effectAllows(
  effect: TResourceEffect,
  requested: 'read' | 'write',
): boolean {
  return effect === requested || effect === 'read_write';
}

function safeInspectionDiagnosticMessage(value: string): string {
  return value
    .replace(/(?:file:\/\/)?\/?(?:Users|home|private|tmp|var)\/[A-Za-z0-9_./\\-]+/g, 'widget://project')
    .replace(/(?:postgres|mysql|libsql|https?):\/\/[^\s]+/gi, '[redacted]')
    .replace(/\b(token|secret|password|credential)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 2_000);
}

function buildInspectionDiagnostics(
  diagnostics: Awaited<ReturnType<WidgetBuildGenerationService['view']>>['diagnostics'],
): readonly TInspectDiagnostic[] {
  return Object.freeze(diagnostics.slice(0, 20).map((diagnostic) => {
    const message = safeInspectionDiagnosticMessage(diagnostic.message);
    const location = diagnostic.path !== null
      && /^(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+(?:\/(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+)*$/u.test(diagnostic.path)
        ? Object.freeze({ file: `widget://${diagnostic.path}` })
        : undefined;
    return Object.freeze({
      fingerprint: sha256(['build', diagnostic.code, message, diagnostic.path ?? ''].join('\u0000')),
      origin: 'build' as const,
      phase: 'receipt_import',
      code: /^[A-Z][A-Z0-9_]{0,255}$/.test(diagnostic.code)
        ? diagnostic.code
        : 'BUILD_IMPORT_FAILED',
      severity: 'error' as const,
      message,
      trust: 'trusted' as const,
      retryability: 'unknown' as const,
      occurrenceCount: 1,
      ...(location === undefined ? {} : { location }),
    });
  }));
}

function buildInspectionBoundary(
  view: Awaited<ReturnType<WidgetBuildGenerationService['view']>>,
): Readonly<{
  code: 'BUILD_REQUIRED' | 'BUILD_PENDING' | 'BUILD_STALE' | 'BUILD_IMPORT_FAILED';
  message: string;
  retryable: boolean;
}> | null {
  if (view.phase === 'building' || view.phase === 'validating') {
    return Object.freeze({
      code: 'BUILD_PENDING',
      message: 'The portable build is still being observed and validated by the host.',
      retryable: true,
    });
  }
  if (view.phase === 'rejected') {
    return Object.freeze({
      code: 'BUILD_IMPORT_FAILED',
      message: 'The portable build output was rejected by host validation.',
      retryable: true,
    });
  }
  if (view.phase === 'ready' && !view.current) {
    return Object.freeze({
      code: 'BUILD_STALE',
      message: 'The accepted build is no longer current for the widget repository.',
      retryable: true,
    });
  }
  if (view.phase === 'unbuilt' || view.phase === 'build_required' || !view.current) {
    return Object.freeze({
      code: 'BUILD_REQUIRED',
      message: 'The current widget repository has no matching accepted portable build.',
      retryable: true,
    });
  }
  return null;
}

/**
 * Process-owned full-stack Preview. Nothing durable is written; a restart
 * leaves only the stopped canvas frame and a clean .preview scratch root.
 */
class WidgetPreviewService {
  readonly name = 'widget-preview';
  readonly #config: TWidgetPreviewServiceConfig;
  readonly #preview: EphemeralPreviewService<
    TWidgetPreviewConstruction,
    TWidgetPreviewSignedArtifact,
    TWidgetPreviewMountHandle
  >;
  readonly #artifacts = new Map<string, TWidgetPreviewSignedArtifact>();
  readonly #artifactGenerations = new Map<string, Readonly<{
    generation: number;
    buildIdentity: string;
  }>>();
  readonly #generationReleases = new Map<string, () => void>();
  readonly #pendingGenerations = new Map<string, TAcceptedWidgetBuildGeneration>();
  #inspectionSequence = 0;

  constructor(config: TWidgetPreviewServiceConfig) {
    this.#config = config;
    const ports: TPreviewPorts<
      TWidgetPreviewConstruction,
      TWidgetPreviewSignedArtifact,
      TWidgetPreviewMountHandle
    > = {
      prepareTempPath: async ({ relativePath }) => {
        await mkdir(join(config.widgetsRoot, relativePath), {
          recursive: true,
          mode: 0o700,
        });
      },
      removeTempPath: async ({ relativePath }) => {
        await rm(join(config.widgetsRoot, relativePath), {
          recursive: true,
          force: true,
        });
      },
      buildConstruction: async ({
        sessionId,
        widgetKey,
        executableInputDigestSha256,
        signal,
        reportDiagnostic,
      }) => {
        const accepted = this.#pendingGenerations.get(sessionId)
          ?? await awaitInspectionSignal(
            config.buildGenerations.requireCurrent(widgetKey, signal),
            signal,
          );
        if (accepted.widgetKey !== widgetKey) {
          throw new Error('Accepted Preview generation does not match the requested draft.');
        }
        reportDiagnostic({ severity: 'info', message: 'Loading accepted Preview generation…' });
        const construction = accepted.construction;
        if (construction.executableInputDigestSha256 !== executableInputDigestSha256) {
          throw new Error('Accepted Preview construction no longer matches its host digest.');
        }
        return Object.freeze({
          manifest: accepted.capture.manifest,
          construction,
        });
      },
      validateConstruction: async ({ construction, executableInputDigestSha256 }) => {
        if (
          construction.construction.executableInputDigestSha256
            !== executableInputDigestSha256
        ) throw new Error('Preview construction no longer matches the draft digest.');
      },
      signConstruction: async ({ construction, signal }) => {
        const signed = await awaitInspectionSignal(
          config.builder.sign(
            construction.construction,
            'preview',
          ),
          signal,
        );
        return this.#assembleArtifact(construction, signed);
      },
      mount: async ({ sessionId }) => Object.freeze({ sessionId }),
      unmount: async () => undefined,
    };
    this.#preview = new EphemeralPreviewService(ports);
  }

  async open(args: TWidgetPreviewOpenInput): Promise<TWidgetPreviewMountView> {
    const sessionId = this.#sessionId(args);
    if (!this.#generationReleases.has(sessionId)) {
      this.#generationReleases.set(
        sessionId,
        this.#config.buildGenerations.activate(args.widgetKey),
      );
    }
    const accepted = await this.#config.buildGenerations.requireCurrent(
      args.widgetKey,
      args.signal,
    );
    const compatibility = Object.freeze({
      ...this.#config.compatibility,
      serverRuntimeAbi: accepted.capture.manifest.server?.runtimeAbi ?? null,
    });
    const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
      manifest: accepted.capture.manifest,
      files: accepted.capture.files,
      environment: Object.freeze({
        ...this.#config.environment,
        serverRuntimeAbi: accepted.capture.manifest.server?.runtimeAbi ?? null,
      }),
      digestSha256: sha256,
    });
    const manifestBindings = await this.#resolveBindings(
      accepted.capture.manifest.resources ?? [],
    );
    // Rebuilds replace the live session; the validated construction is reused
    // only while the exact digest and compatibility policy still match.
    await this.#preview.close(sessionId);
    const retainedArtifact = Object.freeze({
      ...this.#withServer(this.#assembleArtifact(Object.freeze({
        manifest: accepted.capture.manifest,
        construction: accepted.construction,
      }), accepted.signed), manifestBindings),
      constructionReused: false,
    });
    this.#artifacts.set(sessionId, retainedArtifact);
    this.#artifactGenerations.set(sessionId, Object.freeze({
      generation: accepted.generation,
      buildIdentity: accepted.receipt.buildIdentity,
    }));
    this.#pendingGenerations.set(sessionId, accepted);
    try {
      const result = await this.#preview.open({
        sessionId,
        widgetKey: args.widgetKey,
        executableInputDigestSha256,
        compatibility,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
      const artifact = Object.freeze({
        ...this.#withServer(result.signedArtifact, manifestBindings),
        constructionReused: result.session.constructionReused,
        diagnostics: result.session.diagnostics,
      });
      this.#artifacts.set(sessionId, artifact);
      this.#artifactGenerations.set(sessionId, Object.freeze({
        generation: accepted.generation,
        buildIdentity: accepted.receipt.buildIdentity,
      }));
      return this.#mountView(args, artifact);
    } catch (error) {
      const failedSession = this.#preview.get(sessionId);
      if (failedSession?.phase === 'failed') {
        this.#artifacts.set(sessionId, Object.freeze({
          ...retainedArtifact,
          constructionReused: failedSession.constructionReused,
          diagnostics: failedSession.diagnostics,
        }));
      }
      throw error;
    } finally {
      this.#pendingGenerations.delete(sessionId);
    }
  }

  async rebuild(
    args: TWidgetPreviewOpenInput,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewMountView> {
    await this.#config.buildGenerations.rebuild(args.widgetKey, signal ?? args.signal);
    return this.open({
      ...args,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async rebuildDraft(
    args: Readonly<{ widgetKey: string }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{
    widgetKey: string;
    acceptedGeneration: number;
    buildIdentity: string;
  }>> {
    const accepted = await this.#config.buildGenerations.rebuild(args.widgetKey, signal);
    return Object.freeze({
      widgetKey: accepted.widgetKey,
      acceptedGeneration: accepted.generation,
      buildIdentity: accepted.receipt.buildIdentity,
    });
  }

  /** Runs one exact accepted generation in a bounded diagnostic clone. */
  async inspect(
    args: TWidgetPreviewInspectionRequest,
  ): Promise<TWidgetPreviewInspectionResponse> {
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const cancel = (): void => controller.abort(
      args.signal?.reason === 'inspection-timeout'
        ? 'inspection-timeout'
        : 'caller-cancelled',
    );
    args.signal?.addEventListener('abort', cancel, { once: true });
    if (args.signal?.aborted) cancel();
    const timeout = setTimeout(
      () => controller.abort('inspection-timeout'),
      args.input.timeoutMs,
    );
    let identity: TInspectIdentity | undefined;
    let artifactIdentity: TInspectArtifact | undefined;
    let stage: TInspectStage = 'build';
    let jobId: string | undefined;
    let functionBridge: TPreviewInspectionFunctionBridge | undefined;
    let releaseGeneration: (() => void) | undefined;
    let releaseGenerationListener: (() => void) | undefined;
    let generationMonitor: ReturnType<typeof setInterval> | undefined;
    let buildDiagnostics: readonly TInspectDiagnostic[] | undefined;
    let previewState: TInspectVerification['previewState'] = args.input.mode === 'artifact'
      ? 'not_applicable'
      : 'retired';
    let retainedRuntimeEvents: readonly TPreviewInspectionRuntimeEvent[] = [];
    let verifiedSourceMap: TVerifiedWidgetSourceMap | null = null;
    try {
      releaseGeneration = this.#config.buildGenerations.activate(args.widgetKey);
      const buildView = await awaitInspectionSignal(
        this.#config.buildGenerations.view(args.widgetKey),
        controller.signal,
      );
      const buildBoundary = buildInspectionBoundary(buildView);
      if (buildBoundary !== null) {
        buildDiagnostics = buildInspectionDiagnostics(buildView.diagnostics);
        return Object.freeze({
          toolError: Object.freeze({
            ...buildBoundary,
            ...(buildDiagnostics.length === 0 ? {} : { diagnostics: buildDiagnostics }),
          }),
        });
      }
      const accepted = await awaitInspectionSignal(
        this.#config.buildGenerations.requireCurrent(args.widgetKey, controller.signal),
        controller.signal,
      );
      if (
        accepted.widgetKey !== args.widgetKey
        || accepted.capture.slug !== args.widgetKey
        || accepted.capture.manifest.slug !== args.widgetKey
        || accepted.capture.manifest.name !== args.name
        || args.input.name !== args.name
      ) {
        throw inspectionError(
          'WIDGET_DRAFT_IDENTITY_MISMATCH',
          'The captured widget draft identity no longer matches the mounted widget.',
          true,
        );
      }
      if (
        args.input.expectedAcceptedGeneration !== undefined
        && args.input.expectedAcceptedGeneration !== accepted.generation
      ) {
        throw inspectionError(
          'PREVIEW_GENERATION_CHANGED',
          'The accepted Preview generation changed after the requested generation fence was selected.',
          true,
        );
      }
      if (
        args.input.expectedDraftDigestSha256 !== undefined
        && args.input.expectedDraftDigestSha256 !== accepted.capture.treeDigestSha256
      ) {
        return Object.freeze({
          toolError: Object.freeze({
            code: 'WIDGET_DRAFT_DIGEST_STALE',
            message: 'The accepted widget source differs from the requested digest fence.',
            retryable: true,
            observedDraftDigestSha256: accepted.capture.treeDigestSha256,
          }),
        });
      }
      const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
        manifest: accepted.capture.manifest,
        files: accepted.capture.files,
        environment: Object.freeze({
          ...this.#config.environment,
          serverRuntimeAbi: accepted.capture.manifest.server?.runtimeAbi ?? null,
        }),
        digestSha256: sha256,
      });
      if (executableInputDigestSha256 !== accepted.construction.executableInputDigestSha256) {
        throw inspectionError(
          'BUILD_STALE',
          'The accepted construction does not match the independently verified widget inputs.',
          true,
        );
      }
      identity = Object.freeze({
        name: args.name,
        widgetKey: args.widgetKey,
        draftDigestSha256: accepted.capture.treeDigestSha256,
        executableInputDigestSha256,
        environmentIdentity: this.#config.compatibility.environmentIdentity,
      });
      const acceptedArtifact = this.#assembleArtifact(Object.freeze({
        manifest: accepted.capture.manifest,
        construction: accepted.construction,
      }), accepted.signed);
      let artifact = acceptedArtifact;
      let scopeResolution: TPreviewInspectionScopeResolution | undefined;
      if (args.input.mode === 'preview') {
        stage = 'scope';
        if (args.scope === undefined || this.#config.inspectionScope === undefined) {
          throw inspectionError(
            'PREVIEW_UNAVAILABLE',
            'The exact current canvas Preview scope is unavailable.',
            true,
          );
        }
        scopeResolution = await awaitInspectionSignal(
          this.#config.inspectionScope.resolve(Object.freeze({
            chatId: args.chatId,
            canvasId: args.scope.canvasId,
            aiChatElementId: args.scope.aiChatElementId,
            widgetKey: args.widgetKey,
          })),
          controller.signal,
        );
        if (
          scopeResolution.chatId !== args.chatId
          || scopeResolution.canvasId !== args.scope.canvasId
          || scopeResolution.aiChatElementId !== args.scope.aiChatElementId
          || scopeResolution.widgetKey !== args.widgetKey
        ) {
          throw inspectionError(
            'PREVIEW_UNAVAILABLE',
            'The resolved Preview scope did not match the verified AI Chat target.',
            true,
          );
        }
        let manifestBindings: readonly TWidgetPreviewResourceBinding[];
        try {
          manifestBindings = await awaitInspectionSignal(
            this.#resolveBindings(accepted.capture.manifest.resources ?? []),
            controller.signal,
          );
        } catch (error) {
          const code = error !== null && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
          const mapped = code === 'WIDGET_RESOURCE_BINDING_REQUIRED'
            ? 'RESOURCE_REFERENCE_REQUIRED'
            : code === 'WIDGET_RESOURCE_BINDING_STALE'
              ? 'RESOURCE_REFERENCE_STALE'
              : code === 'WIDGET_RESOURCE_NOT_READY'
                ? 'RESOURCE_NOT_READY'
                : code === 'WIDGET_RESOURCE_KIND_MISMATCH'
                  ? 'RESOURCE_KIND_MISMATCH'
                  : 'RESOURCE_PROVIDER_FAILED';
          throw inspectionError(mapped, 'Manifest resource validation failed safely.', true);
        }
        artifact = this.#withServer(acceptedArtifact, manifestBindings);
        if (scopeResolution.previewFrame === 'absent') {
          previewState = 'absent';
        } else {
          const liveSessionId = this.#sessionId({
            canvasId: scopeResolution.canvasId,
            elementId: scopeResolution.previewElementId,
          });
          const liveArtifact = this.#artifacts.get(liveSessionId);
          const liveGeneration = this.#artifactGenerations.get(liveSessionId);
          const liveSession = this.#preview.get(liveSessionId);
          if (liveSession === null || liveArtifact === undefined || liveGeneration === undefined) {
            previewState = 'retired';
            throw inspectionError(
              'PREVIEW_SESSION_RETIRED',
              'The exact visible Preview frame has no current process-owned session.',
              true,
            );
          }
          if (liveSession.phase === 'cancelled') {
            previewState = 'retired';
            throw inspectionError(
              'PREVIEW_SESSION_RETIRED',
              'The exact visible Preview session was cancelled or retired.',
              true,
            );
          }
          if (liveSession.phase !== 'ready' && liveSession.phase !== 'failed') {
            previewState = 'mounting';
            throw inspectionError(
              'PREVIEW_SESSION_MOUNTING',
              'The exact visible Preview session is still starting.',
              true,
            );
          }
          if (
            liveGeneration.generation !== accepted.generation
            || liveGeneration.buildIdentity !== accepted.receipt.buildIdentity
            || liveArtifact.artifactDigestSha256 !== acceptedArtifact.artifactDigestSha256
            || liveArtifact.runtimeDescriptor.artifactHash
              !== acceptedArtifact.runtimeDescriptor.artifactHash
            || liveArtifact.browserFunctionDescriptorsDigestSha256
              !== acceptedArtifact.browserFunctionDescriptorsDigestSha256
          ) {
            previewState = 'generation_mismatch';
            throw inspectionError(
              'PREVIEW_GENERATION_CHANGED',
              'The visible Preview session is not using the selected accepted generation.',
              true,
            );
          }
          previewState = liveSession.phase;
          artifact = Object.freeze({
            ...artifact,
            constructionReused: liveArtifact.constructionReused,
          });
          if (liveSession.phase === 'failed') {
            retainedRuntimeEvents = Object.freeze(liveSession.diagnostics.slice(0, 20).map(
              (diagnostic) => Object.freeze({
                origin: 'lifecycle',
                phase: 'visible_preview_startup',
                code: diagnostic.code ?? 'PREVIEW_FAILED',
                severity: diagnostic.severity,
                message: diagnostic.message,
              }),
            ));
          }
        }
        await awaitInspectionSignal(
          this.#config.inspectionScope.assertCurrent(scopeResolution),
          controller.signal,
        );
      }
      const selectedScope = scopeResolution;
      const assertCurrent = async (): Promise<void> => {
        const current = await this.#config.buildGenerations.view(args.widgetKey);
        if (
          !current.current
          || current.acceptedGeneration !== accepted.generation
          || current.acceptedBuildIdentity !== accepted.receipt.buildIdentity
        ) {
          throw inspectionError(
            'PREVIEW_GENERATION_CHANGED',
            'The widget source or accepted build generation changed during inspection.',
            true,
          );
        }
        if (selectedScope === undefined) return;
        if (this.#config.inspectionScope === undefined) {
          throw inspectionError('PREVIEW_GENERATION_CHANGED', 'The Preview scope was revoked.', true);
        }
        await this.#config.inspectionScope.assertCurrent(selectedScope);
        if (selectedScope.previewFrame === 'absent') return;
        const liveSessionId = this.#sessionId({
          canvasId: selectedScope.canvasId,
          elementId: selectedScope.previewElementId,
        });
        const liveGeneration = this.#artifactGenerations.get(liveSessionId);
        const liveArtifact = this.#artifacts.get(liveSessionId);
        const liveSession = this.#preview.get(liveSessionId);
        if (
          liveGeneration?.generation !== accepted.generation
          || liveGeneration.buildIdentity !== accepted.receipt.buildIdentity
          || liveArtifact?.artifactDigestSha256 !== artifact.artifactDigestSha256
          || liveSession === null
          || liveSession.phase !== previewState
        ) {
          throw inspectionError(
            'PREVIEW_GENERATION_CHANGED',
            'The exact Preview frame or host session changed during inspection.',
            true,
          );
        }
      };
      await awaitInspectionSignal(assertCurrent(), controller.signal);
      releaseGenerationListener = this.#config.buildGenerations.subscribe((event) => {
        if (
          event.widgetKey === args.widgetKey
          && (
            event.generation !== accepted.generation
            || event.buildIdentity !== accepted.receipt.buildIdentity
          )
        ) controller.abort('inspection-generation-changed');
      });
      let monitorPending = false;
      generationMonitor = setInterval(() => {
        if (monitorPending || controller.signal.aborted) return;
        monitorPending = true;
        void assertCurrent().catch(() => {
          controller.abort('inspection-generation-changed');
        }).finally(() => {
          monitorPending = false;
        });
      }, 250);
      generationMonitor.unref();
      artifactIdentity = Object.freeze({
        artifactDigestSha256: artifact.artifactDigestSha256,
        artifactHash: artifact.runtimeDescriptor.artifactHash,
        constructionReused: artifact.constructionReused,
      });
      verifiedSourceMap = await awaitInspectionSignal(
        this.#verifyInspectionSourceMap(artifact),
        controller.signal,
      );
      let bridgeDisposed = false;
      const bridgeController = new AbortController();
      const pendingInvocations = new Set<Promise<unknown>>();
      let bridgeDisposeOperation: Promise<void> | undefined;
      functionBridge = Object.freeze({
        invoke: async (request) => {
          if (bridgeDisposed) {
            throw inspectionError(
              'INSPECTION_FUNCTION_BRIDGE_DISPOSED',
              'Preview inspection function bridge is disposed.',
            );
          }
          await assertCurrent();
          const invocationArtifact = selectedScope === undefined
            ? artifact
            : this.#withServer(
                artifact,
                await this.#resolveBindings(accepted.capture.manifest.resources ?? []),
              );
          const descriptor = invocationArtifact.server?.descriptors.find(
            (candidate) => candidate.exportName === request.functionName,
          );
          if (descriptor?.effect === 'tx') {
            throw inspectionError(
              'INSPECTION_WRITE_APPROVAL_REQUIRED',
              'The diagnostic write was not executed because normal approval is required.',
              true,
            );
          }
          const invocation = this.#invokeArtifactFunction(
            invocationArtifact,
            selectedScope === undefined || selectedScope.previewFrame === 'absent'
              ? Object.freeze({
                  canvasId: `diagnostic-${jobId}`,
                  elementId: `diagnostic-${jobId}`,
                  widgetInstanceId: `diagnostic-${jobId}`,
                })
                : Object.freeze({
                  canvasId: selectedScope.canvasId,
                  elementId: selectedScope.previewElementId,
                  widgetInstanceId: selectedScope.previewInstanceId,
                }),
            request.functionName,
            request.input,
            AbortSignal.any([request.signal, bridgeController.signal, controller.signal]),
          ).then(async (result) => {
            await assertCurrent();
            if (result.status !== 'succeeded') {
              throw new Error(result.failure.message);
            }
            return result.output;
          });
          pendingInvocations.add(invocation);
          try {
            return await invocation;
          } finally {
            pendingInvocations.delete(invocation);
          }
        },
        dispose(): Promise<void> {
          if (bridgeDisposeOperation !== undefined) return bridgeDisposeOperation;
          bridgeDisposed = true;
          bridgeController.abort('inspection-function-bridge-disposed');
          bridgeDisposeOperation = Promise.allSettled([...pendingInvocations])
            .then(() => undefined);
          return bridgeDisposeOperation;
        },
      });
      const elapsedMs = Date.now() - startedAtMs;
      const remainingTimeoutMs = Math.max(1, args.input.timeoutMs - elapsedMs);
      stage = 'mount';
      const preflight = await awaitInspectionSignal(
        this.#config.inspectionBrowser.preflight(),
        controller.signal,
      );
      if (!preflight.ok) {
        throw inspectionError(
          preflight.code,
          `${preflight.message} ${preflight.remediation}`.slice(0, 2_000),
          true,
        );
      }
      const hostConfiguration = await awaitInspectionSignal(
        this.#config.hostConfiguration.read(),
        controller.signal,
      );
      await awaitInspectionSignal(assertCurrent(), controller.signal);
      jobId = this.#inspectionSessionId(args);
      const browser = await this.#config.inspectionBrowser.run(Object.freeze({
        format: PREVIEW_INSPECTION_JOB_FORMAT,
        jobId,
        ownerKey: `chat-${sha256(args.chatId).slice(0, 40)}`,
        widgetKey: args.widgetKey,
        artifact: Object.freeze({
          bytes: artifact.capsuleBytes,
          digestSha256: artifact.artifactDigestSha256,
          artifactHash: artifact.runtimeDescriptor.artifactHash,
          runtimeDescriptor: artifact.runtimeDescriptor,
        }),
        hostConfiguration,
        functionDescriptors: artifact.browserFunctionDescriptors,
        browserFunctionDescriptorsDigestSha256:
          artifact.browserFunctionDescriptorsDigestSha256,
        functionBridge,
        theme: this.#config.inspectionTheme,
        viewport: args.input.viewport,
        settleFrames: args.input.settle.frames,
        settleTimeoutMs: args.input.settle.timeoutMs,
        actions: args.input.actions,
        continueOnActionError: args.input.continueOnActionError,
        timeoutMs: remainingTimeoutMs,
        signal: controller.signal,
      }));
      await awaitInspectionSignal(assertCurrent(), controller.signal);
      if (
        browser.jobId !== jobId
        || browser.artifactDigestSha256 !== artifact.artifactDigestSha256
        || browser.artifactHash
          !== artifact.runtimeDescriptor.artifactHash
      ) {
        throw inspectionError(
          'BROWSER_RESULT_INVALID',
          'Preview inspection browser returned mismatched artifact identity.',
        );
      }
      const projectedBrowser = retainedRuntimeEvents.length === 0
        ? browser
        : Object.freeze({
            ...browser,
            runtimeEvents: Object.freeze([
              ...retainedRuntimeEvents,
              ...browser.runtimeEvents,
            ]),
          });
      const result = fnProjectWidgetPreviewInspectionCompleted({
        surface: args.input.mode,
        browser: projectedBrowser,
        identity,
        artifact: artifactIdentity,
        page: args.input.viewport,
        durationMs: Date.now() - startedAtMs,
        previewState,
        digestSha256: sha256,
        ...(verifiedSourceMap === null
          ? {}
          : {
              mapLocation: (event: TPreviewInspectionRuntimeEvent) => (
                this.#mapInspectionRuntimeLocation(verifiedSourceMap!, event)
              ),
            }),
      });
      return Object.freeze({ result, screenshotPng: browser.screenshotPng });
    } catch (caught) {
      const browserStage = inspectionBrowserStage(caught);
      const error = controller.signal.aborted
        ? inspectionError(
            controller.signal.reason === 'inspection-timeout'
              ? 'PREVIEW_INSPECTION_TIMED_OUT'
              : controller.signal.reason === 'inspection-generation-changed'
                ? 'PREVIEW_GENERATION_CHANGED'
                : 'PREVIEW_INSPECTION_CANCELLED',
            controller.signal.reason === 'inspection-timeout'
              ? 'Preview inspection exceeded its whole-call timeout.'
              : controller.signal.reason === 'inspection-generation-changed'
                ? 'The widget source, accepted generation, or exact Preview scope changed during inspection.'
                : 'Preview inspection was cancelled.',
            true,
          )
        : caught;
      const code = error !== null
        && typeof error === 'object'
        && 'code' in error
        && typeof error.code === 'string'
          ? error.code
          : 'PREVIEW_INSPECTION_UNAVAILABLE';
      if (
        /^(?:BUILD_|PREVIEW_(?:UNAVAILABLE|AMBIGUOUS|FRAME_AMBIGUOUS|SCOPE_TOO_LARGE|CHAT_SCOPE_UNAVAILABLE|CHAT_ELEMENT_UNAVAILABLE|SESSION_MOUNTING|SESSION_RETIRED|GENERATION_CHANGED)|RESOURCE_|MANIFEST_INVALID)/.test(code)
      ) {
        const messages: Readonly<Record<string, string>> = Object.freeze({
          BUILD_REQUIRED: 'The current widget repository requires a new portable build.',
          BUILD_PENDING: 'The portable build is still pending host acceptance.',
          BUILD_STALE: 'The accepted build is stale for the current widget repository.',
          BUILD_IMPORT_FAILED: 'The portable build output was rejected by host validation.',
          PREVIEW_UNAVAILABLE: 'The exact current canvas Preview is unavailable for inspection.',
          PREVIEW_AMBIGUOUS: 'More than one matching Preview exists on the current canvas.',
          PREVIEW_FRAME_AMBIGUOUS: 'More than one matching Preview exists on the current canvas.',
          PREVIEW_SCOPE_TOO_LARGE: 'The current canvas has too many matching candidates to resolve safely.',
          PREVIEW_CHAT_SCOPE_UNAVAILABLE: 'The verified active chat canvas is unavailable.',
          PREVIEW_CHAT_ELEMENT_UNAVAILABLE: 'The verified AI Chat canvas element is unavailable.',
          PREVIEW_SESSION_MOUNTING: 'The exact visible Preview is still starting; retry after it settles.',
          PREVIEW_SESSION_RETIRED: 'The exact visible Preview session was cancelled or retired; reopen Preview and retry.',
          PREVIEW_GENERATION_CHANGED: 'The widget source, accepted generation, or exact Preview changed during inspection.',
          RESOURCE_REFERENCE_REQUIRED: 'A required manifest resource reference is missing; edit omnidraw.json and rebuild.',
          RESOURCE_REFERENCE_STALE: 'A manifest resource reference is unavailable; fix omnidraw.json or the resource and rebuild.',
          RESOURCE_NOT_READY: 'A manifest resource is not ready.',
          RESOURCE_KIND_MISMATCH: 'A manifest resource has the wrong kind.',
          RESOURCE_EFFECT_DENIED: 'The requested operation exceeds the manifest resource effect.',
          RESOURCE_PROVIDER_FAILED: 'The resource provider call failed safely.',
          MANIFEST_INVALID: 'The accepted widget manifest is invalid.',
        });
        return Object.freeze({
          toolError: Object.freeze({
            code,
            message: messages[code] ?? 'Preview inspection could not establish the requested exact authority.',
            retryable: error !== null
              && typeof error === 'object'
              && 'retryable' in error
              && error.retryable === true,
            ...(() => {
              const state = code === 'PREVIEW_FRAME_AMBIGUOUS' || code === 'PREVIEW_AMBIGUOUS'
                ? 'ambiguous' as const
                : code === 'PREVIEW_SESSION_MOUNTING'
                  ? 'mounting' as const
                  : code === 'PREVIEW_GENERATION_CHANGED'
                    ? 'generation_mismatch' as const
                    : code === 'PREVIEW_SESSION_RETIRED'
                      ? 'retired' as const
                      : undefined;
              if (state === undefined) return {};
              return {
                previewState: state,
                nextAction: state === 'ambiguous'
                  ? 'remove_duplicate_previews' as const
                  : state === 'mounting'
                    ? 'retry_after_settle' as const
                    : state === 'generation_mismatch'
                      ? 'retry_current_generation' as const
                      : 'reopen_preview' as const,
              };
            })(),
            ...(buildDiagnostics === undefined || buildDiagnostics.length === 0
              ? {}
              : { diagnostics: buildDiagnostics }),
          }),
        });
      }
      if (
        identity === undefined
        || /(?:PROTOCOL|RESULT_INVALID|IDENTITY_MISMATCH)/.test(code)
      ) {
        return Object.freeze({
          toolError: Object.freeze({
            code: /^[A-Z][A-Z0-9_]{0,127}$/.test(code)
              ? code
              : 'PREVIEW_INSPECTION_UNAVAILABLE',
            message: code === 'PREVIEW_INSPECTION_TIMED_OUT'
              ? 'Preview inspection exceeded its whole-call timeout.'
              : code === 'PREVIEW_INSPECTION_CANCELLED'
                ? 'Preview inspection was cancelled.'
                : /^(?:WIDGET_WORKSPACE|WIDGET_DRAFT)_/.test(code)
                  ? 'The requested widget draft is unavailable for inspection.'
                  : 'Preview inspection could not establish a safe isolated execution.',
            retryable: error !== null
              && typeof error === 'object'
              && 'retryable' in error
              && error.retryable === true,
          }),
        });
      }
      const finalStage = browserStage
        ?? (/SCREENSHOT|PNG/.test(code) ? 'capture_screenshot' : stage);
      const result = fnProjectWidgetPreviewInspectionFailure({
        surface: args.input.mode,
        error,
        stage: finalStage,
        identity,
        ...(artifactIdentity === undefined ? {} : { artifact: artifactIdentity }),
        durationMs: Date.now() - startedAtMs,
        cancelled: code === 'PREVIEW_INSPECTION_CANCELLED',
        previewState,
        digestSha256: sha256,
        ...(isPreviewInspectionBrowserServiceError(error) && error.evidence !== undefined
          ? { browserEvidence: error.evidence }
          : {}),
        ...(verifiedSourceMap === null
          ? {}
          : {
              mapLocation: (event: TPreviewInspectionRuntimeEvent) => (
                this.#mapInspectionRuntimeLocation(verifiedSourceMap!, event)
              ),
            }),
      });
      return Object.freeze({ result });
    } finally {
      clearTimeout(timeout);
      args.signal?.removeEventListener('abort', cancel);
      if (functionBridge !== undefined) {
        await settleInspectionCleanup(functionBridge.dispose());
      }
      if (generationMonitor !== undefined) clearInterval(generationMonitor);
      releaseGenerationListener?.();
      releaseGeneration?.();
    }
  }

  /**
   * Runs the repository's portable build and waits for host acceptance without
   * opening a session or replacing the currently mounted artifact.
   */
  async buildCheck(args: Readonly<{
    widgetKey: string;
    signal?: AbortSignal;
  }>): Promise<Readonly<{ ok: boolean; errors: readonly string[] }>> {
    try {
      await this.#config.buildGenerations.rebuild(args.widgetKey, args.signal);
      return Object.freeze({ ok: true, errors: Object.freeze([]) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Object.freeze({
        ok: false,
        errors: Object.freeze([message.slice(0, 8_000)]),
      });
    }
  }

  async load(args: TWidgetPreviewSessionInput): Promise<TWidgetPreviewMountView> {
    const sessionId = this.#sessionId(args);
    const artifact = this.#artifacts.get(sessionId);
    const session = this.#preview.get(sessionId);
    if (artifact === undefined || session === null || session.phase !== 'ready') {
      throw previewError('WIDGET_PREVIEW_NOT_FOUND', 'Preview stopped — build again.');
    }
    return this.#mountView(args, artifact);
  }

  async close(args: Readonly<{ canvasId: string; elementId: string }>): Promise<boolean> {
    const sessionId = this.#sessionId(args);
    this.#artifacts.delete(sessionId);
    this.#artifactGenerations.delete(sessionId);
    this.#generationReleases.get(sessionId)?.();
    this.#generationReleases.delete(sessionId);
    return this.#preview.close(sessionId);
  }

  async retireWidget(widgetKey: string): Promise<void> {
    const sessionIds = new Set<string>();
    for (const [sessionId, artifact] of this.#artifacts) {
      if (artifact.widgetKey === widgetKey) sessionIds.add(sessionId);
    }
    for (const [sessionId, accepted] of this.#pendingGenerations) {
      if (accepted.widgetKey === widgetKey) sessionIds.add(sessionId);
    }
    await this.#preview.closeWidget(widgetKey);
    for (const sessionId of sessionIds) {
      this.#artifacts.delete(sessionId);
      this.#artifactGenerations.delete(sessionId);
      this.#pendingGenerations.delete(sessionId);
      this.#generationReleases.get(sessionId)?.();
      this.#generationReleases.delete(sessionId);
    }
  }

  async invoke(
    args: Readonly<{
      canvasId: string;
      elementId: string;
      functionName: string;
      input: unknown;
    }>,
    signal?: AbortSignal,
  ): Promise<TDirectFunctionView> {
    const sessionId = this.#sessionId(args);
    const artifact = this.#artifacts.get(sessionId);
    const session = this.#preview.get(sessionId);
    if (artifact === undefined || session?.phase !== 'ready') {
      throw previewError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    return this.#invokeArtifactFunction(
      artifact,
      Object.freeze({
        canvasId: args.canvasId,
        elementId: args.elementId,
        widgetInstanceId: args.elementId,
      }),
      args.functionName,
      args.input,
      signal,
    );
  }

  async #invokeArtifactFunction(
    artifact: TWidgetPreviewSignedArtifact,
    subject: Readonly<{
      canvasId: string;
      elementId: string;
      widgetInstanceId: string;
    }>,
    functionName: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<TDirectFunctionView> {
    if (artifact.server === null) {
      throw previewError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const server = artifact.server;
    const descriptor = server.descriptors.find(
      (candidate) => candidate.exportName === functionName,
    );
    if (descriptor === undefined) {
      throw previewError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const access = this.#config.resources.createFunctionResourceGateway({
      requirements: server.requirements,
      bindings: server.bindings,
    });
    return this.#config.executor.invoke({
      subject,
      definition: {
        widgetKey: artifact.widgetKey,
        catalogGeneration: 0,
        runtimeAbi: server.runtimeAbi,
        artifactDigestSha256: server.artifactDigestSha256,
        descriptor,
      },
      artifact: server.entryBytes,
      input,
      signal,
      createResources: (call) => new DirectInvocationResourceGateway({
        call,
        gateway: access.gateway,
        bindings: access.bindings,
        writePermits: this.#config.writePermits,
        nowMs: this.#config.nowMs,
      }),
    });
  }

  async #verifyInspectionSourceMap(
    artifact: TWidgetPreviewSignedArtifact,
  ): Promise<TVerifiedWidgetSourceMap | null> {
    if (artifact.sourceMap === null) return null;
    return decodeAndVerifyWidgetSourceMap({
      decodeBase64: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
      digestSha256: async (value) => sha256(value),
      decodeUtf8: (value) => new TextDecoder('utf-8', { fatal: true }).decode(value),
      parseSourceMap: (value) => new TraceMap(value),
    }, {
      expectedDigestSha256: artifact.sourceMap.digestSha256,
      expectedCapsuleArtifactHash: artifact.runtimeDescriptor.artifactHash,
      expectedSourceRevision: artifact.sourceMap.sourceRevision,
      bytes: artifact.sourceMap.bytes,
    });
  }

  #mapInspectionRuntimeLocation(
    sourceMap: TVerifiedWidgetSourceMap,
    event: TPreviewInspectionRuntimeEvent,
  ): import('#backend/shell/agent').TInspectDiagnostic['location'] | undefined {
    const generated = event.location;
    if (generated === undefined) return undefined;
    const map = sourceMap.maps.find((candidate) => candidate.module === generated.module);
    if (map === undefined) return undefined;
    return fnRuntimeDiagnosticSource({
      generated,
      authoredPaths: sourceMap.authoredPaths,
      trace: ({ line, column }) => originalPositionFor(map.traceMap, { line, column }),
    }) ?? undefined;
  }

  async stop(): Promise<void> {
    for (const release of this.#generationReleases.values()) release();
    this.#generationReleases.clear();
    this.#artifacts.clear();
    this.#artifactGenerations.clear();
    this.#pendingGenerations.clear();
    await this.#preview.shutdown();
  }

  #inspectionSessionId(args: TWidgetPreviewInspectionRequest): string {
    this.#inspectionSequence += 1;
    return `inspection-${sha256([
      args.chatId,
      args.toolCallId,
      String(this.#inspectionSequence),
    ].join('\u0000')).slice(0, 48)}`;
  }

  #sessionId(args: Readonly<{ canvasId: string; elementId: string }>): string {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `preview-${sanitize(args.canvasId)}-${sanitize(args.elementId)}`;
  }

  #mountView(
    args: TWidgetPreviewSessionInput,
    artifact: TWidgetPreviewSignedArtifact,
  ): TWidgetPreviewMountView {
    return Object.freeze({
      canvasId: args.canvasId,
      elementId: args.elementId,
      widgetKey: artifact.widgetKey,
      manifest: artifact.manifest,
      artifact: Object.freeze({
        digestSha256: artifact.artifactDigestSha256,
        byteSize: artifact.capsuleBytes.byteLength,
        bytesBase64: Buffer.from(artifact.capsuleBytes).toString('base64'),
      }),
      runtimeDescriptor: artifact.runtimeDescriptor,
      functionDescriptors: artifact.browserFunctionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        artifact.browserFunctionDescriptorsDigestSha256,
      constructionReused: artifact.constructionReused,
      diagnostics: artifact.diagnostics,
    });
  }

  #withServer(
    artifact: TWidgetPreviewSignedArtifact,
    bindings: readonly TWidgetPreviewResourceBinding[],
  ): TWidgetPreviewSignedArtifact {
    if (artifact.server === null) return artifact;
    return Object.freeze({
      ...artifact,
      server: Object.freeze({ ...artifact.server, bindings }),
    });
  }

  #assembleArtifact(
    construction: TWidgetPreviewConstruction,
    signed: Awaited<ReturnType<WidgetFilesystemBuildService['sign']>>,
  ): TWidgetPreviewSignedArtifact {
    const executableProjection = fnProjectWidgetExecutableManifest(
      construction.manifest,
    );
    const serverDescriptors = construction.construction.construction.functionDescriptors;
    const validation = fnValidateWidgetServerFunctionDescriptors(
      executableProjection,
      serverDescriptors,
    );
    if (!validation.valid) {
      throw previewError(
        validation.reason === 'resource_effect_exceeded'
          ? 'RESOURCE_EFFECT_DENIED'
          : 'FUNCTION_DESCRIPTOR_INVALID',
        validation.reason === 'resource_effect_exceeded'
          ? 'A server function exceeds its manifest resource effect.'
          : 'Preview server-function descriptors are invalid.',
      );
    }
    const browserFunctionDescriptors = fnProjectWidgetBrowserFunctionDescriptors(
      serverDescriptors,
    );
    const browserFunctionDescriptorsDigestSha256 = sha256(
      fnCanonicalizeWidgetBrowserFunctionDescriptors(browserFunctionDescriptors),
    );
    const capabilityDigest = executableProjection.server === null
      ? '0'.repeat(64)
      : sha256(fnCanonicalizeWidgetServerFunctionDescriptors(serverDescriptors));
    if (!fnWidgetServerFunctionCapabilityRequestMatches(
      capabilityDigest,
      browserFunctionDescriptors,
      signed.capsule.runtime.capabilityRequests,
    )) throw previewError(
      'FUNCTION_DESCRIPTOR_INVALID',
      'Preview functions do not match the signed Capsule capability request.',
    );

    const {
      server: _server,
      resources: _authoredResources,
      ...authoredBrowserManifest
    } = construction.manifest;
    const browserManifest = Object.freeze({
      ...authoredBrowserManifest,
      ...(executableProjection.resources.length === 0
        ? {}
        : { resources: executableProjection.resources }),
    });
    const serverArtifact = construction.construction.construction.serverArtifact;
    const sourceMapArtifact = construction.construction.construction.sourceMapArtifact;
    return Object.freeze({
      widgetKey: construction.manifest.slug,
      manifest: browserManifest,
      capsuleBytes: signed.capsule.artifactBytes,
      artifactDigestSha256: sha256(signed.capsule.artifactBytes),
      runtimeDescriptor: signed.capsule.runtime,
      browserFunctionDescriptors,
      browserFunctionDescriptorsDigestSha256,
      constructionReused: false,
      diagnostics: Object.freeze([]),
      sourceMap: sourceMapArtifact === null
        ? null
        : Object.freeze({
            digestSha256: sourceMapArtifact.digestSha256,
            bytes: new Uint8Array(sourceMapArtifact.bytes),
            sourceRevision:
              construction.construction.construction.distributionProvenance.sourceRevision,
          }),
      server: serverArtifact === null || executableProjection.server === null
        ? null
        : Object.freeze({
            runtimeAbi: serverArtifact.runtimeAbi,
            entryBytes: serverArtifact.bytes,
            artifactDigestSha256: serverArtifact.digestSha256,
            runtimeDescriptor: signed.capsule.runtime,
            descriptors: serverDescriptors,
            requirements: executableProjection.resources,
            bindings: Object.freeze([]),
          }),
    });
  }

  async #resolveBindings(
    requirements: readonly TResourceRequirement[],
  ): Promise<readonly TWidgetPreviewResourceBinding[]> {
    const bindings: TWidgetPreviewResourceBinding[] = [];
    for (const requirement of requirements) {
      if (requirement.resourceId === undefined) {
        if (!requirement.required) continue;
        throw previewError(
          'WIDGET_RESOURCE_BINDING_REQUIRED',
          `Required Preview resource slot '${requirement.slot}' is unconfigured; edit omnidraw.json and rebuild.`,
        );
      }
      const resource = await this.#config.resources.getResource(requirement.resourceId);
      if (resource === null) throw previewError(
        'WIDGET_RESOURCE_BINDING_STALE',
        `Preview resource slot '${requirement.slot}' references an unavailable local resource.`,
      );
      if (resource.status !== 'ready') throw previewError(
        'WIDGET_RESOURCE_NOT_READY',
        `Preview resource slot '${requirement.slot}' is not ready.`,
      );
      if (resource.kind !== requirement.kind) throw previewError(
        'WIDGET_RESOURCE_KIND_MISMATCH',
        `Preview resource slot '${requirement.slot}' has the wrong resource kind.`,
      );
      bindings.push(Object.freeze({
        slot: requirement.slot,
        resourceId: requirement.resourceId,
        kind: resource.kind,
        allowRead: effectAllows(requirement.effect, 'read'),
        allowWrite: effectAllows(requirement.effect, 'write'),
      }));
    }
    return Object.freeze(bindings);
  }
}

export { WidgetPreviewService };
export type { TWidgetPreviewServiceConfig };
