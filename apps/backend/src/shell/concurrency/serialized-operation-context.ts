import { AsyncLocalStorage } from 'node:async_hooks';

export type TSerializedOperationLease = {
  active: boolean;
};

export const SERIALIZED_OPERATION_SCOPES = new AsyncLocalStorage<
  ReadonlyMap<object, TSerializedOperationLease>
>();
