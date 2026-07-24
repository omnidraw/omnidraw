import type { TCanvasJsonValue } from "../typed";

type TArgsJson = {
  value: unknown;
};

function isPlainRecord(value: object): value is Record<string, unknown> {
  if (Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, ancestors: Set<object>): value is TCanvasJsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function cloneJsonValue(value: TCanvasJsonValue): TCanvasJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Projection data contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Projection data contains unsupported '${typeof value}' data.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("Projection data contains a cycle.");
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TypeError("Projection data contains a non-plain object.");
  }

  ancestors.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
  } else {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], ancestors)}`);
    result = `{${entries.join(",")}}`;
  }
  ancestors.delete(value);
  return result;
}

export function fnIsCanvasJsonValue(args: TArgsJson): args is { value: TCanvasJsonValue } {
  return isJsonValue(args.value, new Set());
}

export function fnCloneCanvasJsonValue(args: TArgsJson): TCanvasJsonValue {
  if (!fnIsCanvasJsonValue(args)) {
    throw new TypeError("Expected JSON-serializable canvas data.");
  }
  return cloneJsonValue(args.value);
}

export function fnCanonicalCanvasJson(args: TArgsJson): string {
  return canonicalJson(args.value, new Set());
}
