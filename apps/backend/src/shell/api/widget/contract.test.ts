import { describe, expect, test } from 'bun:test';
import { ZWidgetRuntimeLoadInput, widgetContract } from './contract';

describe('widget runtime API identity', () => {
  test('accepts only the current canvas element and stable widget identity', () => {
    const identity = {
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      widgetKey: 'notes-board',
    };

    expect(ZWidgetRuntimeLoadInput.parse(identity)).toEqual(identity);
    expect(ZWidgetRuntimeLoadInput.safeParse({
      ...identity,
      definitionId: 'legacy-definition',
      revisionId: 'legacy-revision',
    }).success).toBe(false);
  });

  test('keeps every runtime identity component within its public bound', () => {
    expect(ZWidgetRuntimeLoadInput.safeParse({
      canvasId: 'c'.repeat(201),
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      widgetKey: 'notes-board',
    }).success).toBe(false);
  });
});

describe('filesystem widget API bounds', () => {
  test('accepts only strict bounded Config saves with a manifest fence', () => {
    const schema = widgetContract.config.saveDraft.inputSchema as {
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

    const schema = widgetContract.placement.resolve.inputSchema as {
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

  test('keeps deletion planning source-explicit and commit identity opaque', () => {
    const plan = widgetContract.deletion.plan.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const commit = widgetContract.deletion.commit.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(plan.safeParse({ widgetKey: 'notes-board', source: 'draft' }).success).toBe(true);
    expect(plan.safeParse({ widgetKey: 'notes-board', source: 'published' }).success).toBe(true);
    expect(plan.safeParse({ widgetKey: 'notes-board' }).success).toBe(false);
    expect(plan.safeParse({ widgetKey: '../notes-board', source: 'draft' }).success).toBe(false);
    expect(plan.safeParse({ widgetKey: 'notes-board', source: 'draft', path: '/tmp' }).success)
      .toBe(false);
    expect(commit.safeParse({ planToken: 'plan_123', operationId: 'operation_123' }).success)
      .toBe(true);
    expect(commit.safeParse({ planToken: 'plan 123', operationId: 'operation_123' }).success)
      .toBe(false);
    expect(commit.safeParse({
      planToken: 'plan_123', operationId: 'operation_123', widgetKey: 'notes-board',
    }).success).toBe(false);
  });
});
