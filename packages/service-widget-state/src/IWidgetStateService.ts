import type { IService, IStoppableService } from '@omnidraw/runtime';
import type { TTenantContext } from '@omnidraw/tenant-core';
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
  get(
    tenant: TTenantContext,
    args: TWidgetStateGetArgs,
  ): Promise<TWidgetStateGetResult>;

  change(
    tenant: TTenantContext,
    args: TWidgetStateChangeArgs,
  ): Promise<TWidgetStateChangeResult>;

  subscribe(
    tenant: TTenantContext,
    args: TWidgetStateSubscribeArgs,
  ): Promise<TWidgetStateSubscribeResult>;

  release(tenant: TTenantContext, args: TWidgetStateReleaseArgs): void;

  dispose(): void;

  getMetrics(): TWidgetStateServiceMetrics;
}
