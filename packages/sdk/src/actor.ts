import type { TActorOutputEnvelope, TMessageMap, TVibecanvasJsonValue } from './shared';

export type TActorResourceKind = 'kv' | 'secretStore' | 'db';

export type TActorResourcePermission = 'read' | 'write';

export type TActorResourceScope = readonly TActorResourcePermission[];

export type TActorResourceFunctionClass = 'fn' | 'fx' | 'tx';

export type TActorKvResourceRequirement = {
  readonly kind: 'kv';
  readonly required: boolean;
  readonly scope: TActorResourceScope;
};

export type TActorSecretStoreResourceRequirement = {
  readonly kind: 'secretStore';
  readonly required: boolean;
  readonly scope: TActorResourceScope;
};

export type TActorDbSchemaRequirement = {
  readonly id: string;
  readonly version: number;
};

export type TActorDbParameterType = 'string' | 'number' | 'boolean' | 'bigint' | 'bytes' | 'json';

export type TActorDbOperationParameterDeclaration = {
  readonly type: TActorDbParameterType;
  readonly required?: boolean;
  readonly nullable?: boolean;
};

export type TActorDbNamedOperation = {
  readonly effect: TActorResourcePermission;
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, TActorDbOperationParameterDeclaration>>;
  readonly result: 'rows' | 'execute';
};

export type TActorDbResourceRequirement = {
  readonly kind: 'db';
  readonly required: boolean;
  readonly scope: TActorResourceScope;
  readonly schema: TActorDbSchemaRequirement;
  readonly arbitrarySql?: boolean;
  readonly operations?: Readonly<Record<string, TActorDbNamedOperation>>;
};

export type TActorResourceRequirement =
  | TActorKvResourceRequirement
  | TActorSecretStoreResourceRequirement
  | TActorDbResourceRequirement;

export type TActorResourceRequirements = Readonly<Record<string, TActorResourceRequirement>>;

export type TActorResourceIpcValue =
  | null
  | string
  | number
  | boolean
  | bigint
  | Uint8Array
  | TActorResourceIpcValue[]
  | { [key: string]: TActorResourceIpcValue | undefined };

export type TGenericActorResourceErrorCode =
  | 'RESOURCE_NOT_BOUND'
  | 'RESOURCE_SLOT_UNKNOWN'
  | 'RESOURCE_KIND_MISMATCH'
  | 'RESOURCE_SCHEMA_MISMATCH'
  | 'RESOURCE_VERSION_MISMATCH'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_MIGRATING'
  | 'RESOURCE_READ_NOT_ALLOWED'
  | 'RESOURCE_WRITE_NOT_ALLOWED'
  | 'RESOURCE_CALL_CANCELLED'
  | 'RESOURCE_PROVIDER_UNAVAILABLE';

export type TKvResourceErrorCode =
  | 'KV_RESOURCE_NOT_BOUND'
  | 'KV_RESOURCE_UNAVAILABLE'
  | 'KV_KEY_INVALID'
  | 'KV_VALUE_INVALID'
  | 'KV_ENTRY_CONFLICT'
  | 'KV_LIST_LIMIT_EXCEEDED'
  | 'KV_WRITE_NOT_ALLOWED'
  | 'KV_OPERATION_FAILED';

export type TSecretStoreResourceErrorCode =
  | 'SECRET_STORE_NOT_BOUND'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'SECRET_NAME_INVALID'
  | 'SECRET_VALUE_INVALID'
  | 'SECRET_NOT_FOUND'
  | 'SECRET_CONFLICT'
  | 'SECRET_WRITE_NOT_ALLOWED'
  | 'SECRET_OPERATION_FAILED';

export type TDbResourceErrorCode =
  | 'DB_RESOURCE_NOT_BOUND'
  | 'DB_RESOURCE_UNAVAILABLE'
  | 'DB_RESOURCE_MIGRATING'
  | 'DB_RESOURCE_SCHEMA_MISMATCH'
  | 'DB_RESOURCE_VERSION_MISMATCH'
  | 'DB_RESOURCE_MIGRATION_CHANGED'
  | 'DB_RESOURCE_MIGRATION_FAILED'
  | 'DB_RESOURCE_RECOVERY_FAILED'
  | 'DB_NAMED_OPERATION_UNKNOWN'
  | 'DB_OPERATION_PARAMETERS_INVALID'
  | 'DB_READ_NOT_ALLOWED'
  | 'DB_WRITE_NOT_ALLOWED'
  | 'DB_ARBITRARY_SQL_NOT_ALLOWED'
  | 'DB_QUERY_FAILED'
  | 'DB_EXECUTE_FAILED'
  | 'DB_RESULT_LIMIT_EXCEEDED'
  | 'DB_BUSY'
  | 'DB_RESOURCE_DELETE_FAILED';

export type TActorResourceErrorCode =
  | TGenericActorResourceErrorCode
  | TKvResourceErrorCode
  | TSecretStoreResourceErrorCode
  | TDbResourceErrorCode;

export type TActorResourceCallError<TCode extends string = TActorResourceErrorCode> = {
  readonly code: TCode;
  readonly message: string;
  readonly details?: TVibecanvasJsonValue;
};

export type TActorResourceCallRequest = {
  readonly callId: string;
  readonly runId: number;
  readonly slot: string;
  readonly kind: TActorResourceKind;
  readonly operation: string;
  readonly args: TActorResourceIpcValue;
};

export type TActorResourceCallResponse<
  TResult extends TActorResourceIpcValue = TActorResourceIpcValue,
  TCode extends string = TActorResourceErrorCode,
> =
  | { readonly callId: string; readonly ok: true; readonly result: TResult }
  | { readonly callId: string; readonly ok: false; readonly error: TActorResourceCallError<TCode> };

export type TResourceListOptions = {
  readonly prefix?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type TKvResourceEntry<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> = {
  readonly value: TValue;
  readonly revision: number;
};

export type TKvResourceListItem<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> =
  TKvResourceEntry<TValue> & { readonly key: string };

export type TKvResourceListPage<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> = {
  readonly items: readonly TKvResourceListItem<TValue>[];
  readonly nextCursor?: string;
};

export type TKvResourceSetArgs<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> = {
  readonly key: string;
  readonly value: TValue;
};

export type TKvResourceCompareAndSetArgs<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> =
  TKvResourceSetArgs<TValue> & { readonly expectedRevision: number | null };

export type TKvResourceCompareAndSetResult<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> =
  | { readonly ok: true; readonly entry: TKvResourceEntry<TValue> }
  | { readonly ok: false; readonly currentRevision: number | null };

export type TKvResourceDeleteResult = { readonly deleted: boolean };

export interface TKvResourceReadPortal {
  get<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(key: string): Promise<TKvResourceEntry<TValue> | null>;
  has(key: string): Promise<boolean>;
  list<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(options?: TResourceListOptions): Promise<TKvResourceListPage<TValue>>;
}

export interface TKvResourceWritePortal extends TKvResourceReadPortal {
  set<TValue extends TVibecanvasJsonValue>(args: TKvResourceSetArgs<TValue>): Promise<TKvResourceEntry<TValue>>;
  delete(key: string): Promise<TKvResourceDeleteResult>;
  compareAndSet<TValue extends TVibecanvasJsonValue>(args: TKvResourceCompareAndSetArgs<TValue>): Promise<TKvResourceCompareAndSetResult<TValue>>;
}

export type TSecretStoreResourceEntry = {
  readonly value: string;
  readonly revision: number;
};

export type TSecretStoreResourceListItem = {
  readonly name: string;
  readonly revision: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type TSecretStoreResourceListPage = {
  readonly items: readonly TSecretStoreResourceListItem[];
  readonly nextCursor?: string;
};

export type TSecretStoreResourceSetArgs = {
  readonly name: string;
  readonly value: string;
};

export type TSecretStoreResourceSetResult = {
  readonly name: string;
  readonly revision: number;
};

export type TSecretStoreResourceCompareAndSetArgs = TSecretStoreResourceSetArgs & {
  readonly expectedRevision: number | null;
};

export type TSecretStoreResourceCompareAndSetResult =
  | { readonly ok: true; readonly entry: TSecretStoreResourceSetResult }
  | { readonly ok: false; readonly currentRevision: number | null };

export type TSecretStoreResourceDeleteResult = { readonly deleted: boolean };

export interface TSecretStoreResourceReadPortal {
  get(name: string): Promise<TSecretStoreResourceEntry | null>;
  has(name: string): Promise<boolean>;
  list(options?: TResourceListOptions): Promise<TSecretStoreResourceListPage>;
}

export interface TSecretStoreResourceWritePortal extends TSecretStoreResourceReadPortal {
  set(args: TSecretStoreResourceSetArgs): Promise<TSecretStoreResourceSetResult>;
  delete(name: string): Promise<TSecretStoreResourceDeleteResult>;
  compareAndSet(args: TSecretStoreResourceCompareAndSetArgs): Promise<TSecretStoreResourceCompareAndSetResult>;
}

export type TDbResourceValue = null | string | number | bigint | Uint8Array;

export type TDbResourceParameterValue = TDbResourceValue | boolean | TVibecanvasJsonValue;

export type TDbResourceParameters = Readonly<Record<string, TDbResourceParameterValue>>;

export type TDbResourceRow = Readonly<Record<string, TDbResourceValue>>;

export type TDbResourceExecuteResult = {
  readonly rowsAffected: number;
  readonly lastInsertRowId?: bigint;
};

export type TDbResourceExecuteOperation = {
  readonly sql: string;
  readonly parameters?: TDbResourceParameters;
};

export type TDbResourceOperationResult = readonly TDbResourceRow[] | TDbResourceExecuteResult;

export interface TDbResourceReadPortal {
  invoke<TResult extends TActorResourceIpcValue = TActorResourceIpcValue>(operation: string, parameters?: TDbResourceParameters): Promise<TResult>;
  query<TRow extends TDbResourceRow = TDbResourceRow>(sql: string, parameters?: TDbResourceParameters): Promise<readonly TRow[]>;
}

export interface TDbResourceWritePortal extends TDbResourceReadPortal {
  /** Executes one write-capable statement. Always requires tx write access. */
  execute(sql: string, parameters?: TDbResourceParameters): Promise<TDbResourceExecuteResult>;
  /**
   * Executes ordered statements on one resolved DbResource connection without interleaving.
   * Transaction boundaries are caller-controlled: include BEGIN/COMMIT/ROLLBACK/SAVEPOINT
   * operations when atomicity or partial rollback is required.
   */
  execute(operations: readonly TDbResourceExecuteOperation[]): Promise<readonly TDbResourceExecuteResult[]>;
}

export type TActorReadResources = {
  readonly kv: (slot: string) => TKvResourceReadPortal;
  readonly secretStore: (slot: string) => TSecretStoreResourceReadPortal;
  readonly db: (slot: string) => TDbResourceReadPortal;
};

export type TActorWriteResources = {
  readonly kv: (slot: string) => TKvResourceWritePortal;
  readonly secretStore: (slot: string) => TSecretStoreResourceWritePortal;
  readonly db: (slot: string) => TDbResourceWritePortal;
};

export type TActorFunctionPortal = {
  next: () => Promise<unknown>;
  emitMessage: (msg: TActorOutputEnvelope) => Promise<void>;
};

export type TActorReadPortal = TActorFunctionPortal & {
  setData: (data: TVibecanvasJsonValue) => Promise<void>;
  readonly resources: TActorReadResources;
};

export type TActorWritePortal = Omit<TActorReadPortal, 'resources'> & {
  readonly resources: TActorWriteResources;
};

export type TActorFunctionArgs<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue> = {
  readonly data: TContext;
  readonly context?: TContext;
  readonly msg: TMsg;
};

export type TFnPortal = TActorFunctionPortal;
export type TFxPortal = TActorReadPortal;
export type TTxPortal = TActorWritePortal;

export type TActorFn<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorFunctionPortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorFx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorReadPortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorTx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown> = (
  portal: TActorWritePortal,
  args: TActorFunctionArgs<TContext, TMsg>,
) => TResult | Promise<TResult>;

export type TActorFunctionRegistry<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
> = {
  readonly fn?: Record<`fn.${string}`, TActorFn<TContext, TInput[keyof TInput & string]>>;
  readonly fx?: Record<`fx.${string}`, TActorFx<TContext, TInput[keyof TInput & string]>>;
  readonly tx?: Record<`tx.${string}`, TActorTx<TContext, TInput[keyof TInput & string]>>;
};

export function defineActorFunctions<
  TContext = TVibecanvasJsonValue,
  TInput extends TMessageMap = TMessageMap,
>(registry: TActorFunctionRegistry<TContext, TInput>): TActorFunctionRegistry<TContext, TInput> {
  return registry;
}

export function defineFn<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  fn: TActorFn<TContext, TMsg, TResult>,
): TActorFn<TContext, TMsg, TResult> {
  return fn;
}

export function defineFx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  fx: TActorFx<TContext, TMsg, TResult>,
): TActorFx<TContext, TMsg, TResult> {
  return fx;
}

export function defineTx<TContext = TVibecanvasJsonValue, TMsg = TVibecanvasJsonValue, TResult = unknown>(
  tx: TActorTx<TContext, TMsg, TResult>,
): TActorTx<TContext, TMsg, TResult> {
  return tx;
}

export type { TActorOutputEnvelope, TMessageMap, TVibecanvasJsonValue } from './shared';
