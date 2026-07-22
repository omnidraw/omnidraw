import type { TJson } from '../model';

function fnIsPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fnAssertJsonValue(value: unknown, ancestors: Set<object>): asserts value is TJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON-compatible');
  if (ancestors.has(value)) throw new TypeError('Cyclic values are not JSON-compatible');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) fnAssertJsonValue(item, ancestors);
    } else {
      if (!fnIsPlainRecord(value)) throw new TypeError('Class instances are not JSON-compatible');
      for (const item of Object.values(value)) fnAssertJsonValue(item, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function fnParseJsonValue(value: unknown): TJson {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  fnAssertJsonValue(parsed, new Set());
  return parsed;
}

export function fnSerializeJsonValue(value: unknown): string {
  fnAssertJsonValue(value, new Set());
  return JSON.stringify(value);
}
