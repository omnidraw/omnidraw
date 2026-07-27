/**
 * @file Deterministic JSON encoding for invocation bodies, permit receipts, and digests.
 */

type TJson = null | boolean | number | string | readonly TJson[] | { readonly [key: string]: TJson };

function normalize(value: unknown, ancestors: Set<object>): TJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON serializable.');
  if (ancestors.has(value)) throw new TypeError('JSON values cannot contain cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('JSON objects must be plain objects.');
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, normalize(entry, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function fnFunctionCanonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>()));
}
