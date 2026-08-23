/**
 * @file Pure, host-neutral resource bridge codecs.
 *
 * The wire format is deliberately a tagged tree instead of "JSON plus a few
 * magic objects". Consequently an authored object can never be mistaken for a
 * bigint/blob tag, and normalized object keys have one deterministic order.
 */

export const PORTABLE_RESOURCE_REQUEST_FORMAT =
  'omnidraw.resource.request.v1' as const;
export const PORTABLE_RESOURCE_RESULT_FORMAT =
  'omnidraw.resource.result.v1' as const;
export const PORTABLE_RESOURCE_FAILURE_FORMAT =
  'omnidraw.resource.failure.v1' as const;
export const PORTABLE_RESOURCE_DB_ROWS_FORMAT =
  'omnidraw.resource.db.rows.v1' as const;
export const PORTABLE_RESOURCE_DB_EXECUTE_FORMAT =
  'omnidraw.resource.db.execute.v1' as const;

export const PORTABLE_RESOURCE_FAILURE_CODES = Object.freeze([
  'RESOURCE_MALFORMED_INPUT',
  'RESOURCE_SLOT_UNDECLARED',
  'RESOURCE_OPERATION_UNKNOWN',
  'RESOURCE_EFFECT_DENIED',
  'RESOURCE_CONFLICT',
  'RESOURCE_UNAVAILABLE',
  'RESOURCE_QUERY_FAILED',
  'RESOURCE_LIMIT_EXCEEDED',
  'RESOURCE_CANCELLED',
  'RESOURCE_TIMEOUT',
  'RESOURCE_WRITE_OUTCOME_AMBIGUOUS',
] as const);

export type TPortableResourceFailureCode =
  (typeof PORTABLE_RESOURCE_FAILURE_CODES)[number];
export type TPortableResourceEffect = 'read' | 'write';

export type TPortableResourceWireValue =
  | Readonly<{ type: 'null' }>
  | Readonly<{ type: 'boolean'; value: boolean }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'string'; value: string }>
  | Readonly<{ type: 'bigint'; value: string }>
  | Readonly<{ type: 'bytes'; base64: string }>
  | Readonly<{
      type: 'array';
      items: readonly TPortableResourceWireValue[];
    }>
  | Readonly<{
      type: 'object';
      entries: readonly (readonly [string, TPortableResourceWireValue])[];
    }>;

export type TPortableResourceRequestWire = Readonly<{
  format: typeof PORTABLE_RESOURCE_REQUEST_FORMAT;
  correlationId: string;
  slot: string;
  operation: string;
  effect: TPortableResourceEffect;
  input: TPortableResourceWireValue;
}>;

export type TPortableResourceResultWire = Readonly<{
  format: typeof PORTABLE_RESOURCE_RESULT_FORMAT;
  correlationId: string;
  output: TPortableResourceWireValue;
}>;

export type TPortableResourceFailureWire = Readonly<{
  format: typeof PORTABLE_RESOURCE_FAILURE_FORMAT;
  correlationId: string;
  failure: Readonly<{
    code: TPortableResourceFailureCode;
    message: string;
  }>;
}>;

export type TPortableResourceResponseWire =
  | TPortableResourceResultWire
  | TPortableResourceFailureWire;

export type TPortableResourceRequest = Readonly<{
  correlationId: string;
  slot: string;
  operation: string;
  effect: TPortableResourceEffect;
  input: unknown;
}>;

export type TPortableResourceResult = Readonly<{
  correlationId: string;
  output: unknown;
}>;

export type TPortableResourceFailure = Readonly<{
  correlationId: string;
  failure: Readonly<{
    code: TPortableResourceFailureCode;
    message: string;
  }>;
}>;

export type TPortableResourceDbCellWire =
  | Readonly<{ type: 'null' }>
  | Readonly<{ type: 'integer'; value: string }>
  | Readonly<{ type: 'float'; value: number }>
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'blob'; base64: string }>
  | Readonly<{ type: 'json'; value: TPortableResourceWireValue }>;

export type TPortableResourceDbRowsWire = Readonly<{
  format: typeof PORTABLE_RESOURCE_DB_ROWS_FORMAT;
  columns: readonly string[];
  rows: readonly Readonly<{
    cells: readonly TPortableResourceDbCellWire[];
  }>[];
}>;

export type TPortableResourceDbExecuteWire = Readonly<{
  format: typeof PORTABLE_RESOURCE_DB_EXECUTE_FORMAT;
  rowsAffected: number;
  lastInsertId: string | null;
}>;

export type TPortableResourceWireLimits = Readonly<{
  maxDepth: number;
  maxNodes: number;
  maxCollectionItems: number;
  maxStringBytes: number;
  maxByteArrayBytes: number;
  maxWireBytes: number;
  maxDbColumns: number;
  maxDbRows: number;
  maxDbColumnNameBytes: number;
}>;

export const PORTABLE_RESOURCE_WIRE_LIMITS: TPortableResourceWireLimits =
  Object.freeze({
    maxDepth: 32,
    maxNodes: 100_000,
    maxCollectionItems: 10_000,
    maxStringBytes: 1_048_576,
    maxByteArrayBytes: 1_048_576,
    maxWireBytes: 4_194_304,
    maxDbColumns: 128,
    maxDbRows: 1_000,
    maxDbColumnNameBytes: 1_024,
  });

export type TPortableResourceWireErrorCode =
  | 'INVALID_VALUE'
  | 'LIMIT_EXCEEDED'
  | 'MALFORMED_WIRE'
  | 'NON_CANONICAL_WIRE';

export class PortableResourceWireError extends Error {
  readonly code: TPortableResourceWireErrorCode;

  constructor(code: TPortableResourceWireErrorCode, message: string) {
    super(message);
    this.name = 'PortableResourceWireError';
    this.code = code;
  }
}

const SQLITE_INTEGER_MIN = -9_223_372_036_854_775_808n;
const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const INTEGER_PATTERN = /^-?(?:0|[1-9][0-9]*)$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const FAILURE_CODE_SET = new Set<string>(PORTABLE_RESOURCE_FAILURE_CODES);
const encoder = new TextEncoder();

type TMutableBudget = {
  nodes: number;
  collectionItems: number;
};

function fail(
  code: TPortableResourceWireErrorCode,
  message: string,
): never {
  throw new PortableResourceWireError(code, message);
}

function exactLimits(
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceWireLimits {
  const limits = { ...PORTABLE_RESOURCE_WIRE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

function assertStringBound(
  value: string,
  limit: number,
  label: string,
): void {
  if (utf8Length(value) > limit) {
    fail('LIMIT_EXCEEDED', `${label} exceeds its UTF-8 byte limit.`);
  }
}

function plainDataRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('MALFORMED_WIRE', `${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('MALFORMED_WIRE', `${label} must have a plain prototype.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return fail('MALFORMED_WIRE', `${label} must not contain symbol keys.`);
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) {
      return fail(
        'MALFORMED_WIRE',
        `${label} must contain only enumerable data properties.`,
      );
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function denseDataArray(
  value: unknown,
  label: string,
  code: Extract<TPortableResourceWireErrorCode, 'INVALID_VALUE' | 'MALFORMED_WIRE'>,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    return fail(code, `${label} must be an array.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    return fail(code, `${label} must be a dense data array without extra properties.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || descriptor.get !== undefined
      || descriptor.set !== undefined
      || descriptor.enumerable !== true
    ) {
      return fail(code, `${label} must be a dense data array without accessors.`);
    }
  }
  return value;
}

function exactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    fail('MALFORMED_WIRE', `${label} has unsupported or missing fields.`);
  }
}

function addNode(
  budget: TMutableBudget,
  limits: TPortableResourceWireLimits,
): void {
  budget.nodes += 1;
  if (budget.nodes > limits.maxNodes) {
    fail('LIMIT_EXCEEDED', 'Resource value exceeds the node limit.');
  }
}

function addItems(
  budget: TMutableBudget,
  limits: TPortableResourceWireLimits,
  count: number,
): void {
  budget.collectionItems += count;
  if (budget.collectionItems > limits.maxCollectionItems) {
    fail('LIMIT_EXCEEDED', 'Resource value exceeds the collection item limit.');
  }
}

function assertDepth(
  depth: number,
  limits: TPortableResourceWireLimits,
): void {
  if (depth > limits.maxDepth) {
    fail('LIMIT_EXCEEDED', 'Resource value exceeds the nesting limit.');
  }
}

function canonicalInteger(value: bigint): string {
  if (value < SQLITE_INTEGER_MIN || value > SQLITE_INTEGER_MAX) {
    fail('INVALID_VALUE', 'Resource bigint is outside signed 64-bit range.');
  }
  return value.toString();
}

function parseCanonicalInteger(value: unknown): bigint {
  if (typeof value !== 'string' || !INTEGER_PATTERN.test(value)) {
    return fail('MALFORMED_WIRE', 'Resource bigint encoding is malformed.');
  }
  let integer: bigint;
  try {
    integer = BigInt(value);
  } catch {
    return fail('MALFORMED_WIRE', 'Resource bigint encoding is malformed.');
  }
  if (
    integer < SQLITE_INTEGER_MIN
    || integer > SQLITE_INTEGER_MAX
    || integer.toString() !== value
  ) {
    return fail(
      'NON_CANONICAL_WIRE',
      'Resource bigint encoding is non-canonical or out of range.',
    );
  }
  return integer;
}

function base64Encode(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(combined >>> 18) & 63];
    result += BASE64_ALPHABET[(combined >>> 12) & 63];
    result += index + 1 < bytes.length
      ? BASE64_ALPHABET[(combined >>> 6) & 63]
      : '=';
    result += index + 2 < bytes.length
      ? BASE64_ALPHABET[combined & 63]
      : '=';
  }
  return result;
}

function base64Decode(value: unknown, byteLimit: number): Uint8Array {
  if (
    typeof value !== 'string'
    || value.length % 4 !== 0
    || !BASE64_PATTERN.test(value)
  ) {
    return fail('MALFORMED_WIRE', 'Resource bytes are not canonical base64.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength > byteLimit) {
    return fail('LIMIT_EXCEEDED', 'Resource bytes exceed their byte limit.');
  }
  const result = new Uint8Array(byteLength);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === '='
      ? 0
      : BASE64_ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === '='
      ? 0
      : BASE64_ALPHABET.indexOf(value[index + 3]);
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (output < byteLength) result[output++] = (combined >>> 16) & 255;
    if (output < byteLength) result[output++] = (combined >>> 8) & 255;
    if (output < byteLength) result[output++] = combined & 255;
  }
  if (base64Encode(result) !== value) {
    return fail('NON_CANONICAL_WIRE', 'Resource bytes use non-canonical base64.');
  }
  return result;
}

function encodedBytes(value: unknown): number {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return fail('MALFORMED_WIRE', 'Resource wire value is not JSON serializable.');
  }
  if (json === undefined) {
    return fail('MALFORMED_WIRE', 'Resource wire value is not JSON serializable.');
  }
  return utf8Length(json);
}

function assertWireSize(
  value: unknown,
  limits: TPortableResourceWireLimits,
): void {
  if (encodedBytes(value) > limits.maxWireBytes) {
    fail('LIMIT_EXCEEDED', 'Resource wire value exceeds its byte limit.');
  }
}

function encodeValue(
  value: unknown,
  limits: TPortableResourceWireLimits,
  budget: TMutableBudget,
  active: WeakSet<object>,
  depth: number,
): TPortableResourceWireValue {
  assertDepth(depth, limits);
  addNode(budget, limits);
  if (value === null) return Object.freeze({ type: 'null' as const });
  if (typeof value === 'boolean') {
    return Object.freeze({ type: 'boolean' as const, value });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('INVALID_VALUE', 'Resource numbers must be finite.');
    }
    return Object.freeze({
      type: 'number' as const,
      value: Object.is(value, -0) ? 0 : value,
    });
  }
  if (typeof value === 'string') {
    assertStringBound(value, limits.maxStringBytes, 'Resource string');
    return Object.freeze({ type: 'string' as const, value });
  }
  if (typeof value === 'bigint') {
    return Object.freeze({
      type: 'bigint' as const,
      value: canonicalInteger(value),
    });
  }
  if (
    typeof value === 'undefined'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return fail('INVALID_VALUE', 'Resource value contains an unsupported type.');
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array
      ? new Uint8Array(value)
      : new Uint8Array(value.slice(0));
    if (bytes.byteLength > limits.maxByteArrayBytes) {
      return fail('LIMIT_EXCEEDED', 'Resource bytes exceed their byte limit.');
    }
    return Object.freeze({ type: 'bytes' as const, base64: base64Encode(bytes) });
  }
  if (active.has(value)) {
    return fail('INVALID_VALUE', 'Resource value must not contain cycles.');
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      addItems(budget, limits, value.length);
      const items = denseDataArray(value, 'Resource array', 'INVALID_VALUE').map((item) => encodeValue(
        item,
        limits,
        budget,
        active,
        depth + 1,
      ));
      return Object.freeze({ type: 'array' as const, items: Object.freeze(items) });
    }
    const record = plainDataRecord(value, 'Resource object');
    const normalizedKeys = new Map<string, string>();
    const entries: Array<readonly [string, TPortableResourceWireValue]> = [];
    for (const [key, nested] of Object.entries(record)) {
      const normalized = key.normalize('NFC');
      assertStringBound(normalized, limits.maxStringBytes, 'Resource object key');
      const previous = normalizedKeys.get(normalized);
      if (previous !== undefined) {
        return fail(
          'INVALID_VALUE',
          `Resource object keys '${previous}' and '${key}' collide after normalization.`,
        );
      }
      normalizedKeys.set(normalized, key);
      entries.push(Object.freeze([
        normalized,
        encodeValue(nested, limits, budget, active, depth + 1),
      ] as const));
    }
    addItems(budget, limits, entries.length);
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return Object.freeze({
      type: 'object' as const,
      entries: Object.freeze(entries),
    });
  } finally {
    active.delete(value);
  }
}

export function fnEncodePortableResourceValue(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceWireValue {
  const limits = exactLimits(overrides);
  const result = encodeValue(
    value,
    limits,
    { nodes: 0, collectionItems: 0 },
    new WeakSet<object>(),
    0,
  );
  assertWireSize(result, limits);
  return result;
}

function decodeValue(
  value: unknown,
  limits: TPortableResourceWireLimits,
  budget: TMutableBudget,
  depth: number,
): unknown {
  assertDepth(depth, limits);
  addNode(budget, limits);
  const record = plainDataRecord(value, 'Resource wire node');
  if (typeof record.type !== 'string') {
    return fail('MALFORMED_WIRE', 'Resource wire node type is missing.');
  }
  if (record.type === 'null') {
    exactKeys(record, ['type'], 'Resource null node');
    return null;
  }
  if (record.type === 'boolean') {
    exactKeys(record, ['type', 'value'], 'Resource boolean node');
    if (typeof record.value !== 'boolean') {
      return fail('MALFORMED_WIRE', 'Resource boolean node is malformed.');
    }
    return record.value;
  }
  if (record.type === 'number') {
    exactKeys(record, ['type', 'value'], 'Resource number node');
    if (typeof record.value !== 'number' || !Number.isFinite(record.value)) {
      return fail('MALFORMED_WIRE', 'Resource number node is malformed.');
    }
    if (Object.is(record.value, -0)) {
      return fail('NON_CANONICAL_WIRE', 'Resource number node contains negative zero.');
    }
    return record.value;
  }
  if (record.type === 'string') {
    exactKeys(record, ['type', 'value'], 'Resource string node');
    if (typeof record.value !== 'string') {
      return fail('MALFORMED_WIRE', 'Resource string node is malformed.');
    }
    assertStringBound(record.value, limits.maxStringBytes, 'Resource string');
    return record.value;
  }
  if (record.type === 'bigint') {
    exactKeys(record, ['type', 'value'], 'Resource bigint node');
    return parseCanonicalInteger(record.value);
  }
  if (record.type === 'bytes') {
    exactKeys(record, ['type', 'base64'], 'Resource bytes node');
    return base64Decode(record.base64, limits.maxByteArrayBytes);
  }
  if (record.type === 'array') {
    exactKeys(record, ['type', 'items'], 'Resource array node');
    const items = denseDataArray(record.items, 'Resource array node items', 'MALFORMED_WIRE');
    addItems(budget, limits, items.length);
    return Object.freeze(items.map((item) => decodeValue(
      item,
      limits,
      budget,
      depth + 1,
    )));
  }
  if (record.type === 'object') {
    exactKeys(record, ['type', 'entries'], 'Resource object node');
    const entries = denseDataArray(record.entries, 'Resource object entries', 'MALFORMED_WIRE');
    addItems(budget, limits, entries.length);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let previous: string | null = null;
    for (const entryValue of entries) {
      const entry = denseDataArray(entryValue, 'Resource object entry', 'MALFORMED_WIRE');
      if (entry.length !== 2 || typeof entry[0] !== 'string') {
        return fail('MALFORMED_WIRE', 'Resource object entry is malformed.');
      }
      const key = entry[0];
      if (key.normalize('NFC') !== key) {
        return fail('NON_CANONICAL_WIRE', 'Resource object key is not NFC-normalized.');
      }
      assertStringBound(key, limits.maxStringBytes, 'Resource object key');
      if (previous !== null && key <= previous) {
        return fail(
          'NON_CANONICAL_WIRE',
          'Resource object entries must be unique and canonically ordered.',
        );
      }
      previous = key;
      output[key] = decodeValue(entry[1], limits, budget, depth + 1);
    }
    return Object.freeze(output);
  }
  return fail('MALFORMED_WIRE', `Unknown resource wire node '${record.type}'.`);
}

export function fnDecodePortableResourceValue(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): unknown {
  const limits = exactLimits(overrides);
  assertWireSize(value, limits);
  return decodeValue(value, limits, { nodes: 0, collectionItems: 0 }, 0);
}

export function fnCanonicalizePortableResourceWireValue(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): string {
  const limits = exactLimits(overrides);
  const decoded = fnDecodePortableResourceValue(value, limits);
  const canonical = fnEncodePortableResourceValue(decoded, limits);
  const result = JSON.stringify(canonical);
  if (utf8Length(result) > limits.maxWireBytes) {
    return fail('LIMIT_EXCEEDED', 'Resource wire value exceeds its byte limit.');
  }
  return result;
}

function validCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_PATTERN.test(value);
}

function validSlot(value: unknown): value is string {
  return typeof value === 'string' && SLOT_PATTERN.test(value);
}

function validOperation(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_PATTERN.test(value);
}

export function fnEncodePortableResourceRequest(
  request: TPortableResourceRequest,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceRequestWire {
  if (!validCorrelationId(request.correlationId)) {
    return fail('INVALID_VALUE', 'Resource request correlation is invalid.');
  }
  if (!validSlot(request.slot)) {
    return fail('INVALID_VALUE', 'Resource request slot is invalid.');
  }
  if (!validOperation(request.operation)) {
    return fail('INVALID_VALUE', 'Resource request operation is invalid.');
  }
  if (request.effect !== 'read' && request.effect !== 'write') {
    return fail('INVALID_VALUE', 'Resource request effect is invalid.');
  }
  const result = Object.freeze({
    format: PORTABLE_RESOURCE_REQUEST_FORMAT,
    correlationId: request.correlationId,
    slot: request.slot,
    operation: request.operation,
    effect: request.effect,
    input: fnEncodePortableResourceValue(request.input, overrides),
  });
  assertWireSize(result, exactLimits(overrides));
  return result;
}

export function fnDecodePortableResourceRequest(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceRequest {
  const limits = exactLimits(overrides);
  assertWireSize(value, limits);
  const record = plainDataRecord(value, 'Resource request');
  exactKeys(
    record,
    ['format', 'correlationId', 'slot', 'operation', 'effect', 'input'],
    'Resource request',
  );
  if (record.format !== PORTABLE_RESOURCE_REQUEST_FORMAT) {
    return fail('MALFORMED_WIRE', 'Resource request format is unsupported.');
  }
  if (!validCorrelationId(record.correlationId)) {
    return fail('MALFORMED_WIRE', 'Resource request correlation is invalid.');
  }
  if (!validSlot(record.slot)) {
    return fail('MALFORMED_WIRE', 'Resource request slot is invalid.');
  }
  if (!validOperation(record.operation)) {
    return fail('MALFORMED_WIRE', 'Resource request operation is invalid.');
  }
  if (record.effect !== 'read' && record.effect !== 'write') {
    return fail('MALFORMED_WIRE', 'Resource request effect is invalid.');
  }
  return Object.freeze({
    correlationId: record.correlationId,
    slot: record.slot,
    operation: record.operation,
    effect: record.effect,
    input: fnDecodePortableResourceValue(record.input, limits),
  });
}

export function fnEncodePortableResourceResult(
  result: TPortableResourceResult,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceResultWire {
  if (!validCorrelationId(result.correlationId)) {
    return fail('INVALID_VALUE', 'Resource result correlation is invalid.');
  }
  const output = Object.freeze({
    format: PORTABLE_RESOURCE_RESULT_FORMAT,
    correlationId: result.correlationId,
    output: fnEncodePortableResourceValue(result.output, overrides),
  });
  assertWireSize(output, exactLimits(overrides));
  return output;
}

export function fnDecodePortableResourceResult(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceResult {
  const limits = exactLimits(overrides);
  assertWireSize(value, limits);
  const record = plainDataRecord(value, 'Resource result');
  exactKeys(record, ['format', 'correlationId', 'output'], 'Resource result');
  if (record.format !== PORTABLE_RESOURCE_RESULT_FORMAT) {
    return fail('MALFORMED_WIRE', 'Resource result format is unsupported.');
  }
  if (!validCorrelationId(record.correlationId)) {
    return fail('MALFORMED_WIRE', 'Resource result correlation is invalid.');
  }
  return Object.freeze({
    correlationId: record.correlationId,
    output: fnDecodePortableResourceValue(record.output, limits),
  });
}

export function fnEncodePortableResourceFailure(
  result: TPortableResourceFailure,
): TPortableResourceFailureWire {
  if (!validCorrelationId(result.correlationId)) {
    return fail('INVALID_VALUE', 'Resource failure correlation is invalid.');
  }
  if (!FAILURE_CODE_SET.has(result.failure.code)) {
    return fail('INVALID_VALUE', 'Resource failure code is invalid.');
  }
  if (
    typeof result.failure.message !== 'string'
    || result.failure.message.length < 1
    || utf8Length(result.failure.message) > 512
  ) {
    return fail('INVALID_VALUE', 'Resource failure message is invalid.');
  }
  return Object.freeze({
    format: PORTABLE_RESOURCE_FAILURE_FORMAT,
    correlationId: result.correlationId,
    failure: Object.freeze({ ...result.failure }),
  });
}

export function fnDecodePortableResourceFailure(
  value: unknown,
): TPortableResourceFailure {
  const record = plainDataRecord(value, 'Resource failure');
  exactKeys(record, ['format', 'correlationId', 'failure'], 'Resource failure');
  if (record.format !== PORTABLE_RESOURCE_FAILURE_FORMAT) {
    return fail('MALFORMED_WIRE', 'Resource failure format is unsupported.');
  }
  if (!validCorrelationId(record.correlationId)) {
    return fail('MALFORMED_WIRE', 'Resource failure correlation is invalid.');
  }
  const failure = plainDataRecord(record.failure, 'Resource failure payload');
  exactKeys(failure, ['code', 'message'], 'Resource failure payload');
  if (typeof failure.code !== 'string' || !FAILURE_CODE_SET.has(failure.code)) {
    return fail('MALFORMED_WIRE', 'Resource failure code is invalid.');
  }
  if (
    typeof failure.message !== 'string'
    || failure.message.length < 1
    || utf8Length(failure.message) > 512
  ) {
    return fail('MALFORMED_WIRE', 'Resource failure message is invalid.');
  }
  return Object.freeze({
    correlationId: record.correlationId,
    failure: Object.freeze({
      code: failure.code as TPortableResourceFailureCode,
      message: failure.message,
    }),
  });
}

export function fnDecodePortableResourceResponse(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceResult | TPortableResourceFailure {
  const record = plainDataRecord(value, 'Resource response');
  return record.format === PORTABLE_RESOURCE_RESULT_FORMAT
    ? fnDecodePortableResourceResult(value, overrides)
    : fnDecodePortableResourceFailure(value);
}

function encodeDbCell(
  value: unknown,
  limits: TPortableResourceWireLimits,
  forceJson = false,
): TPortableResourceDbCellWire {
  if (forceJson) {
    const encoded = fnEncodePortableResourceValue(value, limits);
    assertDbJsonWireValue(encoded, 'INVALID_VALUE');
    return Object.freeze({ type: 'json' as const, value: encoded });
  }
  if (value === null) return Object.freeze({ type: 'null' as const });
  if (typeof value === 'bigint') {
    return Object.freeze({ type: 'integer' as const, value: canonicalInteger(value) });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('INVALID_VALUE', 'Database float must be finite.');
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        return fail('INVALID_VALUE', 'Database integer number must be safe.');
      }
      return Object.freeze({
        type: 'integer' as const,
        value: canonicalInteger(BigInt(value)),
      });
    }
    return Object.freeze({ type: 'float' as const, value });
  }
  if (typeof value === 'string') {
    assertStringBound(value, limits.maxStringBytes, 'Database text');
    return Object.freeze({ type: 'text' as const, value });
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array
      ? new Uint8Array(value)
      : new Uint8Array(value.slice(0));
    if (bytes.byteLength > limits.maxByteArrayBytes) {
      return fail('LIMIT_EXCEEDED', 'Database blob exceeds its byte limit.');
    }
    return Object.freeze({ type: 'blob' as const, base64: base64Encode(bytes) });
  }
  return Object.freeze({
    type: 'json' as const,
    value: fnEncodePortableResourceValue(value, limits),
  });
}

function decodeDbCell(
  value: unknown,
  limits: TPortableResourceWireLimits,
): unknown {
  const record = plainDataRecord(value, 'Database cell');
  if (record.type === 'null') {
    exactKeys(record, ['type'], 'Database null cell');
    return null;
  }
  if (record.type === 'integer') {
    exactKeys(record, ['type', 'value'], 'Database integer cell');
    return parseCanonicalInteger(record.value);
  }
  if (record.type === 'float') {
    exactKeys(record, ['type', 'value'], 'Database float cell');
    if (typeof record.value !== 'number' || !Number.isFinite(record.value)) {
      return fail('MALFORMED_WIRE', 'Database float cell is malformed.');
    }
    return record.value;
  }
  if (record.type === 'text') {
    exactKeys(record, ['type', 'value'], 'Database text cell');
    if (typeof record.value !== 'string') {
      return fail('MALFORMED_WIRE', 'Database text cell is malformed.');
    }
    assertStringBound(record.value, limits.maxStringBytes, 'Database text');
    return record.value;
  }
  if (record.type === 'blob') {
    exactKeys(record, ['type', 'base64'], 'Database blob cell');
    return base64Decode(record.base64, limits.maxByteArrayBytes);
  }
  if (record.type === 'json') {
    exactKeys(record, ['type', 'value'], 'Database JSON cell');
    const decoded = fnDecodePortableResourceValue(record.value, limits);
    assertDbJsonWireValue(
      record.value as TPortableResourceWireValue,
      'MALFORMED_WIRE',
    );
    return decoded;
  }
  return fail('MALFORMED_WIRE', 'Database cell type is invalid.');
}

function assertDbJsonWireValue(
  value: TPortableResourceWireValue,
  code: 'INVALID_VALUE' | 'MALFORMED_WIRE',
): void {
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.type === 'bigint' || item.type === 'bytes') {
      return fail(
        code,
        'Database JSON cells must not contain bigint or bytes.',
      );
    }
    if (item.type === 'array') pending.push(...item.items);
    if (item.type === 'object') pending.push(...item.entries.map(([, nested]) => nested));
  }
}

export function fnEncodePortableResourceDbRows(
  value: Readonly<{
    columns: readonly string[];
    rows: readonly (readonly unknown[])[];
    /** Column names that must retain a JSON cell tag even for scalar or null values. */
    jsonColumns?: readonly string[];
  }>,
  overrides?: Partial<TPortableResourceWireLimits>,
): TPortableResourceDbRowsWire {
  const limits = exactLimits(overrides);
  const input = plainDataRecord(value, 'Database rows input');
  const hasJsonColumns = Object.prototype.hasOwnProperty.call(input, 'jsonColumns');
  exactKeys(
    input,
    hasJsonColumns ? ['columns', 'rows', 'jsonColumns'] : ['columns', 'rows'],
    'Database rows input',
  );
  const inputColumns = denseDataArray(input.columns, 'Database columns', 'INVALID_VALUE');
  const inputRows = denseDataArray(input.rows, 'Database rows', 'INVALID_VALUE');
  if (inputColumns.length > limits.maxDbColumns) {
    return fail('LIMIT_EXCEEDED', 'Database result has too many columns.');
  }
  if (inputRows.length > limits.maxDbRows) {
    return fail('LIMIT_EXCEEDED', 'Database result has too many rows.');
  }
  const columns = inputColumns.map((column) => {
    if (typeof column !== 'string' || column.normalize('NFC') !== column) {
      return fail('INVALID_VALUE', 'Database column name is invalid.');
    }
    assertStringBound(column, limits.maxDbColumnNameBytes, 'Database column name');
    return column;
  });
  const jsonColumns = new Set<string>();
  if (hasJsonColumns) {
    const declared = denseDataArray(
      input.jsonColumns,
      'Database JSON columns',
      'INVALID_VALUE',
    );
    if (declared.length > limits.maxDbColumns) {
      return fail('LIMIT_EXCEEDED', 'Database result has too many JSON columns.');
    }
    for (const column of declared) {
      if (
        typeof column !== 'string'
        || column.normalize('NFC') !== column
        || !columns.includes(column)
        || jsonColumns.has(column)
      ) {
        return fail('INVALID_VALUE', 'Database JSON column declaration is invalid.');
      }
      assertStringBound(column, limits.maxDbColumnNameBytes, 'Database JSON column name');
      jsonColumns.add(column);
    }
  }
  const rows = inputRows.map((rowValue) => {
    const row = denseDataArray(rowValue, 'Database input row', 'INVALID_VALUE');
    if (row.length !== columns.length) {
      return fail('INVALID_VALUE', 'Database row width differs from its columns.');
    }
    return Object.freeze({
      cells: Object.freeze(row.map((cell, index) => (
        encodeDbCell(cell, limits, jsonColumns.has(columns[index]!))
      ))),
    });
  });
  const result = Object.freeze({
    format: PORTABLE_RESOURCE_DB_ROWS_FORMAT,
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
  });
  assertWireSize(result, limits);
  return result;
}

export function fnDecodePortableResourceDbRows(
  value: unknown,
  overrides?: Partial<TPortableResourceWireLimits>,
): Readonly<{
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}> {
  const limits = exactLimits(overrides);
  assertWireSize(value, limits);
  const record = plainDataRecord(value, 'Database rows');
  exactKeys(record, ['format', 'columns', 'rows'], 'Database rows');
  if (record.format !== PORTABLE_RESOURCE_DB_ROWS_FORMAT) {
    return fail('MALFORMED_WIRE', 'Database rows format is unsupported.');
  }
  const wireColumns = denseDataArray(record.columns, 'Database wire columns', 'MALFORMED_WIRE');
  if (wireColumns.length > limits.maxDbColumns) {
    return fail('LIMIT_EXCEEDED', 'Database result has invalid columns.');
  }
  const columns = wireColumns.map((column) => {
    if (
      typeof column !== 'string'
      || column.normalize('NFC') !== column
    ) {
      return fail('NON_CANONICAL_WIRE', 'Database column name is invalid.');
    }
    assertStringBound(column, limits.maxDbColumnNameBytes, 'Database column name');
    return column;
  });
  const wireRows = denseDataArray(record.rows, 'Database wire rows', 'MALFORMED_WIRE');
  if (wireRows.length > limits.maxDbRows) {
    return fail('LIMIT_EXCEEDED', 'Database result has invalid rows.');
  }
  const rows = wireRows.map((rowValue) => {
    const row = plainDataRecord(rowValue, 'Database row');
    exactKeys(row, ['cells'], 'Database row');
    const cells = denseDataArray(row.cells, 'Database row cells', 'MALFORMED_WIRE');
    if (cells.length !== columns.length) {
      return fail('MALFORMED_WIRE', 'Database row width differs from its columns.');
    }
    return Object.freeze(cells.map((cell) => decodeDbCell(cell, limits)));
  });
  return Object.freeze({
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
  });
}

export function fnEncodePortableResourceDbExecute(
  value: Readonly<{ rowsAffected: number; lastInsertId: bigint | null }>,
): TPortableResourceDbExecuteWire {
  if (!Number.isSafeInteger(value.rowsAffected) || value.rowsAffected < 0) {
    return fail('INVALID_VALUE', 'Database affected-row count is invalid.');
  }
  return Object.freeze({
    format: PORTABLE_RESOURCE_DB_EXECUTE_FORMAT,
    rowsAffected: value.rowsAffected,
    lastInsertId: value.lastInsertId === null
      ? null
      : canonicalInteger(value.lastInsertId),
  });
}

export function fnDecodePortableResourceDbExecute(
  value: unknown,
): Readonly<{ rowsAffected: number; lastInsertId: bigint | null }> {
  const record = plainDataRecord(value, 'Database execute result');
  exactKeys(
    record,
    ['format', 'rowsAffected', 'lastInsertId'],
    'Database execute result',
  );
  if (record.format !== PORTABLE_RESOURCE_DB_EXECUTE_FORMAT) {
    return fail('MALFORMED_WIRE', 'Database execute result format is unsupported.');
  }
  if (!Number.isSafeInteger(record.rowsAffected) || (record.rowsAffected as number) < 0) {
    return fail('MALFORMED_WIRE', 'Database affected-row count is invalid.');
  }
  return Object.freeze({
    rowsAffected: record.rowsAffected as number,
    lastInsertId: record.lastInsertId === null
      ? null
      : parseCanonicalInteger(record.lastInsertId),
  });
}
