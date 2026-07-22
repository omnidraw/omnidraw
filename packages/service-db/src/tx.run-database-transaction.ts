import type { Database } from '@tursodatabase/database';
import { txRunSerializedOperation } from '@vibecanvas/shared-functions/tx.run-serialized-operation';

type TPortal = Readonly<{
  database: Database;
}>;

type TArgs<TResult> = Readonly<{
  operation: () => Promise<TResult>;
  mode?: 'deferred' | 'immediate';
}>;

type TWriteArgs<TResult> = Readonly<{
  operation: () => Promise<TResult>;
}>;

type TDatabaseTransaction<TResult> = (() => Promise<TResult>) & Readonly<{
  immediate(): Promise<TResult>;
}>;

/**
 * Serializes transactions that share one Turso Database connection. The
 * driver serializes statements, but rejects overlapping BEGIN operations on
 * the same connection instead of queuing them.
 */
export function txRunDatabaseTransaction<TResult>(
  portal: TPortal,
  args: TArgs<TResult>,
): Promise<TResult> {
  const run = () => {
    const transaction = portal.database.transaction(args.operation) as TDatabaseTransaction<TResult>;
    return args.mode === 'deferred' ? transaction() : transaction.immediate();
  };
  return txRunSerializedOperation({ scope: portal.database as object }, {
    operation: run,
  });
}

/** Serializes a non-transactional write with every transaction on the connection. */
export function txRunDatabaseWrite<TResult>(
  portal: TPortal,
  args: TWriteArgs<TResult>,
): Promise<TResult> {
  return txRunSerializedOperation({ scope: portal.database as object }, args);
}

export type { TArgs, TPortal, TWriteArgs };
