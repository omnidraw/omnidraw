/**
 * @file Actor-local contracts for independently persisted KV and secret-store entries.
 */
import type { TActorResourceKind, TJson } from '@vibecanvas/service-db/model';

export type TActorResourceKeyValueKind = Extract<TActorResourceKind, 'kv' | 'secretStore'>;

export type TActorResourceKeyValueIdentity = {
  readonly resourceId: string;
  readonly kind: TActorResourceKeyValueKind;
};

export type TActorResourceKeyValueEntry = {
  readonly key: string;
  readonly value: TJson;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TActorResourceKeyValueEntryMetadata = Omit<TActorResourceKeyValueEntry, 'value'>;

export type TActorResourceKeyValuePage<TEntry = TActorResourceKeyValueEntry> = {
  readonly entries: readonly TEntry[];
  readonly nextCursor: string | null;
};

export type TActorResourceKeyValueDeleteResult = {
  readonly deleted: boolean;
};

export type TActorResourceKeyValueCompareAndSetResult =
  | { readonly ok: true; readonly entry: TActorResourceKeyValueEntry }
  | {
    readonly ok: false;
    readonly expectedRevision: number | null;
    readonly currentRevision: number | null;
  };

export interface IActorResourceKeyValuePersistence {
  provision(identity: TActorResourceKeyValueIdentity): Promise<void>;
  verify(identity: TActorResourceKeyValueIdentity): Promise<void>;
  deleteResource(identity: TActorResourceKeyValueIdentity): Promise<void>;
  get(args: { readonly resourceId: string; readonly key: string }): Promise<TActorResourceKeyValueEntry | null>;
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
  }): Promise<TActorResourceKeyValuePage>;
  set(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly value: TJson;
  }): Promise<TActorResourceKeyValueEntry>;
  delete(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision?: number;
  }): Promise<TActorResourceKeyValueDeleteResult>;
  compareAndSet(args: {
    readonly resourceId: string;
    readonly key: string;
    readonly expectedRevision: number | null;
    readonly value: TJson;
  }): Promise<TActorResourceKeyValueCompareAndSetResult>;
  close(): Promise<void>;
}
