/**
 * @file Direct caller-selected resource bridge into the canonical gateway/store path.
 */

import type {
  IResourceStore,
  TResourceCall,
  TResourceId,
  TResourceKind,
  TResourceOperationName,
  TResourceOperationId,
  TResourcePermission,
} from '#backend/shell/resources';
import type {
  ResourceManager,
  TResourceDirectBinding,
  TResourceGatewayAuthorization,
  TResourceManagerCall,
} from './ResourceManager';
import { ResourceGateway } from './ResourceStoreService';
import { fnResourceExactGatewayAuthorization } from './fn.resource-manager-gateway';

export type TResourceManagerGatewayConfig = Readonly<{
  manager: Pick<ResourceManager, 'resolveGatewayCall'>;
  store: IResourceStore;
}>;

export type TResourceManagerGatewayCallOptions = Readonly<{
  operationId?: TResourceOperationId;
  writeCapability?: string;
}>;

export type TResourceManagerGatewayResourceCall = Readonly<{
  resourceId: TResourceId;
  kind: TResourceKind;
  effect: TResourcePermission;
  operation: TResourceOperationName;
  input: unknown;
  operationId?: TResourceOperationId;
  writeCapability?: string;
}>;

export class ResourceManagerGateway {
  readonly #manager: Pick<ResourceManager, 'resolveGatewayCall'>;
  readonly #store: IResourceStore;

  constructor(config: TResourceManagerGatewayConfig) {
    this.#manager = config.manager;
    this.#store = config.store;
  }

  async callWithDirectBinding(
    call: TResourceManagerCall,
    direct: TResourceDirectBinding,
    options: TResourceManagerGatewayCallOptions = {},
  ): Promise<unknown> {
    return this.#callResolved(
      call,
      await this.#manager.resolveGatewayCall(call, direct),
      options,
    );
  }

  async callResource(
    call: TResourceManagerGatewayResourceCall,
  ): Promise<unknown> {
    const authorization = fnResourceExactGatewayAuthorization(call);
    const gateway = new ResourceGateway({
      store: this.#store,
      bindings: { resolveBinding: async () => authorization.binding },
      requirements: { resolveRequirement: async () => authorization.requirement },
    });
    const logicalCall: TResourceCall = call.effect === 'write'
      ? {
        slot: authorization.slot,
        kind: call.kind,
        operation: call.operation,
        operationId: call.operationId,
        effect: 'write',
        input: call.input,
        writeCapability: call.writeCapability,
      }
      : {
        slot: authorization.slot,
        kind: call.kind,
        operation: call.operation,
        operationId: call.operationId,
        effect: 'read',
        input: call.input,
      };
    return (await gateway.call(logicalCall)).output;
  }

  async #callResolved(
    call: TResourceManagerCall,
    authorization: TResourceGatewayAuthorization,
    options: TResourceManagerGatewayCallOptions,
  ): Promise<unknown> {
    const gateway = new ResourceGateway({
      store: this.#store,
      bindings: { resolveBinding: async () => authorization.binding },
      requirements: { resolveRequirement: async () => authorization.requirement },
    });
    const logicalCall: TResourceCall = authorization.effect === 'write'
      ? {
        slot: call.slot,
        kind: call.kind,
        operation: call.operation,
        operationId: options.operationId,
        effect: 'write',
        input: call.args,
        writeCapability: options.writeCapability,
      }
      : {
        slot: call.slot,
        kind: call.kind,
        operation: call.operation,
        operationId: options.operationId,
        effect: 'read',
        input: call.args,
      };
    return (await gateway.call(logicalCall)).output;
  }
}
