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
  type CapsuleKernelHostStream,
  type CapsuleKernelHostStreamSink,
  type CapsuleKernelStreamCancelReason,
  type CapsuleKernelStreamContext,
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
  IWidgetStateHostPort,
  TWidgetBrowserHostOptions,
  TWidgetBrowserMountRequest,
} from '../contracts/interface';
import {
  WidgetBrowserFunctionDescriptorsValidator,
  WidgetRuntimeDescriptorValidator,
} from '../contracts/schema';
import type {
  TWidgetBrowserArtifact,
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapabilityRequest,
  TWidgetHostConfiguration,
  TWidgetHostDiagnostic,
  TWidgetSerializableJsonValue,
  TWidgetStateSnapshot,
  TWidgetViewport,
} from '../contracts/types';
import {
  fnWidgetBrowserFunctionCapabilityRequestMatches,
} from '../contracts/core/fn.function-descriptor';
import { SdkEffectRuntime } from './effect-runtime';
import { WidgetHostError } from '../host-error';
import {
  createOmnidrawCollaborativeStateCapabilityContract,
  createOmnidrawGuestChannelContract,
  createOmnidrawServerFunctionCapabilityContract,
} from './capsule/create-capability-contracts';
import {
  OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
} from './capsule/CONSTANTS';
import { fnOmnidrawWidgetNotificationOutput } from './capsule/fn.channel-values';
import type { TOmnidrawCapsuleCapabilityContract } from './capsule/types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const input = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(input).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(input[key])}`
  )).join(',')}}`;
}

function diagnosticCategory(event: CapsuleMountErrorEvent): TWidgetHostDiagnostic['category'] {
  if (['PAYLOAD_LIMIT', 'RATE_LIMIT', 'CONCURRENCY_LIMIT', 'DEADLINE_EXCEEDED', 'STREAM_OVERFLOW', 'HANDLE_LIMIT', 'HANDLE_QUOTA'].includes(event.code)) {
    return 'budget';
  }
  switch (event.category) {
    case 'capability': return 'capability';
    case 'lifecycle': return 'lifecycle';
    case 'vm': return 'guest';
    case 'dom':
    case 'host': return 'host';
  }
}

function safeDiagnostic(event: CapsuleMountErrorEvent): TWidgetHostDiagnostic {
  const category = diagnosticCategory(event);
  const message = category === 'budget'
    ? 'The widget exceeded a browser runtime budget.'
    : category === 'capability'
      ? 'A widget capability was denied or failed.'
      : category === 'guest'
        ? 'The widget runtime failed.'
        : category === 'lifecycle'
          ? 'The widget lifecycle operation failed.'
          : category === 'internal'
            ? 'The browser widget runtime failed safely.'
            : 'The browser widget host rejected the operation.';
  const details = event as unknown as Readonly<Record<string, unknown>>;
  return Object.freeze({
    format: 'omnidraw.widget-host-diagnostic.v1',
    phase: 'runtime',
    category,
    code: event.code,
    fatal: event.fatal,
    message,
    ...(typeof details.capabilityId === 'string' ? { capability: details.capabilityId } : {}),
    ...(typeof details.operation === 'string' ? { operation: details.operation } : {}),
  });
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

async function signingKeys(
  catalog: TWidgetHostConfiguration,
  document: Document,
): Promise<ReadonlyMap<string, CryptoKey>> {
  const subtle = document.defaultView?.crypto.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('Web Crypto is required to verify widget artifacts.');
  const entries = await Promise.all(catalog.signingKeys.map(async (key) => {
    if (key.algorithm !== 'Ed25519' || key.format !== 'raw') {
      throw new Error(`Widget signing key '${key.keyId}' uses an unsupported format.`);
    }
    const imported = await subtle.importKey(
      'raw',
      ownedBuffer(base64Bytes(key.publicKeyBase64, document.defaultView)),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return [key.keyId, imported] as const;
  }));
  return new Map(entries);
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
    functions: WidgetBrowserFunctionDescriptorsValidator.parse(value.functions ?? []),
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
  const requests = artifact.runtime.capabilityRequests;
  const collaborativeRequest = requests.find(({ id }) => id === OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID);
  const functionRequests = requests.filter(({ id }) => id !== OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID);
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
  const collaborativeContract = collaborativeRequest === undefined
    ? null
    : await createOmnidrawCollaborativeStateCapabilityContract();
  if (collaborativeContract !== null && !requestsMatch(collaborativeContract.request, collaborativeRequest!)) {
    throw new Error('Widget state capability contract is inconsistent with the artifact.');
  }
  const channels = artifact.runtime.channels === null ? null : await createOmnidrawGuestChannelContract({
    localStore: artifact.runtime.channels.store === undefined ? 'none' : 'ephemeral',
  });
  if (channels !== null && canonicalJson(channels.declaration) !== canonicalJson(artifact.runtime.channels)) {
    throw new Error('Widget guest channels are inconsistent with the artifact.');
  }
  const contracts = [functionContract, collaborativeContract].filter(
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

class WidgetStateStream implements CapsuleKernelHostStream {
  readonly #port: IWidgetStateHostPort;
  readonly #subject: TWidgetBrowserMountRequest['subject'];
  readonly #runtime: SdkEffectRuntime;
  #sink: CapsuleKernelHostStreamSink | undefined;
  #iterator: AsyncIterator<import('../contracts/types').TWidgetStateEvent> | undefined;
  #version = 0;
  #initialized = false;
  #demand = 0;
  #active = true;
  #pumping = false;
  #cancelTask = (): void => undefined;

  constructor(port: IWidgetStateHostPort, subject: TWidgetBrowserMountRequest['subject'], runtime: SdkEffectRuntime) {
    this.#port = port;
    this.#subject = subject;
    this.#runtime = runtime;
  }

  start(sink: CapsuleKernelHostStreamSink): void {
    if (this.#sink !== undefined) throw new Error('Widget state stream cannot start twice.');
    this.#sink = sink;
    this.#pump();
  }

  request(demand: Readonly<{ events: number; bytes: number }>): void {
    if (!this.#active) return;
    this.#demand = Math.min(Number.MAX_SAFE_INTEGER, this.#demand + demand.events);
    this.#pump();
  }

  cancel(_reason: CapsuleKernelStreamCancelReason): void {
    if (!this.#active) return;
    this.#active = false;
    this.#cancelTask();
    void this.#iterator?.return?.();
  }

  #pump(): void {
    if (!this.#active || this.#pumping || this.#sink === undefined || this.#demand < 1) return;
    this.#pumping = true;
    this.#cancelTask = this.#runtime.fork(async (signal) => {
      try {
        if (!this.#initialized && this.#demand > 0) {
          const snapshot = await this.#port.get(this.#subject, { signal });
          if (!this.#active) return;
          this.#version = snapshot.version;
          this.#initialized = true;
          this.#demand -= 1;
          if (await this.#sink!.event(snapshot) === 'rejected') return this.cancel({ code: 'overflow' });
        }
        if (this.#iterator === undefined) {
          this.#iterator = this.#port.events(this.#subject, this.#version, { signal })[Symbol.asyncIterator]();
        }
        while (this.#active && this.#demand > 0) {
          const next = await this.#iterator.next();
          if (next.done) { this.#sink?.close(); this.cancel({ code: 'provider-failure' }); return; }
          const snapshot = next.value.snapshot;
          if (snapshot.version <= this.#version) throw new Error('Widget state event version did not advance.');
          this.#version = snapshot.version;
          this.#demand -= 1;
          if (await this.#sink!.event(snapshot) === 'rejected') return this.cancel({ code: 'overflow' });
        }
      } finally {
        this.#pumping = false;
        this.#pump();
      }
    }, () => {
      if (!this.#active) return;
      this.#sink?.error();
      this.cancel({ code: 'provider-failure' });
    });
  }
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

function stateBinding(
  descriptor: CapsuleCapabilityDescriptor,
  port: IWidgetStateHostPort,
  request: TWidgetBrowserMountRequest,
  runtime: SdkEffectRuntime,
): CapsuleCapabilityBinding {
  let disposed = false;
  let latest: TWidgetStateSnapshot | undefined;
  const streams = new Set<WidgetStateStream>();
  return Object.freeze({
    descriptor,
    async invoke(context: CapsuleKernelCallContext, operation: string, input: unknown): Promise<unknown> {
      if (disposed) throw new Error('Widget state provider is disposed.');
      if (operation === 'get') {
        if (input !== null) throw new TypeError('Widget state get input is invalid.');
        latest = await port.get(request.subject, { signal: context.signal });
        return latest;
      }
      if (operation === 'change') {
        if (input === null || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, 'value')) {
          throw new TypeError('Widget state change input is invalid.');
        }
        latest ??= await port.get(request.subject, { signal: context.signal });
        latest = await port.change(
          request.subject,
          latest.version,
          (input as Readonly<{ value: TWidgetSerializableJsonValue }>).value,
          { signal: context.signal },
        );
        return latest;
      }
      throw new Error('Widget state operation is unavailable.');
    },
    openStream(_context: CapsuleKernelStreamContext, operation: string, input: unknown): CapsuleKernelHostStream {
      if (disposed) throw new Error('Widget state provider is disposed.');
      if (operation !== 'subscribe' || input !== null) throw new TypeError('Widget state stream request is invalid.');
      const stream = new WidgetStateStream(port, request.subject, runtime);
      streams.add(stream);
      return stream;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const stream of streams) stream.cancel({ code: 'destroy' });
      streams.clear();
      void port.dispose?.();
    },
  });
}

function bindings(
  contracts: readonly TOmnidrawCapsuleCapabilityContract[],
  request: TWidgetBrowserMountRequest,
  runtime: SdkEffectRuntime,
  createId: () => string,
): readonly CapsuleCapabilityBinding[] {
  return Object.freeze(contracts.map((contract) => {
    if (contract.descriptor.id === OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID) {
      if (request.state === undefined) throw new Error('Widget state authority is unavailable for this mount.');
      return stateBinding(contract.descriptor, request.state, request, runtime);
    }
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
  let disposed = false;
  let idSequence = 0;
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

  const mount = async (
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
          functions: WidgetBrowserFunctionDescriptorsValidator.parse(request.functionDescriptors),
        });
    const catalog = await readCatalog();
    const unsupportedApi = artifact.runtime.apiContract.groups.find((api) => !catalog.allowedApis.includes(api));
    if (unsupportedApi !== undefined) throw new Error(`Widget API group '${unsupportedApi}' is outside host policy.`);
    const keyId = request.mode === 'preview' ? catalog.previewSigningKeyId : catalog.releaseSigningKeyId;
    if (!artifact.runtime.signatureKeyIds.includes(keyId)) throw new Error('Widget artifact lacks the required signing authority.');
    const keys = await signingKeys(catalog, options.document);
    const key = keys.get(keyId);
    if (key === undefined) throw new Error('Widget artifact signing authority is unavailable.');
    const derived = await capabilityContracts(artifact);
    const policy = Object.freeze(derived.contracts.map(({ descriptor }) => Object.freeze({
      effect: 'allow' as const,
      id: descriptor.id,
      versionRange: descriptor.version,
      contractHash: descriptor.contractHash,
      operations: Object.freeze(descriptor.operations.map(({ name }) => name).sort()),
    })));
    const hostOptions = {
      allowedApis: artifact.runtime.apiContract.groups,
      limits: catalog.limits,
      capabilities: policy,
      artifactVerification: {
        signaturePolicy: {
          trustedKeys: new Map([[keyId, key]]),
          minimumValidSignatures: 1,
          requiredKeyIds: [keyId],
          rejectUntrustedSignatures: true,
        },
      },
      vm: { mode: 'release' as const, maxJobsPerDrain: 1_000, maxEntryDepth: 32 },
      browserPlatform: createDefaultCapsuleBrowserPlatform({ document: options.document }),
      artifactCache: new CapsuleMemoryArtifactCache({
        maxEntries: options.artifactCache?.maxEntries ?? 16,
        maxTotalBytes: options.artifactCache?.maxTotalBytes ?? 64 * 1_024 * 1_024,
        maxArtifactBytes: options.artifactCache?.maxArtifactBytes ?? 16 * 1_024 * 1_024,
      }),
      schemas: derived.schemas,
    };
    const inspection = authoring ? createCapsuleAuthoringInspection({ maxResults: 128, maxSummaryResults: 128, maxCanvases: 16 }) : undefined;
    const host: THost = authoring
      ? await createCapsuleAuthoringInspectionHost(hostOptions)
      : await createCapsuleHost(hostOptions);
    liveHosts.add(host);
    for (const { descriptor } of derived.contracts) host.registerCapabilityDescriptor(descriptor);
    const capabilityBindings = bindings(derived.contracts, request, runtime, createId);
    const grants: readonly CapsuleCapabilityGrant[] = Object.freeze(derived.contracts.map(({ grant }) => grant));
    let raw: CapsuleHandle | undefined;
    let stopAbort = (): void => undefined;
    try {
      const report = (event: CapsuleMountErrorEvent): void => {
        const mapped = safeDiagnostic(event);
        try { request.onDiagnostic?.(mapped); } catch { /* Observers cannot affect the runtime. */ }
        if (mapped.fatal) {
          try { request.onFatal?.(mapped); } catch { /* Observers cannot affect cleanup. */ }
        }
      };
      raw = authoring
        ? await (host as CapsuleAuthoringInspectionHost).mount({
            artifact: artifact.bytes,
            container: request.container,
            capabilityBindings,
            grants,
            guestChannels: guestChannels(request, derived.channels),
            restoreSnapshot: request.restoreSnapshot,
            visualConfinement: 'strict',
            authoringInspection: inspection!.attachment,
            // Capsule retains this listener for the mounted handle. Registering
            // it again through `raw.onError` would duplicate every later event.
            onError: report,
          })
        : await (host as CapsuleHost).mount({
            artifact: artifact.bytes,
            container: request.container,
            capabilityBindings,
            grants,
            guestChannels: guestChannels(request, derived.channels),
            restoreSnapshot: request.restoreSnapshot,
            visualConfinement: 'strict',
            // This is the single error subscription for the mount lifetime.
            onError: report,
          });
      if (raw.diagnostics().artifactHash !== artifact.artifactHash) {
        throw new Error('Mounted widget artifact hash does not match runtime metadata.');
      }
      raw.setViewport(request.viewport);
      let finished = false;
      let disposal: Promise<void> | undefined;
      const mounted = raw;
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
          disposal = mounted.destroy(reason).catch(() => undefined).then(async () => {
            inspection?.dispose();
            await host.destroy().catch(() => undefined);
            liveHosts.delete(host);
            liveMounts.delete(base);
          });
          return disposal;
        },
      });
      const onAbort = (): void => { void base.dispose('aborted'); };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      stopAbort = () => request.signal?.removeEventListener('abort', onAbort);
      if (request.signal?.aborted) onAbort();
      if (!finished) liveMounts.add(base);
      if (!authoring) return base;
      return Object.freeze({ ...base, inspection: inspectionController(inspection!) });
    } catch (error) {
      stopAbort();
      await raw?.destroy('mount-failed').catch(() => undefined);
      inspection?.dispose();
      for (const binding of capabilityBindings) await Promise.resolve(binding.dispose()).catch(() => undefined);
      await host.destroy().catch(() => undefined);
      liveHosts.delete(host);
      if (error instanceof CapsuleHostError) throw safeHostFailure(error);
      throw error;
    }
  };

  return Object.freeze({
    validateArtifact,
    mount: (request: TWidgetBrowserMountRequest) => mount(request, false) as Promise<IWidgetBrowserMount>,
    inspect: (request: TWidgetBrowserMountRequest) => mount(request, true) as Promise<IWidgetBrowserInspectionMount>,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await Promise.all([...liveMounts].map((value) => value.dispose('host-disposed')));
      await Promise.all([...liveHosts].map((value) => value.destroy().catch(() => undefined)));
      liveHosts.clear();
      liveMounts.clear();
      await runtime.dispose();
    },
  });
}
