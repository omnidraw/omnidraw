import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TAgentEvent } from '../agent/contract';
import type { TActorDatabaseCapability } from '../interface';
import type { actorsContract, TActorEvent } from './contract';

type TActorInputs = InferContractRouterInputs<typeof actorsContract>;
type TActorOutputs = InferContractRouterOutputs<typeof actorsContract>;

export type TActorApiCapability = {
  deleteDefinition(name: TActorInputs['definitions']['delete']['name']): Promise<boolean>;
  getVibecanvasJson(definitionName: string): TVibecanvasJson | null;
  getWidgetCode(definitionName: string): Promise<TActorOutputs['definitions']['get']['widgetCode'] | null>;
  sendMessage(
    instanceId: TActorInputs['instances']['sendMessage']['instanceId'],
    name: TActorInputs['instances']['sendMessage']['name'],
    payload: TActorInputs['instances']['sendMessage']['payload'],
  ): Promise<TActorOutputs['instances']['sendMessage']['messageId']>;
};

export type TActorEventCapability = {
  publishAgentEvent(tenant: import('@vibecanvas/tenant-core').TTenantContext, event: TAgentEvent): number;
  subscribeActorEvents(tenant: import('@vibecanvas/tenant-core').TTenantContext): AsyncIterable<TActorEvent>;
};

export type TActorsApiContext = {
  db: TActorDatabaseCapability;
  eventPublisher: TActorEventCapability;
  actor: TActorApiCapability;
  tenant: import('@vibecanvas/tenant-core').TTenantContext;
};
