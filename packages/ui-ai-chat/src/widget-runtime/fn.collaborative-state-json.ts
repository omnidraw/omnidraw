import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateDocument,
  TWidgetCollaborativeStateIdentity,
} from './interface';

const MAX_COLLABORATIVE_STATE_BYTES = 64 * 1_024;
const MAX_COLLABORATIVE_STATE_DEPTH = 32;
const MAX_COLLABORATIVE_STATE_NODES = 10_000;

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

function normalize(
  value: unknown,
  depth: number,
  counter: { nodes: number },
): TWidgetCollaborativeJsonValue {
  counter.nodes += 1;
  if (counter.nodes > MAX_COLLABORATIVE_STATE_NODES || depth > MAX_COLLABORATIVE_STATE_DEPTH) {
    throw new TypeError('Widget collaborative state exceeds its structural limit.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Widget collaborative state must use finite numbers.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry, depth + 1, counter));
  }
  if (typeof value !== 'object') {
    throw new TypeError('Widget collaborative state must be JSON data.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Widget collaborative state must use plain objects.');
  }
  const output: Record<string, TWidgetCollaborativeJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError('Widget collaborative state contains a reserved key.');
    }
    output[key] = normalize((value as Record<string, unknown>)[key], depth + 1, counter);
  }
  return output;
}

export function fnNormalizeWidgetCollaborativeJson(
  value: unknown,
): TWidgetCollaborativeJsonValue {
  const normalized = normalize(value, 0, { nodes: 0 });
  if (utf8ByteLength(JSON.stringify(normalized)) > MAX_COLLABORATIVE_STATE_BYTES) {
    throw new TypeError('Widget collaborative state exceeds its byte limit.');
  }
  return normalized;
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

export function fnReadWidgetCollaborativeStateDocument(
  value: unknown,
  expectedIdentity: TWidgetCollaborativeStateIdentity,
): TWidgetCollaborativeJsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Widget collaborative state document is invalid.');
  }
  const record = value as Partial<TWidgetCollaborativeStateDocument>;
  const identity = record.identity;
  if (
    record.schemaVersion !== 1
    || identity === null
    || typeof identity !== 'object'
    || Array.isArray(identity)
    || !fnWidgetCollaborativeStateIdentitiesMatch(identity, expectedIdentity)
    || !Object.prototype.hasOwnProperty.call(record, 'state')
  ) {
    throw new Error('Widget collaborative state identity mismatch.');
  }
  return fnNormalizeWidgetCollaborativeJson(record.state);
}
