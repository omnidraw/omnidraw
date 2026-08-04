import type { IService, IStoppableService } from '@omnidraw/runtime';
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
  TWidgetStateSubscribeResult,
} from './types';

export interface IWidgetStateStore {
  getAuthorizedExactInstance(
    args: TWidgetStateStoreGetArgs,
  ): Promise<TWidgetStateStoreGetResult>;

  compareAndSwapAuthorizedExactInstance(
    args: TWidgetStateStoreCompareAndSwapArgs,
  ): Promise<TWidgetStateStoreCompareAndSwapResult>;
}

export interface IWidgetStateService extends IService, IStoppableService {
  get(args: TWidgetStateGetArgs): Promise<TWidgetStateGetResult>;

  change(args: TWidgetStateChangeArgs): Promise<TWidgetStateChangeResult>;

  subscribe(args: TWidgetStateSubscribeArgs): Promise<TWidgetStateSubscribeResult>;

  release(args: TWidgetStateReleaseArgs): void;

  dispose(): void;

  getMetrics(): TWidgetStateServiceMetrics;
}
