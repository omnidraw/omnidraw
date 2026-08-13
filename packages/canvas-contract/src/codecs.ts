import type {
  TCanvasCommand,
  TCanvasContractCodec,
  TCanvasContractIssue,
  TCanvasContractSchema,
  TCanvasContractValidation,
  TCanvasDocument,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasSceneNode,
  TJsonValue,
} from "./types.js";
import {
  fnValidateCanvasCommand,
  fnValidateCanvasDocument,
  fnValidateCanvasEvent,
  fnValidateCanvasItemPage,
  fnValidateCanvasQuery,
  fnValidateCanvasSceneNode,
} from "./validation.js";

export class CanvasContractDecodeError extends TypeError {
  readonly issues: readonly TCanvasContractIssue[];

  constructor(label: string, issues: readonly TCanvasContractIssue[]) {
    const details = issues
      .map((issue) => `${issue.code} at ${issue.path || "/"}: ${issue.message}`)
      .join("\n");
    super(`Invalid ${label}${details.length === 0 ? "." : `:\n${details}`}`);
    this.name = "CanvasContractDecodeError";
    this.issues = issues;
  }
}

function canonicalJson(value: unknown, path: string, ancestors: Set<object>): TJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path || "/"}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`Non-JSON value at ${path || "/"}.`);
  if (ancestors.has(value)) throw new TypeError(`Cyclic value at ${path || "/"}.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value);
      for (const name of ownNames) {
        if (name === "length") continue;
        const index = Number(name);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== name) {
          throw new TypeError(`Non-index array property at ${path || "/"}.`);
        }
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`Symbol array property at ${path || "/"}.`);
      }
      const result: TJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError(`Sparse array at ${path}/${index}.`);
        result.push(canonicalJson(value[index], `${path}/${index}`, ancestors));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path || "/"}.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`Symbol object property at ${path || "/"}.`);
    }
    const result: { [key: string]: TJsonValue } = {};
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`Non-data JSON property at ${path || "/"}/${key}.`);
      }
      result[key] = canonicalJson(descriptor.value, `${path}/${key}`, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Returns a detached JSON value with recursively lexicographically sorted keys. */
export function fnCanonicalCanvasJson(value: unknown): TJsonValue {
  return canonicalJson(value, "", new Set());
}

/** Stable serialization used by hashes, fixtures, replay, and protocol tests. */
export function fnStringifyCanonicalCanvasJson(value: unknown): string {
  return JSON.stringify(fnCanonicalCanvasJson(value));
}

/** Parses JSON and returns its canonical detached representation. */
export function fnParseCanonicalCanvasJson(text: string): TJsonValue {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new CanvasContractDecodeError("JSON", [{
      code: "INVALID_JSON_TEXT",
      path: "",
      message: error instanceof Error ? error.message : "JSON parsing failed.",
    }]);
  }
  return fnCanonicalCanvasJson(value);
}

function makeSchema<A>(
  label: string,
  validate: (value: unknown) => TCanvasContractValidation,
): TCanvasContractSchema<A> {
  return Object.freeze({
    is(value: unknown): value is A {
      return validate(value).valid;
    },
    validate,
    parse(value: unknown): A {
      const result = validate(value);
      if (!result.valid) throw new CanvasContractDecodeError(label, result.issues);
      return fnCanonicalCanvasJson(value) as unknown as A;
    },
  });
}

function makeCodec<A>(
  label: string,
  schema: TCanvasContractSchema<A>,
): TCanvasContractCodec<A> {
  return Object.freeze({
    decode(value: unknown): A {
      return schema.parse(value);
    },
    parse(text: string): A {
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch (error) {
        throw new CanvasContractDecodeError(label, [{
          code: "INVALID_JSON_TEXT",
          path: "",
          message: error instanceof Error ? error.message : "JSON parsing failed.",
        }]);
      }
      return schema.parse(value);
    },
    encode(value: A): TJsonValue {
      return schema.parse(value) as unknown as TJsonValue;
    },
    stringify(value: A): string {
      return JSON.stringify(schema.parse(value));
    },
  });
}

export const CanvasSceneNodeSchema = makeSchema<TCanvasSceneNode>(
  "Canvas scene node",
  fnValidateCanvasSceneNode,
);
export const CanvasDocumentSchema = makeSchema<TCanvasDocument>(
  "Canvas document",
  fnValidateCanvasDocument,
);
export const CanvasCommandSchema = makeSchema<TCanvasCommand>(
  "Canvas command",
  fnValidateCanvasCommand,
);
export const CanvasQuerySchema = makeSchema<TCanvasItemQuery>(
  "Canvas query",
  fnValidateCanvasQuery,
);
export const CanvasItemPageSchema = makeSchema<TCanvasItemPage>(
  "Canvas item page",
  fnValidateCanvasItemPage,
);
export const CanvasEventSchema = makeSchema<TCanvasEvent>(
  "Canvas event",
  fnValidateCanvasEvent,
);

export const CanvasSceneNodeCodec = makeCodec("Canvas scene node", CanvasSceneNodeSchema);
export const CanvasDocumentCodec = makeCodec("Canvas document", CanvasDocumentSchema);
export const CanvasCommandCodec = makeCodec("Canvas command", CanvasCommandSchema);
export const CanvasQueryCodec = makeCodec("Canvas query", CanvasQuerySchema);
export const CanvasItemPageCodec = makeCodec("Canvas item page", CanvasItemPageSchema);
export const CanvasEventCodec = makeCodec("Canvas event", CanvasEventSchema);
