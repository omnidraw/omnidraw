/** @file Fixed widget-facing resource operations, effects, shapes, and limits. */

import {
  fnDecodePortableResourceDbExecute,
  fnDecodePortableResourceDbRows,
  fnEncodePortableResourceValue,
  type TPortableResourceEffect,
  type TPortableResourceWireValue,
} from './fn.resource-wire';
import {
  fnValidatePortableResourceSql,
} from './fn.portable-resource-sql';

export type TPortableResourceKind = 'kv' | 'db';
export type TPortableResourceOperationEffect = TPortableResourceEffect | 'declared';

export const PORTABLE_RESOURCE_OPERATION_LIMITS = Object.freeze({
  keyBytes: 4_096,
  valueWireBytes: 1_048_576,
  listLimit: 500,
  cursorBytes: 4_096,
  databaseParameterCount: 128,
  databaseBatchCount: 256,
  databaseBatchSqlBytes: 1_048_576,
});

export type TPortableResourceOperationInputSchema =
  | 'kv-key'
  | 'kv-list'
  | 'kv-set'
  | 'kv-delete'
  | 'kv-compare-and-set'
  | 'db-invoke'
  | 'db-query'
  | 'db-execute';

export type TPortableResourceOperationResultSchema =
  | 'kv-entry-or-null'
  | 'boolean'
  | 'kv-page'
  | 'kv-entry'
  | 'delete-result'
  | 'kv-compare-and-set-result'
  | 'declared-db-result'
  | 'db-rows'
  | 'db-execute-result';

export type TPortableResourceOperationDescriptor = Readonly<{
  effect: TPortableResourceOperationEffect;
  inputSchema: TPortableResourceOperationInputSchema;
  resultSchema: TPortableResourceOperationResultSchema;
}>;

function operation(
  effect: TPortableResourceOperationEffect,
  inputSchema: TPortableResourceOperationInputSchema,
  resultSchema: TPortableResourceOperationResultSchema,
): TPortableResourceOperationDescriptor {
  return Object.freeze({ effect, inputSchema, resultSchema });
}

export const PORTABLE_RESOURCE_OPERATION_REGISTRY = Object.freeze({
  kv: Object.freeze({
    get: operation('read', 'kv-key', 'kv-entry-or-null'),
    has: operation('read', 'kv-key', 'boolean'),
    list: operation('read', 'kv-list', 'kv-page'),
    set: operation('write', 'kv-set', 'kv-entry'),
    delete: operation('write', 'kv-delete', 'delete-result'),
    compareAndSet: operation(
      'write',
      'kv-compare-and-set',
      'kv-compare-and-set-result',
    ),
  }),
  db: Object.freeze({
    invoke: operation('declared', 'db-invoke', 'declared-db-result'),
    query: operation('read', 'db-query', 'db-rows'),
    execute: operation('write', 'db-execute', 'db-execute-result'),
  }),
} as const satisfies Readonly<Record<
  TPortableResourceKind,
  Readonly<Record<string, TPortableResourceOperationDescriptor>>
>>);

export type TPortableResourceOperationValidationCode =
  | 'UNKNOWN_OPERATION'
  | 'EFFECT_DENIED'
  | 'INVALID_INPUT'
  | 'INVALID_RESULT';

export class PortableResourceOperationError extends Error {
  readonly code: TPortableResourceOperationValidationCode;

  constructor(code: TPortableResourceOperationValidationCode, message: string) {
    super(message);
    this.name = 'PortableResourceOperationError';
    this.code = code;
  }
}

function fail(
  code: TPortableResourceOperationValidationCode,
  message: string,
): never {
  throw new PortableResourceOperationError(code, message);
}

function dataRecord(
  value: unknown,
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(code, `${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(code, `${label} must have a plain prototype.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return fail(code, `${label} has a symbol key.`);
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) return fail(code, `${label} must contain enumerable data properties only.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function onlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    fail(code, `${label} contains an unsupported field.`);
  }
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail(code, `${label} is missing a required field.`);
  }
}

function boundedString(
  value: unknown,
  maxBytes: number,
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.trim().length === 0)
    || new TextEncoder().encode(value).byteLength > maxBytes
  ) return fail(code, `${label} is invalid or exceeds its byte limit.`);
  return value;
}

function positiveRevision(
  value: unknown,
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail(code, `${label} must be a positive safe integer.`);
  }
  return value as number;
}

function optionalRevision(
  value: unknown,
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
): void {
  if (value !== undefined) positiveRevision(value, label, code);
}

function nullableRevision(
  value: unknown,
  label: string,
  code: Extract<TPortableResourceOperationValidationCode, 'INVALID_INPUT' | 'INVALID_RESULT'>,
): void {
  if (value !== null) positiveRevision(value, label, code);
}

function hasExtendedValue(value: TPortableResourceWireValue): boolean {
  if (value.type === 'bigint' || value.type === 'bytes') return true;
  if (value.type === 'array') return value.items.some(hasExtendedValue);
  if (value.type === 'object') {
    return value.entries.some(([, nested]) => hasExtendedValue(nested));
  }
  return false;
}

function assertJsonValue(value: unknown, label: string): void {
  let encoded: TPortableResourceWireValue;
  try {
    encoded = fnEncodePortableResourceValue(value, {
      maxWireBytes: PORTABLE_RESOURCE_OPERATION_LIMITS.valueWireBytes,
    });
  } catch {
    return fail('INVALID_INPUT', `${label} must be bounded portable JSON.`);
  }
  if (hasExtendedValue(encoded)) {
    fail('INVALID_INPUT', `${label} must not contain bigint or bytes.`);
  }
}

function assertPortableValue(value: unknown, label: string): void {
  try {
    fnEncodePortableResourceValue(value, {
      maxWireBytes: PORTABLE_RESOURCE_OPERATION_LIMITS.valueWireBytes,
    });
  } catch {
    fail('INVALID_INPUT', `${label} is not a bounded portable value.`);
  }
}

function keyInput(input: unknown): Readonly<Record<string, unknown>> {
  const record = dataRecord(input, 'Resource operation input', 'INVALID_INPUT');
  onlyKeys(record, ['key'], ['key'], 'Resource operation input', 'INVALID_INPUT');
  boundedString(
    record.key,
    PORTABLE_RESOURCE_OPERATION_LIMITS.keyBytes,
    'Resource key',
    'INVALID_INPUT',
  );
  return record;
}

function listInput(
  input: unknown,
  keyLimit: number,
): Readonly<Record<string, unknown>> {
  const record = dataRecord(input, 'Resource list input', 'INVALID_INPUT');
  onlyKeys(
    record,
    ['prefix', 'cursor', 'limit'],
    [],
    'Resource list input',
    'INVALID_INPUT',
  );
  if (record.prefix !== undefined) {
    boundedString(record.prefix, keyLimit, 'Resource list prefix', 'INVALID_INPUT', true);
  }
  if (record.cursor !== undefined) {
    boundedString(
      record.cursor,
      PORTABLE_RESOURCE_OPERATION_LIMITS.cursorBytes,
      'Resource list cursor',
      'INVALID_INPUT',
    );
  }
  if (
    record.limit !== undefined
    && (!Number.isSafeInteger(record.limit)
      || (record.limit as number) < 1
      || (record.limit as number) > PORTABLE_RESOURCE_OPERATION_LIMITS.listLimit)
  ) fail('INVALID_INPUT', 'Resource list limit is invalid.');
  return record;
}

function parameterRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze({});
  const parameters = dataRecord(value, 'Database parameters', 'INVALID_INPUT');
  if (
    Object.keys(parameters).length
    > PORTABLE_RESOURCE_OPERATION_LIMITS.databaseParameterCount
  ) fail('INVALID_INPUT', 'Database parameters exceed their count limit.');
  for (const [name, parameter] of Object.entries(parameters)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) {
      fail('INVALID_INPUT', 'Database parameter name is invalid.');
    }
    assertPortableValue(parameter, `Database parameter '${name}'`);
  }
  return parameters;
}

function sqlInput(
  value: unknown,
  effect: TPortableResourceEffect,
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value, 'Database SQL input', 'INVALID_INPUT');
  onlyKeys(
    record,
    ['sql', 'parameters'],
    ['sql'],
    'Database SQL input',
    'INVALID_INPUT',
  );
  if (typeof record.sql !== 'string') fail('INVALID_INPUT', 'Database SQL is invalid.');
  const classification = fnValidatePortableResourceSql({
    sql: record.sql,
    expectedEffect: effect,
  });
  if (!classification.allowed) {
    fail('INVALID_INPUT', classification.message);
  }
  parameterRecord(record.parameters);
  return record;
}

function validateInput(
  schema: TPortableResourceOperationInputSchema,
  input: unknown,
): void {
  if (schema === 'kv-key') {
    keyInput(input);
    return;
  }
  if (schema === 'kv-list') {
    listInput(input, PORTABLE_RESOURCE_OPERATION_LIMITS.keyBytes);
    return;
  }
  if (schema === 'kv-set' || schema === 'kv-compare-and-set') {
    const record = dataRecord(input, 'KV write input', 'INVALID_INPUT');
    onlyKeys(
      record,
      schema === 'kv-set' ? ['key', 'value'] : ['key', 'expectedRevision', 'value'],
      schema === 'kv-set' ? ['key', 'value'] : ['key', 'expectedRevision', 'value'],
      'KV write input',
      'INVALID_INPUT',
    );
    boundedString(
      record.key,
      PORTABLE_RESOURCE_OPERATION_LIMITS.keyBytes,
      'KV key',
      'INVALID_INPUT',
    );
    if (schema === 'kv-compare-and-set') {
      nullableRevision(record.expectedRevision, 'KV expected revision', 'INVALID_INPUT');
    }
    assertJsonValue(record.value, 'KV value');
    return;
  }
  if (schema === 'kv-delete') {
    const record = dataRecord(input, 'KV delete input', 'INVALID_INPUT');
    onlyKeys(
      record,
      ['key', 'expectedRevision'],
      ['key'],
      'KV delete input',
      'INVALID_INPUT',
    );
    boundedString(
      record.key,
      PORTABLE_RESOURCE_OPERATION_LIMITS.keyBytes,
      'KV key',
      'INVALID_INPUT',
    );
    optionalRevision(record.expectedRevision, 'KV expected revision', 'INVALID_INPUT');
    return;
  }
  if (schema === 'db-invoke') {
    const record = dataRecord(input, 'Named database input', 'INVALID_INPUT');
    onlyKeys(
      record,
      ['operation', 'parameters'],
      ['operation'],
      'Named database input',
      'INVALID_INPUT',
    );
    boundedString(record.operation, 512, 'Named database operation', 'INVALID_INPUT');
    parameterRecord(record.parameters);
    return;
  }
  if (schema === 'db-query') {
    sqlInput(input, 'read');
    return;
  }
  const record = dataRecord(input, 'Database execute input', 'INVALID_INPUT');
  const hasSql = Object.prototype.hasOwnProperty.call(record, 'sql');
  const hasOperations = Object.prototype.hasOwnProperty.call(record, 'operations');
  if (hasSql === hasOperations) {
    fail('INVALID_INPUT', 'Database execute requires SQL or an operation batch, exclusively.');
  }
  if (hasSql) {
    sqlInput(input, 'write');
    return;
  }
  onlyKeys(
    record,
    ['operations'],
    ['operations'],
    'Database execute batch',
    'INVALID_INPUT',
  );
  if (
    !Array.isArray(record.operations)
    || record.operations.length < 1
    || record.operations.length > PORTABLE_RESOURCE_OPERATION_LIMITS.databaseBatchCount
  ) fail('INVALID_INPUT', 'Database execute batch size is invalid.');
  let sqlBytes = 0;
  for (const item of record.operations) {
    const validated = sqlInput(item, 'write');
    sqlBytes += new TextEncoder().encode(validated.sql as string).byteLength;
    if (sqlBytes > PORTABLE_RESOURCE_OPERATION_LIMITS.databaseBatchSqlBytes) {
      fail('INVALID_INPUT', 'Database execute batch SQL exceeds its byte limit.');
    }
  }
}

function validateKvEntry(value: unknown, allowNull: boolean): void {
  if (allowNull && value === null) return;
  const record = dataRecord(value, 'KV entry result', 'INVALID_RESULT');
  onlyKeys(record, ['value', 'revision'], ['value', 'revision'], 'KV entry result', 'INVALID_RESULT');
  positiveRevision(record.revision, 'KV revision', 'INVALID_RESULT');
  try {
    assertJsonValue(record.value, 'KV result value');
  } catch {
    fail('INVALID_RESULT', 'KV result value is invalid.');
  }
}

function validateResult(
  schema: TPortableResourceOperationResultSchema,
  value: unknown,
  declaredResult?: 'rows' | 'execute',
): void {
  if (schema === 'boolean') {
    if (typeof value !== 'boolean') fail('INVALID_RESULT', 'Resource result must be boolean.');
    return;
  }
  if (schema === 'kv-entry-or-null' || schema === 'kv-entry') {
    validateKvEntry(value, schema === 'kv-entry-or-null');
    return;
  }
  if (schema === 'delete-result') {
    const record = dataRecord(value, 'Delete result', 'INVALID_RESULT');
    onlyKeys(record, ['deleted'], ['deleted'], 'Delete result', 'INVALID_RESULT');
    if (typeof record.deleted !== 'boolean') fail('INVALID_RESULT', 'Delete result is invalid.');
    return;
  }
  if (schema === 'kv-page') {
    const record = dataRecord(value, 'KV page result', 'INVALID_RESULT');
    onlyKeys(record, ['items', 'nextCursor'], ['items'], 'KV page result', 'INVALID_RESULT');
    if (!Array.isArray(record.items) || record.items.length > PORTABLE_RESOURCE_OPERATION_LIMITS.listLimit) {
      fail('INVALID_RESULT', 'KV page items are invalid.');
    }
    for (const item of record.items) {
      const entry = dataRecord(item, 'KV page item', 'INVALID_RESULT');
      onlyKeys(entry, ['key', 'value', 'revision'], ['key', 'value', 'revision'], 'KV page item', 'INVALID_RESULT');
      boundedString(entry.key, PORTABLE_RESOURCE_OPERATION_LIMITS.keyBytes, 'KV result key', 'INVALID_RESULT');
      positiveRevision(entry.revision, 'KV revision', 'INVALID_RESULT');
      try { assertJsonValue(entry.value, 'KV result value'); } catch {
        fail('INVALID_RESULT', 'KV result value is invalid.');
      }
    }
    if (record.nextCursor !== undefined) {
      boundedString(record.nextCursor, PORTABLE_RESOURCE_OPERATION_LIMITS.cursorBytes, 'KV cursor', 'INVALID_RESULT');
    }
    return;
  }
  if (schema === 'kv-compare-and-set-result') {
    const record = dataRecord(value, 'KV compare-and-set result', 'INVALID_RESULT');
    if (record.ok === true) {
      onlyKeys(record, ['ok', 'entry'], ['ok', 'entry'], 'KV compare-and-set result', 'INVALID_RESULT');
      validateKvEntry(record.entry, false);
    } else if (record.ok === false) {
      onlyKeys(record, ['ok', 'currentRevision'], ['ok', 'currentRevision'], 'KV compare-and-set result', 'INVALID_RESULT');
      nullableRevision(record.currentRevision, 'KV current revision', 'INVALID_RESULT');
    } else fail('INVALID_RESULT', 'KV compare-and-set result is invalid.');
    return;
  }
  const dbResult = schema === 'declared-db-result' ? declaredResult : schema === 'db-rows' ? 'rows' : 'execute';
  if (dbResult === undefined) {
    fail('INVALID_RESULT', 'Named database result shape was not supplied by the host declaration.');
  }
  try {
    if (dbResult === 'rows') {
      fnDecodePortableResourceDbRows(value);
    } else if (Array.isArray(value)) {
      if (value.length < 1 || value.length > PORTABLE_RESOURCE_OPERATION_LIMITS.databaseBatchCount) {
        fail('INVALID_RESULT', 'Database batch result size is invalid.');
      }
      for (const item of value) fnDecodePortableResourceDbExecute(item);
    } else {
      fnDecodePortableResourceDbExecute(value);
    }
  } catch (error) {
    if (error instanceof PortableResourceOperationError) throw error;
    fail('INVALID_RESULT', 'Database result does not match its portable shape.');
  }
}

export function fnGetPortableResourceOperation(
  kind: TPortableResourceKind,
  operationName: string,
): TPortableResourceOperationDescriptor | null {
  const operations = PORTABLE_RESOURCE_OPERATION_REGISTRY[kind] as Readonly<
    Record<string, TPortableResourceOperationDescriptor>
  >;
  return operations[operationName] ?? null;
}

export function fnValidatePortableResourceOperationInput(args: Readonly<{
  kind: TPortableResourceKind;
  operation: string;
  effect: TPortableResourceEffect;
  input: unknown;
  declaredEffect?: TPortableResourceEffect;
}>): void {
  const descriptor = fnGetPortableResourceOperation(args.kind, args.operation);
  if (descriptor === null) {
    fail('UNKNOWN_OPERATION', `Unknown ${args.kind} resource operation '${args.operation}'.`);
  }
  const effect = descriptor.effect === 'declared' ? args.declaredEffect : descriptor.effect;
  if (effect === undefined || effect !== args.effect) {
    fail('EFFECT_DENIED', 'Resource operation effect does not match its portable declaration.');
  }
  validateInput(descriptor.inputSchema, args.input);
}

export function fnValidatePortableResourceOperationResult(args: Readonly<{
  kind: TPortableResourceKind;
  operation: string;
  result: unknown;
  declaredResult?: 'rows' | 'execute';
}>): void {
  const descriptor = fnGetPortableResourceOperation(args.kind, args.operation);
  if (descriptor === null) {
    fail('UNKNOWN_OPERATION', `Unknown ${args.kind} resource operation '${args.operation}'.`);
  }
  validateResult(descriptor.resultSchema, args.result, args.declaredResult);
}
