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

async function createService(
  actorService?: ConstructorParameters<typeof AgentService>[0]['actorService'],
  authorizeToolCall?: ConstructorParameters<typeof AgentService>[0]['authorizeToolCall'],
) {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-prompt-'));
  tempDirs.push(dataPath);

  return new AgentService({
    cachePath: join(dataPath, 'cache'),
    dataPath,
    configPath: join(dataPath, 'config'),
    eventPublisherService: new TestEventPublisherService(),
    actorService,
    authorizeToolCall,
  });
}

async function waitForChatApproval(service: AgentService, widgetId: string, sessionId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const approval = service.listChatApprovals(widgetId, sessionId)[0]
    if (approval) return approval
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for chat approval.')
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
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Secret-store database pages are encrypted at rest');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('portal.resources.db("notes").invoke');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('DB slots are schema-agnostic');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('ordinary SQLite-compatible');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Search, Plus, Minus, Check');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('vc_widget_create({ name, description? })');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('complete runnable unpublished actor/widget draft');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('read `vibecanvas.json`, the actor registry/reset transaction, and the widget entry/CSS');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Update an existing draft with `read`, `edit`, or `patch`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Run `vc_widget_validate`, inspect every diagnostic, and fix all errors');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('vc_widget_create({ name, kind');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('choose `widget` or `actor-widget`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('Accessibility,');
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
      'bash', 'edit', 'grep', 'patch', 'read', 'vc_resource_create', 'vc_resource_data_read',
      'vc_resource_data_write', 'vc_resource_delete', 'vc_resource_inspect', 'vc_resource_list',
      'vc_resource_update', 'vc_widget_create', 'vc_widget_list', 'vc_widget_validate', 'web_fetch',
    ];
    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);

    await expect(service.promptChat(widgetId, sessionId, 'implement this', {
      images: [{ mimeType: 'image/svg+xml', data: 'PHN2Zy8+' }],
    })).rejects.toThrow('Unsupported prompt image MIME type: image/svg+xml');

    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);

    await service.connectChat(widgetId, sessionId);
    expect(service.sessionMap[widgetId][sessionId].session.getActiveToolNames().sort()).toEqual(expectedTools);
  });

  test('reuses duplicate same-scope connections without canceling pending approvals', async () => {
    const service = await createService({
      reload: async () => {},
      createResource: async ({ kind, name }) => ({
        id: 'resource-1',
        kind,
        name,
        status: 'ready',
        last_error: null,
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
      }),
    });
    const widgetId = 'widget-reuse';
    const sessionId = 'session-reuse';
    await service.connectChat(widgetId, sessionId);
    const originalEntry = service.sessionMap[widgetId][sessionId];
    const createTool = originalEntry.session.getToolDefinition('vc_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');

    const toolResult = createTool.execute('tool-reuse', { kind: 'kv', name: 'Preferences' }, undefined, undefined, {} as never);
    const approval = await waitForChatApproval(service, widgetId, sessionId);

    await service.connectChat(widgetId, sessionId);

    expect(service.sessionMap[widgetId][sessionId]).toBe(originalEntry);
    expect(service.listChatApprovals(widgetId, sessionId).map((item) => item.id)).toEqual([approval.id]);
    await service.resolveChatApproval(widgetId, sessionId, approval.id, 'reject');
    await toolResult;
  });

  test('resolves overlapping initial same-scope connects only after a live runtime is committed', async () => {
    const service = await createService();
    const widgetId = 'widget-initial-overlap';
    const sessionId = 'session-initial-overlap';

    const firstConnectAndApprovalRead = service.connectChat(widgetId, sessionId)
      .then(() => service.listChatApprovals(widgetId, sessionId));
    const secondConnect = service.connectChat(widgetId, sessionId);

    await expect(firstConnectAndApprovalRead).resolves.toEqual([]);
    await expect(secondConnect).resolves.toMatchObject({ messageHistory: [] });
    expect(service.sessionMap[widgetId][sessionId]).toBeDefined();
  });

  test('keeps the old scope live during overlapping replacements and commits only the latest generation', async () => {
    const service = await createService({
      reload: async () => {},
      createResource: async ({ kind, name }) => ({
        id: 'resource-2',
        kind,
        name,
        status: 'ready',
        last_error: null,
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
      }),
    });
    const widgetId = 'widget-replace';
    const sessionId = 'session-replace';
    await service.connectChat(widgetId, sessionId);
    const originalEntry = service.sessionMap[widgetId][sessionId];
    const createTool = originalEntry.session.getToolDefinition('vc_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');

    const toolResult = createTool.execute('tool-replace', { kind: 'kv', name: 'Cache' }, undefined, undefined, {} as never);
    const approval = await waitForChatApproval(service, widgetId, sessionId);
    const firstReplacement = service.connectChat(widgetId, sessionId, {}, 'replace');
    const secondReplacement = service.connectChat(widgetId, sessionId, {}, 'replace');

    expect(service.listChatApprovals(widgetId, sessionId).map((item) => item.id)).toEqual([approval.id]);
    await Promise.all([firstReplacement, secondReplacement]);

    expect(service.sessionMap[widgetId][sessionId]).not.toBe(originalEntry);
    expect(service.listChatApprovals(widgetId, sessionId)).toEqual([]);
    await toolResult;
  });

  test('carries an explicit replacement through a later ordinary reuse request', async () => {
    const service = await createService();
    const widgetId = 'widget-sticky-replace';
    const sessionId = 'session-sticky-replace';
    await service.connectChat(widgetId, sessionId);
    const originalEntry = service.sessionMap[widgetId][sessionId];

    const replacement = service.connectChat(widgetId, sessionId, {}, 'replace');
    const laterReuse = service.connectChat(widgetId, sessionId, {}, 'reuse');
    await Promise.all([replacement, laterReuse]);

    expect(service.sessionMap[widgetId][sessionId]).not.toBe(originalEntry);
  });

  test('refreshes internal authorization context on reuse and rejects account ownership changes', async () => {
    const authorizationChecks: Array<{ toolName: string; accountId?: string; requestId?: string }> = [];
    const service = await createService({
      reload: async () => {},
      createResource: async ({ kind, name }) => ({
        id: 'resource-authorization',
        kind,
        name,
        status: 'ready',
        last_error: null,
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
      }),
    }, ({ toolName, context }) => {
      authorizationChecks.push({ toolName, ...context });
      return true;
    });
    const widgetId = 'widget-authorization';
    const sessionId = 'session-authorization';
    const initialConnect = await service.connectChat(widgetId, sessionId, { accountId: 'account-1', requestId: 'request-1' });
    expect(JSON.stringify(initialConnect)).not.toContain('account-1');
    expect(JSON.stringify(initialConnect)).not.toContain('request-1');
    await service.connectChat(widgetId, sessionId, { accountId: 'account-1', requestId: 'request-2' });

    const createTool = service.sessionMap[widgetId][sessionId].session.getToolDefinition('vc_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');
    const toolResult = createTool.execute('tool-authorization', { kind: 'kv', name: 'Preferences' }, undefined, undefined, {} as never);
    const approval = await waitForChatApproval(service, widgetId, sessionId);

    expect(JSON.stringify(service.listChatApprovals(widgetId, sessionId))).not.toContain('account-1');
    expect(JSON.stringify(service.listChatApprovals(widgetId, sessionId))).not.toContain('request-2');
    expect(authorizationChecks).toContainEqual({
      toolName: 'vc_resource_create',
      accountId: 'account-1',
      requestId: 'request-2',
    });
    await service.resolveChatApproval(widgetId, sessionId, approval.id, 'reject');
    await toolResult;
    await expect(service.connectChat(widgetId, sessionId, { accountId: 'account-2', requestId: 'request-3' }))
      .rejects.toMatchObject({ code: 'CHAT_AUTHORIZATION_CHANGED' });
    expect(service.sessionMap[widgetId][sessionId].authorizationContext).toEqual({
      accountId: 'account-1',
      requestId: 'request-2',
    });
  });

  test('moves a session between widgets without weakening approval scope checks', async () => {
    const service = await createService();
    const sessionId = 'session-owner';
    await service.connectChat('widget-a', sessionId);
    await service.connectChat('widget-b', sessionId);

    expect(() => service.listChatApprovals('widget-a', sessionId)).toThrow("No connected agent session for widget 'widget-a'");
    expect(service.listChatApprovals('widget-b', sessionId)).toEqual([]);
    expect(service.sessionMap['widget-a']).toBeUndefined();
    expect(service.sessionMap['widget-b'][sessionId]).toBeDefined();
  });

  test('new chat deliberately retires the runtime and cancels its pending approvals', async () => {
    const service = await createService({
      reload: async () => {},
      createResource: async ({ kind, name }) => ({
        id: 'resource-new-chat',
        kind,
        name,
        status: 'ready',
        last_error: null,
        created_at: '2026-07-18T00:00:00.000Z',
        updated_at: '2026-07-18T00:00:00.000Z',
      }),
    });
    const widgetId = 'widget-new-chat';
    const sessionId = 'session-new-chat';
    await service.connectChat(widgetId, sessionId);
    const createTool = service.sessionMap[widgetId][sessionId].session.getToolDefinition('vc_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');
    const toolResult = createTool.execute('tool-new-chat', { kind: 'kv', name: 'Temporary' }, undefined, undefined, {} as never);
    await waitForChatApproval(service, widgetId, sessionId);

    await service.newChatSession(widgetId, sessionId);

    expect(service.sessionMap[widgetId]).toBeUndefined();
    expect(() => service.listChatApprovals(widgetId, sessionId)).toThrow('No connected agent session');
    await toolResult;
  });

  test('shutdown invalidates in-flight connection generations before they can commit', async () => {
    const service = await createService();
    const connecting = service.connectChat('widget-stop', 'session-stop');
    const stopping = service.stop();

    await expect(connecting).rejects.toThrow('Agent service is stopping.');
    await stopping;
    expect(service.sessionMap).toEqual({});
  });
});
