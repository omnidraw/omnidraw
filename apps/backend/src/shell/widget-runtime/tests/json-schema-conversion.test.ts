import { createCapsuleSchemaResource } from '@omnidraw/capsule/schema';
import { describe, expect, test } from 'bun:test';
import { fnJsonSchemaToCapsuleSchemaDocument } from '../capabilities/fn.json-schema';

describe('fail-closed JSON Schema to Capsule conversion', () => {
  test('preserves the accepted object, array, number, union, and enum semantics', async () => {
    const document = fnJsonSchemaToCapsuleSchemaDocument({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 0, maximum: 10 },
        mode: { type: 'string', enum: ['compact', 'full'] },
        values: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'number' },
              { type: 'null' },
            ],
          },
          minItems: 1,
          maxItems: 4,
        },
      },
      required: ['mode', 'count'],
      minProperties: 2,
      maxProperties: 4,
      additionalProperties: false,
    });

    expect(document).toEqual({
      format: 'capsule-schema-v1',
      root: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            integer: true,
            minimum: 0,
            maximum: 10,
          },
          mode: {
            type: 'union',
            variants: [
              { type: 'literal', value: 'compact' },
              { type: 'literal', value: 'full' },
            ],
          },
          values: {
            type: 'array',
            items: {
              type: 'union',
              variants: [
                { type: 'number' },
                { type: 'null' },
              ],
            },
            minItems: 1,
            maxItems: 4,
          },
        },
        required: ['count', 'mode'],
        additionalProperties: false,
        minProperties: 2,
        maxProperties: 4,
      },
    });
    await expect(createCapsuleSchemaResource(document)).resolves.toEqual(
      expect.objectContaining({
        reference: expect.objectContaining({
          format: 'capsule-schema-v1',
          hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  test('preserves JSON Schema additionalProperties defaults and schema values', () => {
    expect(fnJsonSchemaToCapsuleSchemaDocument({
      type: 'object',
      properties: { known: { type: 'boolean' } },
    }).root).toEqual({
      type: 'object',
      properties: { known: { type: 'boolean' } },
      additionalProperties: true,
    });

    expect(fnJsonSchemaToCapsuleSchemaDocument({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    }).root).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: {
        type: 'number',
        integer: true,
        minimum: 1,
      },
    });
  });

  test('accepts an intentional unconstrained schema without using it as a fallback', () => {
    expect(fnJsonSchemaToCapsuleSchemaDocument({ description: 'Any JSON value.' }))
      .toEqual({
        format: 'capsule-schema-v1',
        root: { type: 'any' },
      });
    expect(fnJsonSchemaToCapsuleSchemaDocument(true)).toEqual({
      format: 'capsule-schema-v1',
      root: { type: 'any' },
    });
  });

  test('rejects lossy or unsupported assertion and applicator keywords', () => {
    const unsupported = [
      { $ref: '#/$defs/value', $defs: { value: { type: 'string' } } },
      { allOf: [{ type: 'string' }] },
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
      { not: { type: 'null' } },
      { type: 'string', minLength: 1 },
      { type: 'string', maxLength: 4 },
      { type: 'string', pattern: '^[a-z]+$' },
      { type: 'string', format: 'uuid' },
      { type: 'number', exclusiveMinimum: 0 },
      { type: 'number', multipleOf: 2 },
      { type: 'array', prefixItems: [{ type: 'string' }] },
      { type: 'array', contains: { type: 'string' } },
      { type: 'array', uniqueItems: true },
      { type: 'object', patternProperties: { '^x': { type: 'string' } } },
      { type: 'object', unevaluatedProperties: false },
    ];

    for (const schema of unsupported) {
      expect(() => fnJsonSchemaToCapsuleSchemaDocument(schema)).toThrow(
        /not supported by Capsule/,
      );
    }
    expect(() => fnJsonSchemaToCapsuleSchemaDocument(false)).toThrow(
      /false schemas are not supported/,
    );
    expect(() => fnJsonSchemaToCapsuleSchemaDocument({
      type: ['string', 'null'],
    })).toThrow(/type must be one supported primitive name/);
  });

  test('rejects malformed bounds, literals, required names, and depth overflow', () => {
    expect(() => fnJsonSchemaToCapsuleSchemaDocument({
      type: 'number',
      minimum: 2,
      maximum: 1,
    })).toThrow(/bounds are inverted/);
    expect(() => fnJsonSchemaToCapsuleSchemaDocument({
      type: 'string',
      enum: ['same', 'same'],
    })).toThrow(/duplicate values/);
    expect(() => fnJsonSchemaToCapsuleSchemaDocument({
      type: 'integer',
      const: 1.5,
    })).toThrow(/does not match its declared type/);
    expect(() => fnJsonSchemaToCapsuleSchemaDocument({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['missing'],
    })).toThrow(/unique declared properties/);

    let deep: unknown = { type: 'string' };
    for (let depth = 0; depth < 26; depth += 1) {
      deep = { type: 'array', items: deep };
    }
    expect(() => fnJsonSchemaToCapsuleSchemaDocument(deep)).toThrow(
      /exceeds the Capsule depth limit/,
    );
  });
});
