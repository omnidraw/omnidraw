import type {
  CapsuleLiteralSchema,
  CapsuleSchemaDocument,
  CapsuleSchemaNode,
} from '@omnidraw/capsule/schema';
import { fnVibecanvasBoundedJsonValueSchema } from './fn.bounded-json-schema';

type TJsonRecord = Readonly<Record<string, unknown>>;
type TSchemaState = { nodes: number };

const MAX_SCHEMA_DEPTH = 24;
const MAX_SCHEMA_NODES = 4_096;
const MAX_SCHEMA_PROPERTIES = 256;
const MAX_UNION_VARIANTS = 32;
const ANNOTATION_KEYS = Object.freeze([
  '$comment',
  '$schema',
  'default',
  'description',
  'examples',
  'title',
]);

function record(value: unknown, label: string): TJsonRecord {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some((key) => typeof key !== 'string')
  ) {
    throw new TypeError(`${label} must be a plain JSON object.`);
  }
  return value as TJsonRecord;
}

function hasOwn(value: TJsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertOnlyKeys(
  value: TJsonRecord,
  assertionKeys: readonly string[],
): void {
  const allowed = new Set([...ANNOTATION_KEYS, ...assertionKeys]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) {
    throw new TypeError(
      `Function JSON Schema keyword "${unsupported}" is not supported by Capsule.`,
    );
  }
}

function safeBound(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Function JSON Schema ${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function finiteBound(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Function JSON Schema ${label} must be finite.`);
  }
  return value;
}

function assertOrderedBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  label: string,
): void {
  if (
    minimum !== undefined
    && maximum !== undefined
    && minimum > maximum
  ) {
    throw new TypeError(`Function JSON Schema ${label} bounds are inverted.`);
  }
}

function literal(value: unknown): CapsuleLiteralSchema {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { type: 'literal', value };
  }
  throw new TypeError('Function JSON Schema literals must be finite structured primitives.');
}

function literalMatchesType(
  value: CapsuleLiteralSchema['value'],
  type: unknown,
): boolean {
  if (type === undefined) return true;
  if (typeof type !== 'string') return false;
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number';
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'string') return typeof value === 'string';
  return false;
}

function literalNode(schema: TJsonRecord): CapsuleSchemaNode {
  assertOnlyKeys(schema, ['const', 'type']);
  const node = literal(schema.const);
  if (!literalMatchesType(node.value, schema.type)) {
    throw new TypeError('Function JSON Schema const does not match its declared type.');
  }
  return node;
}

function enumNode(schema: TJsonRecord): CapsuleSchemaNode {
  assertOnlyKeys(schema, ['enum', 'type']);
  if (
    !Array.isArray(schema.enum)
    || schema.enum.length < 1
    || schema.enum.length > MAX_UNION_VARIANTS
  ) {
    throw new TypeError('Function JSON Schema enum has an invalid variant count.');
  }
  const variants = schema.enum.map((value) => {
    const node = literal(value);
    if (!literalMatchesType(node.value, schema.type)) {
      throw new TypeError('Function JSON Schema enum does not match its declared type.');
    }
    return node;
  });
  const identities = new Set(variants.map(({ value }) => JSON.stringify(value)));
  if (identities.size !== variants.length) {
    throw new TypeError('Function JSON Schema enum contains duplicate values.');
  }
  return variants.length === 1
    ? variants[0]!
    : { type: 'union', variants };
}

function unionNode(
  schema: TJsonRecord,
  state: TSchemaState,
  depth: number,
): CapsuleSchemaNode {
  assertOnlyKeys(schema, ['anyOf']);
  if (
    !Array.isArray(schema.anyOf)
    || schema.anyOf.length < 1
    || schema.anyOf.length > MAX_UNION_VARIANTS
  ) {
    throw new TypeError('Function JSON Schema anyOf has an invalid variant count.');
  }
  const variants = schema.anyOf.map((variant) => schemaNode(variant, state, depth + 1));
  return variants.length === 1
    ? variants[0]!
    : { type: 'union', variants };
}

function objectNode(
  schema: TJsonRecord,
  state: TSchemaState,
  depth: number,
): CapsuleSchemaNode {
  assertOnlyKeys(schema, [
    'additionalProperties',
    'maxProperties',
    'minProperties',
    'properties',
    'required',
    'type',
  ]);
  const sourceProperties = schema.properties === undefined
    ? {}
    : record(schema.properties, 'Function JSON Schema properties');
  const propertyNames = Object.keys(sourceProperties).sort();
  if (propertyNames.length > MAX_SCHEMA_PROPERTIES) {
    throw new TypeError('Function JSON Schema has too many object properties.');
  }
  const properties: Record<string, CapsuleSchemaNode> = {};
  for (const key of propertyNames) {
    properties[key] = schemaNode(sourceProperties[key], state, depth + 1);
  }

  let required: readonly string[] | undefined;
  if (schema.required !== undefined) {
    if (
      !Array.isArray(schema.required)
      || schema.required.some((key) => typeof key !== 'string')
    ) {
      throw new TypeError('Function JSON Schema required must be a string array.');
    }
    const requiredNames = schema.required as string[];
    if (
      new Set(requiredNames).size !== requiredNames.length
      || requiredNames.some((key) => !hasOwn(sourceProperties, key))
    ) {
      throw new TypeError(
        'Function JSON Schema required names must be unique declared properties.',
      );
    }
    required = Object.freeze([...requiredNames].sort());
  }

  const minProperties = safeBound(schema.minProperties, 'minProperties');
  const maxProperties = safeBound(schema.maxProperties, 'maxProperties');
  assertOrderedBounds(minProperties, maxProperties, 'object property');

  let additionalProperties: boolean | CapsuleSchemaNode;
  if (schema.additionalProperties === undefined || schema.additionalProperties === true) {
    additionalProperties = true;
  } else if (schema.additionalProperties === false) {
    additionalProperties = false;
  } else {
    additionalProperties = schemaNode(
      schema.additionalProperties,
      state,
      depth + 1,
    );
  }

  return {
    type: 'object',
    properties,
    ...(required === undefined ? {} : { required }),
    additionalProperties,
    ...(minProperties === undefined ? {} : { minProperties }),
    ...(maxProperties === undefined ? {} : { maxProperties }),
  };
}

function arrayNode(
  schema: TJsonRecord,
  state: TSchemaState,
  depth: number,
): CapsuleSchemaNode {
  assertOnlyKeys(schema, ['items', 'maxItems', 'minItems', 'type']);
  const minItems = safeBound(schema.minItems, 'minItems');
  const maxItems = safeBound(schema.maxItems, 'maxItems');
  assertOrderedBounds(minItems, maxItems, 'array item');
  if (schema.items === false) {
    throw new TypeError('Function JSON Schema false item schemas are not supported by Capsule.');
  }
  return {
    type: 'array',
    items: schema.items === undefined || schema.items === true
      ? { type: 'any' }
      : schemaNode(schema.items, state, depth + 1),
    ...(minItems === undefined ? {} : { minItems }),
    ...(maxItems === undefined ? {} : { maxItems }),
  };
}

function numberNode(
  schema: TJsonRecord,
  integer: boolean,
): CapsuleSchemaNode {
  assertOnlyKeys(schema, ['maximum', 'minimum', 'type']);
  const minimum = finiteBound(schema.minimum, 'minimum');
  const maximum = finiteBound(schema.maximum, 'maximum');
  assertOrderedBounds(minimum, maximum, 'number');
  return {
    type: 'number',
    ...(integer ? { integer: true } : {}),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function schemaNode(
  value: unknown,
  state: TSchemaState,
  depth: number,
): CapsuleSchemaNode {
  if (value === true) return { type: 'any' };
  if (value === false) {
    throw new TypeError('Function JSON Schema false schemas are not supported by Capsule.');
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new TypeError('Function JSON Schema exceeds the Capsule depth limit.');
  }
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_NODES) {
    throw new TypeError('Function JSON Schema exceeds the Capsule node limit.');
  }

  const schema = record(value, 'Function JSON Schema');
  if (hasOwn(schema, 'const')) return literalNode(schema);
  if (hasOwn(schema, 'enum')) return enumNode(schema);
  if (hasOwn(schema, 'anyOf')) return unionNode(schema, state, depth);

  if (schema.type === undefined) {
    assertOnlyKeys(schema, []);
    return { type: 'any' };
  }
  if (typeof schema.type !== 'string') {
    throw new TypeError('Function JSON Schema type must be one supported primitive name.');
  }

  switch (schema.type) {
    case 'null':
      assertOnlyKeys(schema, ['type']);
      return { type: 'null' };
    case 'boolean':
      assertOnlyKeys(schema, ['type']);
      return { type: 'boolean' };
    case 'number':
      return numberNode(schema, false);
    case 'integer':
      return numberNode(schema, true);
    case 'string':
      assertOnlyKeys(schema, ['type']);
      return { type: 'string' };
    case 'array':
      return arrayNode(schema, state, depth);
    case 'object':
      return objectNode(schema, state, depth);
    default:
      throw new TypeError(
        `Function JSON Schema type "${schema.type}" is not supported by Capsule.`,
      );
  }
}

/**
 * Converts only the JSON-Schema subset with semantics exactly representable by
 * Capsule. Unsupported assertions fail the trusted build instead of silently
 * widening or narrowing a server-function contract.
 */
export function fnJsonSchemaToCapsuleSchemaDocument(value: unknown): CapsuleSchemaDocument {
  return {
    format: 'capsule-schema-v1',
    root: schemaNode(value, { nodes: 0 }, 0),
  };
}

/** Deliberately unconstrained schema for bounded guest-local ephemeral values. */
export function fnVibecanvasAnySchemaDocument(): CapsuleSchemaDocument {
  return { format: 'capsule-schema-v1', root: { type: 'any' } };
}

export function fnVibecanvasNullSchemaDocument(): CapsuleSchemaDocument {
  return { format: 'capsule-schema-v1', root: { type: 'null' } };
}

export function fnVibecanvasCollaborativeChangeSchemaDocument(): CapsuleSchemaDocument {
  return {
    format: 'capsule-schema-v1',
    root: {
      type: 'object',
      properties: { value: fnVibecanvasBoundedJsonValueSchema() },
      required: ['value'],
      additionalProperties: false,
    },
  };
}

export function fnVibecanvasCollaborativeSnapshotSchemaDocument(): CapsuleSchemaDocument {
  return {
    format: 'capsule-schema-v1',
    root: {
      type: 'object',
      properties: {
        version: { type: 'number', integer: true, minimum: 1 },
        value: fnVibecanvasBoundedJsonValueSchema(),
      },
      required: ['value', 'version'],
      additionalProperties: false,
    },
  };
}
