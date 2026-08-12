import { describe, expect, test } from 'bun:test';
import {
  ZWidgetRuntimeLoadInput,
  ZWidgetStateIdentity,
  widgetContract,
} from './contract';

describe('widget state API identity', () => {
  test('accepts only the current canvas element and stable widget instance', () => {
    const identity = {
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
    };

    expect(ZWidgetStateIdentity.parse(identity)).toEqual(identity);
    expect(ZWidgetStateIdentity.safeParse({
      ...identity,
      definitionId: 'legacy-definition',
      revisionId: 'legacy-revision',
    }).success).toBe(false);
  });

  test('keeps every state identity component within the public identifier bound', () => {
    expect(ZWidgetStateIdentity.safeParse({
      canvasId: 'c'.repeat(201),
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
    }).success).toBe(false);
  });
});

describe('filesystem widget API bounds', () => {
  test('accepts only strict bounded Config saves with a manifest fence', () => {
    const schema = widgetContract.config.saveDraft['~orpc'].inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const input = {
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: 'a'.repeat(64),
      config: {
        name: 'Notes Board',
        description: 'A filesystem widget.',
        tool: {
          label: 'Notes',
          icon: null,
          group: 'writing-tools',
          priority: 10,
        },
      },
    };

    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, unexpected: true }).success).toBe(false);
    expect(schema.safeParse({
      ...input,
      config: { ...input.config, slug: 'renamed-key' },
    }).success).toBe(false);
    expect(schema.safeParse({
      ...input,
      config: {
        ...input.config,
        tool: { ...input.config.tool, group: 'Not A Group' },
      },
    }).success).toBe(false);
  });

  test('uses strict widget keys and rejects browser-owned placement bindings', () => {
    expect(ZWidgetRuntimeLoadInput.safeParse({
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      widgetKey: 'notes-board',
    }).success).toBe(true);
    expect(ZWidgetRuntimeLoadInput.safeParse({
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      widgetKey: 'Notes Board',
    }).success).toBe(false);

    const schema = widgetContract.placement.resolve['~orpc'].inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const reference = {
      source: 'published',
      widgetKey: 'notes-board',
      catalogGeneration: 1,
    };
    expect(schema.safeParse({ reference }).success).toBe(true);
    expect(schema.safeParse({
      reference,
      resourceBindings: { records: { resourceId: 'resource-a' } },
    }).success).toBe(false);
  });
});
