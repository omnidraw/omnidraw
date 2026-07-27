/**
 * @file Neutral contracts for independently persisted KV and secret-store entries.
 */
import type { IResourceWritePermitGuard } from '../interface';
export type TResourceJson =
  | null
  | boolean
  | number
  | string
  | readonly TResourceJson[]
  | { readonly [key: string]: TResourceJson };

export type TResourceKeyValueKind = 'kv' | 'secretStore';

export type TResourceKeyValueIdentity = {
  readonly resourceId: string;
  readonly kind: TResourceKeyValueKind;
};

export type TResourceKeyValueEntry = {
  readonly key: string;
  readonly value: TResourceJson;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TResourceKeyValueEntryMetadata = Omit<TResourceKeyValueEntry, 'value'>;

export type TResourceKeyValuePage<TEntry = TResourceKeyValueEntry> = {
  readonly entries: readonly TEntry[];
  readonly nextCursor: string | null;
};

export type TResourceKeyValueDeleteResult = {
  readonly deleted: boolean;
};

export type TResourceKeyValueCompareAndSetResult =
  | { readonly ok: true; readonly entry: TResourceKeyValueEntry }
  | {
    readonly ok: false;
    readonly expectedRevision: number | null;
    readonly currentRevision: number | null;
  };

export type TResourceKeyValueReceiptMutation =
  | Readonly<{
      operation: 'set';
      key: string;
      value: TResourceJson;
    }>
  | Readonly<{
      operation: 'delete';
      key: string;
      expectedRevision?: number;
    }>
  | Readonly<{
      operation: 'compareAndSet';
      key: string;
      expectedRevision: number | null;
      value: TResourceJson;
    }>;

export type TResourceKeyValueReceiptMutationRequest = Readonly<{
  resourceId: string;
  invocationId: string;
  attemptId: string;
  operationId: string;
  operationFingerprintSha256: string;
  mutation: TResourceKeyValueReceiptMutation;
}>;

export type TResourceKeyValueMutationReceipt = Readonly<{
  output: unknown;
  committed: true;
  replayed: boolean;
}>;

export type TResourceKeyValueCommittedOperation = Readonly<{
  invocationId: string;
  operationId: string;
  attemptId: string;
  operationName: string;
  operationFingerprintSha256: string;
  output: unknown;
}>;

export interface IResourceKeyValuePersistence {
  provision(identity: TResourceKeyValueIdentity): Promise<void>;
  verify(identity: TResourceKeyValueIdentity): Promise<void>;
  deleteResource(identity: TResourceKeyValueIdentity): Promise<void>;
  get(args: { readonly resourceId: string; readonly key: string }): Promise<TResourceKeyValueEntry | null>;
  getMetadata(args: {
    readonly resourceId: string;
    readonly key: string;
  }): Promise<TResourceKeyValueEntryMetadata | null>;
  has(args: { readonly resourceId: string; readonly key: string }): Promise<boolean>;
  count(args: {
    readonly resourceId: string;
    readonly prefix?: string;
    readonly search?: string;
  }): Promise<number>;
  list(args: {
    readonly resourceId: string;
    readonly prefix?: string;
    readonly search?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<TResourceKeyValuePage>;
  listMetadata(args: {
    readonly resourceId: string;
    readonly prefix?: string;
    readonly search?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<TResourceKeyValuePage<TResourceKeyValueEntryMetadata>>;
  set(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly value: TResourceJson;
  }): Promise<TResourceKeyValueEntry>;
  delete(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision?: number;
  }): Promise<TResourceKeyValueDeleteResult>;
  compareAndSet(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision: number | null;
    readonly value: TResourceJson;
  }): Promise<TResourceKeyValueCompareAndSetResult>;
  mutateWithReceipt(
    request: TResourceKeyValueReceiptMutationRequest,
    guard: IResourceWritePermitGuard,
  ): Promise<TResourceKeyValueMutationReceipt>;
  readCommittedOperation(args: {
    readonly resourceId: string;
    readonly invocationId: string;
    readonly operationId: string;
  }): Promise<TResourceKeyValueCommittedOperation | null>;
  close(): Promise<void>;
}
