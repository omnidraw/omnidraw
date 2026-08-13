import { DATABASE_STATEMENTS } from './statement-registry';
import type { Database } from '@tursodatabase/database';
import {
  DATABASE_OPERATION_SCOPES,
  DATABASE_OPERATION_TAILS,
} from './database-transaction/CONSTANTS';

type TEffectsDatabase = Readonly<{
  database: Database;
}>;

type TArgsDatabaseTransaction<TResult> = Readonly<{
  foreignKeyEnforcement?: 'enabled' | 'disabled';
  operation: () => Promise<TResult>;
  mode?: 'deferred' | 'immediate';
}>;

type TArgsDatabaseWrite<TResult> = Readonly<{
  operation: () => Promise<TResult>;
}>;

type TEffectsSerializedOperation = Readonly<{
  scope: object;
}>;

type TArgsSerializedOperation<TResult> = Readonly<{
  operation: () => Promise<TResult>;
}>;

type TDatabaseTransaction<TResult> = (() => Promise<TResult>) & Readonly<{
  immediate(): Promise<TResult>;
}>;

/** Serializes asynchronous operations sharing one injected mutable scope. */
export function runSerializedOperation<TResult>(
  effects: TEffectsSerializedOperation,
  args: TArgsSerializedOperation<TResult>,
): Promise<TResult> {
  const activeScopes = DATABASE_OPERATION_SCOPES.getStore();
  if (activeScopes?.get(effects.scope)?.active === true) {
    return args.operation();
  }
  const run = async () => {
    const scopes = new Map(activeScopes);
    const lease = { active: true };
    scopes.set(effects.scope, lease);
    return DATABASE_OPERATION_SCOPES.run(scopes, async () => {
      try {
        return await args.operation();
      } finally {
        lease.active = false;
      }
    });
  };
  const previous = DATABASE_OPERATION_TAILS.get(effects.scope) ?? Promise.resolve();
  const result = previous.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  DATABASE_OPERATION_TAILS.set(effects.scope, tail);
  void tail.then(() => {
    if (DATABASE_OPERATION_TAILS.get(effects.scope) === tail) {
      DATABASE_OPERATION_TAILS.delete(effects.scope);
    }
  });
  return result;
}

/**
 * Serializes transactions that share one Turso Database connection. The
 * driver serializes statements, but rejects overlapping BEGIN operations on
 * the same connection instead of queuing them.
 */
export function runDatabaseTransaction<TResult>(
  effects: TEffectsDatabase,
  args: TArgsDatabaseTransaction<TResult>,
): Promise<TResult> {
  const runTransaction = () => {
    const transaction = effects.database.transaction(args.operation) as TDatabaseTransaction<TResult>;
    return args.mode === 'deferred' ? transaction() : transaction.immediate();
  };
  const run = async () => {
    if (args.foreignKeyEnforcement !== 'disabled') return runTransaction();

    await effects.database.exec(DATABASE_STATEMENTS.transactionSetPragmaForeignKeys);
    try {
      return await runTransaction();
    } finally {
      await effects.database.exec(DATABASE_STATEMENTS.transactionSetPragmaForeignKeys2);
    }
  };
  return runSerializedOperation({ scope: effects.database as object }, {
    operation: run,
  });
}

/** Serializes a non-transactional write with every transaction on the connection. */
export function runDatabaseWrite<TResult>(
  effects: TEffectsDatabase,
  args: TArgsDatabaseWrite<TResult>,
): Promise<TResult> {
  return runSerializedOperation({ scope: effects.database as object }, args);
}

export type {
  TArgsDatabaseTransaction,
  TArgsDatabaseWrite,
  TArgsSerializedOperation,
  TEffectsDatabase,
  TEffectsSerializedOperation,
};
