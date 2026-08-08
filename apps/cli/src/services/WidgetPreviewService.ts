import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { IService } from '@omnidraw/runtime';
import type {
  TDirectFunctionView,
  TFunctionInputs,
} from '@omnidraw/api/function';
import type {
  TWidgetPreviewDiagnosticView,
  TWidgetPreviewMountView,
  TWidgetPreviewSelectedResourceInput,
  TWidgetPreviewSessionInput,
} from '@omnidraw/api/widget';
import type { IDirectFunctionInvoker } from '@omnidraw/function-runtime';
import {
  DirectInvocationResourceGateway,
  type EphemeralResourceWritePermitAuthority,
} from '@omnidraw/function-runtime/local';
import {
  fxDecodeAndVerifyWidgetSourceMap,
  type TVerifiedWidgetSourceMap,
} from '@omnidraw/shared-functions/widget-source-map/fx.decode-and-verify-widget-source-map';
import {
  fnRuntimeDiagnosticSource,
} from '@omnidraw/shared-functions/widget-source-map/fn.runtime-diagnostic-source';
import type { TResourceEffect, TResourceRequirement } from '@omnidraw/resource-runtime';
import {
  EphemeralPreviewService,
  NodeWidgetFilesystemWorkspace,
  type TInspectArtifact,
  type TInspectIdentity,
  type TInspectStage,
  type TPreviewConstructionCompatibility,
  type TPreviewPorts,
  type TWidgetPreviewInspectionRequest,
  type TWidgetPreviewInspectionResponse,
  type TWidgetWorkspaceDraftBuildCapture,
  type TWidgetFilesystemConstruction,
  type WidgetFilesystemBuildService,
} from '@omnidraw/service-agent';
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
  type TWidgetCapsuleRuntimeDescriptor,
  type TWidgetCapsuleTheme,
  type TWidgetManifestV1,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';

import type { ResourceService } from './ResourceService';
import type { WidgetFilesystemRuntimeCatalog } from './WidgetFilesystemRuntimeCatalog';
import type { WidgetCapsuleHostConfigurationService } from './WidgetCapsuleHostConfigurationService';
import {
  fnProjectWidgetPreviewInspectionCompleted,
  fnProjectWidgetPreviewInspectionFailure,
} from './fn.widget-preview-inspection';
import {
  PREVIEW_INSPECTION_JOB_FORMAT,
} from './preview-inspection/CONSTANTS';
import type {
  TPreviewInspectionBrowserPort,
  TPreviewInspectionFunctionBridge,
  TPreviewInspectionRuntimeEvent,
} from './preview-inspection/interface';

type TWidgetPreviewOpenInput = TWidgetPreviewSessionInput & Readonly<{
  selectedResources?: readonly TWidgetPreviewSelectedResourceInput[];
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
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  descriptors: readonly TWidgetServerFunctionDescriptor[];
  requirements: readonly TResourceRequirement[];
  bindings: readonly TWidgetPreviewResourceBinding[];
}>;

type TWidgetPreviewSignedArtifact = Readonly<{
  widgetKey: string;
  manifest: Omit<TWidgetManifestV1, 'server'>;
  capsuleBytes: Uint8Array;
  artifactDigestSha256: string;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
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
  builder: WidgetFilesystemBuildService;
  resources: ResourceService;
  executor: IDirectFunctionInvoker;
  writePermits: EphemeralResourceWritePermitAuthority;
  environment: Omit<TWidgetBuildEnvironment, 'serverRuntimeAbi'>;
  compatibility: Omit<TPreviewConstructionCompatibility, 'serverRuntimeAbi'>;
  hostConfiguration: Pick<WidgetCapsuleHostConfigurationService, 'read'>;
  inspectionBrowser: TPreviewInspectionBrowserPort;
  inspectionTheme: TWidgetCapsuleTheme;
}>;

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
        : 'PREVIEW_INSPECTION_CANCELLED',
      signal.reason === 'inspection-timeout'
        ? 'Preview inspection exceeded its whole-call timeout.'
        : 'Preview inspection was cancelled.',
      true,
    ));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(inspectionError(
        signal.reason === 'inspection-timeout'
          ? 'PREVIEW_INSPECTION_TIMED_OUT'
          : 'PREVIEW_INSPECTION_CANCELLED',
        signal.reason === 'inspection-timeout'
          ? 'Preview inspection exceeded its whole-call timeout.'
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

/**
 * Process-owned full-stack Preview. Nothing durable is written; a restart
 * leaves only the stopped canvas frame and a clean .preview scratch root.
 */
class WidgetPreviewService implements IService {
  readonly name = 'widget-preview';
  readonly #config: TWidgetPreviewServiceConfig;
  readonly #workspace: Promise<NodeWidgetFilesystemWorkspace>;
  readonly #preview: EphemeralPreviewService<
    TWidgetPreviewConstruction,
    TWidgetPreviewSignedArtifact,
    TWidgetPreviewMountHandle
  >;
  readonly #artifacts = new Map<string, TWidgetPreviewSignedArtifact>();
  readonly #pendingCaptures = new Map<string, TWidgetWorkspaceDraftBuildCapture>();
  readonly #inspectionSessions = new Set<string>();
  readonly #inspectionStages = new Map<string, TInspectStage>();
  #inspectionSequence = 0;

  constructor(config: TWidgetPreviewServiceConfig) {
    this.#config = config;
    this.#workspace = NodeWidgetFilesystemWorkspace.open({
      rootPath: config.widgetsRoot,
    });
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
        const workspace = await awaitInspectionSignal(this.#workspace, signal);
        const capture = this.#pendingCaptures.get(sessionId)
          ?? await awaitInspectionSignal(
            workspace.captureDraftBuildInput({
              slug: widgetKey,
              signal,
            }),
            signal,
          );
        if (capture.slug !== widgetKey) {
          throw new Error('Preview capture does not match the requested draft.');
        }
        reportDiagnostic({ severity: 'info', message: 'Building Preview construction…' });
        const construction = await awaitInspectionSignal(
          config.builder.construct({
            manifest: capture.manifest,
            files: capture.files,
            expectedExecutableInputDigestSha256: executableInputDigestSha256,
            workspaceKey: `preview_${widgetKey}`,
            signal,
            reportProgress: (phase: 'installing' | 'building' | 'validating') => reportDiagnostic({
              severity: 'info',
              message: `Preview build ${phase}.`,
            }),
          }),
          signal,
        );
        if (this.#inspectionSessions.has(sessionId)) {
          this.#inspectionStages.set(sessionId, 'sign');
        }
        return Object.freeze({
          manifest: capture.manifest,
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
      mount: async ({ sessionId }) => {
        if (this.#inspectionSessions.has(sessionId)) {
          this.#inspectionStages.set(sessionId, 'mount');
        }
        return Object.freeze({ sessionId });
      },
      unmount: async () => undefined,
    };
    this.#preview = new EphemeralPreviewService(ports);
  }

  async open(args: TWidgetPreviewOpenInput): Promise<TWidgetPreviewMountView> {
    const snapshot = await this.#config.catalog.refresh();
    const draft = snapshot.entries[args.widgetKey]?.draft;
    if (
      draft?.health !== 'healthy'
      || draft.manifest === null
      || draft.executable === null
    ) throw previewError('WIDGET_DRAFT_MISSING', 'Widget draft is missing or unhealthy.');
    const compatibility = Object.freeze({
      ...this.#config.compatibility,
      serverRuntimeAbi: draft.manifest.server?.runtimeAbi ?? null,
    });
    const workspace = await this.#workspace;
    const capture = await workspace.captureDraftBuildInput({
      slug: args.widgetKey,
      signal: args.signal ?? new AbortController().signal,
    });
    const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
      manifest: capture.manifest,
      files: capture.files,
      environment: Object.freeze({
        ...this.#config.environment,
        serverRuntimeAbi: capture.manifest.server?.runtimeAbi ?? null,
      }),
      digestSha256: sha256,
    });
    const selectedResources = await this.#resolveBindings(
      draft.executable.resources,
      args.selectedResources ?? [],
    );
    const sessionId = this.#sessionId(args);
    // Rebuilds replace the live session; the validated construction is reused
    // only while the exact digest and compatibility policy still match.
    await this.#preview.close(sessionId);
    this.#pendingCaptures.set(sessionId, capture);
    try {
      const result = await this.#preview.open({
        sessionId,
        widgetKey: args.widgetKey,
        executableInputDigestSha256,
        compatibility,
        selectedResources: selectedResources.map((binding) => Object.freeze({
          slot: binding.slot,
          resourceId: binding.resourceId,
          effect: binding.allowWrite ? 'read_write' as const : 'read' as const,
        })),
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
      const artifact = Object.freeze({
        ...this.#withServer(result.signedArtifact, selectedResources),
        constructionReused: result.session.constructionReused,
        diagnostics: result.session.diagnostics,
      });
      this.#artifacts.set(sessionId, artifact);
      return this.#mountView(args, artifact);
    } finally {
      this.#pendingCaptures.delete(sessionId);
    }
  }

  /**
   * Captures one exact draft and runs its exact Preview-signed bytes in the
   * process-owned, resource-free inspection browser. No visible Preview or
   * durable widget/canvas authority is created.
   */
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
    let sessionId: string | undefined;
    let functionBridge: TPreviewInspectionFunctionBridge | undefined;
    try {
      const preflight = await awaitInspectionSignal(
        this.#config.inspectionBrowser.preflight(),
        controller.signal,
      );
      if (!preflight.ok) {
        return Object.freeze({
          toolError: Object.freeze({
            code: preflight.code,
            message: `${preflight.message} ${preflight.remediation}`.slice(0, 2_000),
            retryable: true,
          }),
        });
      }
      if (controller.signal.aborted) {
        throw inspectionError(
          controller.signal.reason === 'inspection-timeout'
            ? 'PREVIEW_INSPECTION_TIMED_OUT'
            : 'PREVIEW_INSPECTION_CANCELLED',
          'Preview inspection was cancelled before draft capture completed.',
          true,
        );
      }
      const workspace = await awaitInspectionSignal(this.#workspace, controller.signal);
      const capture = await awaitInspectionSignal(
        workspace.captureDraftBuildInput({
          slug: args.widgetKey,
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (
        capture.slug !== args.widgetKey
        || capture.manifest.slug !== args.widgetKey
        || capture.manifest.name !== args.name
        || args.input.name !== args.name
      ) {
        throw inspectionError(
          'WIDGET_DRAFT_IDENTITY_MISMATCH',
          'The captured widget draft identity no longer matches the mounted widget.',
          true,
        );
      }
      if (
        args.input.expectedDraftDigestSha256 !== undefined
        && args.input.expectedDraftDigestSha256 !== capture.treeDigestSha256
      ) {
        return Object.freeze({
          toolError: Object.freeze({
            code: 'WIDGET_DRAFT_DIGEST_STALE',
            message: 'The widget draft changed after the requested digest fence was selected.',
            retryable: true,
            observedDraftDigestSha256: capture.treeDigestSha256,
          }),
        });
      }
      const executableInputDigestSha256 = fnWidgetExecutableInputDigest({
        manifest: capture.manifest,
        files: capture.files,
        environment: Object.freeze({
          ...this.#config.environment,
          serverRuntimeAbi: capture.manifest.server?.runtimeAbi ?? null,
        }),
        digestSha256: sha256,
      });
      identity = Object.freeze({
        name: args.name,
        widgetKey: args.widgetKey,
        draftDigestSha256: capture.treeDigestSha256,
        executableInputDigestSha256,
        environmentIdentity: this.#config.compatibility.environmentIdentity,
      });
      const compatibility = Object.freeze({
        ...this.#config.compatibility,
        serverRuntimeAbi: capture.manifest.server?.runtimeAbi ?? null,
      });
      sessionId = this.#inspectionSessionId(args);
      this.#inspectionSessions.add(sessionId);
      this.#inspectionStages.set(
        sessionId,
        this.#preview.reusableConstruction({
          executableInputDigestSha256,
          compatibility,
        }) === null ? 'build' : 'sign',
      );
      this.#pendingCaptures.set(sessionId, capture);
      const preview = await awaitInspectionSignal(
        this.#preview.open({
          sessionId,
          widgetKey: args.widgetKey,
          executableInputDigestSha256,
          compatibility,
          selectedResources: Object.freeze([]),
          signal: controller.signal,
        }),
        controller.signal,
      );
      const artifact = Object.freeze({
        ...preview.signedArtifact,
        constructionReused: preview.session.constructionReused,
        diagnostics: preview.session.diagnostics,
      });
      artifactIdentity = Object.freeze({
        artifactDigestSha256: artifact.artifactDigestSha256,
        capsuleArtifactHash: artifact.runtimeDescriptor.capsuleArtifactHash,
        constructionReused: artifact.constructionReused,
      });
      this.#inspectionStages.set(sessionId, 'sign');
      const sourceMap = await awaitInspectionSignal(
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
          const invocation = this.#invokeArtifactFunction(
            artifact,
            Object.freeze({
              canvasId: `inspection-${sessionId}`,
              elementId: `inspection-${sessionId}`,
              widgetInstanceId: `inspection-${sessionId}`,
            }),
            request.functionName,
            request.input,
            AbortSignal.any([request.signal, bridgeController.signal]),
          );
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
      this.#inspectionStages.set(sessionId, 'mount');
      const hostConfiguration = await awaitInspectionSignal(
        this.#config.hostConfiguration.read(),
        controller.signal,
      );
      const browser = await this.#config.inspectionBrowser.run(Object.freeze({
        format: PREVIEW_INSPECTION_JOB_FORMAT,
        jobId: sessionId,
        ownerKey: `chat-${sha256(args.chatId).slice(0, 40)}`,
        widgetKey: args.widgetKey,
        artifact: Object.freeze({
          bytes: artifact.capsuleBytes,
          digestSha256: artifact.artifactDigestSha256,
          capsuleArtifactHash: artifact.runtimeDescriptor.capsuleArtifactHash,
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
      if (
        browser.jobId !== sessionId
        || browser.artifactDigestSha256 !== artifact.artifactDigestSha256
        || browser.capsuleArtifactHash
          !== artifact.runtimeDescriptor.capsuleArtifactHash
      ) {
        throw inspectionError(
          'BROWSER_RESULT_INVALID',
          'Preview inspection browser returned mismatched artifact identity.',
        );
      }
      const result = fnProjectWidgetPreviewInspectionCompleted({
        browser,
        identity,
        artifact: artifactIdentity,
        page: args.input.viewport,
        durationMs: Date.now() - startedAtMs,
        digestSha256: sha256,
        ...(sourceMap === null
          ? {}
          : {
              mapLocation: (event: TPreviewInspectionRuntimeEvent) => (
                this.#mapInspectionRuntimeLocation(sourceMap, event)
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
              : 'PREVIEW_INSPECTION_CANCELLED',
            controller.signal.reason === 'inspection-timeout'
              ? 'Preview inspection exceeded its whole-call timeout.'
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
      const fallbackStage = sessionId === undefined
        ? 'build'
        : this.#inspectionStages.get(sessionId) ?? 'mount';
      const stage = browserStage
        ?? (/SCREENSHOT|PNG/.test(code) ? 'capture_screenshot' : fallbackStage);
      const result = fnProjectWidgetPreviewInspectionFailure({
        error,
        stage,
        identity,
        ...(artifactIdentity === undefined ? {} : { artifact: artifactIdentity }),
        durationMs: Date.now() - startedAtMs,
        cancelled: code === 'PREVIEW_INSPECTION_CANCELLED',
      });
      return Object.freeze({ result });
    } finally {
      clearTimeout(timeout);
      args.signal?.removeEventListener('abort', cancel);
      if (functionBridge !== undefined) {
        await settleInspectionCleanup(functionBridge.dispose());
      }
      if (sessionId !== undefined) {
        this.#pendingCaptures.delete(sessionId);
        this.#inspectionSessions.delete(sessionId);
        this.#inspectionStages.delete(sessionId);
        await this.#preview.close(sessionId).catch(() => undefined);
      }
    }
  }

  /**
   * Headless Preview build for agent validation: captures the current shared
   * draft and runs the same construction pipeline a Preview frame would,
   * without opening a session or retaining an artifact.
   */
  async buildCheck(args: Readonly<{
    widgetKey: string;
    signal?: AbortSignal;
  }>): Promise<Readonly<{ ok: boolean; errors: readonly string[] }>> {
    try {
      const workspace = await this.#workspace;
      const capture = await workspace.captureDraftBuildInput({
        slug: args.widgetKey,
        signal: args.signal ?? new AbortController().signal,
      });
      await this.#config.builder.construct({
        manifest: capture.manifest,
        files: capture.files,
        workspaceKey: `preview_${args.widgetKey}`,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
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
    return this.#preview.close(sessionId);
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
    if (artifact === undefined) {
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
      }),
    });
  }

  async #verifyInspectionSourceMap(
    artifact: TWidgetPreviewSignedArtifact,
  ): Promise<TVerifiedWidgetSourceMap | null> {
    if (artifact.sourceMap === null) return null;
    return fxDecodeAndVerifyWidgetSourceMap({
      decodeBase64: (value) => Uint8Array.from(Buffer.from(value, 'base64')),
      digestSha256: async (value) => sha256(value),
      decodeUtf8: (value) => new TextDecoder('utf-8', { fatal: true }).decode(value),
      parseSourceMap: (value) => new TraceMap(value),
    }, {
      expectedDigestSha256: artifact.sourceMap.digestSha256,
      expectedCapsuleArtifactHash: artifact.runtimeDescriptor.capsuleArtifactHash,
      expectedSourceRevision: artifact.sourceMap.sourceRevision,
      bytes: artifact.sourceMap.bytes,
    });
  }

  #mapInspectionRuntimeLocation(
    sourceMap: TVerifiedWidgetSourceMap,
    event: TPreviewInspectionRuntimeEvent,
  ): import('@omnidraw/service-agent').TInspectDiagnostic['location'] | undefined {
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
    this.#artifacts.clear();
    this.#pendingCaptures.clear();
    this.#inspectionSessions.clear();
    this.#inspectionStages.clear();
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
      throw new Error('Preview server-function descriptors are invalid.');
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
    )) throw new Error('Preview functions do not match the signed Capsule capability request.');

    const { server: _server, ...browserManifest } = construction.manifest;
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
    selections: readonly TWidgetPreviewSelectedResourceInput[],
  ): Promise<readonly TWidgetPreviewResourceBinding[]> {
    const bySlot = new Map(requirements.map((item) => [item.slot, item]));
    const bindings = await Promise.all(selections.map(async (selection) => {
      const requirement = bySlot.get(selection.slot);
      const resource = await this.#config.resources.getResource(selection.resourceId);
      const allowRead = selection.effect === 'read' || selection.effect === 'read_write';
      const allowWrite = selection.effect === 'read_write';
      if (
        requirement === undefined
        || resource === null
        || resource.status !== 'ready'
        || resource.kind !== requirement.kind
        || (allowRead && !effectAllows(requirement.effect, 'read'))
        || (allowWrite && !effectAllows(requirement.effect, 'write'))
      ) throw previewError('FUNCTION_RESOURCE_UNAVAILABLE', 'Preview resource is unavailable.');
      return Object.freeze({
        slot: selection.slot,
        resourceId: selection.resourceId,
        kind: resource.kind,
        allowRead,
        allowWrite,
      });
    }));
    for (const requirement of requirements) {
      if (
        requirement.required
        && !bindings.some((binding) => binding.slot === requirement.slot)
      ) {
        const candidates = await this.#config.resources.listResources({
          kind: requirement.kind,
          status: 'ready',
        });
        if (candidates.length === 1) {
          bindings.push(Object.freeze({
            slot: requirement.slot,
            resourceId: candidates[0]!.id,
            kind: requirement.kind,
            allowRead: effectAllows(requirement.effect, 'read'),
            allowWrite: effectAllows(requirement.effect, 'write'),
          }));
          continue;
        }
        throw previewError(
          'FUNCTION_RESOURCE_UNAVAILABLE',
          `Required Preview resource slot '${requirement.slot}' has no selection.`,
        );
      }
    }
    return Object.freeze(bindings);
  }
}

export { WidgetPreviewService };
export type { TWidgetPreviewServiceConfig };
