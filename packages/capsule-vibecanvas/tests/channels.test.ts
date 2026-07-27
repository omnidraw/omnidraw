import { describe, expect, test } from 'bun:test';
import {
  createVibecanvasGuestChannelContract,
  fnVibecanvasWidgetNotificationOutput,
} from '../src/capabilities';

const decoder = new TextDecoder();

function documentFor(
  contract: Awaited<ReturnType<typeof createVibecanvasGuestChannelContract>>,
  hash: string,
): Readonly<Record<string, unknown>> {
  const resource = contract.schemas.find((candidate) => (
    candidate.reference.hash === hash
  ));
  if (resource === undefined) throw new Error(`Missing schema resource ${hash}.`);
  return JSON.parse(decoder.decode(resource.copyCanonicalBytes())) as Readonly<
    Record<string, unknown>
  >;
}

function containsAnySchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAnySchema);
  if (value === null || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.type === 'any'
    || Object.values(record).some(containsAnySchema);
}

describe('Vibecanvas Capsule guest channels', () => {
  test('binds props, theme, and output to distinct deterministic bounded schemas', async () => {
    const first = await createVibecanvasGuestChannelContract({
      localStore: 'ephemeral',
    });
    const second = await createVibecanvasGuestChannelContract({
      localStore: 'ephemeral',
    });
    const references = [
      first.declaration.props,
      first.declaration.theme,
      first.declaration.output,
    ];

    expect(new Set(references.map(({ hash }) => hash)).size).toBe(3);
    expect(second.declaration).toEqual(first.declaration);
    for (const reference of references) {
      expect(containsAnySchema(documentFor(first, reference.hash))).toBe(false);
    }

    const props = documentFor(first, first.declaration.props.hash);
    expect(props).toMatchObject({
      format: 'capsule-schema-v1',
      root: {
        type: 'object',
        maxProperties: 64,
      },
    });
    const theme = documentFor(first, first.declaration.theme.hash);
    expect(theme).toMatchObject({
      root: {
        type: 'object',
        maxProperties: 3,
        properties: {
          format: { type: 'literal', value: 'vibecanvas.widget-theme.v1' },
        },
      },
    });
    const output = documentFor(first, first.declaration.output.hash);
    expect(output).toMatchObject({
      root: {
        type: 'object',
        maxProperties: 3,
        properties: {
          type: { type: 'literal', value: 'notification' },
          message: { type: 'string', minBytes: 1, maxBytes: 512 },
        },
      },
    });

    expect(first.declaration.store?.schema.hash).not.toBe(
      first.declaration.props.hash,
    );
    expect(containsAnySchema(documentFor(
      first,
      first.declaration.store!.schema.hash,
    ))).toBe(true);
  });

  test('fails closed when a routed value is not the one notification action', () => {
    expect(fnVibecanvasWidgetNotificationOutput({
      type: 'notification',
      tone: 'success',
      message: 'Saved',
    })).toEqual({
      type: 'notification',
      tone: 'success',
      message: 'Saved',
    });
    expect(() => fnVibecanvasWidgetNotificationOutput({
      type: 'open-url',
      tone: 'info',
      message: 'https://example.invalid',
    })).toThrow('does not match');
    expect(() => fnVibecanvasWidgetNotificationOutput({
      type: 'notification',
      tone: 'info',
      message: 'Hello',
      resourceId: 'resource-a',
    })).toThrow('does not match');
  });
});
