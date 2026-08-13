import type {
  TWidgetStateChangeArgs,
  TWidgetStateChangeResult,
  TWidgetStateGetArgs,
  TWidgetStateGetResult,
  TWidgetStateReleaseArgs,
  TWidgetStateServiceMetrics,
  TWidgetStateStoreCompareAndSwapArgs,
  TWidgetStateStoreCompareAndSwapResult,
  TWidgetStateStoreGetArgs,
  TWidgetStateStoreGetResult,
  TWidgetStateSubscribeArgs,
  TWidgetStateSubscriptionEvent,
} from '../../core/widget-state/types';

export type TWidgetStateSubscribeResult =
  | Readonly<{
    status: 'subscribed';
    events: AsyncIterable<TWidgetStateSubscriptionEvent>;
  }>
  | Readonly<{ status: 'capacity-unavailable' }>
  | Readonly<{ status: 'unavailable' }>;

export interface IWidgetStateStore {
  getAuthorizedExactInstance(
    args: TWidgetStateStoreGetArgs,
  ): Promise<TWidgetStateStoreGetResult>;

  compareAndSwapAuthorizedExactInstance(
    args: TWidgetStateStoreCompareAndSwapArgs,
  ): Promise<TWidgetStateStoreCompareAndSwapResult>;
}

export interface IWidgetStateService {
  readonly name: string;
  stop(): void;
  get(args: TWidgetStateGetArgs): Promise<TWidgetStateGetResult>;

  change(args: TWidgetStateChangeArgs): Promise<TWidgetStateChangeResult>;

  subscribe(args: TWidgetStateSubscribeArgs): Promise<TWidgetStateSubscribeResult>;

  release(args: TWidgetStateReleaseArgs): void;

  dispose(): void;

  getMetrics(): TWidgetStateServiceMetrics;
}
