import { createCapsuleSchemaResource } from '@omnidraw/capsule/schema';
import { describe, expect, test } from 'bun:test';
import {
  createOmnidrawCollaborativeStateCapabilityContract,
  fnOmnidrawCollaborativeChangeSchemaDocument,
  fnOmnidrawCollaborativeSnapshotSchemaDocument,
} from '../src/capabilities';

type TSchemaRecord = Readonly<Record<string, unknown>>;

const decoder = new TextDecoder();

function schemaRecord(value: unknown): TSchemaRecord {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as TSchemaRecord;
}

function expectJsonPrimitiveSchema(value: unknown): void {
  expect(value).toEqual({
    type: 'union',
    variants: [
      { type: 'null' },
      { type: 'boolean' },
      { type: 'number' },
      { type: 'string', maxBytes: 4_096 },
    ],
  });
}

function expectBoundedJsonSchema(value: unknown, depth: number): void {
  if (depth === 0) {
    expectJsonPrimitiveSchema(value);
    return;
  }
  const schema = schemaRecord(value);
  expect(schema.type).toBe('union');
  const variants = schema.variants as readonly unknown[];
  expect(variants).toHaveLength(3);
  expectJsonPrimitiveSchema(variants[0]);

  const array = schemaRecord(variants[1]);
  expect(array).toMatchObject({ type: 'array', maxItems: 64 });
  expectBoundedJsonSchema(array.items, depth - 1);

  const object = schemaRecord(variants[2]);
  expect(object).toMatchObject({
    type: 'object',
    properties: {},
    maxProperties: 64,
  });
  expectBoundedJsonSchema(object.additionalProperties, depth - 1);
}

function resourceDocument(resource: Readonly<{
  copyCanonicalBytes(): Uint8Array;
}>): TSchemaRecord {
  return JSON.parse(decoder.decode(resource.copyCanonicalBytes())) as TSchemaRecord;
}

describe('Omnidraw Capsule collaborative-state schemas', () => {
  test('publishes exact bounded JSON resources for changes and snapshots', async () => {
    const [change, snapshot, contract] = await Promise.all([
      createCapsuleSchemaResource(fnOmnidrawCollaborativeChangeSchemaDocument()),
      createCapsuleSchemaResource(fnOmnidrawCollaborativeSnapshotSchemaDocument()),
      createOmnidrawCollaborativeStateCapabilityContract(),
    ]);
    const changeOperation = contract.descriptor.operations.find(({ name }) => name === 'change');
    const getOperation = contract.descriptor.operations.find(({ name }) => name === 'get');
    const subscribeOperation = contract.descriptor.operations.find(({ name }) => name === 'subscribe');

    expect(changeOperation?.inputSchema).toEqual(change.reference);
    expect(changeOperation?.outputSchema).toEqual(snapshot.reference);
    expect(getOperation?.outputSchema).toEqual(snapshot.reference);
    expect(subscribeOperation?.eventSchema).toEqual(snapshot.reference);

    const changeDocument = resourceDocument(change);
    const changeRoot = schemaRecord(changeDocument.root);
    expect(changeRoot).toMatchObject({
      type: 'object',
      required: ['value'],
      additionalProperties: false,
    });
    expectBoundedJsonSchema(
      schemaRecord(changeRoot.properties).value,
      4,
    );

    const snapshotDocument = resourceDocument(snapshot);
    const snapshotRoot = schemaRecord(snapshotDocument.root);
    expect(snapshotRoot).toMatchObject({
      type: 'object',
      required: ['value', 'version'],
      additionalProperties: false,
    });
    const snapshotProperties = schemaRecord(snapshotRoot.properties);
    expect(snapshotProperties.version).toEqual({
      type: 'number',
      integer: true,
      minimum: 1,
    });
    expectBoundedJsonSchema(snapshotProperties.value, 4);
  });

  test('contains neither broad any nor byte-string authority', async () => {
    const resources = await Promise.all([
      createCapsuleSchemaResource(fnOmnidrawCollaborativeChangeSchemaDocument()),
      createCapsuleSchemaResource(fnOmnidrawCollaborativeSnapshotSchemaDocument()),
    ]);

    for (const resource of resources) {
      const canonical = decoder.decode(resource.copyCanonicalBytes());
      expect(canonical).not.toContain('"type":"any"');
      expect(canonical).not.toContain('"type":"bytes"');
      expect(canonical).not.toContain('undefined');
    }
  });
});
