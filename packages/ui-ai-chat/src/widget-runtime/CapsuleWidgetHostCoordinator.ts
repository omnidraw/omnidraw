import {
  CapsuleMemoryArtifactCache,
  createCapsuleHost,
  createDefaultCapsuleBrowserPlatform,
  fnMapCapsuleMountError,
  type CapsuleCapabilityBinding,
  type CapsuleHandle,
  type CapsuleHost,
  type CapsuleMountGuestChannels,
  type CapsuleViewport,
} from '@vibecanvas/capsule-vibecanvas/host';
import type {
  TVibecanvasCapsuleTarget,
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
import type {
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleHostFactory,
  TWidgetCapsuleMountCatalog,
  TWidgetUiRuntimeHandle,
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
  catalog: TWidgetCapsuleMountCatalog;
  artifact: TVerifiedWidgetUiArtifact;
  container: HTMLElement;
  capabilityBindings: readonly CapsuleCapabilityBinding[];
  guestChannels?: CapsuleMountGuestChannels;
  onFatal(error: unknown): void;
}>;

type THostState = {
  poolKey: string;
  target: TVibecanvasCapsuleTarget;
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
    targetBase: catalog.targetBase,
    allowedFeatureProfiles: [...catalog.allowedFeatureProfiles].sort(),
    budgetCeiling: catalog.budgetCeiling,
    budgetDefaults: catalog.budgetDefaults,
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

function targetKey(target: TVibecanvasCapsuleTarget): string {
  return JSON.stringify({
    runtimeAbi: target.runtimeAbi,
    domProfile: target.domProfile,
    featureProfiles: [...target.featureProfiles].sort(),
  });
}

function targetFeatureProfiles(target: TVibecanvasCapsuleTarget): readonly string[] {
  return Object.freeze([...target.featureProfiles].sort());
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
  target: TVibecanvasCapsuleTarget,
  signingKeyId: string,
  policySignature: string,
): string {
  return canonicalJson({
    target: targetKey(target),
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
  onFatal: (error: unknown) => void,
  onDestroyed: () => void | Promise<void>,
): TCoordinatedWidgetUiRuntimeHandle {
  let destroyed = false;
  let destroyOperation: Promise<void> | undefined;
  const errorSubscription = handle.onError((event) => {
    if (!destroyed && event.fatal) {
      try {
        onFatal(fnMapCapsuleMountError(event));
      } finally {
        void destroy('capsule-fatal-error');
      }
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

/**
 * Owns one generation-scoped pool of shared Capsule hosts keyed by exact
 * execution target, signing authority, and locally derived capability policy.
 * Capsule 0.9 requires exact feature-profile equality and immutable host
 * verification/capability policy, so incompatible artifacts cannot share one
 * literal host. Idle policy partitions are retired when their last handle is
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

      const state = await this.#ensureHost(
        catalog,
        args.artifact.runtimeDescriptor.target,
        args.mode,
      );
      const grants: readonly CapsuleCapabilityGrant[] = Object.freeze(
        resolved.map(({ grant }) => grant),
      );
      let rawHandle: CapsuleHandle | undefined;
      let logicalHandle: TCoordinatedWidgetUiRuntimeHandle | undefined;
      try {
        rawHandle = await state.host.mount({
          artifact: Uint8Array.from(args.artifact.bytes),
          container: args.container,
          capabilityBindings: args.capabilityBindings,
          grants,
          featureGrants: targetFeatureProfiles(args.artifact.runtimeDescriptor.target),
          budgets: args.artifact.runtimeDescriptor.budgets,
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
        state.activeHandles += 1;
        const handle = idempotentHandle(rawHandle, args.onFatal, () => {
          this.#handles.delete(handle);
          if (this.#states.get(state.poolKey) !== state) return;
          return this.#serialize(() => this.#releaseHost(state));
        });
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
        throw error;
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
      target: TVibecanvasCapsuleTarget;
      signingKeyId: string;
      diagnostics: ReturnType<CapsuleHost['diagnostics']>;
    }>[];
  }> {
    return Object.freeze({
      destroyed: this.#destroyed,
      generation: this.#generation ?? null,
      handles: this.#handles.size,
      hosts: Object.freeze([...this.#states.values()].map((state) => Object.freeze({
        target: state.target,
        signingKeyId: state.signingKeyId,
        diagnostics: state.host.diagnostics(),
      }))),
    });
  }

  async #ensureHost(
    catalog: TWidgetCapsuleMountCatalog,
    requestedTarget: TVibecanvasCapsuleTarget,
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
      requestedTarget,
      signingKeyId,
      mountPolicySignature(catalog),
    );
    const current = this.#states.get(key);
    if (current !== undefined) return current;
    return await this.#createHost(catalog, requestedTarget, signingKeyId, key);
  }

  async #createHost(
    catalog: TWidgetCapsuleMountCatalog,
    target: TVibecanvasCapsuleTarget,
    signingKeyId: string,
    key: string,
  ): Promise<THostState> {
    const signingKey = catalog.trustedSigningKeys.get(signingKeyId);
    if (signingKey === undefined) {
      throw new Error('Widget Capsule signing authority is unavailable.');
    }
    const host = await this.#hostFactory.create({
      runtimePolicy: {
        target,
        capabilities: hostCapabilityPolicy(catalog),
        budgetCeiling: catalog.budgetCeiling,
        budgetDefaults: catalog.budgetDefaults,
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
      target,
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
