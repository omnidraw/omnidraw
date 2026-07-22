/** @file Bounded trusted host-side JSON Schema validator. */

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { fnCanonicalJson } from './fn.canonical-json';

export type TFunctionSchemaValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; message: string }>;

export interface IFunctionSchemaValidator {
  validate(schema: unknown, value: unknown): TFunctionSchemaValidation;
}

export type TJsonSchemaFunctionValidatorConfig = Readonly<{
  maxCachedSchemas?: number;
  maxSchemaBytes?: number;
  maxSchemaDepth?: number;
  maxSchemaNodes?: number;
}>;

export class JsonSchemaFunctionValidator implements IFunctionSchemaValidator {
  readonly #ajv = new Ajv2020({
    allErrors: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    strict: true,
    validateSchema: true,
    ownProperties: true,
  });
  readonly #cache = new Map<string, ValidateFunction>();
  readonly #maxCachedSchemas: number;
  readonly #maxSchemaBytes: number;
  readonly #maxSchemaDepth: number;
  readonly #maxSchemaNodes: number;

  constructor(config: TJsonSchemaFunctionValidatorConfig = {}) {
    this.#maxCachedSchemas = config.maxCachedSchemas ?? 128;
    this.#maxSchemaBytes = config.maxSchemaBytes ?? 262_144;
    this.#maxSchemaDepth = config.maxSchemaDepth ?? 64;
    this.#maxSchemaNodes = config.maxSchemaNodes ?? 10_000;
  }

  validate(schema: unknown, value: unknown): TFunctionSchemaValidation {
    let key: string;
    try {
      key = fnCanonicalJson(schema, {
        maxBytes: this.#maxSchemaBytes,
        maxDepth: this.#maxSchemaDepth,
        maxNodes: this.#maxSchemaNodes,
      });
    } catch {
      return { valid: false, message: 'Function schema exceeds trusted validation limits.' };
    }
    let validate = this.#cache.get(key);
    if (!validate) {
      try {
        validate = this.#ajv.compile(JSON.parse(key));
      } catch {
        return { valid: false, message: 'Function schema is invalid.' };
      }
      this.#cache.set(key, validate);
      while (this.#cache.size > this.#maxCachedSchemas) {
        const oldest = this.#cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
    } else {
      this.#cache.delete(key);
      this.#cache.set(key, validate);
    }
    return validate(value)
      ? { valid: true }
      : { valid: false, message: 'Function value does not match its canonical JSON schema.' };
  }
}
