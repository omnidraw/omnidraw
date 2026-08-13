/**
 * @file Pure canonical JSON encoding for hashes and idempotency fingerprints.
 */

export type TCanonicalJsonLimits = Readonly<{
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
}>;

type TState = {
  readonly active: Set<object>;
  nodes: number;
};

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
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

function encode(
  value: unknown,
  limits: Required<TCanonicalJsonLimits>,
  state: TState,
  depth: number,
): string {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) throw new TypeError('JSON value exceeds its node limit.');
  if (depth > limits.maxDepth) throw new TypeError('JSON value exceeds its depth limit.');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') throw new TypeError('Value is not JSON serializable.');
  if (state.active.has(value)) throw new TypeError('JSON value contains a cycle.');
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined) throw new TypeError('JSON arrays cannot be sparse.');
        if (descriptor.get || descriptor.set) {
          throw new TypeError('JSON arrays cannot contain accessors.');
        }
        entries.push(encode(descriptor.value, limits, state, depth + 1));
      }
      return `[${entries.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('JSON objects must be plain records.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('JSON objects cannot contain symbol keys.');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const members = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new TypeError('JSON objects cannot contain accessors.');
      }
      return `${JSON.stringify(key)}:${encode(descriptor.value, limits, state, depth + 1)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    state.active.delete(value);
  }
}

export function fnCanonicalJson(
  value: unknown,
  limits: TCanonicalJsonLimits = {},
): string {
  const resolved = {
    maxBytes: limits.maxBytes ?? 1_048_576,
    maxDepth: limits.maxDepth ?? 64,
    maxNodes: limits.maxNodes ?? 10_000,
  };
  const encoded = encode(value, resolved, { active: new Set(), nodes: 0 }, 0);
  if (utf8ByteLength(encoded) > resolved.maxBytes) {
    throw new TypeError('JSON value exceeds its byte limit.');
  }
  return encoded;
}
