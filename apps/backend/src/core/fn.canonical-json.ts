export type TCanonicalJson = null | boolean | number | string | readonly TCanonicalJson[] | Readonly<{
  [key: string]: TCanonicalJson;
}>;

/**
 * Projects a world value onto the private JSON boundary. Optional object
 * fields are omitted exactly as JSON encoding omits them; unsupported values
 * remain errors instead of being stringified or silently coerced.
 */
export function fnNormalizeCanonicalJson(value: unknown): TCanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => (
      entry === undefined ? null : fnNormalizeCanonicalJson(entry)
    )));
  }
  if (typeof value === 'object') {
    const source = value as Readonly<Record<string, unknown>>;
    const result: Record<string, TCanonicalJson> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) result[key] = fnNormalizeCanonicalJson(entry);
    }
    return Object.freeze(result);
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
}

export function fnCanonicalJson(value: unknown): string {
  return JSON.stringify(fnNormalizeCanonicalJson(value));
}

/** Stable non-cryptographic state digest for deterministic replay evidence. */
export function fnCanonicalStateDigest(value: unknown): string {
  const bytes = new TextEncoder().encode(fnCanonicalJson(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
