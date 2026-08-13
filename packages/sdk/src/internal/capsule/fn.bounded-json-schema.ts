import type { CapsuleSchemaNode } from '@omnidraw/capsule/schema';

const JSON_STRING_MAX_BYTES = 4_096;
const JSON_COLLECTION_MAX_ITEMS = 64;
const JSON_VALUE_MAX_DEPTH = 4;

function fnOmnidrawJsonPrimitiveSchema(): CapsuleSchemaNode {
  return {
    type: 'union',
    variants: [
      { type: 'null' },
      { type: 'boolean' },
      { type: 'number' },
      { type: 'string', maxBytes: JSON_STRING_MAX_BYTES },
    ],
  };
}

function fnOmnidrawBoundedJsonSchemaAtDepth(depth: number): CapsuleSchemaNode {
  const primitive = fnOmnidrawJsonPrimitiveSchema();
  if (depth === 0) return primitive;
  return {
    type: 'union',
    variants: [
      primitive,
      {
        type: 'array',
        items: fnOmnidrawBoundedJsonSchemaAtDepth(depth - 1),
        maxItems: JSON_COLLECTION_MAX_ITEMS,
      },
      {
        type: 'object',
        properties: {},
        additionalProperties: fnOmnidrawBoundedJsonSchemaAtDepth(depth - 1),
        maxProperties: JSON_COLLECTION_MAX_ITEMS,
      },
    ],
  };
}

/**
 * Exact JSON structured-value subset shared by guest channels and
 * collaborative state. Capsule byte strings and JavaScript-only values are
 * intentionally absent.
 */
export function fnOmnidrawBoundedJsonValueSchema(): CapsuleSchemaNode {
  return fnOmnidrawBoundedJsonSchemaAtDepth(JSON_VALUE_MAX_DEPTH);
}

