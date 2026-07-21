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
}>;

class TenantServicePool<TService extends TTenantChildService>
implements IService, IStartableService<object, object>, IStoppableService {
  readonly name: string;
  readonly #create: TTenantServiceFactory<TService>;
  readonly #entries = new Map<string, Promise<TService>>();
  readonly #retainedStartupFailures = new Map<string, TService>();
  readonly #maxTenants: number;
  readonly #key: TTenantServiceKey;
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
  }

  start(context: IServiceContext<object, object>): void {
    this.#context = context;
    this.#stopped = false;
  }

  forTenant(tenant: TTenantContext): Promise<TService> {
    if (this.#stopped || !this.#context) {
      return Promise.reject(new Error(`${this.name} is not accepting tenant work.`));
    }
    const key = this.#key(tenant);
    const existing = this.#entries.get(key);
    if (existing) return existing;
    if (this.#entries.size >= this.#maxTenants) {
      return Promise.reject(new Error(`${this.name} tenant capacity reached.`));
    }

    const frozenTenant = fnFreezeTenantContext(tenant);
    const context = this.#context;
    const created = Promise.resolve(this.#create(frozenTenant)).then(async (service) => {
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
            `${this.name} child startup and ownership cleanup failed.`,
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

  getTenantCount(): number {
    return this.#entries.size;
  }

  async stop(): Promise<void> {
    if (this.#stopped && this.#entries.size === 0) return;
    this.#stopped = true;
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

    if (this.#entries.size === 0) this.#context = null;
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
