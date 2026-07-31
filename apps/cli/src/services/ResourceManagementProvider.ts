import {
  ResourceError,
  type IResourceWritePermitGuard,
} from '@omnidraw/resource-runtime';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type {
  ILocalResourceProvider,
  TLocalResourceCommittedOperation,
  TLocalResourceDispatchReceipt,
  TLocalResourceOperationIdentity,
  TLocalResolvedResourceCall,
  TLocalResource,
  TLocalResourceRequirement,
} from '@omnidraw/resource-runtime/local';
import { RESOURCE_MANAGEMENT_OPERATION } from './CONSTANTS';

type TResourceManagementEnvelope = Readonly<{
  action: string;
  args: unknown;
}>;

type TResourceManagementDispatch = (
  tenant: TTenantContext,
  resource: TLocalResource,
  action: string,
  args: unknown,
) => Promise<unknown>;

type TResourceManagementProviderConfig = Readonly<{
  provider: ILocalResourceProvider;
  effects: Readonly<Record<string, 'read' | 'write'>>;
  dispatch: TResourceManagementDispatch;
}>;

/**
 * Store-owned adapter for operator/UI operations. Guest calls still use the
 * wrapped provider's exact operation policy; only the trusted host emits the
 * reserved management operation.
 */
class ResourceManagementProvider implements ILocalResourceProvider {
  readonly kind;
  readonly reconcileReady;
  readonly #provider: ILocalResourceProvider;
  readonly #effects: Readonly<Record<string, 'read' | 'write'>>;
  readonly #dispatchManagement: TResourceManagementDispatch;

  constructor(config: TResourceManagementProviderConfig) {
    this.#provider = config.provider;
    this.#effects = config.effects;
    this.#dispatchManagement = config.dispatch;
    this.kind = config.provider.kind;
    this.reconcileReady = config.provider.reconcileReady;
  }

  provision(resource: TLocalResource, args: unknown): Promise<void> {
    return this.#provider.provision(resource, args);
  }

  delete(resource: TLocalResource): Promise<void> {
    return this.#provider.delete(resource);
  }

  reconcile(resource: TLocalResource) {
    return this.#provider.reconcile
      ? this.#provider.reconcile(resource)
      : Promise.resolve({
          status: 'error' as const,
          lastError: {
            code: 'RESOURCE_PROVIDER_UNAVAILABLE' as const,
            message: 'Resource provider cannot reconcile physical state.',
          },
        });
  }

  close(): Promise<void> {
    return this.#provider.close?.() ?? Promise.resolve();
  }

  effect(operation: string, requirement: TLocalResourceRequirement, args: unknown) {
    if (operation !== RESOURCE_MANAGEMENT_OPERATION) {
      return this.#provider.effect(operation, requirement, args);
    }
    const envelope = this.#envelope(args);
    return this.#effects[envelope.action] ?? null;
  }

  dispatch(context: TLocalResolvedResourceCall, operation: string, args: unknown): Promise<unknown> {
    if (operation !== RESOURCE_MANAGEMENT_OPERATION) {
      return this.#provider.dispatch(context, operation, args);
    }
    if (!context.tenant) {
      throw new ResourceError(
        'RESOURCE_CALL_INVALID',
        'Resource management calls require an admitted tenant context.',
      );
    }
    const envelope = this.#envelope(args);
    if (!this.#effects[envelope.action]) {
      throw new ResourceError('RESOURCE_CALL_INVALID', 'Unknown resource management operation.');
    }
    return this.#dispatchManagement(context.tenant, context.resource, envelope.action, envelope.args);
  }

  dispatchWithReceipt(
    context: TLocalResolvedResourceCall,
    operation: string,
    args: unknown,
    identity: TLocalResourceOperationIdentity,
    guard: IResourceWritePermitGuard,
  ): Promise<TLocalResourceDispatchReceipt> {
    if (operation === RESOURCE_MANAGEMENT_OPERATION || !this.#provider.dispatchWithReceipt) {
      throw new ResourceError(
        'RESOURCE_PROVIDER_UNAVAILABLE',
        'Resource provider does not support durable function operation receipts.',
      );
    }
    return this.#provider.dispatchWithReceipt(context, operation, args, identity, guard);
  }

  readCommittedOperation(
    resource: TLocalResource,
    request: Readonly<{ invocationId: string; operationId: string }>,
  ): Promise<TLocalResourceCommittedOperation | null> {
    return this.#provider.readCommittedOperation?.(resource, request) ?? Promise.resolve(null);
  }

  #envelope(value: unknown): TResourceManagementEnvelope {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ResourceError('RESOURCE_CALL_INVALID', 'Resource management input must be an object.');
    }
    const envelope = value as Partial<TResourceManagementEnvelope>;
    if (typeof envelope.action !== 'string' || envelope.action.length === 0) {
      throw new ResourceError('RESOURCE_CALL_INVALID', 'Resource management action is invalid.');
    }
    return { action: envelope.action, args: envelope.args };
  }
}

export { ResourceManagementProvider };
export type {
  TResourceManagementDispatch,
  TResourceManagementEnvelope,
  TResourceManagementProviderConfig,
};
