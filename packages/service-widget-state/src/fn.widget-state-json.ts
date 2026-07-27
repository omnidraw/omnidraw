import {
  MAX_WIDGET_STATE_BYTES,
  MAX_WIDGET_STATE_DEPTH,
  MAX_WIDGET_STATE_NODES,
} from './CONSTANTS';
import type { TWidgetStateJson } from './types';

type TTraversalCounter = {
  nodes: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function assertJsonValue(
  value: unknown,
  depth: number,
  counter: TTraversalCounter,
): void {
  counter.nodes += 1;
  if (counter.nodes > MAX_WIDGET_STATE_NODES || depth > MAX_WIDGET_STATE_DEPTH) {
    throw new TypeError('Widget state exceeds its structural limit.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Widget state must use finite numbers.');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonValue(entry, depth + 1, counter);
    return;
  }
  if (!isPlainObject(value)) {
    throw new TypeError('Widget state must be JSON data in plain objects.');
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError('Widget state contains a reserved key.');
    }
    assertJsonValue(value[key], depth + 1, counter);
  }
}

function freezeJsonValue(value: TWidgetStateJson): TWidgetStateJson {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const entry of value) freezeJsonValue(entry);
    return Object.freeze(value);
  }
  for (const entry of Object.values(value)) freezeJsonValue(entry);
  return Object.freeze(value);
}

export function fnAssertWidgetStateJson(
  value: unknown,
): asserts value is TWidgetStateJson {
  assertJsonValue(value, 0, { nodes: 0 });
  const serialized = JSON.stringify(value);
  if (
    serialized === undefined
    || utf8ByteLength(serialized) > MAX_WIDGET_STATE_BYTES
  ) {
    throw new TypeError('Widget state exceeds its byte limit.');
  }
}

export function fnNormalizeWidgetStateJson(value: unknown): TWidgetStateJson {
  fnAssertWidgetStateJson(value);
  const serialized = JSON.stringify(value);
  const clone = JSON.parse(serialized) as TWidgetStateJson;
  return freezeJsonValue(clone);
}
