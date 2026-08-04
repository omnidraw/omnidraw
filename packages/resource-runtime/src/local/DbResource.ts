import type { Database } from '@tursodatabase/database';
import { Database as SQLiteDatabase } from 'bun:sqlite';
import { Buffer } from 'node:buffer';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ResourceError, toResourceError } from '../ResourceError';
import type {
  TDbCellValue,
  TDbColumn,
  TDbColumnDefinition,
  TDbDraftOperation,
  TDbForeignKey,
  TDbIndex,
  TDbInspection,
  TDbLiveSqlResult,
  TDbObject,
  TDbRow,
  TDbRowCreate,
  TDbRowDelete,
  TDbRowIdentity,
  TDbRowsPage,
  TDbPreviewCellValue,
  TDbRowUpdate,
  TDbTrigger,
  TResourceKind,
} from '../types';
import type {
  ILocalResourceProvider,
  TLocalResolvedResourceCall,
  TLocalResourceRequirement,
  TLocalResourceReconcileResult,
  TResourceIdleSweepScheduler,
} from './ResourceProviderTypes';

type TDbParameterType = 'string' | 'number' | 'boolean' | 'bigint' | 'bytes' | 'json';

type TDbOperationParameterDeclaration = Readonly<{
  type: TDbParameterType;
  required?: boolean;
  nullable?: boolean;
}>;

type TDbNamedOperation = Readonly<{
  effect: 'read' | 'write';
  sql: string;
  parameters?: Readonly<Record<string, TDbOperationParameterDeclaration>>;
  result: 'rows' | 'execute';
}>;

type TDbProviderRequirement = Readonly<{
  kind: 'db';
  required: boolean;
  scope: readonly ('read' | 'write')[];
  arbitrarySql?: boolean;
  operations?: Readonly<Record<string, TDbNamedOperation>>;
}>;

type TResourceProviderRequirement = Readonly<{
  kind: Exclude<TResourceKind, 'db'>;
  required: boolean;
  scope: readonly ('read' | 'write')[];
}> | TDbProviderRequirement;

type TDbProviderResource = Readonly<{ id: string; kind: TResourceKind }>;
type TResourceProviderCreateArgs = Readonly<Record<string, never>>;

type TDbResolvedProviderCall = TLocalResolvedResourceCall;

type TDbDraftChangeRecord = Readonly<{
  sequence: number;
  kind: 'structure' | 'sql';
  operation: unknown;
  sql: string;
}>;

type TDbDraftCatalogRecord = Readonly<{
  id: string;
  createdAtSec: string;
}>;

type TDbResourceControlStore = Readonly<{
  dbResource: Readonly<{
    draft: Readonly<{
      list(args: Readonly<{
        resourceId: string;
        before?: Readonly<{ createdAtSec: string; id: string }>;
        limit?: number;
      }>): Promise<readonly TDbDraftCatalogRecord[]>;
    }>;
  }>;
}>;

const RESOURCE_ID_MAX_LENGTH = 128;
const IDENTIFIER_MAX_LENGTH = 256;
const GUEST_SQL_MAX_LENGTH = 65_536;
const DRAFT_SQL_MAX_LENGTH = 1_048_576;
const DRAFT_STATEMENT_MAX_COUNT = 256;
const PARAMETER_MAX_COUNT = 128;
const EXECUTE_OPERATION_MAX_COUNT = 256;
const EXECUTE_TOTAL_SQL_MAX_LENGTH = 1_048_576;
const PARAMETER_BYTES_MAX = 1_048_576;
const RESULT_ROW_MAX_COUNT = 1_000;
const RESULT_COLUMN_MAX_COUNT = 128;
const RESULT_BYTES_MAX = 4_194_304;
const QUERY_TIMEOUT_MS = 5_000;
const ROW_PAGE_MAX = 200;
const ROW_BLOB_PREVIEW_BYTES = 64;
const LIVE_SQL_ROW_MAX = 200;
const ROW_HYDRATION_BYTES_MAX = 1_048_576;
const LIVE_SQL_BYTES_MAX = 1_048_576;
const ROW_BULK_MAX = 100;
const INSPECTION_OBJECT_MAX = 256;
const INSPECTION_MEMBER_MAX = 512;
const INSPECTION_SQL_MAX_LENGTH = 1_048_576;
const SQLITE_INTEGER_MIN = -9_223_372_036_854_775_808n;
const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;
const SQLITE_STRICT_COLUMN_TYPES = ['INT', 'INTEGER', 'REAL', 'TEXT', 'BLOB', 'ANY'] as const;

export const DB_RESOURCE_DEFAULT_MAX_OPEN_HANDLES = 32;
export const DB_RESOURCE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS = 60_000;

const APPLY_MARKER_SQL = `
CREATE TABLE IF NOT EXISTS \`_omnidraw_apply_markers\` (
  \`apply_id\` TEXT PRIMARY KEY NOT NULL,
  \`applied_at\` TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
`;

const DRAFT_CHANGE_EVIDENCE_SQL = `
CREATE TABLE IF NOT EXISTS \`_omnidraw_draft_change_evidence\` (
  \`sequence\` INTEGER PRIMARY KEY NOT NULL CHECK (\`sequence\` >= 1),
  \`kind\` TEXT NOT NULL CHECK (\`kind\` IN ('structure', 'sql')),
  \`sql\` TEXT NOT NULL CHECK (length(trim(\`sql\`)) > 0)
) STRICT;
`;

const RESOURCE_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA temp_store = 2;
`;

export type TDatabaseFactory = (
  databasePath: string,
  options: ConstructorParameters<typeof Database>[1],
) => Database;

export type TDbResourceConfig = {
  readonly db: TDbResourceControlStore;
  readonly dataRoot: string;
  readonly databaseFactory: TDatabaseFactory;
  readonly maxOpenHandles?: number;
  readonly idleHandleTimeoutMs?: number;
  readonly nowMs?: () => number;
  readonly scheduleIdleSweep?: TResourceIdleSweepScheduler;
};

type TDbBindValue = null | string | number | bigint | Uint8Array;
type TDbBindParameters = readonly TDbBindValue[] | Record<string, TDbBindValue>;
type TDbExecuteOperation = { readonly sql: string; readonly parameters: TDbBindParameters };
type TNativeRow = Record<string, null | string | number | bigint | Uint8Array>;
export type TDbDraftChangeEvidence = { readonly sequence: number; readonly kind: 'structure' | 'sql'; readonly sql: string };

function validateHostId(value: string, label = 'DbResource'): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > RESOURCE_ID_MAX_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  ) {
    throw new ResourceError('DB_RESOURCE_UNAVAILABLE', `${label} has an invalid host identity.`);
  }
  return value;
}

function validateIdentifier(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > IDENTIFIER_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Database object name is invalid.');
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${validateIdentifier(value).replaceAll('"', '""')}"`;
}

function isInternalObject(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('sqlite_')
    || lower.startsWith('_omnidraw_')
    || lower.startsWith('libsql_')
    || lower.startsWith('_turso_')
    || lower.startsWith('_litestream_');
}

function boundedInspectionSql(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > INSPECTION_SQL_MAX_LENGTH) {
    throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database structure SQL exceeds the inspection limit.');
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function recordArgs(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database operation arguments must be an object.');
  }
  return value;
}

function sqlSummary(sql: string): { statementCount: number; tokens: string[] } {
  const tokens: string[] = [];
  let token = '';
  let statementCount = 0;
  let hasContent = false;
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' = 'normal';
  const finish = () => {
    if (token) tokens.push(token.toUpperCase());
    token = '';
  };
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (mode === 'line') {
      if (char === '\n' || char === '\r') mode = 'normal';
      continue;
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { mode = 'normal'; index += 1; }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const close = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (char === close) {
        if (next === close) index += 1;
        else mode = 'normal';
      }
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']') mode = 'normal';
      continue;
    }
    if (char === '-' && next === '-') { finish(); mode = 'line'; index += 1; continue; }
    if (char === '/' && next === '*') { finish(); mode = 'block'; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      finish(); hasContent = true;
      mode = char === "'" ? 'single' : char === '"' ? 'double' : char === '`' ? 'backtick' : 'bracket';
      continue;
    }
    if (char === ';') {
      finish();
      if (hasContent) statementCount += 1;
      hasContent = false;
      continue;
    }
    if (/[A-Za-z_]/.test(char) || (token.length > 0 && /[0-9]/.test(char))) {
      token += char;
      hasContent = true;
      continue;
    }
    finish();
    if (!/\s/.test(char)) hasContent = true;
  }
  finish();
  if (hasContent) statementCount += 1;
  return { statementCount, tokens };
}

function hasHostFileSql(tokens: readonly string[]): boolean {
  if (tokens.some((token) => ['ATTACH', 'DETACH', 'LOAD_EXTENSION', 'READFILE', 'WRITEFILE', 'TEMP_STORE_DIRECTORY', 'DATA_STORE_DIRECTORY'].includes(token))) return true;
  const vacuum = tokens.indexOf('VACUUM');
  return vacuum >= 0 && tokens.slice(vacuum + 1).includes('INTO');
}

function boundedGuestSql(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > GUEST_SQL_MAX_LENGTH) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database SQL is blank or exceeds the host limit.');
  }
  const summary = sqlSummary(value);
  if (summary.statementCount !== 1) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Arbitrary database calls require exactly one SQL statement.');
  }
  if (hasHostFileSql(summary.tokens)) {
    throw new ResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Database SQL may not control host files or load extensions.');
  }
  return value;
}

function boundedDraftSql(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > DRAFT_SQL_MAX_LENGTH) {
    throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft SQL is blank or exceeds the host limit.');
  }
  const summary = sqlSummary(value);
  if (summary.statementCount < 1 || summary.statementCount > DRAFT_STATEMENT_MAX_COUNT || hasHostFileSql(summary.tokens)) {
    throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft SQL is invalid or attempts to control host files.');
  }
  if (summary.tokens.some((token) => token === 'BEGIN' || token === 'COMMIT' || token === 'ROLLBACK' || token === 'SAVEPOINT' || token === 'RELEASE')) {
    throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft SQL may not control the host apply transaction.');
  }
  return value;
}

function parameterBytes(value: TDbBindValue): number {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'bigint') return value.toString().length;
  return 8;
}

function assertBoundBytes(values: readonly TDbBindValue[], message: string): void {
  if (values.reduce<number>((total, value) => total + parameterBytes(value), 0) > PARAMETER_BYTES_MAX) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', message);
  }
}

function toBindValue(value: unknown): TDbBindValue {
  if (value === null || typeof value === 'bigint' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) || isPlainObject(value)) {
    try { return JSON.stringify(value); } catch { /* handled below */ }
  }
  throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameter has an unsupported value.');
}

function bindParameters(value: unknown): TDbBindParameters {
  if (value === undefined) return {};
  if (!isPlainObject(value) || Object.keys(value).length > PARAMETER_MAX_COUNT) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters must be a bounded object.');
  }
  const result: TDbBindParameters = {};
  let bytes = 0;
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameter has an invalid name.');
    }
    const converted = toBindValue(raw);
    bytes += Buffer.byteLength(name) + parameterBytes(converted);
    if (bytes > PARAMETER_BYTES_MAX) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters exceed the size limit.');
    result[name] = converted;
  }
  return result;
}

function bindWireParameters(value: unknown): TDbBindParameters {
  if (value === undefined) return {};
  if (Array.isArray(value)) {
    if (value.length > PARAMETER_MAX_COUNT) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters exceed the count limit.');
    }
    const result = value.map((raw) => fromWireValue(raw as TDbCellValue));
    assertBoundBytes(result, 'Database parameters exceed the size limit.');
    return result;
  }
  if (!isPlainObject(value) || Object.keys(value).length > PARAMETER_MAX_COUNT) {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters must be a bounded array or object.');
  }
  const result: TDbBindParameters = {};
  let bytes = 0;
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameter has an invalid name.');
    }
    const converted = fromWireValue(raw as TDbCellValue);
    bytes += Buffer.byteLength(name) + parameterBytes(converted);
    if (bytes > PARAMETER_BYTES_MAX) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters exceed the size limit.');
    result[name] = converted;
  }
  return result;
}

function draftSqlBindParameters(operation: TDbDraftChangeRecord['operation']): TDbBindParameters | null {
  if (!isPlainObject(operation) || operation.type !== 'boundSql' || !Array.isArray(operation.parameters)) return null;
  return bindWireParameters(operation.parameters);
}

function bindNamedParameters(requirement: TDbProviderRequirement, operationName: string, value: unknown): TDbBindParameters {
  const operation = requirement.operations?.[operationName];
  if (!operation) throw new ResourceError('DB_NAMED_OPERATION_UNKNOWN', `Named database operation "${operationName}" is not declared.`);
  const raw = value === undefined ? {} : recordArgs(value);
  const declarations = operation.parameters ?? {};
  for (const name of Object.keys(raw)) {
    if (!(name in declarations)) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Unknown parameter "${name}".`);
  }
  const result: TDbBindParameters = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    const supplied = Object.prototype.hasOwnProperty.call(raw, name) && raw[name] !== undefined;
    if (!supplied) {
      if (declaration.required !== false) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Required parameter "${name}" is missing.`);
      continue;
    }
    const value = raw[name];
    const valid = declaration.type === 'string' ? typeof value === 'string'
      : declaration.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : declaration.type === 'boolean' ? typeof value === 'boolean'
          : declaration.type === 'bigint' ? typeof value === 'bigint'
            : declaration.type === 'bytes' ? value instanceof Uint8Array
              : declaration.type === 'json';
    if (!valid) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Parameter "${name}" must have type ${declaration.type}.`);
    result[name] = toBindValue(value);
  }
  return result;
}

function toWireValue(value: unknown): TDbCellValue {
  if (value === null) return { type: 'null' };
  if (typeof value === 'bigint') {
    if (value < SQLITE_INTEGER_MIN || value > SQLITE_INTEGER_MAX) throw new ResourceError('DB_QUERY_FAILED', 'Database returned an out-of-range SQLite integer.');
    return { type: 'integer', value: value.toString() };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw new ResourceError('DB_QUERY_FAILED', 'Database returned an unsafe integer value.');
      return { type: 'integer', value: value.toString() };
    }
    return { type: 'real', value };
  }
  if (typeof value === 'string') return { type: 'text', value };
  if (value instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  if (value instanceof ArrayBuffer) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  throw new ResourceError('DB_QUERY_FAILED', 'Database returned an unsupported SQLite value.');
}

function toWireInteger(value: unknown): Extract<TDbCellValue, { type: 'integer' }> {
  const wire = toWireValue(value);
  if (wire.type !== 'integer') throw new ResourceError('DB_QUERY_FAILED', 'Database returned a non-integer rowid.');
  return wire;
}

function toPreviewWireValue(value: unknown): TDbPreviewCellValue {
  const wire = toWireValue(value);
  if (wire.type !== 'blob') return wire;
  const bytes = Buffer.from(wire.base64, 'base64');
  const preview = bytes.subarray(0, ROW_BLOB_PREVIEW_BYTES);
  return {
    type: 'blobPreview',
    byteLength: bytes.byteLength,
    previewBase64: preview.toString('base64'),
    truncated: bytes.byteLength > preview.byteLength,
  };
}

function toSqlBlobPreview(byteLength: unknown, preview: unknown): TDbPreviewCellValue | null {
  if (byteLength === null || byteLength === undefined) return null;
  const numericLength = typeof byteLength === 'bigint' ? Number(byteLength)
    : typeof byteLength === 'number' ? byteLength : Number.NaN;
  if (!Number.isSafeInteger(numericLength) || numericLength < 0) {
    throw new ResourceError('DB_QUERY_FAILED', 'Database returned an invalid BLOB length.');
  }
  const bytes = preview instanceof Uint8Array ? preview : preview instanceof ArrayBuffer ? new Uint8Array(preview) : null;
  if (!bytes) throw new ResourceError('DB_QUERY_FAILED', 'Database returned an invalid BLOB preview.');
  return {
    type: 'blobPreview',
    byteLength: numericLength,
    previewBase64: Buffer.from(bytes).toString('base64'),
    truncated: numericLength > bytes.byteLength,
  };
}

function fromWireValue(value: TDbCellValue): TDbBindValue {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database cell value is invalid.');
  }
  if (value.type === 'null') return null;
  if (value.type === 'integer') {
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(value.value)) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Integer cell value is invalid.');
    try {
      const integer = BigInt(value.value);
      if (integer < SQLITE_INTEGER_MIN || integer > SQLITE_INTEGER_MAX) throw new Error('out of range');
      return integer;
    } catch { throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Integer cell value is outside SQLite integer range.'); }
  }
  if (value.type === 'real' && Number.isFinite(value.value)) return value.value;
  if (value.type === 'text' && typeof value.value === 'string') return value.value;
  if (value.type === 'blob' && typeof value.base64 === 'string') {
    if (value.base64.length > 1_398_104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Blob cell value is not bounded canonical base64.');
    }
    const bytes = Buffer.from(value.base64, 'base64');
    if (bytes.byteLength > PARAMETER_BYTES_MAX || bytes.toString('base64') !== value.base64) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Blob cell value is not bounded canonical base64.');
    }
    return new Uint8Array(bytes);
  }
  throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database cell value is invalid.');
}

function normalizeNativeRow(raw: unknown, columnMax = RESULT_COLUMN_MAX_COUNT): TNativeRow {
  if (!isPlainObject(raw) || Object.keys(raw).length > columnMax) {
    throw new ResourceError('DB_QUERY_FAILED', 'Database returned an invalid row.');
  }
  const result: TNativeRow = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === null || typeof value === 'string' || typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) || value instanceof Uint8Array) {
      result[name] = value;
    } else if (value instanceof ArrayBuffer) {
      result[name] = new Uint8Array(value);
    } else {
      throw new ResourceError('DB_QUERY_FAILED', 'Database returned an unsupported value type.');
    }
  }
  return result;
}

function nativeRowBytes(row: TNativeRow): number {
  return Object.entries(row).reduce((total, [name, value]) => total + Buffer.byteLength(name) + parameterBytes(value), 0);
}

function columnSql(column: TDbColumnDefinition, includePrimaryKey = true): string {
  const name = quoteIdentifier(column.name);
  const declaredType = (column.declaredType ?? '').trim();
  if (declaredType && !/^[A-Za-z][A-Za-z0-9_ (),]*$/.test(declaredType)) {
    throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Declared SQLite type is invalid.');
  }
  const defaultSql = column.defaultSql?.trim() ?? '';
  if (defaultSql && !/^(?:NULL|TRUE|FALSE|CURRENT_(?:TIME|DATE|TIMESTAMP)|[-+]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)|'(?:''|[^'])*'|x'[0-9a-fA-F]*')$/.test(defaultSql)) {
    throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Column default must be a bounded SQLite literal or current-time keyword.');
  }
  return [name, declaredType, column.nullable === false ? 'NOT NULL' : '', defaultSql ? `DEFAULT ${defaultSql}` : '', includePrimaryKey && column.primaryKeyOrder ? 'PRIMARY KEY' : '']
    .filter(Boolean)
    .join(' ');
}

function tableOptions(createSql: string | null): { strict: boolean; withoutRowid: boolean } {
  const suffix = createSql?.match(/\)\s*((?:STRICT|WITHOUT\s+ROWID)(?:\s*,\s*(?:STRICT|WITHOUT\s+ROWID))*)\s*;?\s*$/i)?.[1] ?? '';
  return {
    strict: /(?:^|,)\s*STRICT\s*(?:,|$)/i.test(suffix),
    withoutRowid: /(?:^|,)\s*WITHOUT\s+ROWID\s*(?:,|$)/i.test(suffix),
  };
}

function tableOptionsSql(options: { readonly strict: boolean; readonly withoutRowid: boolean }): string {
  const values = [options.strict ? 'STRICT' : '', options.withoutRowid ? 'WITHOUT ROWID' : ''].filter(Boolean);
  return values.length > 0 ? ` ${values.join(', ')}` : '';
}

function requiresCombinedTableOptionsCompatibility(sql: string): boolean {
  return /\)\s*(?:STRICT\s*,\s*WITHOUT\s+ROWID|WITHOUT\s+ROWID\s*,\s*STRICT)\s*;/i.test(sql);
}

function validateStrictColumnTypes(columns: readonly TDbColumnDefinition[]): void {
  for (const column of columns) {
    const declaredType = (column.declaredType ?? '').trim().toUpperCase();
    if (!(SQLITE_STRICT_COLUMN_TYPES as readonly string[]).includes(declaredType)) {
      throw new ResourceError(
        'DB_RESOURCE_SCHEMA_OPERATION_INVALID',
        `STRICT table column "${column.name}" must use INT, INTEGER, REAL, TEXT, BLOB, or ANY; received ${declaredType || 'no declared type'}.`,
      );
    }
  }
}

function referentialAction(value: string | undefined): string {
  const action = (value ?? 'NO ACTION').toUpperCase();
  if (!['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'].includes(action)) {
    throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Foreign-key action is invalid.');
  }
  return action;
}

function defaultIdleSweepScheduler(
  callback: () => void | Promise<void>,
  delayMs: number,
): () => void {
  const timer = setTimeout(() => { void callback(); }, delayMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
}

export class DbResource implements ILocalResourceProvider {
  readonly kind = 'db' as const;
  readonly reconcileReady = true;
  readonly #db: TDbResourceControlStore;
  readonly #dataRoot: string;
  readonly #databaseFactory: TDatabaseFactory;
  readonly #maxOpenHandles: number;
  readonly #idleHandleTimeoutMs: number;
  readonly #nowMs: () => number;
  readonly #scheduleIdleSweep: TResourceIdleSweepScheduler;
  readonly #handles = new Map<string, Promise<Database>>();
  readonly #handleLastUsed = new Map<string, number>();
  readonly #handleLastUsedAtMs = new Map<string, number>();
  readonly #failedCloses = new Set<Database>();
  readonly #temporaryOperations = new Set<Promise<unknown>>();
  readonly #trackedTemporaryRequests = new Map<string, number>();
  readonly #handleCapacityWaiters = new Set<() => void>();
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();
  readonly #blocked = new Set<string>();
  #handleAdmissionTail: Promise<void> = Promise.resolve();
  #temporaryHandleCount = 0;
  #cancelIdleSweep: (() => void) | null = null;
  #closingHandleCount = 0;
  #handleClock = 0;
  #closed = false;

  constructor(config: TDbResourceConfig) {
    this.#db = config.db;
    this.#dataRoot = config.dataRoot;
    this.#databaseFactory = config.databaseFactory;
    this.#maxOpenHandles = config.maxOpenHandles ?? DB_RESOURCE_DEFAULT_MAX_OPEN_HANDLES;
    this.#idleHandleTimeoutMs = config.idleHandleTimeoutMs ?? DB_RESOURCE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#scheduleIdleSweep = config.scheduleIdleSweep ?? defaultIdleSweepScheduler;
    if (!Number.isInteger(this.#maxOpenHandles) || this.#maxOpenHandles < 1) {
      throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource open-handle limit must be a positive integer.');
    }
    if (!Number.isInteger(this.#idleHandleTimeoutMs) || this.#idleHandleTimeoutMs < 1) {
      throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource idle-handle timeout must be a positive integer.');
    }
  }

  get openHandleCount(): number {
    return this.#handles.size
      + this.#temporaryHandleCount
      + this.#failedCloses.size
      + this.#closingHandleCount;
  }

  async provision(resource: TDbProviderResource, _args: TResourceProviderCreateArgs): Promise<void> {
    this.#assertAvailable();
    if (resource.kind !== 'db') throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'Resource kind is not db.');
    const resourceId = validateHostId(resource.id);
    const directory = this.#resourceDirectory(resourceId);
    try {
      await mkdir(this.#dataRoot, { recursive: true });
      await mkdir(directory);
      const database = await this.#open(resourceId, false);
      await database.exec(APPLY_MARKER_SQL);
      await database.exec('DROP TABLE IF EXISTS `_omnidraw_migrations`;');
      await this.#closeHandle(resourceId);
      await this.#verifyDatabaseFile(this.#databasePath(resourceId), new Set());
    } catch (error) {
      await this.#closeHandle(resourceId).catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw toResourceError(error, 'DB_RESOURCE_UNAVAILABLE', 'DbResource provisioning failed.');
    }
  }

  async delete(resource: TDbProviderResource): Promise<void> {
    const resourceId = validateHostId(resource.id);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#writeTails.get(resourceId);
      await this.#closeHandle(resourceId);
      let before: { createdAtSec: string; id: string } | undefined;
      do {
        const drafts = await this.#db.dbResource.draft.list({ resourceId, before, limit: 100 });
        await Promise.all(drafts.map((draft) => rm(this.#draftDirectory(draft.id), { recursive: true, force: true })));
        const last = drafts.at(-1);
        before = drafts.length === 100 && last ? { createdAtSec: last.createdAtSec, id: last.id } : undefined;
        if (drafts.length < 100) break;
      } while (before);
      await rm(this.#resourceDirectory(resourceId), { recursive: true, force: true });
    } catch (error) {
      throw toResourceError(error, 'DB_RESOURCE_DELETE_FAILED', 'DbResource physical deletion failed.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  effect(operation: string, requirement: TLocalResourceRequirement, rawArgs: unknown): 'read' | 'write' | null {
    if (requirement.kind !== 'db') return null;
    if (operation === 'query') return 'read';
    if (operation === 'execute') return 'write';
    if (operation !== 'invoke') return null;
    const name = recordArgs(rawArgs).operation;
    if (typeof name !== 'string') return null;
    return requirement.operations?.[name]?.effect ?? null;
  }

  async dispatch(context: TDbResolvedProviderCall, operation: string, rawArgs: unknown): Promise<unknown> {
    const resourceId = validateHostId(context.resource.id);
    this.#assertAvailable(resourceId);
    if (context.requirement.kind !== 'db') throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'Bound resource is not a DbResource.');
    return this.#track(resourceId, this.#dispatchGuest(
      context,
      context.requirement as TDbProviderRequirement,
      operation,
      rawArgs,
    ));
  }

  async reconcile(resource: TDbProviderResource): Promise<TLocalResourceReconcileResult> {
    if (resource.kind !== 'db') return { status: 'error' as const, lastError: { code: 'DB_RESOURCE_RECOVERY_FAILED', message: 'DbResource catalog kind is invalid.' } };
    const resourceId = validateHostId(resource.id);
    this.#blocked.add(resourceId);
    try {
      await this.#closeHandle(resourceId).catch(() => undefined);
      await this.#verifiedSnapshotForeignKeys(this.#databasePath(resourceId));
      const database = await this.#open(resourceId, true);
      await database.exec(APPLY_MARKER_SQL);
      await database.exec('DROP TABLE IF EXISTS `_omnidraw_migrations`;');
      await this.#removeDatabaseFiles(`${this.#databasePath(resourceId)}.pre-migration`);
      return { status: 'ready' as const };
    } catch {
      return { status: 'error' as const, lastError: { code: 'DB_RESOURCE_RECOVERY_FAILED', message: 'DbResource physical state could not be reconciled safely.' } };
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async inspect(resourceIdValue: string, target: 'live' | 'draft', draftId?: string): Promise<TDbInspection> {
    const resourceId = validateHostId(resourceIdValue);
    const path = target === 'live' ? this.#databasePath(resourceId) : this.#draftDatabasePath(validateHostId(draftId ?? '', 'DbResource draft'));
    const objects = await this.#withDatabase(path, true, (database) => this.#inspectDatabase(database));
    return { resourceId, target, draftId: target === 'draft' ? draftId ?? null : null, objects };
  }

  async inspectForeignKeyViolations(resourceIdValue: string): Promise<readonly string[]> {
    const resourceId = validateHostId(resourceIdValue);
    const violations = await this.#withDatabase(this.#databasePath(resourceId), true, (database) => this.#foreignKeyViolations(database));
    return [...violations].sort();
  }

  async listRows(args: { resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number }): Promise<TDbRowsPage> {
    const resourceId = validateHostId(args.resourceId);
    this.#assertAvailable(resourceId);
    const limit = args.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > ROW_PAGE_MAX) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Row page limit must be between 1 and ${ROW_PAGE_MAX}.`);
    return this.#withDatabase(this.#databasePath(resourceId), true, async (database) => {
      const object = await this.#requireObject(database, args.object);
      const visibleColumns = object.columns.filter((column) => !column.hidden).map((column) => column.name);
      if (visibleColumns.length > RESULT_COLUMN_MAX_COUNT) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database table has too many columns to browse safely.');
      const usedAliases = new Set(visibleColumns);
      const nextAlias = (base: string) => {
        let alias = base;
        let suffix = 0;
        while (usedAliases.has(alias)) { suffix += 1; alias = `${base}_${suffix}`; }
        usedAliases.add(alias);
        return alias;
      };
      const blobMetadata = visibleColumns.map((column, index) => ({
        column,
        lengthAlias: nextAlias(`__omnidraw_blob_length_${index}`),
        previewAlias: nextAlias(`__omnidraw_blob_preview_${index}`),
      }));
      const selectColumns = blobMetadata.flatMap(({ column, lengthAlias, previewAlias }) => {
        const quoted = quoteIdentifier(column);
        return [
          `CASE WHEN typeof(${quoted}) = 'blob' THEN NULL ELSE ${quoted} END AS ${quoted}`,
          `CASE WHEN typeof(${quoted}) = 'blob' THEN length(${quoted}) ELSE NULL END AS ${quoteIdentifier(lengthAlias)}`,
          `CASE WHEN typeof(${quoted}) = 'blob' THEN substr(${quoted}, 1, ${ROW_BLOB_PREVIEW_BYTES}) ELSE NULL END AS ${quoteIdentifier(previewAlias)}`,
        ];
      });
      let rowidAlias: string | null = null;
      const identityAliases = new Map<string, string>();
      if (object.identity?.kind === 'rowid') {
        rowidAlias = nextAlias('__omnidraw_rowid_value');
        selectColumns.push(`rowid AS ${quoteIdentifier(rowidAlias)}`);
      } else if (object.identity?.kind === 'primaryKey') {
        for (const [index, column] of object.identity.columns.entries()) {
          const alias = nextAlias(`__omnidraw_identity_${index}`);
          identityAliases.set(column, alias);
          selectColumns.push(`${quoteIdentifier(column)} AS ${quoteIdentifier(alias)}`);
        }
      }
      const cursor = this.#cursorPredicate(object, args.cursor ?? null);
      const order = object.identity?.kind === 'primaryKey'
        ? object.identity.columns.map(quoteIdentifier).join(', ')
        : object.identity?.kind === 'rowid' ? 'rowid' : visibleColumns.map(quoteIdentifier).join(', ');
      const sql = `SELECT ${selectColumns.join(', ')} FROM ${quoteIdentifier(object.name)}${cursor.sql} ORDER BY ${order || '1'} LIMIT ${limit + 1}`;
      const nativeRows = await this.#queryNative(database, sql, cursor.parameters, selectColumns.length);
      const hasMore = nativeRows.length > limit;
      const pageRows = hasMore ? nativeRows.slice(0, limit) : nativeRows;
      const rows = pageRows.map((native) => {
        const values: Record<string, TDbPreviewCellValue> = {};
        for (const { column, lengthAlias, previewAlias } of blobMetadata) {
          values[column] = toSqlBlobPreview(native[lengthAlias], native[previewAlias]) ?? toPreviewWireValue(native[column]);
        }
        const identity = object.identity?.kind === 'rowid'
          ? { kind: 'rowid' as const, value: toWireInteger(native[rowidAlias!]) }
          : object.identity?.kind === 'primaryKey'
            ? { kind: 'primaryKey' as const, values: Object.fromEntries(object.identity.columns.map((column) => [column, toWireValue(native[identityAliases.get(column)!])])) }
            : null;
        return { values, identity };
      });
      return { object, rows, hasMore, nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].identity : null };
    });
  }

  async getRow(args: { resourceId: string; object: string; identity: TDbRowIdentity; columns?: readonly string[] }): Promise<TDbRow> {
    const resourceId = validateHostId(args.resourceId);
    this.#assertAvailable(resourceId);
    return this.#withDatabase(this.#databasePath(resourceId), true, async (database) => {
      const object = await this.#requireEditableObject(database, args.object);
      const allVisibleColumns = object.columns.filter((column) => !column.hidden).map((column) => column.name);
      const visibleColumnSet = new Set(allVisibleColumns);
      const visibleColumns = args.columns?.map(validateIdentifier) ?? allVisibleColumns;
      if (visibleColumns.length === 0 || visibleColumns.length > RESULT_COLUMN_MAX_COUNT || new Set(visibleColumns).size !== visibleColumns.length) {
        throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database row projection must contain between 1 and 128 unique columns.');
      }
      if (visibleColumns.some((column) => !visibleColumnSet.has(column))) {
        throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database row projection contains a missing or hidden column.');
      }
      const identity = this.#identityPredicate(object, args.identity);
      let nativeRows: TNativeRow[];
      try {
        nativeRows = await this.#queryNative(database, `SELECT ${visibleColumns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(object.name)} WHERE ${identity.sql} LIMIT 2`, identity.parameters, RESULT_COLUMN_MAX_COUNT, ROW_HYDRATION_BYTES_MAX);
      } catch (error) {
        if (error instanceof ResourceError && error.code === 'DB_RESULT_LIMIT_EXCEEDED') {
          throw new ResourceError('DB_RESOURCE_ROW_TOO_LARGE', `The selected row exceeds the ${ROW_HYDRATION_BYTES_MAX / 1_048_576} MiB hydration limit.`);
        }
        throw error;
      }
      if (nativeRows.length !== 1) throw new ResourceError('DB_RESOURCE_ROW_CONFLICT', 'The selected row changed or disappeared before it could be loaded.');
      const values: Record<string, TDbCellValue> = {};
      for (const column of visibleColumns) values[column] = toWireValue(nativeRows[0][column]);
      return { identity: args.identity, values };
    });
  }

  async executeLiveSql(args: {
    resourceId: string;
    sql: string;
    parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>;
    approved: boolean;
  }): Promise<TDbLiveSqlResult> {
    const resourceId = validateHostId(args.resourceId);
    this.#assertAvailable(resourceId);
    const sql = boundedGuestSql(args.sql);
    const parameters = bindWireParameters(args.parameters);
    const execute = args.approved
      ? this.#serializeWrite(resourceId, async () => {
        const database = await this.#open(resourceId, true);
        const transaction = database.transaction(() => this.#executeLiveSqlDatabase(database, sql, parameters, true));
        return transaction();
      })
      : (async () => {
        if (!await this.#liveSqlStatementProducesRows(resourceId, sql)) {
          throw new ResourceError('DB_LIVE_SQL_APPROVAL_REQUIRED', 'Live database mutations require explicit user approval.');
        }
        return this.#withDatabase(
          this.#databasePath(resourceId),
          true,
          (database) => this.#executeLiveSqlDatabase(database, sql, parameters, false),
          resourceId,
        );
      })();
    return this.#track(resourceId, execute);
  }

  createRow(args: { resourceId: string; object: string; values: Readonly<Record<string, TDbCellValue>> }) {
    return this.#rowWrite(args.resourceId, async (database) => {
      const object = await this.#requireEditableObject(database, args.object);
      const values = this.#validatedValues(object, args.values, true);
      const columns = Object.keys(values);
      const sql = columns.length === 0
        ? `INSERT INTO ${quoteIdentifier(object.name)} DEFAULT VALUES`
        : `INSERT INTO ${quoteIdentifier(object.name)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      const result = await this.#runNative(database, sql, columns.map((name) => values[name]));
      return { rowsAffected: result.rowsAffected, lastInsertRowId: result.lastInsertRowId === undefined ? null : toWireValue(result.lastInsertRowId) };
    });
  }

  updateRow(args: { resourceId: string; object: string } & Omit<TDbRowUpdate, 'kind'>) {
    return this.#rowWrite(args.resourceId, async (database) => {
      const object = await this.#requireEditableObject(database, args.object);
      const values = this.#validatedValues(object, args.values, false);
      if (Object.keys(values).length === 0) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Row update has no changed values.');
      const expected = this.#expectedForUpdate(object, args.expectedOriginal, values);
      const identity = this.#identityPredicate(object, args.identity);
      const optimistic = this.#expectedPredicate(expected);
      const names = Object.keys(values);
      const result = await this.#runNative(database, `UPDATE ${quoteIdentifier(object.name)} SET ${names.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${identity.sql}${optimistic.sql}`, [...names.map((name) => values[name]), ...identity.parameters, ...optimistic.parameters]);
      if (result.rowsAffected !== 1) throw new ResourceError('DB_RESOURCE_ROW_CONFLICT', 'The row changed or disappeared before the update could be applied.');
      return { rowsAffected: result.rowsAffected };
    });
  }

  deleteRow(args: { resourceId: string; object: string } & Omit<TDbRowDelete, 'kind'>) {
    return this.#rowWrite(args.resourceId, async (database) => {
      const object = await this.#requireEditableObject(database, args.object);
      const expected = this.#expectedForDelete(object, args.expectedOriginal);
      const identity = this.#identityPredicate(object, args.identity);
      const optimistic = this.#expectedPredicate(expected);
      const result = await this.#runNative(database, `DELETE FROM ${quoteIdentifier(object.name)} WHERE ${identity.sql}${optimistic.sql}`, [...identity.parameters, ...optimistic.parameters]);
      if (result.rowsAffected !== 1) throw new ResourceError('DB_RESOURCE_ROW_CONFLICT', 'The row changed or disappeared before it could be deleted.');
      return { rowsAffected: result.rowsAffected };
    });
  }

  bulkRows(args: { resourceId: string; object: string; operations: readonly (TDbRowCreate | TDbRowUpdate | TDbRowDelete)[] }) {
    if (args.operations.length < 1 || args.operations.length > ROW_BULK_MAX) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Bulk row writes require between 1 and ${ROW_BULK_MAX} operations.`);
    if (Buffer.byteLength(JSON.stringify(args.operations), 'utf8') > RESULT_BYTES_MAX) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Bulk row writes exceed the payload size limit.');
    return this.#rowWrite(args.resourceId, async (database) => {
      const object = await this.#requireEditableObject(database, args.object);
      const results: { rowsAffected: number }[] = [];
      for (const operation of args.operations) {
        if (operation.kind === 'create') {
          const values = this.#validatedValues(object, operation.values, true);
          const names = Object.keys(values);
          const result = names.length === 0
            ? await this.#runNative(database, `INSERT INTO ${quoteIdentifier(object.name)} DEFAULT VALUES`, [])
            : await this.#runNative(database, `INSERT INTO ${quoteIdentifier(object.name)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, names.map((name) => values[name]));
          results.push({ rowsAffected: result.rowsAffected });
          continue;
        }
        const identity = this.#identityPredicate(object, operation.identity);
        if (operation.kind === 'delete') {
          const expected = this.#expectedForDelete(object, operation.expectedOriginal);
          const optimistic = this.#expectedPredicate(expected);
          const result = await this.#runNative(database, `DELETE FROM ${quoteIdentifier(object.name)} WHERE ${identity.sql}${optimistic.sql}`, [...identity.parameters, ...optimistic.parameters]);
          if (result.rowsAffected !== 1) throw new ResourceError('DB_RESOURCE_ROW_CONFLICT', 'A bulk row target changed or disappeared.');
          results.push({ rowsAffected: result.rowsAffected });
          continue;
        }
        const values = this.#validatedValues(object, operation.values, false);
        const names = Object.keys(values);
        if (names.length === 0) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Bulk row update has no changed values.');
        const expected = this.#expectedForUpdate(object, operation.expectedOriginal, values);
        const optimistic = this.#expectedPredicate(expected);
        const result = await this.#runNative(database, `UPDATE ${quoteIdentifier(object.name)} SET ${names.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${identity.sql}${optimistic.sql}`, [...names.map((name) => values[name]), ...identity.parameters, ...optimistic.parameters]);
        if (result.rowsAffected !== 1) throw new ResourceError('DB_RESOURCE_ROW_CONFLICT', 'A bulk row target changed or disappeared.');
        results.push({ rowsAffected: result.rowsAffected });
      }
      return results;
    });
  }

  async createDraft(resourceIdValue: string, draftIdValue: string): Promise<void> {
    const resourceId = validateHostId(resourceIdValue);
    const draftId = validateHostId(draftIdValue, 'DbResource draft');
    this.#assertAvailable(resourceId);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#serializeWrite(resourceId, async () => {
        const live = await this.#open(resourceId, true);
        await live.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: QUERY_TIMEOUT_MS });
        await this.#closeHandle(resourceId);
        const draftPath = this.#draftDatabasePath(draftId);
        await mkdir(dirname(draftPath), { recursive: true });
        await this.#copyDatabaseFiles(this.#databasePath(resourceId), draftPath);
        await this.#withDatabase(draftPath, false, async (database) => {
          await database.exec(DRAFT_CHANGE_EVIDENCE_SQL, { queryTimeout: QUERY_TIMEOUT_MS });
          const baselineForeignKeys = await this.#foreignKeyViolations(database);
          await this.#verifyDatabase(database, baselineForeignKeys);
        });
        await this.#open(resourceId, true);
      });
    } catch (error) {
      await rm(this.#draftDirectory(draftId), { recursive: true, force: true }).catch(() => undefined);
      throw toResourceError(error, 'DB_RESOURCE_DRAFT_INVALID', 'DbResource structure draft could not be created.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async discardDraft(draftIdValue: string): Promise<void> {
    const draftId = validateHostId(draftIdValue, 'DbResource draft');
    await rm(this.#draftDirectory(draftId), { recursive: true, force: true });
  }

  async applyDraftChange(draftIdValue: string, operation: TDbDraftOperation): Promise<TDbDraftChangeEvidence> {
    const draftId = validateHostId(draftIdValue, 'DbResource draft');
    const path = this.#draftDatabasePath(draftId);
    const prepared = await this.#withDatabase(path, false, async (database) => {
      const sql = await this.#structuredSql(database, operation);
      if (!requiresCombinedTableOptionsCompatibility(sql)) return { sql, baselineForeignKeys: null };
      const baselineForeignKeys = await this.#foreignKeyViolations(database);
      await database.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: QUERY_TIMEOUT_MS });
      return { sql, baselineForeignKeys };
    });
    if (prepared.baselineForeignKeys !== null) {
      return this.#applyDraftChangeWithSqlite(path, prepared.sql, prepared.baselineForeignKeys);
    }
    return this.#withDatabase(path, false, async (database) => {
      const sql = prepared.sql;
      const baselineForeignKeys = await this.#foreignKeyViolations(database);
      const rebuild = sql.includes('__omnidraw_rebuild');
      if (rebuild) await database.exec('PRAGMA foreign_keys = OFF;');
      const apply = database.transaction(async (): Promise<TDbDraftChangeEvidence> => {
        await database.exec(DRAFT_CHANGE_EVIDENCE_SQL, { queryTimeout: QUERY_TIMEOUT_MS });
        const rows = await this.#queryNative(database, 'SELECT COALESCE(MAX(`sequence`), 0) + 1 AS `next_sequence` FROM `_omnidraw_draft_change_evidence`', []);
        const rawSequence = rows[0]?.next_sequence;
        const sequence = typeof rawSequence === 'bigint' ? Number(rawSequence) : rawSequence;
        if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft change evidence sequence is invalid.');
        await database.exec(sql, { queryTimeout: QUERY_TIMEOUT_MS });
        await this.#runNative(database, 'INSERT INTO `_omnidraw_draft_change_evidence` (`sequence`, `kind`, `sql`) VALUES (?, ?, ?)', [Number(sequence), 'structure', sql]);
        await this.#verifyDatabase(database, baselineForeignKeys);
        return { sequence: Number(sequence), kind: 'structure', sql };
      });
      try {
        return await apply();
      } catch (error) {
        throw toResourceError(error, 'DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Structure change could not be applied to the draft.');
      } finally {
        if (rebuild) await database.exec('PRAGMA foreign_keys = ON;').catch(() => undefined);
      }
    });
  }

  async #applyDraftChangeWithSqlite(
    databasePath: string,
    sql: string,
    baselineForeignKeys: ReadonlySet<string>,
  ): Promise<TDbDraftChangeEvidence> {
    const recoveryPath = `${databasePath}.combined-options-backup`;
    await this.#copyDatabaseFiles(databasePath, recoveryPath);
    try {
      const database = new SQLiteDatabase(databasePath, { create: false, readwrite: true });
      let evidence: TDbDraftChangeEvidence | null = null;
      try {
        database.exec(RESOURCE_PRAGMAS_SQL);
        const rebuild = sql.includes('__omnidraw_rebuild');
        if (rebuild) database.exec('PRAGMA foreign_keys = OFF;');
        const apply = database.transaction(() => {
          database.exec(DRAFT_CHANGE_EVIDENCE_SQL);
          const row = database.query('SELECT COALESCE(MAX(`sequence`), 0) + 1 AS `next_sequence` FROM `_omnidraw_draft_change_evidence`').get() as { next_sequence?: number | bigint } | null;
          const rawSequence = row?.next_sequence;
          const sequence = typeof rawSequence === 'bigint' ? Number(rawSequence) : rawSequence;
          if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft change evidence sequence is invalid.');
          database.exec(sql);
          database.query('INSERT INTO `_omnidraw_draft_change_evidence` (`sequence`, `kind`, `sql`) VALUES (?, ?, ?)').run(Number(sequence), 'structure', sql);
          evidence = { sequence: Number(sequence), kind: 'structure', sql };
        });
        apply();
        if (rebuild) database.exec('PRAGMA foreign_keys = ON;');
      } finally {
        database.close();
      }
      await this.#verifyDatabaseFile(databasePath, baselineForeignKeys);
      if (evidence === null) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft change evidence was not recorded.');
      return evidence;
    } catch (error) {
      try {
        await this.#copyDatabaseFiles(recoveryPath, databasePath);
        await this.#verifyDatabaseFile(databasePath, baselineForeignKeys);
      } catch {
        throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Structure change failed and the physical draft could not be restored safely.', { uncertain: true });
      }
      throw toResourceError(error, 'DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Structure change could not be applied to the draft.');
    } finally {
      await this.#removeDatabaseFiles(recoveryPath).catch(() => undefined);
    }
  }

  async executeDraftSql(
    draftIdValue: string,
    sqlValue: string,
    wireParameters?: readonly TDbCellValue[],
  ): Promise<TDbDraftChangeEvidence> {
    const draftId = validateHostId(draftIdValue, 'DbResource draft');
    const sql = boundedDraftSql(sqlValue);
    const parameters = wireParameters === undefined ? null : bindWireParameters(wireParameters);
    if (sqlSummary(sql).statementCount !== 1) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database write operations must contain exactly one SQLite statement.');
    }
    return this.#withDatabase(this.#draftDatabasePath(draftId), false, async (database) => {
      const baselineForeignKeys = await this.#foreignKeyViolations(database);
      const apply = database.transaction(async (): Promise<TDbDraftChangeEvidence> => {
        await database.exec(DRAFT_CHANGE_EVIDENCE_SQL, { queryTimeout: QUERY_TIMEOUT_MS });
        const rows = await this.#queryNative(database, 'SELECT COALESCE(MAX(`sequence`), 0) + 1 AS `next_sequence` FROM `_omnidraw_draft_change_evidence`', []);
        const rawSequence = rows[0]?.next_sequence;
        const sequence = typeof rawSequence === 'bigint' ? Number(rawSequence) : rawSequence;
        if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft change evidence sequence is invalid.');
        if (parameters === null) {
          await database.exec(sql, { queryTimeout: QUERY_TIMEOUT_MS });
        } else {
          await this.#runNative(database, sql, parameters);
        }
        await this.#runNative(database, 'INSERT INTO `_omnidraw_draft_change_evidence` (`sequence`, `kind`, `sql`) VALUES (?, ?, ?)', [Number(sequence), 'sql', sql]);
        await this.#verifyDatabase(database, baselineForeignKeys);
        return { sequence: Number(sequence), kind: 'sql', sql };
      });
      try {
        return await apply();
      } catch {
        throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Advanced SQL failed without changing the draft.');
      }
    });
  }

  async listDraftChangeEvidence(draftIdValue: string): Promise<TDbDraftChangeEvidence[]> {
    const draftId = validateHostId(draftIdValue, 'DbResource draft');
    return this.#withDatabase(this.#draftDatabasePath(draftId), true, async (database) => {
      const rows = await this.#queryNative(database, 'SELECT `sequence`, `kind`, `sql` FROM `_omnidraw_draft_change_evidence` ORDER BY `sequence`', []);
      return rows.map((row): TDbDraftChangeEvidence => {
        const sequence = typeof row.sequence === 'bigint' ? Number(row.sequence) : row.sequence;
        if (!Number.isSafeInteger(sequence) || Number(sequence) < 1 || (row.kind !== 'structure' && row.kind !== 'sql') || typeof row.sql !== 'string') {
          throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft change evidence is invalid.');
        }
        return { sequence: Number(sequence), kind: row.kind, sql: row.sql };
      });
    });
  }

  async applyDraft(args: { resourceId: string; draftId: string; applyId: string; changes: readonly TDbDraftChangeRecord[] }): Promise<{ outcome: 'succeeded' | 'recovered'; backupRetained: boolean; error: { code: string; message: string } | null }> {
    const resourceId = validateHostId(args.resourceId);
    const draftId = validateHostId(args.draftId, 'DbResource draft');
    const applyId = validateHostId(args.applyId, 'DbResource apply');
    this.#blocked.add(resourceId);
    const livePath = this.#databasePath(resourceId);
    const backupPath = this.#backupDatabasePath(resourceId, applyId);
    let backupReady = false;
    try {
      await this.#drain(resourceId);
      return await this.#serializeWrite(resourceId, async () => {
        const live = await this.#open(resourceId, true);
        const baselineForeignKeys = await this.#foreignKeyViolations(live);
        await live.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: QUERY_TIMEOUT_MS });
        await this.#closeHandle(resourceId);
        await mkdir(dirname(backupPath), { recursive: true });
        await this.#copyDatabaseFiles(livePath, backupPath);
        await this.#verifyDatabaseFile(backupPath, baselineForeignKeys);
        backupReady = true;
        try {
          const rebuild = args.changes.some((change) => change.sql.includes('__omnidraw_rebuild'));
          const orderedChanges = [...args.changes].sort((a, b) => a.sequence - b.sequence);
          if (orderedChanges.some((change) => requiresCombinedTableOptionsCompatibility(change.sql))) {
            this.#applyChangesWithSqlite(livePath, orderedChanges, applyId, rebuild);
          } else {
            const database = await this.#open(resourceId, true);
            if (rebuild) await database.exec('PRAGMA foreign_keys = OFF;');
            const transaction = database.transaction(async () => {
              for (const change of orderedChanges) {
                const sql = boundedDraftSql(change.sql);
                const parameters = change.kind === 'sql' ? draftSqlBindParameters(change.operation) : null;
                if (parameters === null) await database.exec(sql, { queryTimeout: QUERY_TIMEOUT_MS });
                else await this.#runNative(database, sql, parameters);
              }
              await database.exec(APPLY_MARKER_SQL);
              await database.run('INSERT INTO `_omnidraw_apply_markers` (`apply_id`) VALUES (?)', applyId, { queryTimeout: QUERY_TIMEOUT_MS });
            });
            try {
              await transaction();
            } finally {
              if (rebuild) await database.exec('PRAGMA foreign_keys = ON;').catch(() => undefined);
            }
          }
          const database = await this.#open(resourceId, true);
          await this.#verifyDatabase(database, baselineForeignKeys);
          const marker = await this.#queryNative(database, 'SELECT `apply_id` FROM `_omnidraw_apply_markers` WHERE `apply_id` = ?', [applyId]);
          if (marker.length !== 1) throw new ResourceError('DB_RESOURCE_APPLY_FAILED', 'Committed apply marker is missing.');
          return { outcome: 'succeeded' as const, backupRetained: true, error: null };
        } catch {
          await this.#closeHandle(resourceId).catch(() => undefined);
          try {
            await this.#copyDatabaseFiles(backupPath, livePath);
            await this.#verifyDatabaseFile(livePath, baselineForeignKeys);
            return { outcome: 'recovered' as const, backupRetained: true, error: { code: 'DB_RESOURCE_APPLY_RECOVERED', message: 'The apply failed and the verified previous database was restored.' } };
          } catch {
            throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'The apply failed and the retained backup could not be restored safely.');
          }
        }
      });
    } finally {
      if (!backupReady) await rm(dirname(backupPath), { recursive: true, force: true }).catch(() => undefined);
      this.#blocked.delete(resourceId);
    }
  }

  #applyChangesWithSqlite(
    databasePath: string,
    changes: readonly TDbDraftChangeRecord[],
    applyId: string,
    rebuild: boolean,
  ): void {
    const database = new SQLiteDatabase(databasePath, { create: false, readwrite: true });
    try {
      database.exec(RESOURCE_PRAGMAS_SQL);
      if (rebuild) database.exec('PRAGMA foreign_keys = OFF;');
      const apply = database.transaction(() => {
        for (const change of changes) {
          const sql = boundedDraftSql(change.sql);
          const parameters = change.kind === 'sql' ? draftSqlBindParameters(change.operation) : null;
          if (parameters === null) {
            database.exec(sql);
          } else {
            const values = Array.isArray(parameters) ? parameters : Object.values(parameters);
            database.query(sql).run(...values);
          }
        }
        database.exec(APPLY_MARKER_SQL);
        database.query('INSERT INTO `_omnidraw_apply_markers` (`apply_id`) VALUES (?)').run(applyId);
      });
      apply();
      if (rebuild) database.exec('PRAGMA foreign_keys = ON;');
    } finally {
      database.close();
    }
  }

  async restoreBackup(resourceIdValue: string, applyIdValue: string, restoreIdValue: string): Promise<void> {
    const resourceId = validateHostId(resourceIdValue);
    const applyId = validateHostId(applyIdValue, 'DbResource apply');
    const restoreId = validateHostId(restoreIdValue, 'DbResource restore');
    const backupPath = this.#backupDatabasePath(resourceId, applyId);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#serializeWrite(resourceId, async () => {
        const backupForeignKeys = await this.#verifiedSnapshotForeignKeys(backupPath);
        await this.#closeHandle(resourceId).catch(() => undefined);
        await this.#copyDatabaseFiles(backupPath, this.#databasePath(resourceId));
        await this.#verifyDatabaseFile(this.#databasePath(resourceId), backupForeignKeys);
        const database = await this.#open(resourceId, true);
        const markRestore = database.transaction(async () => {
          await database.exec(APPLY_MARKER_SQL);
          await database.run('INSERT INTO `_omnidraw_apply_markers` (`apply_id`) VALUES (?)', restoreId, { queryTimeout: QUERY_TIMEOUT_MS });
        });
        await markRestore();
      });
    } catch {
      throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'The retained DbResource backup could not be restored safely.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async discardBackup(resourceIdValue: string, applyIdValue: string): Promise<void> {
    const resourceId = validateHostId(resourceIdValue);
    const applyId = validateHostId(applyIdValue, 'DbResource apply');
    await rm(this.#backupDirectory(resourceId, applyId), { recursive: true, force: true });
  }

  async hasApplyMarker(resourceIdValue: string, applyIdValue: string): Promise<boolean> {
    const resourceId = validateHostId(resourceIdValue);
    const applyId = validateHostId(applyIdValue, 'DbResource apply');
    try {
      const rows = await this.#withDatabase(this.#databasePath(resourceId), true, (database) => this.#queryNative(
        database,
        'SELECT `apply_id` FROM `_omnidraw_apply_markers` WHERE `apply_id` = ?',
        [applyId],
      ));
      return rows.length === 1;
    } catch {
      return false;
    }
  }

  async hasVerifiedBackup(resourceIdValue: string, applyIdValue: string): Promise<boolean> {
    const resourceId = validateHostId(resourceIdValue);
    const applyId = validateHostId(applyIdValue, 'DbResource apply');
    try {
      await this.#verifiedSnapshotForeignKeys(this.#backupDatabasePath(resourceId, applyId));
      return true;
    } catch {
      return false;
    }
  }

  async reconcileApply(
    resourceIdValue: string,
    applyIdValue: string,
    options: { fallbackBackupApplyId?: string; restoreSourceApplyId?: string } = {},
  ): Promise<{
    outcome: 'committed' | 'uncommitted' | 'recovered' | 'unrecoverable';
    retainedBackupApplyId: string | null;
  }> {
    const resourceId = validateHostId(resourceIdValue);
    const applyId = validateHostId(applyIdValue, 'DbResource apply');
    this.#blocked.add(resourceId);
    try {
      await this.#closeHandle(resourceId).catch(() => undefined);
      const backupIds = [...new Set([
        applyId,
        ...(options.restoreSourceApplyId ? [validateHostId(options.restoreSourceApplyId, 'DbResource apply')] : []),
        ...(options.fallbackBackupApplyId ? [validateHostId(options.fallbackBackupApplyId, 'DbResource apply')] : []),
      ])];
      const verifiedBackups = new Map<string, Set<string>>();
      for (const backupId of backupIds) {
        try {
          verifiedBackups.set(
            backupId,
            await this.#verifiedSnapshotForeignKeys(this.#backupDatabasePath(resourceId, backupId)),
          );
        } catch {
          // Missing and unhealthy snapshots are not recovery candidates.
        }
      }
      const restoreSourceId = options.restoreSourceApplyId && verifiedBackups.has(options.restoreSourceApplyId)
        ? options.restoreSourceApplyId
        : null;
      const currentApplyBackupId = verifiedBackups.has(applyId) ? applyId : null;
      const fallbackBackupId = options.fallbackBackupApplyId && verifiedBackups.has(options.fallbackBackupApplyId)
        ? options.fallbackBackupApplyId
        : null;
      const retainedBackupApplyId = currentApplyBackupId ?? restoreSourceId ?? fallbackBackupId;

      let liveHealthy = false;
      let liveMarker = await this.hasApplyMarker(resourceId, applyId);
      const authoritativeBaselineId = options.restoreSourceApplyId
        ? restoreSourceId
        : currentApplyBackupId ?? (liveMarker ? fallbackBackupId : null);
      try {
        const livePath = this.#databasePath(resourceId);
        if (authoritativeBaselineId === null) {
          await this.#verifiedSnapshotForeignKeys(livePath);
        } else {
          await this.#verifyDatabaseFile(livePath, verifiedBackups.get(authoritativeBaselineId)!);
        }
        liveHealthy = true;
        liveMarker = liveMarker || await this.hasApplyMarker(resourceId, applyId);
        if (liveMarker && authoritativeBaselineId !== null) {
          return { outcome: 'committed', retainedBackupApplyId };
        }
      } catch {
        // A verified backup below may still recover the live file.
      }

      const recoveryId = options.restoreSourceApplyId
        ? restoreSourceId
        : currentApplyBackupId ?? fallbackBackupId;
      if (options.restoreSourceApplyId || !liveHealthy || liveMarker) {
        if (recoveryId !== null) {
          try {
            const livePath = this.#databasePath(resourceId);
            await this.#copyDatabaseFiles(this.#backupDatabasePath(resourceId, recoveryId), livePath);
            await this.#verifyDatabaseFile(livePath, verifiedBackups.get(recoveryId)!);
            if (options.restoreSourceApplyId) {
              const database = await this.#open(resourceId, true);
              const markRestore = database.transaction(async () => {
                await database.exec(APPLY_MARKER_SQL);
                await database.run('INSERT OR IGNORE INTO `_omnidraw_apply_markers` (`apply_id`) VALUES (?)', applyId, { queryTimeout: QUERY_TIMEOUT_MS });
              });
              await markRestore();
            }
            return { outcome: 'recovered', retainedBackupApplyId: recoveryId };
          } catch {
            // The source was verified before copy but could not restore the live file.
          }
        }
        return { outcome: 'unrecoverable', retainedBackupApplyId };
      }
      return { outcome: 'uncommitted', retainedBackupApplyId };
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#notifyHandleCapacityChange();
    this.#cancelIdleSweep?.();
    this.#cancelIdleSweep = null;
    await this.#handleAdmissionTail;
    await Promise.allSettled([...this.#temporaryOperations]);
    await Promise.all([...this.#inflight.keys()].map((resourceId) => this.#drain(resourceId)));
    await Promise.allSettled([...this.#writeTails.values()]);
    const results = await Promise.allSettled([...this.#handles.keys()].map((resourceId) => this.#closeHandle(resourceId)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    const retryResults = await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
    failures.push(...retryResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason));
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more DbResource handles failed to close.');
    }
  }

  async #dispatchGuest(context: TDbResolvedProviderCall, requirement: TDbProviderRequirement, operation: string, rawArgs: unknown): Promise<unknown> {
    try {
      const args = recordArgs(rawArgs);
      if (operation === 'invoke') {
        if (typeof args.operation !== 'string') throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Named database operation is invalid.');
        const declared = requirement.operations?.[args.operation];
        if (!declared) throw new ResourceError('DB_NAMED_OPERATION_UNKNOWN', `Named database operation "${args.operation}" is not declared.`);
        if (declared.effect === 'read' && !context.canRead) throw new ResourceError('DB_READ_NOT_ALLOWED', 'Read access is not allowed for this DbResource slot.');
        if (declared.effect === 'write' && !context.canWrite) throw new ResourceError('DB_WRITE_NOT_ALLOWED', 'Write access is not allowed for this DbResource slot.');
        const parameters = bindNamedParameters(requirement, args.operation, args.parameters);
        const sql = boundedGuestSql(declared.sql);
        const run = (): Promise<unknown> => declared.effect === 'read'
          ? declared.result === 'rows'
            ? this.#queryGuest(context.resource.id, sql, parameters)
            : this.#executeReadonlyGuest(context.resource.id, sql, parameters)
          : declared.result === 'rows'
            ? this.#queryWriteGuest(context.resource.id, sql, parameters)
            : this.#executeGuest(context.resource.id, sql, parameters);
        return declared.effect === 'write' ? this.#serializeWrite(context.resource.id, run) : run();
      }
      if (operation === 'query') {
        if (requirement.arbitrarySql !== true) throw new ResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Arbitrary SQL is not enabled for this DbResource slot.');
        if (!context.canRead) throw new ResourceError('DB_READ_NOT_ALLOWED', 'Read access is not allowed for this DbResource slot.');
        return this.#queryGuest(context.resource.id, boundedGuestSql(args.sql), bindParameters(args.parameters));
      }
      if (operation === 'execute') {
        if (requirement.arbitrarySql !== true) throw new ResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Arbitrary SQL is not enabled for this DbResource slot.');
        if (!context.canWrite) throw new ResourceError('DB_WRITE_NOT_ALLOWED', 'Write access is not allowed for this DbResource slot.');
        if (args.operations !== undefined) {
          if (!Array.isArray(args.operations) || args.operations.length < 1 || args.operations.length > EXECUTE_OPERATION_MAX_COUNT) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database execute operations are invalid.');
          let totalSql = 0;
          const operations: TDbExecuteOperation[] = args.operations.map((value) => {
            const item = recordArgs(value);
            const sql = boundedGuestSql(item.sql);
            totalSql += sql.length;
            if (totalSql > EXECUTE_TOTAL_SQL_MAX_LENGTH) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database execute SQL exceeds the host limit.');
            return { sql, parameters: bindParameters(item.parameters) };
          });
          return this.#serializeWrite(context.resource.id, () => this.#executeGuestOperations(context.resource.id, operations));
        }
        return this.#serializeWrite(context.resource.id, () => this.#executeGuest(context.resource.id, boundedGuestSql(args.sql), bindParameters(args.parameters)));
      }
      throw new ResourceError('DB_RESOURCE_UNAVAILABLE', `Unknown DbResource operation "${operation}".`);
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource operation failed.');
    }
  }

  async #dispatchGuestWriteDatabase(
    database: Database,
    context: TDbResolvedProviderCall,
    requirement: TDbProviderRequirement,
    operation: string,
    rawArgs: unknown,
  ): Promise<unknown> {
    const args = recordArgs(rawArgs);
    if (operation === 'invoke') {
      if (typeof args.operation !== 'string') {
        throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Named database operation is invalid.');
      }
      const declared = requirement.operations?.[args.operation];
      if (!declared) {
        throw new ResourceError('DB_NAMED_OPERATION_UNKNOWN', `Named database operation "${args.operation}" is not declared.`);
      }
      if (declared.effect !== 'write' || !context.canWrite) {
        throw new ResourceError('DB_WRITE_NOT_ALLOWED', 'Write access is not allowed for this database operation.');
      }
      const parameters = bindNamedParameters(requirement, args.operation, args.parameters);
      const sql = boundedGuestSql(declared.sql);
      return declared.result === 'rows'
        ? this.#queryGuestRows(database, sql, parameters)
        : this.#runNative(database, sql, parameters);
    }
    if (operation !== 'execute' || requirement.arbitrarySql !== true || !context.canWrite) {
      throw new ResourceError('DB_WRITE_NOT_ALLOWED', 'Database write operation is not allowed.');
    }
    if (args.operations !== undefined) {
      if (
        !Array.isArray(args.operations)
        || args.operations.length < 1
        || args.operations.length > EXECUTE_OPERATION_MAX_COUNT
      ) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database execute operations are invalid.');
      let totalSql = 0;
      const results: { rowsAffected: number; lastInsertRowId?: bigint }[] = [];
      for (const value of args.operations) {
        const item = recordArgs(value);
        const sql = boundedGuestSql(item.sql);
        totalSql += sql.length;
        if (totalSql > EXECUTE_TOTAL_SQL_MAX_LENGTH) {
          throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database execute SQL exceeds the host limit.');
        }
        results.push(await this.#runNative(database, sql, bindParameters(item.parameters)));
      }
      return results;
    }
    return this.#runNative(database, boundedGuestSql(args.sql), bindParameters(args.parameters));
  }

  async #executeLiveSqlDatabase(
    database: Database,
    sql: string,
    parameters: TDbBindParameters,
    approved: boolean,
  ): Promise<TDbLiveSqlResult> {
    let statement;
    try {
      statement = await database.prepare(sql);
    } catch {
      if (!approved) throw new ResourceError('DB_LIVE_SQL_APPROVAL_REQUIRED', 'Live database mutations require explicit user approval.');
      throw new ResourceError('DB_QUERY_FAILED', 'Live database SQL could not be prepared.');
    }
    statement.safeIntegers(true);
    try {
      if (!statement.reader) {
        if (!approved) {
          throw new ResourceError('DB_LIVE_SQL_APPROVAL_REQUIRED', 'Live database mutations require explicit user approval.');
        }
        const result = await statement.run(parameters, { queryTimeout: QUERY_TIMEOUT_MS });
        const rowId = result.lastInsertRowid as number | bigint;
        const firstToken = sqlSummary(sql).tokens[0];
        const reportsInsertedIdentity = firstToken === 'INSERT' || firstToken === 'REPLACE';
        const lastInsertRowId = !reportsInsertedIdentity ? null
          : typeof rowId === 'bigint'
            ? toWireValue(rowId)
            : Number.isSafeInteger(rowId) ? toWireValue(rowId) : null;
        return { kind: 'execute', rowsAffected: result.changes, lastInsertRowId };
      }

      const columns = statement.columns().map((column) => column.name);
      if (columns.length > RESULT_COLUMN_MAX_COUNT || columns.some((column) => typeof column !== 'string' || column.length > 1_024)) {
        throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Live database SQL returned too many or invalid columns.');
      }
      const beforeChanges = statement.database.totalChanges();
      const rows: Record<string, TDbPreviewCellValue>[] = [];
      let rowCount = 0;
      let bytes = 0;
      try {
        for await (const raw of statement.iterate(parameters, { queryTimeout: QUERY_TIMEOUT_MS })) {
          rowCount += 1;
          if (rowCount > RESULT_ROW_MAX_COUNT) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', `Live database SQL returned more than ${RESULT_ROW_MAX_COUNT} rows.`);
          const native = normalizeNativeRow(raw);
          bytes += nativeRowBytes(native);
          if (bytes > LIVE_SQL_BYTES_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', `Live database SQL exceeded the ${LIVE_SQL_BYTES_MAX / 1_048_576} MiB result limit.`);
          if (rows.length < LIVE_SQL_ROW_MAX) {
            rows.push(Object.fromEntries(Object.entries(native).map(([name, value]) => [name, toPreviewWireValue(value)])));
          }
        }
      } catch (error) {
        if (!approved && !(error instanceof ResourceError)) {
          throw new ResourceError('DB_LIVE_SQL_APPROVAL_REQUIRED', 'Live database mutations require explicit user approval.');
        }
        throw error;
      }
      const changes = statement.database.totalChanges() - beforeChanges;
      if (!Number.isSafeInteger(changes) || changes < 0) throw new ResourceError('DB_QUERY_FAILED', 'Live database SQL returned invalid change metadata.');
      return {
        kind: 'rows',
        columns,
        rows,
        rowCount,
        rowsAffected: changes,
        truncated: rowCount > rows.length,
      };
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      if (!approved) throw new ResourceError('DB_LIVE_SQL_APPROVAL_REQUIRED', 'Live database mutations require explicit user approval.');
      throw new ResourceError('DB_EXECUTE_FAILED', 'Live database SQL failed.');
    } finally {
      statement.close();
    }
  }

  async #liveSqlStatementProducesRows(resourceId: string, sql: string): Promise<boolean> {
    const database = await this.#open(resourceId, true);
    let statement;
    try {
      statement = await database.prepare(sql);
    } catch {
      throw new ResourceError('DB_QUERY_FAILED', 'Live database SQL could not be prepared.');
    }
    try {
      return statement.reader;
    } finally {
      statement.close();
    }
  }

  async #queryGuest(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      return await this.#withDatabase(
        this.#databasePath(resourceId),
        true,
        (database) => this.#queryGuestRows(database, sql, parameters),
        resourceId,
      );
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DB_QUERY_FAILED', 'Database query failed.');
    }
  }

  async #queryWriteGuest(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      return await this.#queryGuestRows(await this.#open(resourceId, true), sql, parameters);
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DB_EXECUTE_FAILED', 'Database write query failed.');
    }
  }

  async #queryGuestRows(database: Database, sql: string, parameters: TDbBindParameters) {
    const statement = await database.prepare(sql);
    statement.safeIntegers(true);
    try {
      if (!statement.reader) throw new ResourceError('DB_READ_NOT_ALLOWED', 'Database query requires a row-producing statement.');
      const rows: TNativeRow[] = [];
      let bytes = 0;
      for await (const raw of statement.iterate(parameters, { queryTimeout: QUERY_TIMEOUT_MS })) {
        if (rows.length >= RESULT_ROW_MAX_COUNT) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database result has too many rows.');
        const row = normalizeNativeRow(raw);
        bytes += nativeRowBytes(row);
        if (bytes > RESULT_BYTES_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database result exceeds the size limit.');
        rows.push(row);
      }
      return rows;
    } finally { statement.close(); }
  }

  async #executeReadonlyGuest(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      return await this.#withDatabase(
        this.#databasePath(resourceId),
        true,
        (database) => this.#runNative(database, sql, parameters),
        resourceId,
      );
    } catch { throw new ResourceError('DB_QUERY_FAILED', 'Read-only database operation failed.'); }
  }

  async #executeGuest(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      return await this.#runNative(await this.#open(resourceId, true), sql, parameters);
    } catch { throw new ResourceError('DB_EXECUTE_FAILED', 'Database execute failed.'); }
  }

  async #executeGuestOperations(resourceId: string, operations: readonly TDbExecuteOperation[]) {
    const database = await this.#open(resourceId, true);
    const execute = database.transaction(async () => {
      const results: { rowsAffected: number; lastInsertRowId?: bigint }[] = [];
      for (const operation of operations) results.push(await this.#runNative(database, operation.sql, operation.parameters));
      return results;
    });
    try {
      return await execute();
    } catch {
      throw new ResourceError('DB_EXECUTE_FAILED', 'Database execute failed.');
    }
  }

  async #inspectDatabase(database: Database): Promise<TDbObject[]> {
    const schemaRows = await this.#queryNative(database, `
      SELECT name, type, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'view')
        AND lower(name) NOT GLOB 'sqlite_*'
        AND lower(name) NOT GLOB '_omnidraw_*'
        AND lower(name) NOT GLOB 'libsql_*'
        AND lower(name) NOT GLOB '_turso_*'
        AND lower(name) NOT GLOB '_litestream_*'
      ORDER BY type, name
      LIMIT ${INSPECTION_OBJECT_MAX + 1}
    `, []);
    if (schemaRows.length > INSPECTION_OBJECT_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database has too many user objects to inspect safely.');
    const objects: TDbObject[] = [];
    for (const schemaRow of schemaRows) {
      const name = String(schemaRow.name);
      const kind = schemaRow.type === 'view' ? 'view' as const : 'table' as const;
      if (isInternalObject(name)) continue;
      const columnRows = await this.#pragmaNative(database, `PRAGMA table_xinfo(${quoteIdentifier(name)});`);
      if (columnRows.length > INSPECTION_MEMBER_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database object has too many columns to inspect safely.');
      const columns = columnRows.map((row): TDbColumn => ({
        name: String(row.name),
        declaredType: typeof row.type === 'string' ? row.type : '',
        nullable: Number(row.notnull) === 0,
        defaultSql: boundedInspectionSql(row.dflt_value),
        primaryKeyOrder: Number(row.pk) > 0 ? Number(row.pk) : null,
        hidden: Number(row.hidden) !== 0,
      }));
      const indexes: TDbIndex[] = [];
      if (kind === 'table') {
        const indexRows = await this.#pragmaNative(database, `PRAGMA index_list(${quoteIdentifier(name)});`);
        if (indexRows.length > INSPECTION_MEMBER_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database object has too many indexes to inspect safely.');
        for (const indexRow of indexRows) {
          const indexName = String(indexRow.name);
          const indexSchema = await this.#queryNative(database, 'SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?', ['index', indexName]);
          const indexColumnRows = await this.#pragmaNative(database, `PRAGMA index_xinfo(${quoteIdentifier(indexName)});`);
          if (indexColumnRows.length > INSPECTION_MEMBER_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database index has too many columns to inspect safely.');
          const indexColumns = indexColumnRows
            .filter((row) => Number(row.key) === 1)
            .map((row) => ({ name: row.name === null ? null : String(row.name), sequence: Number(row.seqno) }));
          indexes.push({ name: indexName, unique: Number(indexRow.unique) === 1, origin: String(indexRow.origin ?? ''), partial: Number(indexRow.partial) === 1, columns: indexColumns, createSql: boundedInspectionSql(indexSchema[0]?.sql ?? null) });
        }
      }
      const foreignRows = kind === 'table' ? await this.#pragmaNative(database, `PRAGMA foreign_key_list(${quoteIdentifier(name)});`) : [];
      if (foreignRows.length > INSPECTION_MEMBER_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database object has too many foreign-key columns to inspect safely.');
      const foreignMap = new Map<number, TDbForeignKey>();
      for (const row of foreignRows) {
        const id = Number(row.id);
        const current = foreignMap.get(id) ?? { id, columns: [], referencedTable: String(row.table), referencedColumns: [], onUpdate: String(row.on_update), onDelete: String(row.on_delete), match: String(row.match) };
        (current.columns as string[]).push(String(row.from));
        (current.referencedColumns as (string | null)[]).push(row.to === null ? null : String(row.to));
        foreignMap.set(id, current);
      }
      const triggers = (await this.#queryNative(database, `SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, [name]))
        .filter((row) => typeof row.sql === 'string' && !isInternalObject(String(row.name)))
        .map((row): TDbTrigger => ({ name: String(row.name), createSql: boundedInspectionSql(row.sql) ?? '' }));
      if (triggers.length > INSPECTION_MEMBER_MAX) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database object has too many triggers to inspect safely.');
      const primaryKey = columns.filter((column) => column.primaryKeyOrder !== null).sort((a, b) => (a.primaryKeyOrder ?? 0) - (b.primaryKeyOrder ?? 0));
      const createSql = boundedInspectionSql(schemaRow.sql);
      const options = tableOptions(createSql);
      const virtual = /^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(createSql ?? '');
      const rowidAlias = primaryKey.length === 1
        && primaryKey[0].declaredType.trim().toUpperCase() === 'INTEGER'
        && !indexes.some((index) => index.origin === 'pk');
      const safePrimaryKey = primaryKey.length > 0 && (primaryKey.every((column) => !column.nullable) || rowidAlias);
      const blobPrimaryKey = primaryKey.some((column) => /\bBLOB\b/i.test(column.declaredType));
      const identity = kind === 'view' || virtual ? null
        : safePrimaryKey && !blobPrimaryKey ? { kind: 'primaryKey' as const, columns: primaryKey.map((column) => column.name) }
          : options.withoutRowid ? null : { kind: 'rowid' as const };
      const readOnlyReason = kind === 'view' ? 'Views are read-only in the data workbench.'
        : virtual ? 'Virtual tables are read-only in the data workbench.'
        : blobPrimaryKey && options.withoutRowid ? 'This WITHOUT ROWID table has a BLOB primary key that cannot be transported as a bounded editable identity.'
        : identity === null ? 'This table has no safe primary-key or rowid identity.' : null;
      objects.push({ name, kind, columns, indexes, foreignKeys: [...foreignMap.values()], triggers, createSql, identity, editable: readOnlyReason === null, readOnlyReason });
    }
    if (Buffer.byteLength(JSON.stringify(objects), 'utf8') > RESULT_BYTES_MAX) {
      throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database structure inspection exceeds the response size limit.');
    }
    return objects;
  }

  async #requireObject(database: Database, nameValue: string): Promise<TDbObject> {
    const name = validateIdentifier(nameValue);
    const object = (await this.#inspectDatabase(database)).find((candidate) => candidate.name === name);
    if (!object) throw new ResourceError('DB_RESOURCE_TABLE_READ_ONLY', 'Database table or view was not found.');
    return object;
  }

  async #requireEditableObject(database: Database, name: string): Promise<TDbObject> {
    const object = await this.#requireObject(database, name);
    if (!object.editable || !object.identity) throw new ResourceError('DB_RESOURCE_TABLE_READ_ONLY', object.readOnlyReason ?? 'Database object is read-only.');
    return object;
  }

  #validatedValues(object: TDbObject, values: Readonly<Record<string, TDbCellValue>>, allowEmpty: boolean): Record<string, TDbBindValue> {
    if (!isPlainObject(values)) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Row values must be an object.');
    const columns = new Set(object.columns.filter((column) => !column.hidden).map((column) => column.name));
    const result: Record<string, TDbBindValue> = {};
    for (const [name, value] of Object.entries(values)) {
      if (!columns.has(name)) throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', `Unknown row column "${name}".`);
      result[name] = fromWireValue(value as TDbCellValue);
    }
    assertBoundBytes(Object.values(result), 'Row values exceed the payload size limit.');
    if (!allowEmpty && Object.keys(result).length === 0) return result;
    return result;
  }

  #rowIdentity(object: TDbObject, row: TNativeRow): TDbRowIdentity | null {
    if (object.identity?.kind === 'rowid') return { kind: 'rowid', value: toWireInteger(row.__omnidraw_rowid_value) };
    if (object.identity?.kind === 'primaryKey') {
      const values: Record<string, TDbCellValue> = {};
      for (const name of object.identity.columns) values[name] = toWireValue(row[name]);
      return { kind: 'primaryKey', values };
    }
    return null;
  }

  #identityPredicate(object: TDbObject, identity: TDbRowIdentity): { sql: string; parameters: TDbBindValue[] } {
    if (object.identity?.kind === 'rowid' && identity.kind === 'rowid') {
      if (identity.value.type !== 'integer') throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Rowid identity must be an SQLite integer.');
      const parameters = [fromWireValue(identity.value)];
      assertBoundBytes(parameters, 'Row identity exceeds the payload size limit.');
      return { sql: 'rowid = ?', parameters };
    }
    if (object.identity?.kind === 'primaryKey' && identity.kind === 'primaryKey') {
      const names = Object.keys(identity.values);
      if (names.length !== object.identity.columns.length || object.identity.columns.some((name) => !Object.prototype.hasOwnProperty.call(identity.values, name))) {
        throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Complete primary-key identity is required.');
      }
      const parameters = object.identity.columns.map((name) => fromWireValue(identity.values[name]));
      assertBoundBytes(parameters, 'Row identity exceeds the payload size limit.');
      return { sql: object.identity.columns.map((name) => `${quoteIdentifier(name)} IS ?`).join(' AND '), parameters };
    }
    throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Stable row identity is required.');
  }

  #cursorPredicate(object: TDbObject, cursor: TDbRowIdentity | null): { sql: string; parameters: TDbBindValue[] } {
    if (!cursor) return { sql: '', parameters: [] };
    if (object.identity?.kind === 'rowid' && cursor.kind === 'rowid') {
      if (cursor.value.type !== 'integer') throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Rowid cursor must be an SQLite integer.');
      return { sql: ' WHERE rowid > ?', parameters: [fromWireValue(cursor.value)] };
    }
    if (object.identity?.kind === 'primaryKey' && cursor.kind === 'primaryKey') {
      const columns = object.identity.columns;
      const names = Object.keys(cursor.values);
      if (names.length !== columns.length || columns.some((name) => !Object.prototype.hasOwnProperty.call(cursor.values, name))) {
        throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Complete primary-key cursor is required.');
      }
      const parameters: TDbBindValue[] = [];
      const clauses = columns.map((column, index) => {
        const parts = columns.slice(0, index).map((name) => { parameters.push(fromWireValue(cursor.values[name])); return `${quoteIdentifier(name)} IS ?`; });
        parameters.push(fromWireValue(cursor.values[column]));
        parts.push(`${quoteIdentifier(column)} > ?`);
        return `(${parts.join(' AND ')})`;
      });
      assertBoundBytes(parameters, 'Row cursor exceeds the payload size limit.');
      return { sql: ` WHERE ${clauses.join(' OR ')}`, parameters };
    }
    throw new ResourceError('DB_RESOURCE_ROW_IDENTITY_REQUIRED', 'Cursor identity does not match this table.');
  }

  #expectedPredicate(values: Record<string, TDbBindValue>): { sql: string; parameters: TDbBindValue[] } {
    const names = Object.keys(values);
    return { sql: names.length ? ` AND ${names.map((name) => `${quoteIdentifier(name)} IS ?`).join(' AND ')}` : '', parameters: names.map((name) => values[name]) };
  }

  #expectedForUpdate(
    object: TDbObject,
    expectedOriginal: Readonly<Record<string, TDbCellValue>>,
    updates: Record<string, TDbBindValue>,
  ): Record<string, TDbBindValue> {
    const expected = this.#validatedValues(object, expectedOriginal, false);
    if (Object.keys(updates).some((name) => !Object.prototype.hasOwnProperty.call(expected, name))) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Expected original values must include every updated column.');
    }
    return expected;
  }

  #expectedForDelete(
    object: TDbObject,
    expectedOriginal: Readonly<Record<string, TDbCellValue>>,
  ): Record<string, TDbBindValue> {
    const expected = this.#validatedValues(object, expectedOriginal, false);
    const visible = object.columns.filter((column) => !column.hidden).map((column) => column.name);
    if (Object.keys(expected).length !== visible.length || visible.some((name) => !Object.prototype.hasOwnProperty.call(expected, name))) {
      throw new ResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Expected original values must include the complete visible row before deletion.');
    }
    return expected;
  }

  async #structuredSql(database: Database, operation: TDbDraftOperation): Promise<string> {
    if (operation.kind === 'createTable') {
      if (operation.columns.length < 1 || operation.columns.length > RESULT_COLUMN_MAX_COUNT) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'A table requires a bounded non-empty column list.');
      const strict = operation.strict ?? true;
      if (strict) validateStrictColumnTypes(operation.columns);
      const primary = operation.columns.filter((column) => column.primaryKeyOrder).sort((a, b) => (a.primaryKeyOrder ?? 0) - (b.primaryKeyOrder ?? 0));
      const definitions = operation.columns.map((column) => columnSql(column, primary.length <= 1));
      if (primary.length > 1) definitions.push(`PRIMARY KEY (${primary.map((column) => quoteIdentifier(column.name)).join(', ')})`);
      return `CREATE TABLE ${quoteIdentifier(operation.table)} (${definitions.join(', ')})${tableOptionsSql({ strict, withoutRowid: operation.withoutRowid ?? false })};`;
    }
    if (operation.kind === 'renameTable') return `ALTER TABLE ${quoteIdentifier(operation.table)} RENAME TO ${quoteIdentifier(operation.newName)};`;
    if (operation.kind === 'dropTable') return `DROP TABLE ${quoteIdentifier(operation.table)};`;
    if (operation.kind === 'addColumn') {
      const table = await this.#requireObject(database, operation.table);
      if (table.kind !== 'table') throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Columns can only be added to tables.');
      if (tableOptions(table.createSql).strict) validateStrictColumnTypes([operation.column]);
      return `ALTER TABLE ${quoteIdentifier(operation.table)} ADD COLUMN ${columnSql(operation.column)};`;
    }
    if (operation.kind === 'renameColumn') return `ALTER TABLE ${quoteIdentifier(operation.table)} RENAME COLUMN ${quoteIdentifier(operation.column)} TO ${quoteIdentifier(operation.newName)};`;
    if (operation.kind === 'dropColumn') return `ALTER TABLE ${quoteIdentifier(operation.table)} DROP COLUMN ${quoteIdentifier(operation.column)};`;
    if (operation.kind === 'createIndex') {
      if (operation.columns.length < 1 || operation.columns.length > RESULT_COLUMN_MAX_COUNT) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'An index requires columns.');
      const table = await this.#requireObject(database, operation.table);
      const available = new Set(table.columns.map((column) => column.name));
      if (operation.columns.some((column) => !available.has(column))) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Index column was not found.');
      return `CREATE ${operation.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(operation.name)} ON ${quoteIdentifier(operation.table)} (${operation.columns.map(quoteIdentifier).join(', ')});`;
    }
    if (operation.kind === 'dropIndex') return `DROP INDEX ${quoteIdentifier(operation.name)};`;
    return this.#rebuildTableSql(database, operation);
  }

  async #rebuildTableSql(database: Database, operation: Extract<TDbDraftOperation, { kind: 'alterColumn' | 'createForeignKey' | 'dropForeignKey' }>): Promise<string> {
    const object = await this.#requireObject(database, operation.table);
    if (object.kind !== 'table') throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Only tables can be rebuilt.');
    const originalSql = object.createSql;
    const originalOptions = tableOptions(originalSql);
    const originalTokens = originalSql === null ? [] : sqlSummary(originalSql).tokens;
    if (
      originalSql === null
      || originalTokens.some((token) => ['CHECK', 'GENERATED', 'AUTOINCREMENT', 'COLLATE', 'CONFLICT', 'CONSTRAINT', 'DEFERRABLE', 'INITIALLY', 'MATCH', 'VIRTUAL', 'ASC', 'DESC'].includes(token))
      || (originalTokens.includes('AS') && originalTokens.includes('SELECT'))
    ) {
      throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'This table contains structure that the structured rebuild cannot preserve losslessly; use advanced draft SQL.');
    }
    let columns: TDbColumnDefinition[] = object.columns.filter((column) => !column.hidden).map((column) => ({ name: column.name, declaredType: column.declaredType, nullable: column.nullable, defaultSql: column.defaultSql, primaryKeyOrder: column.primaryKeyOrder }));
    const sourceByTarget = new Map(columns.map((column) => [column.name, column.name]));
    let foreignKeys = [...object.foreignKeys];
    if (operation.kind === 'alterColumn') {
      const index = columns.findIndex((column) => column.name === operation.column);
      if (index < 0) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Column to alter was not found.');
      const current = columns[index];
      const next: TDbColumnDefinition = {
        name: operation.definition.name,
        declaredType: operation.definition.declaredType ?? current.declaredType,
        nullable: operation.definition.nullable ?? current.nullable,
        defaultSql: operation.definition.defaultSql === undefined ? current.defaultSql : operation.definition.defaultSql,
        primaryKeyOrder: operation.definition.primaryKeyOrder === undefined ? current.primaryKeyOrder : operation.definition.primaryKeyOrder,
      };
      if (next.name !== operation.column) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Structured alter-column cannot rename a column; use the dedicated rename-column operation.');
      columns[index] = next;
      sourceByTarget.delete(operation.column);
      sourceByTarget.set(next.name, operation.column);
      foreignKeys = foreignKeys.map((foreign) => ({ ...foreign, columns: foreign.columns.map((name) => name === operation.column ? next.name : name) }));
    } else if (operation.kind === 'createForeignKey') {
      if (operation.columns.length < 1 || operation.columns.length !== operation.referencedColumns.length) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Foreign-key column lists must be non-empty and equal in length.');
      const available = new Set(columns.map((column) => column.name));
      if (operation.columns.some((column) => !available.has(column))) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Foreign-key source column was not found.');
      const referenced = await this.#requireObject(database, operation.referencedTable);
      const referencedAvailable = new Set(referenced.columns.map((column) => column.name));
      if (operation.referencedColumns.some((column) => !referencedAvailable.has(column))) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Foreign-key referenced column was not found.');
      foreignKeys.push({ id: foreignKeys.reduce((max, key) => Math.max(max, key.id), -1) + 1, columns: [...operation.columns], referencedTable: operation.referencedTable, referencedColumns: [...operation.referencedColumns], onUpdate: referentialAction(operation.onUpdate), onDelete: referentialAction(operation.onDelete), match: 'NONE' });
    } else {
      const before = foreignKeys.length;
      foreignKeys = foreignKeys.filter((foreign) => foreign.id !== operation.id);
      if (before === foreignKeys.length) throw new ResourceError('DB_RESOURCE_SCHEMA_OPERATION_INVALID', 'Foreign key to drop was not found.');
    }
    const primary = columns.filter((column) => column.primaryKeyOrder).sort((a, b) => (a.primaryKeyOrder ?? 0) - (b.primaryKeyOrder ?? 0));
    if (originalOptions.strict) validateStrictColumnTypes(columns);
    const definitions = columns.map((column) => columnSql(column, primary.length <= 1));
    if (primary.length > 1) definitions.push(`PRIMARY KEY (${primary.map((column) => quoteIdentifier(column.name)).join(', ')})`);
    for (const index of object.indexes.filter((candidate) => candidate.unique && candidate.origin === 'u')) {
      const names = index.columns.map((column) => column.name).filter((name): name is string => name !== null);
      if (names.length > 0) definitions.push(`UNIQUE (${names.map((name) => quoteIdentifier(operation.kind === 'alterColumn' && name === operation.column ? operation.definition.name : name)).join(', ')})`);
    }
    for (const foreign of foreignKeys) {
      const referencedColumns = foreign.referencedColumns.every((name): name is string => name !== null)
        ? ` (${foreign.referencedColumns.map(quoteIdentifier).join(', ')})`
        : '';
      definitions.push(`FOREIGN KEY (${foreign.columns.map(quoteIdentifier).join(', ')}) REFERENCES ${quoteIdentifier(foreign.referencedTable)}${referencedColumns} ON UPDATE ${referentialAction(foreign.onUpdate)} ON DELETE ${referentialAction(foreign.onDelete)}`);
    }
    const temporary = '__omnidraw_rebuild';
    const targets = columns.map((column) => column.name);
    const indexes = object.indexes.filter((index) => index.createSql).map((index) => `${index.createSql};`).join('\n');
    const triggers = object.triggers.map((trigger) => `${trigger.createSql};`).join('\n');
    return [
      `DROP TABLE IF EXISTS ${quoteIdentifier(temporary)};`,
      `CREATE TABLE ${quoteIdentifier(temporary)} (${definitions.join(', ')})${tableOptionsSql(originalOptions)};`,
      `INSERT INTO ${quoteIdentifier(temporary)} (${targets.map(quoteIdentifier).join(', ')}) SELECT ${targets.map((name) => quoteIdentifier(sourceByTarget.get(name) ?? name)).join(', ')} FROM ${quoteIdentifier(object.name)};`,
      `DROP TABLE ${quoteIdentifier(object.name)};`,
      `ALTER TABLE ${quoteIdentifier(temporary)} RENAME TO ${quoteIdentifier(object.name)};`,
      indexes,
      triggers,
    ].filter(Boolean).join('\n');
  }

  #rowWrite<T>(resourceIdValue: string, write: (database: Database) => Promise<T>): Promise<T> {
    const resourceId = validateHostId(resourceIdValue);
    this.#assertAvailable(resourceId);
    return this.#track(resourceId, this.#serializeWrite(resourceId, async () => {
      const database = await this.#open(resourceId, true);
      const transaction = database.transaction(() => write(database));
      try { return await transaction(); }
      catch (error) {
        if (error instanceof ResourceError) throw error;
        throw new ResourceError('DB_EXECUTE_FAILED', 'Live row write failed.');
      }
    }));
  }

  async #queryNative(
    database: Database,
    sql: string,
    parameters: readonly TDbBindValue[],
    columnMax = RESULT_COLUMN_MAX_COUNT,
    byteMax = RESULT_BYTES_MAX,
  ): Promise<TNativeRow[]> {
    const statement = await database.prepare(sql);
    statement.safeIntegers(true);
    try {
      const rows: TNativeRow[] = [];
      let bytes = 0;
      for await (const raw of statement.iterate([...parameters], { queryTimeout: QUERY_TIMEOUT_MS })) {
        if (rows.length >= RESULT_ROW_MAX_COUNT) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database management query returned too many rows.');
        const row = normalizeNativeRow(raw, columnMax);
        bytes += nativeRowBytes(row);
        if (bytes > byteMax) throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database management query exceeded the response size limit.');
        rows.push(row);
      }
      return rows;
    } finally { statement.close(); }
  }

  async #pragmaNative(database: Database, sql: string): Promise<TNativeRow[]> {
    return this.#queryNative(database, sql, []);
  }

  async #runNative(database: Database, sql: string, parameters: readonly TDbBindValue[] | TDbBindParameters): Promise<{ rowsAffected: number; lastInsertRowId?: bigint }> {
    const statement = await database.prepare(sql);
    statement.safeIntegers(true);
    try {
      const result = await statement.run(parameters, { queryTimeout: QUERY_TIMEOUT_MS });
      const rowId = result.lastInsertRowid as number | bigint;
      return { rowsAffected: result.changes, ...(typeof rowId === 'bigint' ? { lastInsertRowId: rowId } : Number.isSafeInteger(rowId) ? { lastInsertRowId: BigInt(rowId) } : {}) };
    } finally { statement.close(); }
  }

  async #foreignKeyViolations(database: Database): Promise<Set<string>> {
    try {
      const tableRows = await this.#queryNative(database, "SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' ORDER BY `name`", []);
      const tableNames = new Set(tableRows.map((row) => {
        if (typeof row.name !== 'string') throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign-key inspection returned an invalid table name.');
        return validateIdentifier(row.name);
      }));
      const parentPrimaryKeys = new Map<string, string[]>();
      const parentEligibleKeys = new Map<string, string[][]>();
      const violations = new Set<string>();
      let violationCount = 0;

      for (const tableRow of tableRows) {
        if (typeof tableRow.name !== 'string') throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign-key inspection returned an invalid table name.');
        const table = validateIdentifier(tableRow.name);
        const lower = table.toLowerCase();
        if (lower.startsWith('sqlite_') || lower.startsWith('libsql_') || lower.startsWith('_turso_') || lower.startsWith('_litestream_')) continue;
        const foreignRows = await this.#pragmaNative(database, `PRAGMA foreign_key_list(${quoteIdentifier(table)});`);
        const foreignKeys = new Map<number, { parentTable: string; parts: { sequence: number; childColumn: string; parentColumn: string | null }[] }>();
        for (const row of foreignRows) {
          const id = Number(row.id);
          const sequence = Number(row.seq);
          if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(sequence) || sequence < 0 || typeof row.table !== 'string' || typeof row.from !== 'string') {
            throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign-key inspection returned invalid metadata.');
          }
          const parentTable = validateIdentifier(row.table);
          const current = foreignKeys.get(id) ?? { parentTable, parts: [] };
          if (current.parentTable !== parentTable) throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign-key inspection returned inconsistent metadata.');
          current.parts.push({
            sequence,
            childColumn: validateIdentifier(row.from),
            parentColumn: row.to === null || row.to === undefined || row.to === '' ? null : validateIdentifier(String(row.to)),
          });
          foreignKeys.set(id, current);
        }

        for (const [foreignKeyId, foreignKey] of foreignKeys) {
          const parts = [...foreignKey.parts].sort((left, right) => left.sequence - right.sequence);
          if (parts.length === 0 || parts.some((part, index) => part.sequence !== index)) {
            throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign-key inspection returned a non-contiguous key definition.');
          }
          const parentExists = tableNames.has(foreignKey.parentTable);
          if (parentExists && parts.some((part) => part.parentColumn === null)) {
            let primaryKey = parentPrimaryKeys.get(foreignKey.parentTable);
            if (!primaryKey) {
              primaryKey = (await this.#pragmaNative(database, `PRAGMA table_xinfo(${quoteIdentifier(foreignKey.parentTable)});`))
                .filter((row) => Number(row.pk) > 0 && typeof row.name === 'string')
                .sort((left, right) => Number(left.pk) - Number(right.pk))
                .map((row) => validateIdentifier(String(row.name)));
              parentPrimaryKeys.set(foreignKey.parentTable, primaryKey);
            }
            if (primaryKey.length !== parts.length || parts.some((part) => part.parentColumn !== null)) {
              throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign key does not resolve to a complete parent primary key.');
            }
            parts.forEach((part, index) => { part.parentColumn = primaryKey![index]; });
          }
          if (parentExists) {
            let eligibleKeys = parentEligibleKeys.get(foreignKey.parentTable);
            if (!eligibleKeys) {
              let primaryKey = parentPrimaryKeys.get(foreignKey.parentTable);
              if (!primaryKey) {
                primaryKey = (await this.#pragmaNative(database, `PRAGMA table_xinfo(${quoteIdentifier(foreignKey.parentTable)});`))
                  .filter((row) => Number(row.pk) > 0 && typeof row.name === 'string')
                  .sort((left, right) => Number(left.pk) - Number(right.pk))
                  .map((row) => validateIdentifier(String(row.name)));
                parentPrimaryKeys.set(foreignKey.parentTable, primaryKey);
              }
              eligibleKeys = primaryKey.length > 0 ? [primaryKey] : [];
              const parentSchema = await this.#queryNative(database, "SELECT `sql` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` = ?", [foreignKey.parentTable]);
              const parentHasExplicitCollation = typeof parentSchema[0]?.sql === 'string'
                && sqlSummary(parentSchema[0].sql).tokens.includes('COLLATE');
              for (const indexRow of await this.#pragmaNative(database, `PRAGMA index_list(${quoteIdentifier(foreignKey.parentTable)});`)) {
                if (Number(indexRow.unique) !== 1 || Number(indexRow.partial) === 1 || typeof indexRow.name !== 'string') continue;
                const indexColumns = (await this.#pragmaNative(database, `PRAGMA index_xinfo(${quoteIdentifier(validateIdentifier(indexRow.name))});`))
                  .filter((row) => Number(row.key) === 1)
                  .sort((left, right) => Number(left.seqno) - Number(right.seqno));
                if (
                  parentHasExplicitCollation
                  || indexColumns.length === 0
                  || indexColumns.some((row) => typeof row.name !== 'string' || row.name.length === 0 || row.coll !== 'BINARY')
                ) continue;
                eligibleKeys.push(indexColumns.map((row) => validateIdentifier(String(row.name))));
              }
              parentEligibleKeys.set(foreignKey.parentTable, eligibleKeys);
            }
            const referencedColumns = parts.map((part) => part.parentColumn!);
            if (!eligibleKeys.some((key) => key.length === referencedColumns.length && key.every((column, index) => column === referencedColumns[index]))) {
              throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Foreign key references parent columns that are not an eligible primary or unique key in the declared order.');
            }
          }

          const childAlias = 'fk_child';
          const parentAlias = 'fk_parent';
          const childExpressions = parts.map((part) => `${childAlias}.${quoteIdentifier(part.childColumn)}`);
          const selected = childExpressions.map((expression, index) => `${expression} AS ${quoteIdentifier(`value_${index}`)}`);
          const parentMatch = parentExists
            ? parts.map((part, index) => `${parentAlias}.${quoteIdentifier(part.parentColumn!)} = ${childExpressions[index]}`).join(' AND ')
            : '';
          const sql = `
            SELECT ${selected.join(', ')}, COUNT(*) AS \`violation_count\`
            FROM ${quoteIdentifier(table)} AS ${childAlias}
            WHERE ${childExpressions.map((expression) => `${expression} IS NOT NULL`).join(' AND ')}
              ${parentExists ? `AND NOT EXISTS (
                SELECT 1 FROM ${quoteIdentifier(foreignKey.parentTable)} AS ${parentAlias}
                WHERE ${parentMatch}
              )` : ''}
            GROUP BY ${childExpressions.join(', ')}
          `;
          for (const row of await this.#queryNative(database, sql, [])) {
            const rawCount = row.violation_count;
            const count = typeof rawCount === 'bigint' ? Number(rawCount) : rawCount;
            if (!Number.isSafeInteger(count) || Number(count) < 1 || violationCount + Number(count) > RESULT_ROW_MAX_COUNT) {
              throw new ResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database has too many foreign-key violations to verify safely.');
            }
            const values = parts.map((_part, index) => toWireValue(row[`value_${index}`]));
            const key = JSON.stringify([table, foreignKeyId, values]);
            for (let ordinal = 1; ordinal <= Number(count); ordinal += 1) violations.add(`${key}#${ordinal}`);
            violationCount += Number(count);
          }
        }
      }
      return violations;
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'Database foreign-key verification is unavailable or failed.');
    }
  }

  async #verifyDatabase(database: Database, baselineForeignKeys: ReadonlySet<string>): Promise<void> {
    const health = await this.#pragmaNative(database, 'PRAGMA quick_check;');
    const healthy = health.length === 1 && Object.values(health[0]).some((value) => value === 'ok');
    if (!healthy) throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource database health check failed.');
    const violations = await this.#foreignKeyViolations(database);
    if ([...violations].some((violation) => !baselineForeignKeys.has(violation))) throw new ResourceError('DB_RESOURCE_APPLY_FAILED', 'DbResource apply introduced a foreign-key violation.');
  }

  async #verifyDatabaseFile(databasePath: string, baselineForeignKeys: ReadonlySet<string>): Promise<void> {
    await this.#withDatabase(databasePath, true, (database) => this.#verifyDatabase(database, baselineForeignKeys));
  }

  async #verifiedSnapshotForeignKeys(databasePath: string): Promise<Set<string>> {
    return this.#withDatabase(databasePath, true, async (database) => {
      const baselineForeignKeys = await this.#foreignKeyViolations(database);
      await this.#verifyDatabase(database, baselineForeignKeys);
      return baselineForeignKeys;
    });
  }

  #withDatabase<T>(
    databasePath: string,
    readonly: boolean,
    operation: (database: Database) => Promise<T>,
    trackedResourceId?: string,
  ): Promise<T> {
    if (trackedResourceId) {
      this.#trackedTemporaryRequests.set(
        trackedResourceId,
        (this.#trackedTemporaryRequests.get(trackedResourceId) ?? 0) + 1,
      );
    }
    const call = this.#runWithDatabase(databasePath, readonly, operation);
    this.#temporaryOperations.add(call);
    void call.finally(() => {
      this.#temporaryOperations.delete(call);
      if (!trackedResourceId) return;
      const remaining = (this.#trackedTemporaryRequests.get(trackedResourceId) ?? 1) - 1;
      if (remaining === 0) this.#trackedTemporaryRequests.delete(trackedResourceId);
      else this.#trackedTemporaryRequests.set(trackedResourceId, remaining);
    }).catch(() => undefined);
    return call;
  }

  async #runWithDatabase<T>(
    databasePath: string,
    readonly: boolean,
    operation: (database: Database) => Promise<T>,
  ): Promise<T> {
    await this.#reserveTemporaryHandle();
    let database: Database;
    try {
      database = this.#databaseFactory(databasePath, {
        readonly,
        fileMustExist: true,
        defaultQueryTimeout: QUERY_TIMEOUT_MS,
        experimental: ['custom_types', 'triggers', 'index_method', 'strict', 'without_rowid', 'multiprocess_wal'],
      });
    } catch (error) {
      this.#releaseTemporaryHandle();
      throw error;
    }

    let outcome: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>;
    try {
      await database.connect();
      if (readonly) {
        await database.exec('PRAGMA query_only = 1;', { queryTimeout: QUERY_TIMEOUT_MS });
        const queryOnly = await this.#pragmaNative(database, 'PRAGMA query_only;');
        if (queryOnly.length !== 1 || !Object.values(queryOnly[0]).some((value) => Number(value) === 1)) {
          throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'Database readonly connection could not be enforced.');
        }
      } else {
        await database.exec(RESOURCE_PRAGMAS_SQL);
      }
      outcome = { ok: true, value: await operation(database) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    let closeError: unknown;
    let closeFailed = false;
    try {
      await this.#closeTemporaryDatabase(database);
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }
    if (!outcome.ok && closeFailed) {
      throw new AggregateError(
        [outcome.error, closeError],
        'DbResource operation and temporary database close both failed.',
      );
    }
    if (!outcome.ok) throw outcome.error;
    if (closeFailed) throw closeError;
    return outcome.value;
  }

  async #removeDatabaseFiles(databasePath: string): Promise<void> {
    const directory = dirname(databasePath);
    const fileName = basename(databasePath);
    const entries = await readdir(directory).catch(() => [] as string[]);
    await Promise.all(entries.filter((entry) => entry === fileName || entry.startsWith(`${fileName}-`)).map((entry) => rm(join(directory, entry), { force: true })));
  }

  async #copyDatabaseFiles(sourcePath: string, destinationPath: string): Promise<void> {
    const sourceDirectory = dirname(sourcePath);
    const sourceName = basename(sourcePath);
    const destinationName = basename(destinationPath);
    const entries = await readdir(sourceDirectory);
    const sourceEntries = entries.filter((entry) => entry === sourceName || entry.startsWith(`${sourceName}-`));
    if (!sourceEntries.includes(sourceName)) throw new ResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource snapshot source is missing its database file.');
    await mkdir(dirname(destinationPath), { recursive: true });
    await this.#removeDatabaseFiles(destinationPath);
    await Promise.all(sourceEntries.map((entry) => copyFile(join(sourceDirectory, entry), join(dirname(destinationPath), `${destinationName}${entry.slice(sourceName.length)}`))));
  }

  #resourceDirectory(resourceId: string) { return join(this.#dataRoot, validateHostId(resourceId)); }
  #databasePath(resourceId: string) { return join(this.#resourceDirectory(resourceId), 'data.db'); }
  #draftDirectory(draftId: string) { return join(this.#dataRoot, '.drafts', validateHostId(draftId, 'DbResource draft')); }
  #draftDatabasePath(draftId: string) { return join(this.#draftDirectory(draftId), 'data.db'); }
  #backupDirectory(resourceId: string, applyId: string) { return join(this.#resourceDirectory(resourceId), 'backups', validateHostId(applyId, 'DbResource apply')); }
  #backupDatabasePath(resourceId: string, applyId: string) { return join(this.#backupDirectory(resourceId, applyId), 'data.db'); }

  #open(resourceId: string, fileMustExist: boolean): Promise<Database> {
    const cached = this.#handles.get(resourceId);
    if (cached) {
      this.#touchHandle(resourceId);
      return cached;
    }
    return this.#withHandleAdmission(async () => {
      const admitted = this.#handles.get(resourceId);
      if (admitted) {
        this.#touchHandle(resourceId);
        return admitted;
      }
      await this.#waitForHandleCapacity(resourceId);
      const opening = (async () => {
        const database = this.#databaseFactory(this.#databasePath(resourceId), {
          defaultQueryTimeout: QUERY_TIMEOUT_MS,
          fileMustExist,
          experimental: ['custom_types', 'triggers', 'index_method', 'strict', 'without_rowid', 'multiprocess_wal'],
        });
        try { await database.connect(); await database.exec(RESOURCE_PRAGMAS_SQL); return database; }
        catch (error) { await this.#closeDatabase(database).catch(() => undefined); throw error; }
      })();
      this.#handles.set(resourceId, opening);
      this.#touchHandle(resourceId);
      void opening.catch(() => {
        if (this.#handles.get(resourceId) === opening) {
          this.#handles.delete(resourceId);
          this.#handleLastUsed.delete(resourceId);
          this.#handleLastUsedAtMs.delete(resourceId);
          this.#notifyHandleCapacityChange();
          this.#scheduleNextIdleSweep();
        }
      });
      return opening;
    });
  }

  async #closeHandle(resourceId: string): Promise<void> {
    const opening = this.#handles.get(resourceId);
    this.#handles.delete(resourceId);
    this.#handleLastUsed.delete(resourceId);
    this.#handleLastUsedAtMs.delete(resourceId);
    if (!opening) return;
    this.#closingHandleCount += 1;
    try {
      await this.#closeDatabase(await opening);
    } finally {
      this.#closingHandleCount -= 1;
      this.#notifyHandleCapacityChange();
      this.#scheduleNextIdleSweep();
    }
  }

  async #closeDatabase(database: Database): Promise<void> {
    const wasFailed = this.#failedCloses.has(database);
    try {
      await database.close();
      this.#failedCloses.delete(database);
      if (wasFailed) this.#notifyHandleCapacityChange();
    } catch (error) {
      this.#failedCloses.add(database);
      throw error;
    }
  }

  #withHandleAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#handleAdmissionTail.then(operation, operation);
    this.#handleAdmissionTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #reserveTemporaryHandle(): Promise<void> {
    await this.#withHandleAdmission(async () => {
      this.#assertAvailable();
      await this.#waitForHandleCapacity();
      this.#temporaryHandleCount += 1;
    });
  }

  async #waitForHandleCapacity(excludedResourceId?: string): Promise<void> {
    while (this.openHandleCount >= this.#maxOpenHandles) {
      this.#assertAvailable();
      let closeFailures: unknown[] = [];
      if (this.#failedCloses.size > 0) {
        const retryResults = await Promise.allSettled(
          [...this.#failedCloses].map((database) => this.#closeDatabase(database)),
        );
        closeFailures = retryResults.flatMap((result) => (
          result.status === 'rejected' ? [result.reason] : []
        ));
        if (this.openHandleCount < this.#maxOpenHandles) break;
      }
      if (await this.#evictOneIdleHandle(excludedResourceId)) continue;
      if (this.openHandleCount < this.#maxOpenHandles) break;

      const busy = [
        ...[...this.#inflight.entries()].flatMap(([resourceId, calls]) => (
          this.#blockingInflightCount(resourceId) > 0 ? [...calls] : []
        )),
        ...this.#writeTails.values(),
      ];
      const capacityMayChange = this.#temporaryHandleCount > 0 || this.#closingHandleCount > 0;
      if (busy.length === 0 && !capacityMayChange) {
        if (closeFailures.length > 0) {
          throw new AggregateError(closeFailures, 'DbResource could not close a handle to admit more work.');
        }
        throw new ResourceError('DB_BUSY', 'All DbResource handles are busy.');
      }

      const waiter = this.#handleCapacityWaiter();
      try {
        await Promise.race([
          waiter.promise,
          ...busy.map((operation) => operation.catch(() => undefined)),
        ]);
      } finally {
        waiter.cancel();
      }
    }
  }

  async #closeTemporaryDatabase(database: Database): Promise<void> {
    let closeError: unknown;
    let closeFailed = false;
    try {
      await database.close();
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }
    this.#temporaryHandleCount -= 1;
    if (closeFailed) this.#failedCloses.add(database);
    this.#notifyHandleCapacityChange();
    if (closeFailed) throw closeError;
  }

  #releaseTemporaryHandle(): void {
    this.#temporaryHandleCount -= 1;
    this.#notifyHandleCapacityChange();
  }

  #handleCapacityWaiter(): Readonly<{ promise: Promise<void>; cancel: () => void }> {
    let resolve!: () => void;
    const promise = new Promise<void>((next) => { resolve = next; });
    const wake = () => {
      this.#handleCapacityWaiters.delete(wake);
      resolve();
    };
    this.#handleCapacityWaiters.add(wake);
    return { promise, cancel: () => this.#handleCapacityWaiters.delete(wake) };
  }

  #notifyHandleCapacityChange(): void {
    const waiters = [...this.#handleCapacityWaiters];
    this.#handleCapacityWaiters.clear();
    for (const wake of waiters) wake();
  }

  #blockingInflightCount(resourceId: string): number {
    return Math.max(
      0,
      (this.#inflight.get(resourceId)?.size ?? 0)
        - (this.#trackedTemporaryRequests.get(resourceId) ?? 0),
    );
  }

  async #evictOneIdleHandle(excludedResourceId?: string): Promise<boolean> {
    const candidate = [...this.#handles.keys()]
      .filter((resourceId) => (
        resourceId !== excludedResourceId
        && !this.#blocked.has(resourceId)
        && this.#blockingInflightCount(resourceId) === 0
        && !this.#writeTails.has(resourceId)
      ))
      .sort((left, right) => (
        (this.#handleLastUsed.get(left) ?? 0) - (this.#handleLastUsed.get(right) ?? 0)
      ))[0];
    if (!candidate) return false;
    await this.#closeHandle(candidate);
    return true;
  }

  #touchHandle(resourceId: string): void {
    this.#handleLastUsed.set(resourceId, ++this.#handleClock);
    this.#handleLastUsedAtMs.set(resourceId, this.#nowMs());
    this.#scheduleNextIdleSweep();
  }

  #scheduleNextIdleSweep(): void {
    this.#cancelIdleSweep?.();
    this.#cancelIdleSweep = null;
    if (this.#closed || (this.#handles.size === 0 && this.#failedCloses.size === 0)) return;

    const nowMs = this.#nowMs();
    let delayMs = this.#idleHandleTimeoutMs;
    for (const resourceId of this.#handles.keys()) {
      const busy = this.#blocked.has(resourceId)
        || (this.#inflight.get(resourceId)?.size ?? 0) > 0
        || this.#writeTails.has(resourceId);
      const candidateDelay = busy
        ? this.#idleHandleTimeoutMs
        : Math.max(
            1,
            (this.#handleLastUsedAtMs.get(resourceId) ?? nowMs) + this.#idleHandleTimeoutMs - nowMs,
          );
      delayMs = Math.min(delayMs, candidateDelay);
    }
    this.#cancelIdleSweep = this.#scheduleIdleSweep(async () => {
      this.#cancelIdleSweep = null;
      await this.#closeExpiredIdleHandles();
    }, delayMs);
  }

  async #closeExpiredIdleHandles(): Promise<void> {
    if (this.#closed) return;
    await this.#withHandleAdmission(async () => {
      if (this.#failedCloses.size > 0) {
        await Promise.allSettled([...this.#failedCloses].map((database) => this.#closeDatabase(database)));
      }
      const expiredBeforeMs = this.#nowMs() - this.#idleHandleTimeoutMs;
      const candidates = [...this.#handles.keys()].filter((resourceId) => (
        !this.#blocked.has(resourceId)
        && (this.#inflight.get(resourceId)?.size ?? 0) === 0
        && !this.#writeTails.has(resourceId)
        && (this.#handleLastUsedAtMs.get(resourceId) ?? Number.POSITIVE_INFINITY) <= expiredBeforeMs
      ));
      for (const resourceId of candidates) {
        await this.#closeHandle(resourceId).catch(() => undefined);
      }
    });
    this.#scheduleNextIdleSweep();
  }

  #serializeWrite<T>(resourceId: string, write: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(resourceId) ?? Promise.resolve();
    const result = previous.then(write, write);
    const tail = result.then(() => undefined, () => undefined);
    this.#writeTails.set(resourceId, tail);
    void tail.finally(() => { if (this.#writeTails.get(resourceId) === tail) this.#writeTails.delete(resourceId); });
    return result;
  }

  #track<T>(resourceId: string, call: Promise<T>): Promise<T> {
    const calls = this.#inflight.get(resourceId) ?? new Set<Promise<unknown>>();
    this.#inflight.set(resourceId, calls);
    calls.add(call);
    void call.finally(() => {
      calls.delete(call);
      if (calls.size === 0) {
        this.#inflight.delete(resourceId);
        if (this.#handles.has(resourceId)) this.#touchHandle(resourceId);
      }
    }).catch(() => undefined);
    return call;
  }

  async #drain(resourceId: string): Promise<void> {
    const calls = this.#inflight.get(resourceId);
    if (calls?.size) await Promise.allSettled([...calls]);
  }

  #assertAvailable(resourceId?: string): void {
    if (this.#closed) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource provider is closed.');
    if (resourceId && this.#blocked.has(resourceId)) throw new ResourceError('DB_RESOURCE_MIGRATING', 'DbResource is unavailable while coordinated database work is running.');
  }
}
