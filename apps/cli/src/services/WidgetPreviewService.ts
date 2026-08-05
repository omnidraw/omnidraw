import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
import type { TResourceEffect, TResourceRequirement } from '@omnidraw/resource-runtime';
import {
  EphemeralPreviewService,
  NodeWidgetFilesystemWorkspace,
  type TPreviewConstructionCompatibility,
  type TPreviewPorts,
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
  type TWidgetManifestV1,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';

import type { ResourceService } from './ResourceService';
import type { WidgetFilesystemRuntimeCatalog } from './WidgetFilesystemRuntimeCatalog';

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
}>;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function previewError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
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
        widgetKey,
        executableInputDigestSha256,
        signal,
        reportDiagnostic,
      }) => {
        const workspace = await this.#workspace;
        const capture = await workspace.captureDraftBuildInput({
          slug: widgetKey,
          signal,
        });
        reportDiagnostic({ severity: 'info', message: 'Building Preview construction…' });
        const construction = await config.builder.construct({
          manifest: capture.manifest,
          files: capture.files,
          expectedExecutableInputDigestSha256: executableInputDigestSha256,
          workspaceKey: `preview_${widgetKey}`,
          signal,
          reportProgress: (phase: 'installing' | 'building' | 'validating') => reportDiagnostic({
            severity: 'info',
            message: `Preview build ${phase}.`,
          }),
        });
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
        const signed = await config.builder.sign(
          construction.construction,
          'preview',
        );
        if (signal.aborted) throw new Error('Preview was cancelled.');
        return this.#assembleArtifact(construction, signed);
      },
      mount: async ({ sessionId }) => Object.freeze({ sessionId }),
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
    if (artifact === undefined || artifact.server === null) {
      throw previewError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const server = artifact.server;
    const descriptor = server.descriptors.find(
      (candidate) => candidate.exportName === args.functionName,
    );
    if (descriptor === undefined) {
      throw previewError('FUNCTION_NOT_FOUND', 'Published function was not found.');
    }
    const access = this.#config.resources.createFunctionResourceGateway({
      requirements: server.requirements,
      bindings: server.bindings,
    });
    return this.#config.executor.invoke({
      subject: {
        canvasId: args.canvasId,
        elementId: args.elementId,
        widgetInstanceId: args.elementId,
      },
      definition: {
        widgetKey: artifact.widgetKey,
        catalogGeneration: 0,
        runtimeAbi: server.runtimeAbi,
        artifactDigestSha256: server.artifactDigestSha256,
        descriptor,
      },
      artifact: server.entryBytes,
      input: args.input,
      signal,
      createResources: (call) => new DirectInvocationResourceGateway({
        call,
        gateway: access.gateway,
        bindings: access.bindings,
        writePermits: this.#config.writePermits,
      }),
    });
  }

  async stop(): Promise<void> {
    this.#artifacts.clear();
    await this.#preview.shutdown();
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
