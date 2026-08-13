import { AsyncLocalStorage } from 'node:async_hooks';

export type TDatabaseOperationLease = {
  active: boolean;
};

export const DATABASE_OPERATION_SCOPES = new AsyncLocalStorage<
  ReadonlyMap<object, TDatabaseOperationLease>
>();

export const DATABASE_OPERATION_TAILS = new WeakMap<object, Promise<void>>();
