import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../AgentService';
import { createTestChats, createTestEvents, testAgentWorld, testChatId } from './service.fixture';

const temporaryRoots: string[] = [];
const PROVIDER = 'widget-selection-test-provider';
const MODEL = 'widget-selection-test-model';

function assistantMessage() {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text', text: 'Selection received.' }],
    api: 'widget-selection-test-api',
    provider: PROVIDER,
    model: MODEL,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };
}

function completedStream() {
  const message = assistantMessage();
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: message };
      yield { type: 'text_start', contentIndex: 0, partial: message };
      yield {
        type: 'text_end',
        contentIndex: 0,
        content: 'Selection received.',
        partial: message,
      };
      yield { type: 'done', reason: 'stop', message };
    },
    async result() {
      return message;
    },
  };
}

function findWidgetSelection(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('omnidraw.widget-selection.v1') ? value : undefined;
  }
  if (Array.isArray(value)) {
    let latest: unknown;
    for (const entry of value) {
      const selection = findWidgetSelection(entry);
      if (selection !== undefined) latest = selection;
    }
    return latest;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.format === 'omnidraw.widget-selection.v1') return record;
    let latest: unknown;
    for (const entry of Object.values(record)) {
      const selection = findWidgetSelection(entry);
      if (selection !== undefined) latest = selection;
    }
    return latest;
  }
  return undefined;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('AgentService widget reference selection', () => {
  test('mounts the exact draft before Pi and injects one-turn model-visible safe context', async () => {
    const sessionId = testChatId('widget-reference-selection');
    const dataPath = await mkdtemp(join(tmpdir(), 'omnidraw-widget-reference-'));
    temporaryRoots.push(dataPath);
    const draftRoot = join(dataPath, 'widgets', 'drafts');
    const draftPath = join(draftRoot, 'notes-board');
    const comparisonDraftPath = join(draftRoot, 'tasks-board');
    const staleDraftPath = join(draftRoot, 'stale-board');
    await Promise.all([
      mkdir(join(draftPath, 'ui'), { recursive: true }),
      mkdir(join(comparisonDraftPath, 'ui'), { recursive: true }),
      mkdir(join(staleDraftPath, 'ui'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(draftPath, 'omnidraw.json'), JSON.stringify({
        $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
        schemaVersion: 1,
        name: 'Notes Board',
        slug: 'notes-board',
        description: 'Mention fixture.',
        tool: { label: 'Notes Board', group: null, priority: 0 },
        ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
      })),
      writeFile(join(draftPath, 'ui', 'main.ts'), 'export default 1;\n'),
      writeFile(join(comparisonDraftPath, 'omnidraw.json'), JSON.stringify({
        $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
        schemaVersion: 1,
        name: 'Tasks Board',
        slug: 'tasks-board',
        description: 'Comparison fixture.',
        tool: { label: 'Tasks Board', group: null, priority: 0 },
        ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
      })),
      writeFile(join(comparisonDraftPath, 'ui', 'main.ts'), 'export default 2;\n'),
      writeFile(join(staleDraftPath, 'omnidraw.json'), JSON.stringify({
        $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
        schemaVersion: 1,
        name: 'Stale Board',
        slug: 'stale-board',
        description: 'Stale frontend reference fixture.',
        tool: { label: 'Stale Board', group: null, priority: 0 },
        ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
      })),
      writeFile(join(staleDraftPath, 'ui', 'main.ts'), 'export default 4;\n'),
    ]);
    const chats = createTestChats();
    const modelContexts: unknown[] = [];
    let fenceChecks = 0;
    let publishedMaterialized = false;
    const service = new AgentService({
      world: testAgentWorld(),
      dataPath,
      widgetDraftsRoot: draftRoot,
      eventPublisherService: createTestEvents(),
      chats,
      chatScope: {
        validate: async ({ canvasId, widgetId }) => (
          canvasId === 'canvas-a' && widgetId === 'chat-element'
        ),
      },
      widgetReferenceResolver: {
        async resolve(references) {
          return {
            catalogGeneration: 7,
            catalogDigestSha256: 'a'.repeat(64),
            references: references.map((reference) => {
              const isPublishedKey = reference.name === 'published-only';
              const isPublishedOnly = isPublishedKey && !publishedMaterialized;
              const isTasks = reference.name === 'tasks-board';
              const isStale = reference.name === 'stale-board';
              const name = isPublishedKey
                ? 'Published Only'
                : isTasks ? 'Tasks Board' : isStale ? 'Stale Board' : 'Notes Board';
              return {
                widgetKey: reference.name,
                requestedVariant: reference.source,
                displayName: name,
                health: 'healthy' as const,
                draftAvailable: !isPublishedOnly,
                publicationAvailable: reference.source === 'published' || isPublishedOnly,
                requirements: [{ slot: 'records', kind: 'db', effect: 'read' as const, required: true }],
                editableDraft: isPublishedOnly ? null : {
                  name,
                  slug: reference.name,
                  treeDigestSha256: 'b'.repeat(64),
                  buildPhase: 'build_required' as const,
                  acceptedGeneration: 3,
                  acceptedCurrent: false,
                },
              };
            }),
          };
        },
        async assertCurrent(resolution) {
          fenceChecks += 1;
          if (resolution.references.some((reference) => reference.widgetKey === 'stale-board')) {
            throw Object.assign(new Error('Frontend widget reference is stale.'), {
              code: 'WIDGET_REFERENCE_STALE',
            });
          }
        },
      },
      widgetAuthoringAuthority: {
        async catalog() {
          return {
            catalogGeneration: 7,
            catalogDigestSha256: 'a'.repeat(64),
            entries: [],
          };
        },
        async ensureEditableDraft({ name }) {
          const displayName = name === 'published-only'
            ? 'Published Only'
            : name === 'tasks-board'
              ? 'Tasks Board'
              : name === 'stale-board' ? 'Stale Board' : 'Notes Board';
          const path = join(draftRoot, name);
          if (name === 'published-only' && !publishedMaterialized) {
            await mkdir(join(path, 'ui'), { recursive: true });
            await Promise.all([
              writeFile(join(path, 'omnidraw.json'), JSON.stringify({
                $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
                schemaVersion: 1,
                name: displayName,
                slug: name,
                description: 'Materialized publication fixture.',
                tool: { label: displayName, group: null, priority: 0 },
                ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
              })),
              writeFile(join(path, 'ui', 'main.ts'), 'export default 3;\n'),
            ]);
            publishedMaterialized = true;
          }
          return {
            widgetKey: name,
            displayName,
            slug: name,
            treeDigestSha256: 'b'.repeat(64),
            sourceDecision: name === 'published-only'
              ? 'materialized-publication' as const
              : 'existing-draft' as const,
            materialized: name === 'published-only',
          };
        },
        assertEditableDraftCurrent: async () => undefined,
      },
    });
    await service.start({} as never);
    service.modelRuntime.registerProvider(PROVIDER, {
      api: 'widget-selection-test-api' as never,
      baseUrl: 'http://127.0.0.1.invalid',
      apiKey: 'test-key',
      models: [{
        id: MODEL,
        name: 'Widget Selection Test',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16_000,
        maxTokens: 1_000,
      }],
      streamSimple: ((_model: unknown, context: unknown) => {
        modelContexts.push(context);
        return completedStream();
      }) as never,
    });
    await service.modelRuntime.setRuntimeApiKey(PROVIDER, 'test-key');
    service.settingsManager.setDefaultModelAndProvider(PROVIDER, MODEL);

    await service.connectChat('chat-element', sessionId, 'canvas-a');
    expect(await readdir(join(
      dataPath,
      'pi',
      'agent',
      'chats',
      sessionId,
      'workspace',
      'widgets',
    ))).toEqual([]);
    await expect(service.promptChat('chat-element', sessionId, 'Use this stale selection.', {
      canvasId: 'canvas-a',
      widgetRefs: [{ name: 'stale-board', source: 'draft' }],
    })).rejects.toMatchObject({ code: 'WIDGET_REFERENCE_STALE' });
    expect(await readdir(join(
      dataPath,
      'pi',
      'agent',
      'chats',
      sessionId,
      'workspace',
      'widgets',
    ))).toEqual([]);
    await service.promptChat('chat-element', sessionId, 'Fix the mentioned widget.', {
      canvasId: 'canvas-a',
      widgetRefs: [{ name: 'notes-board', source: 'published' }],
    });

    expect(fenceChecks).toBe(2);
    expect(await realpath(join(
      dataPath,
      'pi',
      'agent',
      'chats',
      sessionId,
      'workspace',
      'widgets',
      'Notes Board',
    ))).toBe(await realpath(draftPath));
    expect(chats.records.get(sessionId)?.canvasId).toBe('canvas-a');
    const firstContext = JSON.stringify(findWidgetSelection(modelContexts[0])).replaceAll('\\', '');
    expect(firstContext).toContain('omnidraw.widget-selection.v1');
    expect(firstContext).toContain('"requestedVariant":"published"');
    expect(firstContext).toContain('"mountedPath":"widgets/Notes Board"');
    expect(firstContext).toContain('"phase":"build_required"');
    expect(firstContext).not.toContain(dataPath);
    expect(firstContext).not.toContain('treeDigestSha256');

    await service.promptChat('chat-element', sessionId, 'Continue.', {
      canvasId: 'canvas-a',
    });
    const continuationContext = JSON.stringify(
      findWidgetSelection(modelContexts[1]),
    ).replaceAll('\\', '');
    expect(continuationContext).toContain('omnidraw.widget-selection.v1');
    expect(continuationContext).toContain('"explicitlyMentioned":[]');
    expect(continuationContext).toContain('"widgetKey":"notes-board"');

    await service.promptChat('chat-element', sessionId, 'Compare these.', {
      canvasId: 'canvas-a',
      widgetRefs: [
        { name: 'notes-board', source: 'draft' },
        { name: 'tasks-board', source: 'draft' },
      ],
    });
    const comparisonContext = JSON.stringify(
      findWidgetSelection(modelContexts[2]),
    ).replaceAll('\\', '');
    expect(comparisonContext).toContain('"widgetKey":"notes-board"');
    expect(comparisonContext).toContain('"widgetKey":"tasks-board"');
    expect(comparisonContext).toContain('"activeEditableTarget":null');
    expect((await readdir(join(
      dataPath,
      'pi',
      'agent',
      'chats',
      sessionId,
      'workspace',
      'widgets',
    ))).sort()).toEqual(['Notes Board', 'Tasks Board']);

    await service.promptChat('chat-element', sessionId, 'Keep comparing.', {
      canvasId: 'canvas-a',
    });
    const comparisonContinuation = JSON.stringify(
      findWidgetSelection(modelContexts[3]),
    ).replaceAll('\\', '');
    expect(comparisonContinuation).toContain('"explicitlyMentioned":[]');
    expect(comparisonContinuation).toContain('"activeEditableTarget":null');

    await service.promptChat('chat-element', sessionId, 'Explain this publication.', {
      canvasId: 'canvas-a',
      widgetRefs: [{ name: 'published-only', source: 'published' }],
    });
    const publishedOnlyContext = JSON.stringify(
      findWidgetSelection(modelContexts[4]),
    ).replaceAll('\\', '');
    expect(publishedOnlyContext).toContain('"requestedVariant":"published"');
    expect(publishedOnlyContext).toContain('"editableVariant":"draft"');
    expect(publishedOnlyContext).toContain('"mountedPath":"widgets/Published Only"');
    expect((await readdir(join(
      dataPath,
      'pi',
      'agent',
      'chats',
      sessionId,
      'workspace',
      'widgets',
    ))).sort()).toEqual(['Notes Board', 'Published Only', 'Tasks Board']);
    expect(fenceChecks).toBe(4);

    await service.promptChat('chat-element', sessionId, 'Continue editing it.', {
      canvasId: 'canvas-a',
      widgetRefs: [{ name: 'published-only', source: 'published' }],
    });
    const activePublishedRecords = [
      ...service.sessionMap['chat-element']![sessionId]!.sessionManager.buildContextEntries(),
    ].filter((entry) => (
      entry.type === 'custom'
      && entry.customType === 'omnidraw.activeWidgetMount'
      && (entry.data as { name?: unknown } | undefined)?.name === 'Published Only'
    ));
    expect(activePublishedRecords).toHaveLength(1);
    expect(fenceChecks).toBe(5);

    await expect(service.connectChat(
      'chat-element',
      sessionId,
      'canvas-b',
    )).rejects.toMatchObject({ code: 'CHAT_CANVAS_CONFLICT' });
    await service.stop();
  });
});
