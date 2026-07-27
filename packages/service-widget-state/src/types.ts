import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TWidgetStateJson =
  | null
  | boolean
  | number
  | string
  | readonly TWidgetStateJson[]
  | Readonly<{ [key: string]: TWidgetStateJson }>;

export type TWidgetStateInstanceIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  definitionId: string;
  revisionId: string;
}>;

export type TWidgetStateStoredSnapshot = Readonly<{
  version: number;
  state: TWidgetStateJson;
}>;

export type TWidgetStateSnapshot = Readonly<{
  identity: TWidgetStateInstanceIdentity;
  version: number;
  state: TWidgetStateJson;
}>;

export type TWidgetStateUnavailableResult = Readonly<{
  status: 'unavailable';
}>;

export type TWidgetStateStoreGetArgs = Readonly<{
  tenant: TTenantContext;
  identity: TWidgetStateInstanceIdentity;
  initialSnapshot: TWidgetStateStoredSnapshot;
}>;

export type TWidgetStateStoreGetResult =
  | Readonly<{
    status: 'found';
    snapshot: TWidgetStateStoredSnapshot;
  }>
  | TWidgetStateUnavailableResult;

export type TWidgetStateStoreCompareAndSwapArgs = Readonly<{
  tenant: TTenantContext;
  identity: TWidgetStateInstanceIdentity;
  expectedVersion: number;
  state: TWidgetStateJson;
  initialSnapshot: TWidgetStateStoredSnapshot;
}>;

export type TWidgetStateStoreCompareAndSwapResult =
  | Readonly<{
    status: 'changed';
    snapshot: TWidgetStateStoredSnapshot;
  }>
  | Readonly<{
    status: 'conflict';
    snapshot: TWidgetStateStoredSnapshot;
  }>
  | TWidgetStateUnavailableResult;

export type TWidgetStateGetArgs = Readonly<{
  identity: TWidgetStateInstanceIdentity;
}>;

export type TWidgetStateGetResult =
  | Readonly<{
    status: 'found';
    snapshot: TWidgetStateSnapshot;
  }>
  | TWidgetStateUnavailableResult;

export type TWidgetStateChangeArgs = Readonly<{
  identity: TWidgetStateInstanceIdentity;
  expectedVersion: number;
  state: TWidgetStateJson;
}>;

export type TWidgetStateChangeResult =
  | Readonly<{
    status: 'changed';
    snapshot: TWidgetStateSnapshot;
  }>
  | Readonly<{
    status: 'conflict';
    snapshot: TWidgetStateSnapshot;
  }>
  | Readonly<{
    status: 'rate-limited';
    retryAfterMs: number;
  }>
  | TWidgetStateUnavailableResult;

export type TWidgetStateSubscriptionEvent =
  | Readonly<{
    type: 'changed';
    snapshot: TWidgetStateSnapshot;
  }>
  | Readonly<{
    type: 'snapshot';
    reason: 'initial' | 'resync';
    snapshot: TWidgetStateSnapshot;
  }>;

export type TWidgetStateSubscribeArgs = Readonly<{
  identity: TWidgetStateInstanceIdentity;
  afterVersion?: number;
}>;

export type TWidgetStateSubscribeResult =
  | Readonly<{
    status: 'subscribed';
    events: AsyncIterable<TWidgetStateSubscriptionEvent>;
  }>
  | Readonly<{
    status: 'capacity-unavailable';
  }>
  | TWidgetStateUnavailableResult;

export type TWidgetStateReleaseArgs = Readonly<{
  identity: TWidgetStateInstanceIdentity;
}>;

export type TWidgetStateServiceMetrics = Readonly<{
  disposed: boolean;
  activeStreams: number;
  activeSubscribers: number;
  replayEvents: number;
  mutationRateLedgers: number;
  getAttempts: number;
  changeAttempts: number;
  changes: number;
  conflicts: number;
  unavailable: number;
  rateLimited: number;
  subscriptions: number;
  releases: number;
}>;

export type TWidgetStateServiceOptions = Readonly<{
  now?: () => number;
  initialVersion?: number;
  initialState?: TWidgetStateJson;
  replayCapacity?: number;
  subscriberQueueCapacity?: number;
  maxActiveStreams?: number;
  mutationRateLimit?: number;
  mutationRateWindowMs?: number;
  maxMutationRateLedgers?: number;
}>;
