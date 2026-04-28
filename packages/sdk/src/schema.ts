/** JSON Schema primitive type names supported by Vibecanvas actor ports. */
type TJsonSchemaPrimitiveType = "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";

/**
 * JSON Schema used for widget actor input/output payloads.
 *
 * Vibecanvas validates messages in the host before delivery. Guest widgets only
 * declare schemas; they do not need to bundle a validator.
 */
type TJsonSchema = boolean | {
  $id?: string;
  $schema?: string;
  $ref?: string;
  /** Prefer `definitions` for draft-07 compatibility; `$defs` is allowed for newer drafts. */
  $defs?: Record<string, TJsonSchema>;
  /** Draft-07 reusable schema definitions. */
  definitions?: Record<string, TJsonSchema>;
  title?: string;
  description?: string;
  type?: TJsonSchemaPrimitiveType | TJsonSchemaPrimitiveType[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, TJsonSchema>;
  required?: string[];
  additionalProperties?: boolean | TJsonSchema;
  items?: TJsonSchema | TJsonSchema[];
  additionalItems?: boolean | TJsonSchema;
  prefixItems?: TJsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  anyOf?: TJsonSchema[];
  oneOf?: TJsonSchema[];
  allOf?: TJsonSchema[];
  not?: TJsonSchema;
};

export type { TJsonSchema };
