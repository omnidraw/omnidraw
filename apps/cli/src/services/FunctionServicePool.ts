import type { IFunctionInvocationApiCapability } from '@vibecanvas/api/function';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import { FunctionService } from './FunctionService';
import {
  TenantServicePool,
  type TTenantServicePoolOptions,
} from './TenantServicePool';

type TFunctionServicePoolOptions = Omit<
  TTenantServicePoolOptions<FunctionService>,
  'key' | 'singlePlacementPerOrganization'
> & Readonly<{
  /** Trusted placement identities that must recover work during process boot. */
  bootstrapTenants?: readonly TTenantContext[];
}>;

class FunctionServicePool extends TenantServicePool<FunctionService>
implements IFunctionInvocationApiCapability {
  readonly #bootstrapTenants: readonly TTenantContext[];

  constructor(options: TFunctionServicePoolOptions) {
    super('function-service-pool', {
      ...options,
      key: (tenant) => fnScopedKey('function-service', [
        tenant.orgId,
        tenant.cellId,
        String(tenant.placementEpoch),
      ]),
      singlePlacementPerOrganization: true,
    });
    this.#bootstrapTenants = Object.freeze([...(options.bootstrapTenants ?? [])]);
  }

  override async start(context: IServiceContext<object, object>): Promise<void> {
    super.start(context);
    try {
      await Promise.all(this.#bootstrapTenants.map((tenant) => this.forTenant(tenant)));
    } catch (error) {
      try {
        await super.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Function placement bootstrap and cleanup both failed.',
        );
      }
      throw error;
    }
  }

  invokeFunction: IFunctionInvocationApiCapability['invokeFunction'] = (tenant, request) => (
    this.#delegate(tenant, (service) => service.invokeFunction(tenant, request))
  );

  getFunctionInvocation: IFunctionInvocationApiCapability['getFunctionInvocation'] = (
    tenant,
    invocationId,
  ) => this.#delegate(
    tenant,
    (service) => service.getFunctionInvocation(tenant, invocationId),
  );

  cancelFunctionInvocation: IFunctionInvocationApiCapability['cancelFunctionInvocation'] = (
    tenant,
    invocationId,
  ) => this.#delegate(
    tenant,
    (service) => service.cancelFunctionInvocation(tenant, invocationId),
  );

  #delegate<TResult>(
    tenant: TTenantContext,
    operation: (service: FunctionService) => Promise<TResult>,
  ): Promise<TResult> {
    return this.withTenantService(tenant, operation);
  }
}

function createFunctionInvocationCapability(
  pool: FunctionServicePool,
): IFunctionInvocationApiCapability {
  return Object.freeze({
    invokeFunction: pool.invokeFunction,
    getFunctionInvocation: pool.getFunctionInvocation,
    cancelFunctionInvocation: pool.cancelFunctionInvocation,
  });
}

export { createFunctionInvocationCapability, FunctionServicePool };
export type { TFunctionServicePoolOptions };
