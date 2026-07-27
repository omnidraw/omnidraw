import {
  MAX_WIDGET_COLLABORATIVE_STATE_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_DEPTH,
  MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES,
  MAX_WIDGET_COLLABORATIVE_STATE_NODES,
} from '../CONSTANTS';
import type {
  TWidgetCollaborativeStateDocument,
  TWidgetCollaborativeStateIdentity,
} from '../types/widget-state.types';

const DOCUMENT_KEYS = ['identity', 'schemaVersion', 'state'] as const;
const IDENTITY_KEYS = [
  'canvasId',
  'definitionId',
  'elementId',
  'orgId',
  'revisionId',
  'stateDocumentId',
  'widgetInstanceId',
] as const;

type TTraversalCounter = { nodes: number };

export type TWidgetCollaborativeStateChunkByteLength = Readonly<{
  byteLength: number;
  contentKind: 'incremental' | 'snapshot' | null;
}>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function assertJsonValue(value: unknown, depth: number, counter: TTraversalCounter): void {
  counter.nodes += 1;
  if (
    counter.nodes > MAX_WIDGET_COLLABORATIVE_STATE_NODES
    || depth > MAX_WIDGET_COLLABORATIVE_STATE_DEPTH
  ) {
    throw new TypeError('Widget collaborative state exceeds its structural limit.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Widget collaborative state must use finite numbers.');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonValue(entry, depth + 1, counter);
    return;
  }
  if (!isPlainObject(value)) {
    throw new TypeError('Widget collaborative state must be JSON data in plain objects.');
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError('Widget collaborative state contains a reserved key.');
    }
    assertJsonValue(value[key], depth + 1, counter);
  }
}

function assertEncodedByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new TypeError('Widget collaborative state encoded byte length is invalid.');
  }
}

function sumEncodedByteLengths(byteLengths: readonly number[]): number {
  let total = 0;
  for (const byteLength of byteLengths) {
    assertEncodedByteLength(byteLength);
    total += byteLength;
    if (
      !Number.isSafeInteger(total)
      || total > MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES
    ) {
      throw new TypeError('Widget collaborative state exceeds its durable byte quota.');
    }
  }
  return total;
}

export function fnAssertWidgetCollaborativeStateEncodedQuota(
  chunks: readonly TWidgetCollaborativeStateChunkByteLength[],
  encodedChangeByteLengths: readonly number[],
): void {
  for (const chunk of chunks) {
    assertEncodedByteLength(chunk.byteLength);
    if (
      chunk.contentKind === 'incremental'
      && chunk.byteLength > MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES
    ) {
      throw new TypeError('Widget collaborative state incremental chunk exceeds its byte limit.');
    }
  }
  sumEncodedByteLengths(chunks.map((chunk) => chunk.byteLength));
  for (const byteLength of encodedChangeByteLengths) {
    assertEncodedByteLength(byteLength);
    if (byteLength > MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES) {
      throw new TypeError('Widget collaborative state change exceeds its encoded byte limit.');
    }
  }
  sumEncodedByteLengths(encodedChangeByteLengths);
}

export function fnWidgetCollaborativeStateIdentitiesMatch(
  left: TWidgetCollaborativeStateIdentity,
  right: TWidgetCollaborativeStateIdentity,
): boolean {
  return left.orgId === right.orgId
    && left.canvasId === right.canvasId
    && left.elementId === right.elementId
    && left.widgetInstanceId === right.widgetInstanceId
    && left.definitionId === right.definitionId
    && left.revisionId === right.revisionId
    && left.stateDocumentId === right.stateDocumentId;
}

export function fnAssertWidgetCollaborativeStateDocument(
  value: unknown,
  expectedIdentity: TWidgetCollaborativeStateIdentity,
): asserts value is TWidgetCollaborativeStateDocument {
  if (!isPlainObject(value) || !hasExactKeys(value, DOCUMENT_KEYS)) {
    throw new TypeError('Widget collaborative state document has an invalid schema.');
  }
  const identity = value.identity;
  if (
    value.schemaVersion !== 1
    || !isPlainObject(identity)
    || !hasExactKeys(identity, IDENTITY_KEYS)
    || IDENTITY_KEYS.some((key) => typeof identity[key] !== 'string')
    || !fnWidgetCollaborativeStateIdentitiesMatch(
      identity as TWidgetCollaborativeStateIdentity,
      expectedIdentity,
    )
    || !Object.prototype.hasOwnProperty.call(value, 'state')
  ) {
    throw new TypeError('Widget collaborative state identity does not match its durable owner.');
  }
  assertJsonValue(value.state, 0, { nodes: 0 });
  const serialized = JSON.stringify(value.state);
  if (
    serialized === undefined
    || utf8ByteLength(serialized) > MAX_WIDGET_COLLABORATIVE_STATE_BYTES
  ) {
    throw new TypeError('Widget collaborative state exceeds its byte limit.');
  }
}
