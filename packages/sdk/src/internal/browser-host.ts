/** @file Capsule-backed browser host hidden behind SDK-owned contracts. */

import {
  CapsuleHostError,
  CapsuleMemoryArtifactCache,
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
  type CapsuleCapabilityBinding,
  type CapsuleCapabilityDescriptor,
  type CapsuleCapabilityGrant,
  type CapsuleHandle,
  type CapsuleHost,
  type CapsuleKernelCallContext,
  type CapsuleMountErrorEvent,
  type CapsuleMountGuestChannels,
  type CapsuleSchemaResource,
} from '@omnidraw/capsule';
import {
  createCapsuleAuthoringInspection,
  createCapsuleAuthoringInspectionHost,
  type CapsuleAuthoringInspectionController,
  type CapsuleAuthoringInspectionHost,
} from '@omnidraw/capsule/authoring-inspection';
import {
  CAPSULE_API_GROUP_BUNDLE_DIGEST,
  CAPSULE_API_GROUP_CONTRACT_FORMAT,
} from '@omnidraw/capsule/protocol';
import type {
  IWidgetAuthoringInspectionController,
  IWidgetBrowserHost,
  IWidgetBrowserInspectionMount,
  IWidgetBrowserMount,
  IWidgetFunctionHostPort,
  TWidgetBrowserHostOptions,
  TWidgetBrowserMountRequest,
} from '../contracts/interface';
import {
  WidgetRuntimeDescriptorValidator,
  WidgetServerFunctionDescriptorsValidator,
} from '../contracts/schema';
import type {
  TWidgetBrowserArtifact,
  TWidgetCapabilityRequest,
  TWidgetHostConfiguration,
  TWidgetSerializableJsonValue,
  TWidgetViewport,
} from '../contracts/types';
import {
  fnWidgetBrowserFunctionCapabilityRequestMatches,
} from '../contracts/core/fn.function-descriptor';
import { SdkEffectRuntime } from './effect-runtime';
import { WidgetHostError } from '../host-error';
import {
  createOmnidrawGuestChannelContract,
  createOmnidrawServerFunctionCapabilityContract,
} from './capsule/create-capability-contracts';
import { fnOmnidrawWidgetNotificationOutput } from './capsule/fn.channel-values';
import type { TOmnidrawCapsuleCapabilityContract } from './capsule/types';
import { fnCapsuleMountErrorDiagnostic } from './fn.capsule-mount-error-diagnostic';
import {
  createArtifactAdmissionCache,
  fnArtifactAdmissionKey,
  type TArtifactAdmissionLease,
} from './artifact-admission-cache';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const input = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(input).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(input[key])}`
  )).join(',')}}`;
}

function safeHostFailure(error: InstanceType<typeof CapsuleHostError>): WidgetHostError {
  const artifact = error.code === 'ARTIFACT_CACHE_MISS' || error.code === 'ARTIFACT_REJECTED';
  const capability = error.code === 'CAPABILITY_REJECTED';
  const channel = error.code === 'CHANNEL_QUOTA' || error.code === 'CHANNEL_REJECTED';
  const lifecycle = ['DESTROYED', 'LIFECYCLE_REJECTED', 'NOT_PARKABLE', 'VIEWPORT_REJECTED'].includes(error.code);
  const target = error.code === 'PLATFORM_UNSUPPORTED';
  const category = artifact ? 'artifact'
    : capability ? 'capability'
      : channel ? 'channel'
        : lifecycle ? 'lifecycle'
          : target ? 'target'
            : error.code === 'INTERNAL_ERROR' ? 'internal' : 'host';
  const message = artifact ? 'The widget UI artifact was rejected.'
    : capability ? 'A widget capability was denied or failed.'
      : channel ? 'A widget data channel was rejected.'
        : lifecycle ? 'The widget lifecycle operation failed.'
          : target ? 'The widget UI target is not supported by this browser.'
            : category === 'internal' ? 'The browser widget runtime failed safely.'
              : 'The browser widget host rejected the operation.';
  return new WidgetHostError(Object.freeze({
    format: 'omnidraw.widget-host-diagnostic.v1',
    phase: 'host',
    category,
    code: error.code,
    fatal: true,
    message,
  }), { cause: error });
}

function base64Bytes(value: string, view: Window | null): Uint8Array {
  const decode = view?.atob.bind(view) ?? globalThis.atob;
  const text = decode(value);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

type TSigningAuthority = Readonly<{
  keyId: string;
  key: CryptoKey;
  publicKeyBytesHex: string;
  publicKeyFingerprintSha256: `sha256:${string}`;
}>;

async function signingAuthority(
  catalog: TWidgetHostConfiguration,
  keyId: string,
  document: Document,
): Promise<TSigningAuthority> {
  const configuredKeys = catalog.signingKeys.filter((candidate) => candidate.keyId === keyId);
  if (configuredKeys.length !== 1) throw new Error('Widget artifact signing authority is unavailable or ambiguous.');
  const configured = configuredKeys[0]!;
  if (configured.algorithm !== 'Ed25519' || configured.format !== 'raw') {
    throw new Error(`Widget signing key '${configured.keyId}' uses an unsupported format.`);
  }
  const subtle = document.defaultView?.crypto.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('Web Crypto is required to verify widget artifacts.');
  const bytes = base64Bytes(configured.publicKeyBase64, document.defaultView);
  const fingerprint = new Uint8Array(await subtle.digest('SHA-256', ownedBuffer(bytes)));
  const key = await subtle.importKey(
    'raw',
    ownedBuffer(bytes),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const hex = (value: Uint8Array): string => [...value]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({
    keyId,
    key,
    publicKeyBytesHex: hex(bytes),
    publicKeyFingerprintSha256: `sha256:${hex(fingerprint)}`,
  });
}

async function defaultDigest(bytes: Uint8Array, document: Document): Promise<string> {
  const subtle = document.defaultView?.crypto.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('Web Crypto is required to verify widget artifact digests.');
  const result = await subtle.digest('SHA-256', ownedBuffer(bytes));
  return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function captureArtifact(input: unknown): TWidgetBrowserArtifact {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('A widget browser artifact must be an object.');
  }
  const value = input as Readonly<Record<string, unknown>>;
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0) {
    throw new TypeError('A widget browser artifact requires non-empty bytes.');
  }
  if (typeof value.digestSha256 !== 'string' || !SHA256_PATTERN.test(value.digestSha256)) {
    throw new TypeError('Widget browser artifact digest must be lowercase SHA-256.');
  }
  const artifactHash = value.artifactHash;
  if (typeof artifactHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(artifactHash)) {
    throw new TypeError('Widget browser artifact runtime hash is invalid.');
  }
  const rawRuntime = value.runtime;
  return Object.freeze({
    bytes: Uint8Array.from(value.bytes),
    digestSha256: value.digestSha256,
    artifactHash: artifactHash as `sha256:${string}`,
    runtime: WidgetRuntimeDescriptorValidator.parse(rawRuntime),
    functions: WidgetServerFunctionDescriptorsValidator.parse(value.functions ?? []),
  });
}

function requestsMatch(
  derived: Readonly<{ id: string; versionRange: string; contractHash: string; required: boolean; operations: readonly string[] }>,
  signed: TWidgetCapabilityRequest,
): boolean {
  return canonicalJson({ ...derived, operations: [...derived.operations].sort() })
    === canonicalJson({ ...signed, operations: [...signed.operations].sort() });
}

async function capabilityContracts(
  artifact: TWidgetBrowserArtifact,
): Promise<Readonly<{
  contracts: readonly TOmnidrawCapsuleCapabilityContract[];
  schemas: readonly CapsuleSchemaResource[];
  channels: Awaited<ReturnType<typeof createOmnidrawGuestChannelContract>> | null;
}>> {
  const functionRequests = artifact.runtime.capabilityRequests;
  if (functionRequests.length !== (artifact.functions.length === 0 ? 0 : 1)) {
    throw new Error('Widget function descriptors do not match signed capability requests.');
  }
  const functionRequest = functionRequests[0];
  if (functionRequest !== undefined && !fnWidgetBrowserFunctionCapabilityRequestMatches(functionRequest, artifact.functions)) {
    throw new Error('Widget function descriptors failed signed capability verification.');
  }
  const functionContract = functionRequest === undefined ? null : await createOmnidrawServerFunctionCapabilityContract({
    descriptorDigestSha256: functionRequest.contractHash.slice('sha256:'.length),
    functions: artifact.functions,
  });
  if (functionContract !== null && !requestsMatch(functionContract.request, functionRequest!)) {
    throw new Error('Widget function capability contract is inconsistent with the artifact.');
  }
  const channels = artifact.runtime.channels === null ? null : await createOmnidrawGuestChannelContract({
    localStore: artifact.runtime.channels.store === undefined ? 'none' : 'ephemeral',
  });
  if (channels !== null && canonicalJson(channels.declaration) !== canonicalJson(artifact.runtime.channels)) {
    throw new Error('Widget guest channels are inconsistent with the artifact.');
  }
  const contracts = [functionContract].filter(
    (contract): contract is TOmnidrawCapsuleCapabilityContract => contract !== null,
  );
  const schemas = new Map<string, CapsuleSchemaResource>();
  for (const contract of contracts) for (const schema of contract.schemas) schemas.set(schema.reference.hash, schema);
  if (channels !== null) for (const schema of channels.schemas) schemas.set(schema.reference.hash, schema);
  return Object.freeze({
    contracts: Object.freeze(contracts),
    schemas: Object.freeze([...schemas.values()].sort((left, right) => left.reference.hash.localeCompare(right.reference.hash))),
    channels,
  });
}

function functionBinding(
  descriptor: CapsuleCapabilityDescriptor,
  port: IWidgetFunctionHostPort,
  request: TWidgetBrowserMountRequest,
  createId: () => string,
): CapsuleCapabilityBinding {
  let disposed = false;
  return Object.freeze({
    descriptor,
    async invoke(context: CapsuleKernelCallContext, operation: string, input: unknown): Promise<unknown> {
      if (disposed) throw new Error('Widget function provider is disposed.');
      return await port.invoke({
        invocationId: createId(),
        subject: request.subject,
        functionName: operation,
        input: input as TWidgetSerializableJsonValue,
        signal: context.signal,
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      void port.dispose?.();
    },
  });
}

function bindings(
  contracts: readonly TOmnidrawCapsuleCapabilityContract[],
  request: TWidgetBrowserMountRequest,
  createId: () => string,
): readonly CapsuleCapabilityBinding[] {
  return Object.freeze(contracts.map((contract) => {
    if (request.functions === undefined) throw new Error('Widget function authority is unavailable for this mount.');
    return functionBinding(contract.descriptor, request.functions, request, createId);
  }));
}

function guestChannels(
  request: TWidgetBrowserMountRequest,
  contract: Awaited<ReturnType<typeof createOmnidrawGuestChannelContract>> | null,
): CapsuleMountGuestChannels | undefined {
  if (contract === null) return undefined;
  return Object.freeze({
    props: Object.freeze({ schema: contract.declaration.props, initial: request.props ?? {} }),
    theme: Object.freeze({ schema: contract.declaration.theme, initial: request.theme }),
    output: Object.freeze({
      schema: contract.declaration.output,
      onOutput: (value: unknown): void => request.output?.notification(fnOmnidrawWidgetNotificationOutput(value)),
    }),
    ...(contract.declaration.store === undefined ? {} : {
      store: Object.freeze({ schema: contract.declaration.store.schema, maxEntries: contract.declaration.store.maxEntries }),
    }),
  });
}

function mountDiagnostics(handle: CapsuleHandle): ReturnType<IWidgetBrowserMount['diagnostics']> {
  const value = handle.diagnostics();
  return Object.freeze({
    instanceId: value.instanceId,
    artifactHash: value.artifactHash,
    state: value.state,
    generation: value.generation,
    ...(value.viewport.current === undefined ? {} : { viewport: value.viewport.current }),
  });
}

function inspectionController(value: CapsuleAuthoringInspectionController): IWidgetAuthoringInspectionController {
  return Object.freeze({
    query: (request: Parameters<IWidgetAuthoringInspectionController['query']>[0]) => value.query(request),
    visibleSummary: (request: Parameters<IWidgetAuthoringInspectionController['visibleSummary']>[0]) => value.visibleSummary(request),
    validateActionPoint: (targetId: number) => value.validateActionPoint(targetId),
    canvases: (request: Parameters<IWidgetAuthoringInspectionController['canvases']>[0]) => value.canvases(request),
    dispose: () => value.dispose(),
  });
}

type THost = CapsuleHost | CapsuleAuthoringInspectionHost;

export async function createWidgetBrowserHost(
  options: TWidgetBrowserHostOptions,
): Promise<IWidgetBrowserHost> {
  if (options.document === undefined) throw new TypeError('A browser document is required.');
  const runtime = new SdkEffectRuntime();
  const liveHosts = new Set<THost>();
  const liveMounts = new Set<IWidgetBrowserMount>();
  const inFlightMounts = new Set<Promise<unknown>>();
  const inFlightMountControllers = new Set<AbortController>();
  const artifactCacheMaxEntries = options.artifactCache?.maxEntries ?? 16;
  const artifactCache = new CapsuleMemoryArtifactCache({
    maxEntries: artifactCacheMaxEntries,
    maxTotalBytes: options.artifactCache?.maxTotalBytes ?? 64 * 1_024 * 1_024,
    maxArtifactBytes: options.artifactCache?.maxArtifactBytes ?? 16 * 1_024 * 1_024,
  });
  const artifactAdmissions = createArtifactAdmissionCache(
    artifactCache,
    runtime,
    artifactCacheMaxEntries,
  );
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let idSequence = 0;
  let hostCreations = 0;
  const createId = options.createId ?? (() => `widget-invocation-${++idSequence}`);
  const readCatalog = async (): Promise<TWidgetHostConfiguration> => {
    const value = typeof options.catalog === 'function' ? await options.catalog() : options.catalog;
    if (value.allowedApis.length === 0 || value.signingKeys.length === 0) throw new Error('Widget host catalog is empty.');
    return value;
  };

  const validateArtifact = async (input: unknown): Promise<TWidgetBrowserArtifact> => {
    const artifact = captureArtifact(input);
    const digest = options.digestSha256 === undefined
      ? await defaultDigest(artifact.bytes, options.document)
      : await options.digestSha256(artifact.bytes);
    if (!SHA256_PATTERN.test(digest) || digest !== artifact.digestSha256) {
      throw new Error('Widget browser artifact failed digest verification.');
    }
    if (artifact.runtime.artifactHash !== artifact.artifactHash) {
      throw new Error('Widget browser artifact hash does not match runtime metadata.');
    }
    if (
      artifact.runtime.apiContract.format !== CAPSULE_API_GROUP_CONTRACT_FORMAT
      || artifact.runtime.apiContract.bundleDigest !== CAPSULE_API_GROUP_BUNDLE_DIGEST
    ) throw new Error('Widget browser artifact uses an incompatible API contract.');
    return artifact;
  };

  const mountOne = async (
    request: TWidgetBrowserMountRequest,
    authoring: boolean,
  ): Promise<IWidgetBrowserMount | IWidgetBrowserInspectionMount> => {
    if (disposed) throw new Error('The widget browser host is disposed.');
    if (request.signal?.aborted) throw request.signal.reason ?? new Error('Widget mount was aborted.');
    const validatedArtifact = await validateArtifact(request.artifact);
    const artifact: TWidgetBrowserArtifact = request.functionDescriptors === undefined
      ? validatedArtifact
      : Object.freeze({
          ...validatedArtifact,
          functions: WidgetServerFunctionDescriptorsValidator.parse(request.functionDescriptors),
        });
    const catalog = await readCatalog();
    const unsupportedApi = artifact.runtime.apiContract.groups.find((api) => !catalog.allowedApis.includes(api));
    if (unsupportedApi !== undefined) throw new Error(`Widget API group '${unsupportedApi}' is outside host policy.`);
    const keyId = request.mode === 'preview' ? catalog.previewSigningKeyId : catalog.releaseSigningKeyId;
    if (!artifact.runtime.signatureKeyIds.includes(keyId)) throw new Error('Widget artifact lacks the required signing authority.');
    const authority = await signingAuthority(catalog, keyId, options.document);
    const derived = await capabilityContracts(artifact);
    const policy = Object.freeze(derived.contracts.map(({ descriptor }) => Object.freeze({
      effect: 'allow' as const,
      id: descriptor.id,
      versionRange: descriptor.version,
      contractHash: descriptor.contractHash,
      operations: Object.freeze(descriptor.operations.map(({ name }) => name).sort()),
    })));
    const admissionKey = fnArtifactAdmissionKey({
      format: 'omnidraw.capsule-artifact-admission.v1',
      artifact: {
        bytesDigestSha256: artifact.digestSha256,
        artifactHash: artifact.artifactHash,
        apiContract: artifact.runtime.apiContract,
      },
      deployment: { mode: request.mode, catalogGeneration: catalog.generation },
      hostPolicy: {
        allowedApis: artifact.runtime.apiContract.groups,
        limits: catalog.limits,
        capabilities: policy,
        schemas: derived.schemas.map(({ reference }) => reference),
        vm: { mode: 'release', maxJobsPerDrain: 1_000, maxEntryDepth: 32 },
      },
      signaturePolicy: {
        algorithm: 'Ed25519',
        format: 'raw',
        trustedKeyId: authority.keyId,
        trustedKeyBytesHex: authority.publicKeyBytesHex,
        trustedKeyFingerprintSha256: authority.publicKeyFingerprintSha256,
        minimumValidSignatures: 1,
        requiredKeyIds: [keyId],
        rejectUntrustedSignatures: true,
      },
    });
    const hostOptions = {
      allowedApis: artifact.runtime.apiContract.groups,
      limits: catalog.limits,
      capabilities: policy,
      artifactVerification: {
        signaturePolicy: {
          trustedKeys: new Map([[keyId, authority.key]]),
          minimumValidSignatures: 1,
          requiredKeyIds: [keyId],
          rejectUntrustedSignatures: true,
        },
      },
      vm: { mode: 'release' as const, maxJobsPerDrain: 1_000, maxEntryDepth: 32 },
      browserPlatform: createDefaultCapsuleBrowserPlatform({ document: options.document }),
      artifactCache,
      schemas: derived.schemas,
    };
    let admission: TArtifactAdmissionLease | undefined;
    let inspection: ReturnType<typeof createCapsuleAuthoringInspection> | undefined;
    let host: THost | undefined;
    let capabilityBindings: readonly CapsuleCapabilityBinding[] = Object.freeze([]);
    const grants: readonly CapsuleCapabilityGrant[] = Object.freeze(derived.contracts.map(({ grant }) => grant));
    let raw: CapsuleHandle | undefined;
    let stopAbort = (): void => undefined;
    let stopRuntimeErrors = (): void => undefined;
    const assertMountActive = (): void => {
      if (disposed) throw new Error('The widget browser host is disposed.');
      if (request.signal?.aborted) throw request.signal.reason ?? new Error('Widget mount was aborted.');
    };
    try {
      admission = await artifactAdmissions.acquire({
        admissionKey,
        artifactHash: artifact.artifactHash,
        artifactBytes: artifact.bytes,
        signal: request.signal,
      });
      assertMountActive();
      const prepareAttempt = async (): Promise<void> => {
        assertMountActive();
        inspection = authoring
          ? createCapsuleAuthoringInspection({ maxResults: 128, maxSummaryResults: 128, maxCanvases: 16 })
          : undefined;
        host = authoring
          ? await createCapsuleAuthoringInspectionHost(hostOptions)
          : await createCapsuleHost(hostOptions);
        hostCreations += 1;
        liveHosts.add(host);
        const attemptHost = host;
        const startupAbort = (): void => { void attemptHost.destroy(); };
        request.signal?.addEventListener('abort', startupAbort, { once: true });
        stopAbort = () => request.signal?.removeEventListener('abort', startupAbort);
        assertMountActive();
        for (const { descriptor } of derived.contracts) host.registerCapabilityDescriptor(descriptor);
        capabilityBindings = bindings(derived.contracts, request, createId);
      };
      const retireFailedAttempt = async (): Promise<void> => {
        stopAbort();
        stopAbort = () => undefined;
        inspection?.dispose();
        inspection = undefined;
        for (const binding of capabilityBindings) {
          await Promise.resolve(binding.dispose()).catch(() => undefined);
        }
        capabilityBindings = Object.freeze([]);
        await host?.destroy().catch(() => undefined);
        if (host !== undefined) liveHosts.delete(host);
        host = undefined;
      };
      await prepareAttempt();
      const report = (event: CapsuleMountErrorEvent): void => {
        const mapped = fnCapsuleMountErrorDiagnostic(event);
        try { request.onDiagnostic?.(mapped); } catch { /* Observers cannot affect the runtime. */ }
        if (mapped.fatal) {
          try { request.onFatal?.(mapped); } catch { /* Observers cannot affect cleanup. */ }
        }
      };
      const mountArtifact = async (
        source: Readonly<Uint8Array> | Readonly<{ hash: typeof artifact.artifactHash }>,
      ): Promise<CapsuleHandle> => authoring
        ? (host as CapsuleAuthoringInspectionHost).mount({
            artifact: source,
            container: request.container,
            capabilityBindings,
            grants,
            guestChannels: guestChannels(request, derived.channels),
            restoreSnapshot: request.restoreSnapshot,
            visualConfinement: 'strict',
            authoringInspection: inspection!.attachment,
            // This listener covers startup before Capsule can return a handle.
            onError: report,
          })
        : (host as CapsuleHost).mount({
            artifact: source,
            container: request.container,
            capabilityBindings,
            grants,
            guestChannels: guestChannels(request, derived.channels),
            restoreSnapshot: request.restoreSnapshot,
            visualConfinement: 'strict',
            // This listener covers startup before Capsule can return a handle.
            onError: report,
          });
      try {
        raw = await mountArtifact(admission.cached
          ? Object.freeze({ hash: artifact.artifactHash })
          : artifact.bytes);
      } catch (error) {
        if (!(
          admission.cached
          && error instanceof CapsuleHostError
          && (error.code === 'ARTIFACT_CACHE_MISS' || error.code === 'ARTIFACT_REJECTED')
        )) throw error;
        // The bounded shared cache may evict between admission and Capsule's
        // lookup. Capsule consumes mount-local bindings on failure, so retry
        // only through a completely fresh isolated host transaction.
        await retireFailedAttempt();
        await prepareAttempt();
        raw = await mountArtifact(artifact.bytes);
      }
      assertMountActive();
      const runtimeErrorSubscription = raw.onError(report);
      let runtimeErrorsSubscribed = true;
      stopRuntimeErrors = () => {
        if (!runtimeErrorsSubscribed) return;
        runtimeErrorsSubscribed = false;
        runtimeErrorSubscription.unsubscribe();
      };
      if (raw.diagnostics().artifactHash !== artifact.artifactHash) {
        throw new Error('Mounted widget artifact hash does not match runtime metadata.');
      }
      raw.setViewport(request.viewport);
      assertMountActive();
      // Admission covers successful Capsule verification and initial lifecycle
      // publication, never merely an SDK digest check.
      admission.succeed();
      let finished = false;
      let disposal: Promise<void> | undefined;
      const mounted = raw;
      const mountedHost = host;
      if (mountedHost === undefined) throw new Error('Capsule host creation did not complete.');
      const base: IWidgetBrowserMount = Object.freeze({
        ready: () => mounted.ready(),
        setProps: (value: Parameters<IWidgetBrowserMount['setProps']>[0]) => mounted.setProps(value),
        setTheme: (value: Parameters<IWidgetBrowserMount['setTheme']>[0]) => mounted.setTheme(value),
        setViewport: (value: TWidgetViewport) => mounted.setViewport(value),
        focus: (focusOptions?: FocusOptions) => mounted.focus(focusOptions),
        setSchedulingMode: (mode: 'active' | 'throttled') => mounted.setSchedulingMode(mode),
        freeze: async (reason?: string) => { await mounted.freeze(reason); },
        resume: (reason?: string) => mounted.resume({ ...(reason === undefined ? {} : { reason }), schedulingMode: 'active' }),
        snapshot: (reason?: string) => mounted.snapshot(reason === undefined ? {} : { reason }),
        diagnostics: () => mountDiagnostics(mounted),
        dispose(reason?: string): Promise<void> {
          if (disposal !== undefined) return disposal;
          finished = true;
          stopAbort();
          stopRuntimeErrors();
          disposal = mounted.destroy(reason).catch(() => undefined).then(async () => {
            inspection?.dispose();
            await mountedHost.destroy().catch(() => undefined);
            liveHosts.delete(mountedHost);
            liveMounts.delete(base);
          });
          return disposal;
        },
      });
      stopAbort();
      const onAbort = (): void => { void base.dispose('aborted'); };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      stopAbort = () => request.signal?.removeEventListener('abort', onAbort);
      if (request.signal?.aborted) onAbort();
      if (!finished) liveMounts.add(base);
      if (!authoring) return base;
      return Object.freeze({ ...base, inspection: inspectionController(inspection!) });
    } catch (error) {
      admission?.fail(error);
      stopAbort();
      stopRuntimeErrors();
      await raw?.destroy('mount-failed').catch(() => undefined);
      inspection?.dispose();
      for (const binding of capabilityBindings) await Promise.resolve(binding.dispose()).catch(() => undefined);
      await host?.destroy().catch(() => undefined);
      if (host !== undefined) liveHosts.delete(host);
      if (error instanceof CapsuleHostError) throw safeHostFailure(error);
      throw error;
    }
  };

  const trackedMount = <T extends IWidgetBrowserMount>(
    request: TWidgetBrowserMountRequest,
    authoring: boolean,
  ): Promise<T> => {
    const controller = new AbortController();
    inFlightMountControllers.add(controller);
    const signal = request.signal === undefined
      ? controller.signal
      : AbortSignal.any([request.signal, controller.signal]);
    const trackedRequest = Object.freeze({ ...request, signal });
    let operation: Promise<T>;
    operation = (mountOne(trackedRequest, authoring) as Promise<T>).finally(() => {
      inFlightMountControllers.delete(controller);
      inFlightMounts.delete(operation);
    });
    inFlightMounts.add(operation);
    return operation;
  };

  return Object.freeze({
    validateArtifact,
    mount: (request: TWidgetBrowserMountRequest) => trackedMount<IWidgetBrowserMount>(request, false),
    inspect: (request: TWidgetBrowserMountRequest) => trackedMount<IWidgetBrowserInspectionMount>(request, true),
    diagnostics: () => Object.freeze({
      liveHosts: liveHosts.size,
      liveMounts: liveMounts.size,
      hostCreations,
      artifactCache: Object.freeze({ ...artifactCache.diagnostics() }),
      pendingArtifactAdmissions: artifactAdmissions.diagnostics().pendingAdmissions,
    }),
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      disposed = true;
      // Interrupt every operation before awaiting it; some Capsule startup
      // paths settle only after their isolated host is destroyed.
      for (const controller of inFlightMountControllers) {
        controller.abort(new Error('The widget browser host is disposed.'));
      }
      artifactAdmissions.clear();
      disposal = (async () => {
        await Promise.allSettled([...inFlightMounts]);
        await Promise.all([...liveMounts].map((value) => value.dispose('host-disposed')));
        await Promise.all([...liveHosts].map((value) => value.destroy().catch(() => undefined)));
        liveHosts.clear();
        liveMounts.clear();
        await runtime.dispose();
      })();
      return disposal;
    },
  });
}
