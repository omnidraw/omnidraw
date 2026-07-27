import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { fnFreezeTenantContext, fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';

type TTenantChildService = Partial<IStartableService<object, object> & IStoppableService>;
type TTenantServiceFactory<TService extends TTenantChildService> = (
  tenant: TTenantContext,
) => TService | Promise<TService>;

type TTenantServiceKey = (tenant: TTenantContext) => string;

type TTenantServicePoolOptions<TService extends TTenantChildService> = Readonly<{
  maxTenants?: number;
  create: TTenantServiceFactory<TService>;
  key?: TTenantServiceKey;
  singlePlacementPerOrganization?: boolean;
}>;

type TTenantPlacementState = {
  activeOperationCount: number;
  currentKey: string | null;
  epoch: number;
  operationsDrained: Promise<void>;
  resolveOperationsDrained: (() => void) | null;
  tail: Promise<void>;
  targetKey: string;
};

type TTenantPlacementAcquisition<TService> = Readonly<{
  service: TService;
  state: TTenantPlacementState;
}>;

class TenantServicePool<TService extends TTenantChildService>
implements IService, IStartableService<object, object>, IStoppableService {
  readonly name: string;
  readonly #create: TTenantServiceFactory<TService>;
  readonly #entries = new Map<string, Promise<TService>>();
  readonly #placementStates = new Map<string, TTenantPlacementState>();
  readonly #retainedStartupFailures = new Map<string, TService>();
  readonly #maxTenants: number;
  readonly #key: TTenantServiceKey;
  readonly #singlePlacementPerOrganization: boolean;
  #context: IServiceContext<object, object> | null = null;
  #stopped = false;

  constructor(name: string, options: TTenantServicePoolOptions<TService>) {
    this.name = name;
    this.#create = options.create;
    this.#maxTenants = Math.max(1, options.maxTenants ?? 32);
    this.#key = options.key ?? ((tenant) => fnScopedKey('tenant-service', [
      tenant.orgId,
      tenant.accountId,
      tenant.cellId,
      String(tenant.placementEpoch),
    ]));
    this.#singlePlacementPerOrganization = options.singlePlacementPerOrganization ?? false;
  }

  start(context: IServiceContext<object, object>): void {
    this.#context = context;
    this.#stopped = false;
  }

  forTenant(tenant: TTenantContext): Promise<TService> {
    return this.#routeTenantService(tenant, (service) => service, false);
  }

  protected withTenantService<TResult>(
    tenant: TTenantContext,
    operation: (service: TService) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    return this.#routeTenantService(tenant, operation, true);
  }

  #routeTenantService<TResult>(
    tenant: TTenantContext,
    operation: (service: TService) => TResult | Promise<TResult>,
    drainOperation: boolean,
  ): Promise<TResult> {
    if (this.#stopped || !this.#context) {
      return Promise.reject(new Error(`${this.name} is not accepting tenant work.`));
    }
    const frozenTenant = fnFreezeTenantContext(tenant);
    const key = this.#key(frozenTenant);
    if (this.#singlePlacementPerOrganization) {
      return this.#forOrganizationPlacement(frozenTenant, key, drainOperation)
        .then(async ({ service, state }) => {
          try {
            return await operation(service);
          } finally {
            if (drainOperation) this.#releasePlacementOperation(state);
          }
        });
    }
    return this.#forKey(frozenTenant, key).then(operation);
  }

  #forKey(tenant: TTenantContext, key: string): Promise<TService> {
    if (this.#stopped || !this.#context) {
      return Promise.reject(new Error(`${this.name} is not accepting tenant work.`));
    }
    const existing = this.#entries.get(key);
    if (existing) return existing;
    if (this.#entries.size >= this.#maxTenants) {
      return Promise.reject(new Error(`${this.name} tenant capacity reached.`));
    }

    const context = this.#context;
    const created = Promise.resolve(this.#create(tenant)).then(async (service) => {
      try {
        await service.start?.(context);
        return service;
      } catch (error) {
        try {
          await service.stop?.();
        } catch (cleanupError) {
          this.#retainedStartupFailures.set(key, service);
          throw new AggregateError(
            [error, cleanupError],
            `${this.name} child startup and service cleanup failed.`,
          );
        }
        throw error;
      }
    });
    this.#entries.set(key, created);
    void created.catch(() => {
      if (
        this.#entries.get(key) === created
        && !this.#retainedStartupFailures.has(key)
      ) this.#entries.delete(key);
    });
    return created;
  }

  #forOrganizationPlacement(
    tenant: TTenantContext,
    key: string,
    drainOperation: boolean,
  ): Promise<TTenantPlacementAcquisition<TService>> {
    const existingState = this.#placementStates.get(tenant.orgId);
    const state = existingState ?? {
      activeOperationCount: 0,
      currentKey: null,
      epoch: tenant.placementEpoch,
      operationsDrained: Promise.resolve(),
      resolveOperationsDrained: null,
      tail: Promise.resolve(),
      targetKey: key,
    };
    if (!existingState) {
      this.#placementStates.set(tenant.orgId, state);
    } else if (tenant.placementEpoch < state.epoch) {
      return Promise.reject(this.#stalePlacementError(tenant, state.epoch));
    } else if (tenant.placementEpoch === state.epoch && key !== state.targetKey) {
      return Promise.reject(new Error(
        `${this.name} received conflicting organization placement at epoch ${state.epoch}.`,
      ));
    } else if (tenant.placementEpoch > state.epoch) {
      state.epoch = tenant.placementEpoch;
      state.targetKey = key;
    }

    const requestedEpoch = tenant.placementEpoch;
    const transition = state.tail.then(async () => {
      if (this.#stopped || !this.#context) {
        throw new Error(`${this.name} is not accepting tenant work.`);
      }
      if (state.epoch !== requestedEpoch || state.targetKey !== key) {
        throw this.#stalePlacementError(tenant, state.epoch);
      }
      if (state.currentKey && state.currentKey !== key) {
        await state.operationsDrained;
        await this.#retireEntry(state.currentKey);
        state.currentKey = null;
      }
      if (state.epoch !== requestedEpoch || state.targetKey !== key) {
        throw this.#stalePlacementError(tenant, state.epoch);
      }

      state.currentKey = key;
      try {
        const service = await this.#forKey(tenant, key);
        if (state.epoch !== requestedEpoch || state.targetKey !== key) {
          await this.#retireEntry(key);
          if (state.currentKey === key) state.currentKey = null;
          throw this.#stalePlacementError(tenant, state.epoch);
        }
        if (drainOperation) this.#retainPlacementOperation(state);
        return { service, state };
      } catch (error) {
        if (
          state.currentKey === key
          && !this.#entries.has(key)
        ) state.currentKey = null;
        throw error;
      }
    });
    state.tail = transition.then(
      () => undefined,
      () => undefined,
    );
    return transition;
  }

  #retainPlacementOperation(state: TTenantPlacementState): void {
    if (state.activeOperationCount === 0) {
      state.operationsDrained = new Promise<void>((resolve) => {
        state.resolveOperationsDrained = resolve;
      });
    }
    state.activeOperationCount += 1;
  }

  #releasePlacementOperation(state: TTenantPlacementState): void {
    state.activeOperationCount -= 1;
    if (state.activeOperationCount !== 0) return;
    state.resolveOperationsDrained?.();
    state.resolveOperationsDrained = null;
  }

  #stalePlacementError(tenant: TTenantContext, currentEpoch: number): Error {
    return new Error(
      `${this.name} rejected stale organization placement epoch ${tenant.placementEpoch}; current epoch is ${currentEpoch}.`,
    );
  }

  async #retireEntry(key: string): Promise<void> {
    const servicePromise = this.#entries.get(key);
    if (!servicePromise) return;
    const result = await Promise.allSettled([servicePromise]);
    const serviceResult = result[0]!;
    if (serviceResult.status === 'rejected') {
      const retained = this.#retainedStartupFailures.get(key);
      if (!retained) {
        if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
        return;
      }
      await retained.stop?.();
      this.#retainedStartupFailures.delete(key);
      if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
      return;
    }
    await serviceResult.value.stop?.();
    if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
  }

  getTenantCount(): number {
    return this.#entries.size;
  }

  async stop(): Promise<void> {
    if (this.#stopped && this.#entries.size === 0) return;
    this.#stopped = true;
    await Promise.all([...this.#placementStates.values()].map((state) => state.tail));
    await Promise.all(
      [...this.#placementStates.values()].map((state) => state.operationsDrained),
    );
    const entries = [...this.#entries.entries()];
    const services = await Promise.allSettled(entries.map(([, service]) => service));
    const failures: unknown[] = [];

    await Promise.all(services.map(async (result, index) => {
      const [key, servicePromise] = entries[index]!;
      if (result.status === 'rejected') {
        const retained = this.#retainedStartupFailures.get(key);
        if (!retained) {
          if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
          return;
        }
        try {
          await retained.stop?.();
          this.#retainedStartupFailures.delete(key);
          if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
        } catch (error) {
          failures.push(error);
        }
        return;
      }
      try {
        await result.value.stop?.();
        if (this.#entries.get(key) === servicePromise) this.#entries.delete(key);
      } catch (error) {
        failures.push(error);
      }
    }));

    if (this.#entries.size === 0) {
      this.#context = null;
      this.#placementStates.clear();
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${this.name} retained children that failed to stop.`,
      );
    }
  }
}

export { TenantServicePool };
export type {
  TTenantChildService,
  TTenantServiceFactory,
  TTenantServiceKey,
  TTenantServicePoolOptions,
};
