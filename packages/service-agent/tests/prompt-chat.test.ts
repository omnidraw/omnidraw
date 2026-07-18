import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord, fxLatestWidgetResourceSelectionRecord } from '../src/core/fx.session-records';
import { createFakeSessionManager } from './tool.test-helpers';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { WIDGET_CHAT_SYSTEM_PROMPT } from '../src/prompts';

class TestEventPublisherService implements IEventPublisherService {
  name = 'test-event-publisher';

  publishDbEvent(canvasId: string, event: TDbEvent): void { void canvasId; void event; }
  async *subscribeDbEvents(canvasId: string): AsyncIterable<TDbEvent> { void canvasId; }
  publishActorEvent(event: TActorEvent): void { void event; }
  async *subscribeActorEvents(): AsyncIterable<TActorEvent> { }
  publishAgentEvent(event: TAgentEvent): void { void event; }
  async *subscribeAgentEvents(): AsyncIterable<TAgentEvent> { }
  publishFilesystemEvent(path: string, event: TFilesystemEvent): void { void path; void event; }
  async *subscribeFilesystemEvents(path: string): AsyncIterable<TFilesystemEvent> { void path; }
  publishNotification(event: TNotificationEvent): void { void event; }
  async *subscribeNotifications(): AsyncIterable<TNotificationEvent> { }
  getLatestNotification(): TNotificationEvent | null { return null; }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(actorService?: ConstructorParameters<typeof AgentService>[0]['actorService']) {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-prompt-'));
  tempDirs.push(dataPath);

  return new AgentService({
    cachePath: join(dataPath, 'cache'),
    dataPath,
    configPath: join(dataPath, 'config'),
    eventPublisherService: new TestEventPublisherService(),
    actorService,
  });
}

describe('AgentService.promptChat', () => {
  test('teaches widget agents the actor lifecycle and activity contract', () => {
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('New transitions use `{ func: ["tx.name"], targetState: "ready" }`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Never write a loop or sleep/retry cycle inside it');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('args.msg.kind === "activity.tick"');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('recover: { targetState: "ready" }');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('accepted only so existing widgets keep working');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('widget.tool.group: omit by default');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('actor.resources: optional definition-level map');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('portal.resources.kv("slot")');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Secret values are currently stored as plaintext');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('portal.resources.db("notes").invoke');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('DB slots are schema-agnostic');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('ordinary SQLite-compatible');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('Host-published DbResource schema context');
  });

  test('passes image-only prompts to Pi with fallback text', async () => {
    const service = await createService();
    const calls: Array<{ text: string; options: unknown }> = [];

    service.sessionMap.widget = {
      session: {
        unsub: () => {},
        sessionManager: {} as never,
        session: {
          prompt: async (text: string, options: unknown) => {
            calls.push({ text, options });
          },
        } as never,
      },
    };

    await service.promptChat('widget', 'session', '', {
      images: [{ name: 'reference.png', mimeType: 'image/png', data: 'aW1hZ2U=' }],
    });

    expect(calls).toEqual([{
      text: 'Please use the attached image.',
      options: {
        images: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
      },
    }]);
  });

  test('rejects unsupported prompt image MIME types', async () => {
    const service = await createService();

    service.sessionMap.widget = {
      session: {
        unsub: () => {},
        sessionManager: {} as never,
        session: {
          prompt: async () => {},
        } as never,
      },
    };

    await expect(service.promptChat('widget', 'session', 'describe this', {
      images: [{ mimeType: 'image/svg+xml', data: 'PHN2Zy8+' }],
    })).rejects.toThrow('Unsupported prompt image MIME type: image/svg+xml');
  });

  test('resolves typed resource IDs and persists trusted selection metadata', async () => {
    const service = await createService({
      reload: async () => {},
      getResource: async (id) => ({
        id,
        kind: id === 'kv-1' ? 'kv' : 'db',
        name: id === 'kv-1' ? 'Preferences' : 'Notes Database',
        status: 'ready',
        last_error: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    });
    const sessionManager = {
      entries: [] as any[],
      appendCustomEntry(customType: string, data?: unknown) {
        this.entries.push({ type: 'custom', customType, data });
        return String(this.entries.length);
      },
      getEntries() { return this.entries; },
    };
    service.sessionMap.widget = {
      session: {
        unsub: () => {},
        sessionManager: sessionManager as never,
        session: { prompt: async () => {} } as never,
      },
    };

    await service.promptChat('widget', 'session', 'Use @Notes Database', { resourceIds: ['db-1'] });
    expect(fxLatestWidgetResourceSelectionRecord({ sessionManager: sessionManager as never }, {})).toEqual({
      resources: [{ id: 'db-1', kind: 'db', name: 'Notes Database', status: 'ready' }],
      selectedAt: expect.any(String),
    });
    await service.promptChat('widget', 'session', 'Do not use a resource now', { resourceIds: [] });
    expect(fxLatestWidgetResourceSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([]);
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([
      { id: 'db-1', kind: 'db', name: 'Notes Database', status: 'ready' },
    ]);
  });

  test('replaces a same-kind draft binding on mention and clears it only through the explicit action', async () => {
    const resources = [
      { id: 'db-1', kind: 'db' as const, name: 'QA Database' },
      { id: 'db-2', kind: 'db' as const, name: 'Manual QA Database' },
      { id: 'kv-1', kind: 'kv' as const, name: 'Preferences' },
    ];
    const service = await createService({
      reload: async () => {},
      getResource: async (id) => {
        const resource = resources.find((candidate) => candidate.id === id);
        return resource ? {
          ...resource,
          status: 'ready',
          last_error: null,
          created_at: '2026-07-13T00:00:00.000Z',
          updated_at: '2026-07-13T00:00:00.000Z',
        } : null;
      },
    });
    const sessionManager = createFakeSessionManager();
    service.sessionMap.widget = {
      session: {
        unsub: () => {},
        sessionManager: sessionManager as never,
        session: { prompt: async () => {} } as never,
      },
    };

    await service.promptChat('widget', 'session', 'Use these resources', { resourceIds: ['db-1', 'kv-1'] });
    await service.promptChat('widget', 'session', 'Switch to @Manual QA Database', { resourceIds: ['db-2'] });
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([
      { id: 'kv-1', kind: 'kv', name: 'Preferences', status: 'ready' },
      { id: 'db-2', kind: 'db', name: 'Manual QA Database', status: 'ready' },
    ]);

    expect(service.clearDraftResourceBindingsChat('widget', 'session')).toEqual({ cleared: true });
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})).toMatchObject({
      resources: [],
      source: 'explicit-clear',
    });
  });

  test('keeps the exact phase-free registry across reconnect and continuation errors', async () => {
    const service = await createService();
    const widgetId = 'widget-tools';
    const sessionId = 'session-tools';
    await service.connectChat(widgetId, sessionId);

    const expectedTools = [
      'edit', 'grep', 'patch', 'read', 'vc_resource_create', 'vc_resource_data_read',
      'vc_resource_data_write', 'vc_resource_delete', 'vc_resource_inspect', 'vc_resource_list',
      'vc_resource_update', 'vc_widget_create', 'vc_widget_validate', 'web_fetch',
    ];
    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);

    await expect(service.promptChat(widgetId, sessionId, 'implement this', {
      images: [{ mimeType: 'image/svg+xml', data: 'PHN2Zy8+' }],
    })).rejects.toThrow('Unsupported prompt image MIME type: image/svg+xml');

    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);

    await service.connectChat(widgetId, sessionId);
    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);
  });
});
