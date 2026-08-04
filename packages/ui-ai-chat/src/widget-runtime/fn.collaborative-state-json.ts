import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateIdentity,
  TWidgetCollaborativeStateTransportSnapshot,
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
  return left.canvasId === right.canvasId
    && left.elementId === right.elementId
    && left.widgetInstanceId === right.widgetInstanceId;
}

export function fnNormalizeWidgetCollaborativeStateTransportSnapshot(
  value: TWidgetCollaborativeStateTransportSnapshot,
  expectedIdentity: TWidgetCollaborativeStateIdentity,
): TWidgetCollaborativeStateTransportSnapshot {
  if (
    !Number.isSafeInteger(value.version)
    || value.version < 1
    || !fnWidgetCollaborativeStateIdentitiesMatch(value.identity, expectedIdentity)
  ) {
    throw new Error('Widget collaborative state identity mismatch.');
  }
  return Object.freeze({
    identity: Object.freeze({ ...expectedIdentity }),
    version: value.version,
    state: fnNormalizeWidgetCollaborativeJson(value.state),
  });
}
