export type TJsonValue = null | boolean | number | string | readonly TJsonValue[] | {
  readonly [key: string]: TJsonValue;
};

/** Converts an application DTO to canonical JSON and omits absent object fields. */
export function fnJsonSafe(value: unknown, seen = new Set<object>()): TJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RPC payload numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("RPC payloads cannot contain cycles.");
    seen.add(value);
    const result = value.map((item) => {
      if (item === undefined) throw new TypeError("RPC payload arrays cannot contain undefined.");
      return fnJsonSafe(item, seen);
    });
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("RPC payloads cannot contain cycles.");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("RPC payloads must contain plain JSON objects.");
    }
    seen.add(value);
    const result: Record<string, TJsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) result[key] = fnJsonSafe(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`RPC payload contains unsupported ${typeof value}.`);
}
