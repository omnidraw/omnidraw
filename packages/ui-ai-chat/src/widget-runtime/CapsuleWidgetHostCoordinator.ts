import {
  CAPSULE_MOUNT_ERROR_FORMAT,
  CapsuleHostError,
  CapsuleMemoryArtifactCache,
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
  fnMapCapsuleMountError,
  fnMapThrownCapsuleHostError,
  type CapsuleCapabilityBinding,
  type CapsuleHandle,
  type CapsuleHost,
  type CapsuleMountErrorEvent,
  type CapsuleMountGuestChannels,
  type CapsuleViewport,
} from '@vibecanvas/capsule-vibecanvas/host';
import { originalPositionFor } from '@jridgewell/trace-mapping';
import type {
  TVibecanvasCapsuleError,
} from '@vibecanvas/capsule-vibecanvas/contract';
import type {
  CapsuleCapabilityGrant,
} from '@vibecanvas/capsule-vibecanvas/capabilities';
import {
  fnAssertWidgetCapsuleRuntimeCompatible,
  fnResolveWidgetCapsuleCapabilities,
  fnValidateWidgetCapsuleHostCatalog,
  fnValidateWidgetCapsuleMountCatalog,
} from './fn.capsule-catalog';
import { fnRuntimeDiagnosticSource } from './fn.runtime-diagnostic-source';
import type { TWidgetCapsuleApiGroup } from '@vibecanvas/widget-contract';
import type {
  TWidgetArtifactRuntimeIdentity,
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleHostFactory,
  TWidgetCapsuleMountCatalog,
  TWidgetUiRuntimeHandle,
  TVerifiedWidgetSourceMapArtifact,
  TVerifiedWidgetUiArtifact,
} from './interface';

type TCapsuleWidgetHostCoordinatorConfig = Readonly<{
  document: Document;
  catalog(): TWidgetCapsuleHostCatalog | Promise<TWidgetCapsuleHostCatalog>;
  hostFactory?: TWidgetCapsuleHostFactory;
  artifactCache?: Readonly<{
    maxEntries?: number;
    maxTotalBytes?: number;
    maxArtifactBytes?: number;
  }>;
}>;

type TMountArgs = Readonly<{
  mode: 'preview' | 'published';
  identity: TWidgetArtifactRuntimeIdentity;
  catalog: TWidgetCapsuleMountCatalog;
  artifact: TVerifiedWidgetUiArtifact;
  sourceMapArtifact?: TVerifiedWidgetSourceMapArtifact;
  container: HTMLElement;
  capabilityBindings: readonly CapsuleCapabilityBinding[];
  guestChannels?: CapsuleMountGuestChannels;
  onDiagnostic?(error: TVibecanvasCapsuleError): void;
  onFatal(error: unknown): void;
}>;

type THostState = {
  poolKey: string;
  apis: readonly TWidgetCapsuleApiGroup[];
  signingKeyId: string;
  generation: string;
  host: CapsuleHost;
  activeHandles: number;
};

const WIDGET_CAPSULE_INVALIDATE = Symbol('widget-capsule-invalidate');

type TCoordinatedWidgetUiRuntimeHandle = TWidgetUiRuntimeHandle & Readonly<{
  [WIDGET_CAPSULE_INVALIDATE](reason: string): Promise<void>;
}>;

const DEFAULT_HOST_FACTORY: TWidgetCapsuleHostFactory = Object.freeze({
  create: createCapsuleHost,
});

function catalogSignature(catalog: TWidgetCapsuleHostCatalog): string {
  return JSON.stringify({
    generation: catalog.generation,
    allowedApis: catalog.allowedApis,
    limits: catalog.limits,
    signingKeyIds: [...catalog.trustedSigningKeys.keys()].sort(),
    previewSigningKeyId: catalog.previewSigningKeyId,
    releaseSigningKeyId: catalog.releaseSigningKeyId,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function capabilityBindingsMatch(
  bindings: readonly CapsuleCapabilityBinding[],
  expectedDescriptors: ReadonlyMap<string, CapsuleCapabilityBinding['descriptor']>,
): boolean {
  if (bindings.length !== expectedDescriptors.size) return false;
  const bindingIds = new Set(bindings.map((binding) => binding.descriptor.id));
  if (bindingIds.size !== bindings.length) return false;
  return bindings.every((binding) => {
    const expected = expectedDescriptors.get(binding.descriptor.id);
    return expected !== undefined
      && canonicalJson(binding.descriptor) === canonicalJson(expected);
  });
}

function mountPolicySignature(catalog: TWidgetCapsuleMountCatalog): string {
  return canonicalJson({
    schemas: catalog.schemas.map((schema) => schema.reference.hash).sort(),
    capabilities: catalog.capabilities.map(({ kind, descriptor }) => ({
      kind,
      descriptor,
    })).sort((left, right) => (
      left.descriptor.id < right.descriptor.id
        ? -1
        : left.descriptor.id > right.descriptor.id
          ? 1
          : 0
    )),
  });
}

function hostPoolKey(
  apis: readonly TWidgetCapsuleApiGroup[],
  signingKeyId: string,
  policySignature: string,
): string {
  return canonicalJson({
    apis,
    signingKeyId,
    policySignature,
  });
}

function hostCapabilityPolicy(catalog: TWidgetCapsuleMountCatalog) {
  return Object.freeze(catalog.capabilities.map(({ descriptor }) => Object.freeze({
    effect: 'allow' as const,
    id: descriptor.id,
    versionRange: descriptor.version,
    contractHash: descriptor.contractHash,
    operations: Object.freeze(descriptor.operations.map((operation) => operation.name).sort()),
  })));
}

function idempotentHandle(
  handle: CapsuleHandle,
  mapError: (
    event: CapsuleMountErrorEvent,
    lifecycleGeneration: number,
  ) => TVibecanvasCapsuleError,
  onFatal: (error: unknown) => void,
  onDiagnostic: ((error: TVibecanvasCapsuleError) => void) | undefined,
  onDestroyed: () => void | Promise<void>,
): TCoordinatedWidgetUiRuntimeHandle {
  let destroyed = false;
  let destroyOperation: Promise<void> | undefined;
  const errorSubscription = handle.onError((event) => {
    if (destroyed) return;
    const mapped = mapError(event, handle.diagnostics().generation);
    if (!event.fatal) {
      try {
        onDiagnostic?.(mapped);
      } catch {
        // A diagnostic observer cannot affect the live Capsule handle.
      }
      return;
    }
    try {
      onFatal(mapped);
    } finally {
      void destroy('capsule-fatal-error');
    }
  });

  const destroy = (reason?: string): Promise<void> => {
    if (destroyOperation !== undefined) return destroyOperation;
    destroyed = true;
    errorSubscription.unsubscribe();
    destroyOperation = handle.destroy(reason).finally(onDestroyed);
    return destroyOperation;
  };

  return Object.freeze({
    [WIDGET_CAPSULE_INVALIDATE](reason: string): Promise<void> {
      if (!destroyed) {
        try {
          onFatal(Object.assign(
            new Error('Widget Capsule host catalog changed.'),
            {
              code: 'WIDGET_CAPSULE_CATALOG_INVALIDATED',
              reason,
            },
          ));
        } catch {
          // A consumer error observer cannot block terminal host retirement.
        }
      }
      return destroy(reason);
    },
    ready: () => handle.ready(),
    setProps(value: unknown): void {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      handle.setProps(value);
    },
    setTheme(value: unknown): void {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      handle.setTheme(value);
    },
    setViewport(value: CapsuleViewport): void {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      handle.setViewport(value);
    },
    focus(options?: FocusOptions): void {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      handle.focus(options);
    },
    async setSchedulingMode(mode: 'active' | 'throttled'): Promise<void> {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      await handle.setSchedulingMode(mode);
    },
    async freeze(reason?: string): Promise<void> {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      await handle.freeze(reason);
    },
    async resume(reason?: string): Promise<void> {
      if (destroyed) throw new Error('Widget Capsule handle is destroyed.');
      await handle.resume({
        ...(reason === undefined ? {} : { reason }),
        schedulingMode: 'active',
      });
    },
    diagnostics: () => handle.diagnostics(),
    destroy,
  });
}

function eventMapper(args: TMountArgs): (
  event: CapsuleMountErrorEvent,
  lifecycleGeneration?: number,
) => TVibecanvasCapsuleError {
  let runtimeGeneration: number | undefined;
  return (event, lifecycleGeneration) => {
    const mapped = fnMapCapsuleMountError(event);
    if (
      args.mode !== 'preview'
      || !('kind' in args.identity)
      || args.identity.kind !== 'draft_preview'
      || event.format !== CAPSULE_MOUNT_ERROR_FORMAT
      || event.category !== 'vm'
      || event.artifactHash !== args.artifact.capsuleArtifactHash
      || !Number.isSafeInteger(event.runtimeGeneration)
      || event.runtimeGeneration < 1
      || !Number.isSafeInteger(event.lifecycleGeneration)
      || event.lifecycleGeneration < 1
      || (
        lifecycleGeneration !== undefined
        && event.lifecycleGeneration !== lifecycleGeneration
      )
      || (
        runtimeGeneration !== undefined
        && event.runtimeGeneration !== runtimeGeneration
      )
    ) return mapped;
    runtimeGeneration ??= event.runtimeGeneration;
    const retained = args.sourceMapArtifact;
    const location = event.location;
    if (
      retained === undefined
      || retained.capsuleArtifactHash !== args.artifact.capsuleArtifactHash
      || retained.sourceRevision !== args.identity.revision
      || location === undefined
    ) return mapped;
    const sourceMap = retained.maps.find(({ module }) => module === location.module);
    if (sourceMap === undefined) return mapped;
    const authored = fnRuntimeDiagnosticSource({
      generated: location,
      authoredPaths: retained.authoredPaths,
      trace(generated) {
        try {
          const original = originalPositionFor(
            sourceMap.traceMap,
            { line: generated.line, column: generated.column },
          );
          return Object.freeze({
            source: original.source,
            line: original.line,
            column: original.column,
          });
        } catch {
          return null;
        }
      },
    });
    return authored === null
      ? mapped
      : Object.freeze({ ...mapped, ...authored });
  };
}

/**
 * Owns one generation-scoped pool of shared Capsule hosts keyed by exact
 * public API contract, signing authority, and locally derived capability
 * policy. Idle policy partitions are retired when their last handle is
 * destroyed. Deployment-catalog changes are terminal for the whole pool.
 */
export class CapsuleWidgetHostCoordinator {
  readonly #config: TCapsuleWidgetHostCoordinatorConfig;
  readonly #hostFactory: TWidgetCapsuleHostFactory;
  readonly #handles = new Set<TCoordinatedWidgetUiRuntimeHandle>();
  readonly #states = new Map<string, THostState>();
  #generation: string | undefined;
  #stateSignature: string | undefined;
  #transition: Promise<void> = Promise.resolve();
  #destroyed = false;

  constructor(config: TCapsuleWidgetHostCoordinatorConfig) {
    this.#config = config;
    this.#hostFactory = config.hostFactory ?? DEFAULT_HOST_FACTORY;
  }

  async catalog(): Promise<TWidgetCapsuleHostCatalog> {
    const catalog = await this.#config.catalog();
    fnValidateWidgetCapsuleHostCatalog(catalog);
    return catalog;
  }

  mount(args: TMountArgs): Promise<TWidgetUiRuntimeHandle> {
    return this.#serialize(async () => {
      if (this.#destroyed) throw new Error('Widget Capsule host coordinator is destroyed.');
      const currentCatalog = await this.catalog();
      const catalog = args.catalog;
      fnValidateWidgetCapsuleMountCatalog(catalog);
      if (catalogSignature(catalog) !== catalogSignature(currentCatalog)) {
        throw new Error('Widget Capsule catalog changed while the mount was being prepared.');
      }
      fnAssertWidgetCapsuleRuntimeCompatible(
        catalog,
        args.artifact.runtimeDescriptor,
        args.mode,
      );
      const resolved = fnResolveWidgetCapsuleCapabilities(
        catalog,
        args.artifact.runtimeDescriptor.capabilityRequests,
      );
      const expectedDescriptors = new Map(resolved.map(({ catalogEntry }) => [
        catalogEntry.descriptor.id,
        catalogEntry.descriptor,
      ]));
      if (!capabilityBindingsMatch(args.capabilityBindings, expectedDescriptors)) {
        throw new Error('Widget Capsule capability bindings do not match the signed request.');
      }

      const requestedApis = args.artifact.runtimeDescriptor.apiContract.groups;
      const state = await this.#ensureHost(catalog, requestedApis, args.mode);
      const grants: readonly CapsuleCapabilityGrant[] = Object.freeze(
        resolved.map(({ grant }) => grant),
      );
      let rawHandle: CapsuleHandle | undefined;
      let logicalHandle: TCoordinatedWidgetUiRuntimeHandle | undefined;
      const mapError = eventMapper(args);
      const observeStartupError = (event: CapsuleMountErrorEvent): void => {
        const mapped = mapError(event);
        try {
          if (event.fatal) args.onFatal(mapped);
          else args.onDiagnostic?.(mapped);
        } catch {
          // Startup observers cannot affect Capsule's mount settlement.
        }
      };
      try {
        rawHandle = await state.host.mount({
          artifact: Uint8Array.from(args.artifact.bytes),
          container: args.container,
          capabilityBindings: args.capabilityBindings,
          grants,
          onError: observeStartupError,
          ...(args.guestChannels === undefined
            ? {}
            : { guestChannels: args.guestChannels }),
        });
        const diagnostics = rawHandle.diagnostics();
        if (diagnostics.artifactHash !== args.artifact.capsuleArtifactHash) {
          const rejectedHandle = rawHandle;
          rawHandle = undefined;
          await rejectedHandle.destroy('artifact-hash-mismatch').catch(() => undefined);
          throw new Error('Mounted Capsule artifact hash does not match runtime metadata.');
        }
        const apiContractMatches = (
          diagnostics.apiContract.legacy === false
          && canonicalJson(diagnostics.apiContract.requestedApis)
            === canonicalJson(requestedApis)
          && diagnostics.apiContract.bundleDigest
            === args.artifact.runtimeDescriptor.apiContract.bundleDigest
        );
        if (!apiContractMatches) {
          const rejectedHandle = rawHandle;
          rawHandle = undefined;
          await rejectedHandle.destroy('api-contract-version-mismatch').catch(() => undefined);
          throw new Error('Mounted Capsule artifact API contract is inconsistent.');
        }
        state.activeHandles += 1;
        const handle = idempotentHandle(
          rawHandle,
          mapError,
          args.onFatal,
          args.onDiagnostic,
          () => {
            this.#handles.delete(handle);
            if (this.#states.get(state.poolKey) !== state) return;
            return this.#serialize(() => this.#releaseHost(state));
          },
        );
        logicalHandle = handle;
        this.#handles.add(handle);
        return handle;
      } catch (error) {
        await rawHandle?.destroy('mount-failed').catch(() => undefined);
        if (logicalHandle === undefined && rawHandle !== undefined) {
          await this.#releaseHost(state);
        } else if (rawHandle === undefined) {
          await this.#destroyIdleHost(state);
        }
        for (const binding of args.capabilityBindings) {
          await Promise.resolve(binding.dispose()).catch(() => undefined);
        }
        throw error instanceof CapsuleHostError
          ? fnMapThrownCapsuleHostError(error)
          : error;
      }
    });
  }

  replaceCatalog(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#destroyed) throw new Error('Widget Capsule host coordinator is destroyed.');
      const catalog = await this.#config.catalog();
      fnValidateWidgetCapsuleHostCatalog(catalog);
      const signature = catalogSignature(catalog);
      if (this.#stateSignature === signature) return;
      if (this.#generation === catalog.generation && this.#stateSignature !== undefined) {
        throw new Error('Widget Capsule catalog changed without a new generation.');
      }
      await this.#destroyHost('catalog-generation-changed', true);
      this.#generation = catalog.generation;
      this.#stateSignature = signature;
    });
  }

  destroy(reason = 'application-runtime-stopped'): Promise<void> {
    return this.#serialize(async () => {
      if (this.#destroyed) return;
      this.#destroyed = true;
      await this.#destroyHost(reason);
    });
  }

  diagnostics(): Readonly<{
    destroyed: boolean;
    generation: string | null;
    handles: number;
    hosts: readonly Readonly<{
      apis: readonly TWidgetCapsuleApiGroup[];
      signingKeyId: string;
      diagnostics: ReturnType<CapsuleHost['diagnostics']>;
    }>[];
  }> {
    return Object.freeze({
      destroyed: this.#destroyed,
      generation: this.#generation ?? null,
      handles: this.#handles.size,
      hosts: Object.freeze([...this.#states.values()].map((state) => Object.freeze({
        apis: state.apis,
        signingKeyId: state.signingKeyId,
        diagnostics: state.host.diagnostics(),
      }))),
    });
  }

  async #ensureHost(
    catalog: TWidgetCapsuleMountCatalog,
    requestedApis: readonly TWidgetCapsuleApiGroup[],
    mode: TMountArgs['mode'],
  ): Promise<THostState> {
    const signature = catalogSignature(catalog);
    if (this.#generation === undefined) {
      this.#generation = catalog.generation;
      this.#stateSignature = signature;
    } else if (
      this.#generation === catalog.generation
      && this.#stateSignature !== signature
    ) {
      throw new Error('Widget Capsule catalog changed without a new generation.');
    } else if (this.#generation !== catalog.generation) {
      await this.#destroyHost('catalog-generation-changed', true);
      this.#generation = catalog.generation;
      this.#stateSignature = signature;
    }
    const signingKeyId = mode === 'preview'
      ? catalog.previewSigningKeyId
      : catalog.releaseSigningKeyId;
    const key = hostPoolKey(
      requestedApis,
      signingKeyId,
      mountPolicySignature(catalog),
    );
    const current = this.#states.get(key);
    if (current !== undefined) return current;
    return await this.#createHost(catalog, requestedApis, signingKeyId, key);
  }

  async #createHost(
    catalog: TWidgetCapsuleMountCatalog,
    apis: readonly TWidgetCapsuleApiGroup[],
    signingKeyId: string,
    key: string,
  ): Promise<THostState> {
    const signingKey = catalog.trustedSigningKeys.get(signingKeyId);
    if (signingKey === undefined) {
      throw new Error('Widget Capsule signing authority is unavailable.');
    }
    const host = await this.#hostFactory.create({
      allowedApis: apis,
      limits: catalog.limits,
      capabilities: hostCapabilityPolicy(catalog),
      artifactVerification: {
        signaturePolicy: {
          trustedKeys: new Map([[signingKeyId, signingKey]]),
          minimumValidSignatures: 1,
          requiredKeyIds: [signingKeyId],
          rejectUntrustedSignatures: true,
        },
      },
      vm: {
        mode: 'release',
        maxJobsPerDrain: 1_000,
        maxEntryDepth: 32,
      },
      browserPlatform: createDefaultCapsuleBrowserPlatform({
        document: this.#config.document,
      }),
      artifactCache: new CapsuleMemoryArtifactCache({
        maxEntries: this.#config.artifactCache?.maxEntries ?? 64,
        maxTotalBytes: this.#config.artifactCache?.maxTotalBytes ?? 64 * 1_024 * 1_024,
        maxArtifactBytes: this.#config.artifactCache?.maxArtifactBytes ?? 16 * 1_024 * 1_024,
      }),
      schemas: catalog.schemas,
    });
    try {
      for (const { descriptor } of catalog.capabilities) {
        host.registerCapabilityDescriptor(descriptor);
      }
    } catch (error) {
      await host.destroy();
      throw error;
    }
    const state: THostState = {
      poolKey: key,
      apis,
      signingKeyId,
      generation: catalog.generation,
      host,
      activeHandles: 0,
    };
    this.#states.set(key, state);
    return state;
  }

  async #releaseHost(state: THostState): Promise<void> {
    if (this.#states.get(state.poolKey) !== state) return;
    state.activeHandles = Math.max(0, state.activeHandles - 1);
    if (state.activeHandles !== 0) return;
    this.#states.delete(state.poolKey);
    await state.host.destroy();
  }

  async #destroyIdleHost(state: THostState): Promise<void> {
    if (
      state.activeHandles !== 0
      || this.#states.get(state.poolKey) !== state
    ) return;
    this.#states.delete(state.poolKey);
    await state.host.destroy();
  }

  async #destroyHost(reason: string, invalidateHandles = false): Promise<void> {
    const states = [...this.#states.values()];
    this.#states.clear();
    this.#generation = undefined;
    this.#stateSignature = undefined;
    const handles = [...this.#handles];
    this.#handles.clear();
    await Promise.allSettled(handles.map((handle) => (
      invalidateHandles
        ? handle[WIDGET_CAPSULE_INVALIDATE](reason)
        : handle.destroy(reason)
    )));
    await Promise.allSettled(states.map((state) => state.host.destroy()));
  }

  #serialize<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#transition.then(operation, operation);
    this.#transition = result.then(() => undefined, () => undefined);
    return result;
  }
}
