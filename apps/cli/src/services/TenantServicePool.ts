import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { fnFreezeTenantContext, fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';

type TTenantChildService = Partial<IStartableService<object, object> & IStoppableService>;
type TTenantServiceFactory<TService extends TTenantChildService> = (
  tenant: TTenantContext,
) => TService | Promise<TService>;

type TTenantServicePoolOptions<TService extends TTenantChildService> = Readonly<{
  maxTenants?: number;
  create: TTenantServiceFactory<TService>;
}>;

class TenantServicePool<TService extends TTenantChildService>
implements IService, IStartableService<object, object>, IStoppableService {
  readonly name: string;
  readonly #create: TTenantServiceFactory<TService>;
  readonly #entries = new Map<string, Promise<TService>>();
  readonly #maxTenants: number;
  #context: IServiceContext<object, object> | null = null;
  #stopped = false;

  constructor(name: string, options: TTenantServicePoolOptions<TService>) {
    this.name = name;
    this.#create = options.create;
    this.#maxTenants = Math.max(1, options.maxTenants ?? 32);
  }

  start(context: IServiceContext<object, object>): void {
    this.#context = context;
    this.#stopped = false;
  }

  forTenant(tenant: TTenantContext): Promise<TService> {
    if (this.#stopped || !this.#context) {
      return Promise.reject(new Error(`${this.name} is not accepting tenant work.`));
    }
    const key = this.#tenantKey(tenant);
    const existing = this.#entries.get(key);
    if (existing) return existing;
    if (this.#entries.size >= this.#maxTenants) {
      return Promise.reject(new Error(`${this.name} tenant capacity reached.`));
    }

    const frozenTenant = fnFreezeTenantContext(tenant);
    const context = this.#context;
    const created = Promise.resolve(this.#create(frozenTenant)).then(async (service) => {
      await service.start?.(context);
      return service;
    });
    this.#entries.set(key, created);
    void created.catch(() => {
      if (this.#entries.get(key) === created) this.#entries.delete(key);
    });
    return created;
  }

  getTenantCount(): number {
    return this.#entries.size;
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    const services = await Promise.allSettled(entries);
    await Promise.allSettled(services.flatMap((result) => (
      result.status === 'fulfilled' && result.value.stop ? [result.value.stop()] : []
    )));
    this.#context = null;
  }

  #tenantKey(tenant: TTenantContext): string {
    return fnScopedKey('tenant-service', [
      tenant.orgId,
      tenant.accountId,
      tenant.cellId,
      String(tenant.placementEpoch),
    ]);
  }
}

export { TenantServicePool };
export type { TTenantChildService, TTenantServiceFactory, TTenantServicePoolOptions };
