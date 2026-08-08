import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { fxLatestWidgetResourceSelectionRecord } from '../src/core/fx.session-records';
import { createFakeSessionManager } from './tool.test-helpers';
import { WIDGET_CHAT_SYSTEM_PROMPT } from '../src/prompts';
import { createTestChats, createTestEvents } from './service.fixture';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(
  resourceService?: ConstructorParameters<typeof AgentService>[0]['resourceService'],
  authorizeToolCall?: ConstructorParameters<typeof AgentService>[0]['authorizeToolCall'],
  chats = createTestChats(),
) {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-prompt-'));
  tempDirs.push(dataPath);

  return new AgentService({
    dataPath,
    widgetDraftsRoot: join(dataPath, 'widgets', 'drafts'),
    eventPublisherService: createTestEvents(),
    chats,
    resourceService,
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
  test('teaches widget agents the browser-first Capsule and short-function contract', () => {
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('"schemaVersion": 1');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('"$schema": "https://omnidraw.dev/schemas/widget/v1.json"');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('"tool": {');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toMatch(/schemaVersion"?\s*:\s*[34]/);
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toMatch(/manifest[- ]v[34]/i);
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('"runtime": "capsule"');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('"apis": ["DOM"]');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Omit `server` and `resources` for a UI-only widget');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('UI-only widgets start no backend process');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('defineServerFunction');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`fn` is deterministic and has no resources');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`fx` may read only declared resource slots');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`tx` may perform declared writes');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Draft Preview runs the same Capsule UI path');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`localStore` is `none` or `ephemeral`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('`localStore` is `none`, `ephemeral`, or `snapshot`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Use `context.resources.read` or `context.resources.write`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('ordinary SQLite-compatible');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('od_widget_create({ name, description?, template?, server? })');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`template: "react"`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`server: true`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Read only files you need to change');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Do not call `bash`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('not a confinement boundary');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain("Omnidraw host process's filesystem");
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Shell access does not manufacture approval');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('generated manifest, package, lockfile, Vite config');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Do not import `@omnidraw/capsule/guest` directly');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('React is the pre-tested component-library path');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`react` and `react-dom` to exactly `19.2.7`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Other npm libraries may be added with exact versions');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Vite compiles `.tsx`/`.jsx`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('frozen `npm ci`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('guest-owned `npm run build`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('does not install dependencies or compile source');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Package lifecycle hooks and the build script execute with the build-server');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('retain the generated direct');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`@omnidraw/capsule` dependency');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`["DOM", "WEBGL"]`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('canvas-webgl-v1');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`three` to exactly `0.185.1`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('rely on the `WEBGL` group defaults');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('explicitly indexed');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`THREE.RawShaderMaterial`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('not ambient `drawArrays`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('measured `messageBytes`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('do not use built-in lit/PBR materials');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('do not use `THREE.Clock`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('monotonic timestamp passed to each');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('independent of');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('successful browser Preview execution');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('custom properties and');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`var()` fallbacks');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('not part of the signed artifact');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('exact Capsule');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain(
      'Capsule does not admit CSS custom-property references',
    );
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('subscribeWidgetTheme()');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('`document.body` is already the application');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Every intermediate');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('empty, loading, or error state');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('background: var(--card)');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('generated manifest, package, lockfile, Vite config');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('do not edit it manually');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Update the draft with `read`, `edit`, or `patch`');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Run `od_widget_validate`; it performs the frozen install');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('vc_widget_preview_wait');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('vc_widget_preview_test');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('live Preview interaction was not tested');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('The AI cannot');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).toContain('Publish or **Republish**');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('draft Preview title bar or draft detail page');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('frame-owned Preview revision');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('actor');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toMatch(/\barrow(?:js)?\b/i);
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('od_widget_create({ name, kind');
    expect(WIDGET_CHAT_SYSTEM_PROMPT).not.toContain('choose `widget` or `actor-widget`');
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
      getResource: async (id) => ({
        id,
        kind: id === 'kv-1' ? 'kv' : 'db',
        name: id === 'kv-1' ? 'Preferences' : 'Notes Database',
        status: 'ready',
        lastError: null,
        createdAtSec: '2026-01-01 00:00:00',
        updatedAtSec: '2026-01-01 00:00:00',
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
  });

  test('keeps the exact phase-free registry across reconnect and continuation errors', async () => {
    const service = await createService();
    const widgetId = 'widget-tools';
    const sessionId = 'session-tools';
    await service.connectChat(widgetId, sessionId);

    const expectedTools = [
      'bash', 'edit', 'grep', 'od_resource_create', 'od_resource_data_read',
      'od_resource_data_write', 'od_resource_delete', 'od_resource_inspect', 'od_resource_list',
      'od_resource_update', 'od_widget_create', 'od_widget_list', 'od_widget_validate', 'patch', 'read',
      'web_fetch',
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
      createResource: async ({ kind, name }) => ({
        id: 'resource-1',
        kind,
        name,
        status: 'ready',
        lastError: null,
        createdAtSec: '2026-07-18 00:00:00',
        updatedAtSec: '2026-07-18 00:00:00',
      }),
    });
    const widgetId = 'widget-reuse';
    const sessionId = 'session-reuse';
    await service.connectChat(widgetId, sessionId);
    const originalEntry = service.sessionMap[widgetId][sessionId];
    const createTool = originalEntry.session.getToolDefinition('od_resource_create');
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
      createResource: async ({ kind, name }) => ({
        id: 'resource-2',
        kind,
        name,
        status: 'ready',
        lastError: null,
        createdAtSec: '2026-07-18 00:00:00',
        updatedAtSec: '2026-07-18 00:00:00',
      }),
    });
    const widgetId = 'widget-replace';
    const sessionId = 'session-replace';
    await service.connectChat(widgetId, sessionId);
    const originalEntry = service.sessionMap[widgetId][sessionId];
    const createTool = originalEntry.session.getToolDefinition('od_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');

    const toolResult = createTool.execute('tool-replace', { kind: 'kv', name: 'Cache' }, undefined, undefined, {} as never);
    const approval = await waitForChatApproval(service, widgetId, sessionId);
    const firstReplacement = service.connectChat(widgetId, sessionId, 'replace');
    const secondReplacement = service.connectChat(widgetId, sessionId, 'replace');

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

    const replacement = service.connectChat(widgetId, sessionId, 'replace');
    const laterReuse = service.connectChat(widgetId, sessionId, 'reuse');
    await Promise.all([replacement, laterReuse]);

    expect(service.sessionMap[widgetId][sessionId]).not.toBe(originalEntry);
  });

  test('retains one durable chat metadata row with portable relative paths', async () => {
    const chats = createTestChats();
    const service = await createService(undefined, undefined, chats);
    const widgetId = 'widget-metadata';
    const sessionId = 'session-metadata';

    await service.connectChat(widgetId, sessionId);
    const created = chats.records.get(sessionId);
    expect(created).toMatchObject({
      id: sessionId,
      canvasId: null,
      name: 'AI Chat',
      status: 'active',
    });
    expect(created?.workspaceRelativePath).toMatch(/^pi\/agent\/chats\//);
    expect(created?.historyRelativePath).toMatch(/^pi\/agent\/chats\//);
    await service.connectChat(widgetId, sessionId);
    expect(chats.records.size).toBe(1);
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
      createResource: async ({ kind, name }) => ({
        id: 'resource-new-chat',
        kind,
        name,
        status: 'ready',
        lastError: null,
        createdAtSec: '2026-07-18 00:00:00',
        updatedAtSec: '2026-07-18 00:00:00',
      }),
    });
    const widgetId = 'widget-new-chat';
    const sessionId = 'session-new-chat';
    await service.connectChat(widgetId, sessionId);
    const createTool = service.sessionMap[widgetId][sessionId].session.getToolDefinition('od_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');
    const toolResult = createTool.execute('tool-new-chat', { kind: 'kv', name: 'Temporary' }, undefined, undefined, {} as never);
    await waitForChatApproval(service, widgetId, sessionId);

    await service.newChatSession(widgetId, sessionId);

    expect(service.sessionMap[widgetId]).toBeUndefined();
    expect(() => service.listChatApprovals(widgetId, sessionId)).toThrow('No connected agent session');
    await toolResult;
  });

  test('edits an active middle user turn by entry ID, preserves images, and reconnects to the new branch', async () => {
    const service = await createService();
    const externalStateDir = await mkdtemp(join(tmpdir(), 'vc-agent-edit-external-state-'));
    tempDirs.push(externalStateDir);
    const externalStatePath = join(externalStateDir, 'workspace-and-canvas-state.json');
    const externalState = '{"canvasItems":["kept"],"widgetDraft":"kept","resource":"kept"}\n';
    await writeFile(externalStatePath, externalState);
    const widgetId = 'widget-edit';
    const sessionId = 'session-edit';
    await service.connectChat(widgetId, sessionId);
    const entry = service.sessionMap[widgetId][sessionId];
    const manager = entry.sessionManager;
    const firstUserId = manager.appendMessage({ role: 'user', content: 'duplicate', timestamp: 1 });
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'first answer' }],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 2,
    });
    const secondUserId = manager.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'duplicate' },
        { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
      ],
      timestamp: 3,
    });
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'abandoned answer' }],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 4,
    });

    const promptCalls: Array<{ text: string; options?: { images?: unknown[] } }> = [];
    entry.session.prompt = (async (text: string, options?: { images?: unknown[] }) => {
      promptCalls.push({ text, options });
      manager.appendMessage({
        role: 'user',
        content: options?.images?.length
          ? [{ type: 'text', text }, ...(options.images as Array<{ type: 'image'; mimeType: string; data: string }>)]
          : text,
        timestamp: 5,
      });
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'replacement answer' }],
        api: 'test',
        provider: 'test',
        model: 'test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: 6,
      });
    }) as never;

    const edited = await service.editChatMessage(widgetId, sessionId, secondUserId, 'corrected');
    expect(promptCalls).toEqual([{
      text: 'corrected',
      options: { images: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }] },
    }]);
    expect(edited.map((item) => item.entryId)).toContain(firstUserId);
    expect(edited.map((item) => item.message).some((message) => JSON.stringify(message).includes('abandoned answer'))).toBe(false);
    expect(manager.getBranch().some((branchEntry) => branchEntry.type === 'branch_summary')).toBe(false);

    const reconnected = await service.connectChat(widgetId, sessionId);
    expect(reconnected.messageHistory).toEqual(edited);
    expect(await readFile(externalStatePath, 'utf8')).toBe(externalState);
    expect(manager.getEntries().some((branchEntry) => (
      branchEntry.type === 'message'
      && branchEntry.message.role === 'assistant'
      && JSON.stringify(branchEntry.message).includes('abandoned answer')
    ))).toBe(true);
  });

  test('rejects stale, inactive, assistant, and empty text-only edit targets before branching', async () => {
    const service = await createService();
    const widgetId = 'widget-invalid-edit';
    const sessionId = 'session-invalid-edit';
    await service.connectChat(widgetId, sessionId);
    const entry = service.sessionMap[widgetId][sessionId];
    const manager = entry.sessionManager;
    const userId = manager.appendMessage({ role: 'user', content: 'keep me', timestamp: 1 });
    const assistantId = manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      api: 'test',
      provider: 'test',
      model: 'test',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 2,
    });
    const leafBefore = manager.getLeafId();

    await expect(service.editChatMessage(widgetId, sessionId, 'foreign', 'changed')).rejects.toThrow('not on the active chat branch');
    await expect(service.editChatMessage(widgetId, sessionId, assistantId, 'changed')).rejects.toThrow('not on the active chat branch');
    await expect(service.editChatMessage(widgetId, sessionId, userId, '   ')).rejects.toThrow('at least one preserved image');
    expect(manager.getLeafId()).toBe(leafBefore);
  });

  test('rejects prompt, reconnect, new-session, and duplicate-edit races for the same chat', async () => {
    const service = await createService();
    const widgetId = 'widget-edit-race';
    const sessionId = 'session-edit-race';
    await service.connectChat(widgetId, sessionId);
    const entry = service.sessionMap[widgetId][sessionId];
    const manager = entry.sessionManager;
    const userId = manager.appendMessage({ role: 'user', content: 'original', timestamp: 1 });

    let releasePrompt: (() => void) | undefined;
    entry.session.prompt = (async (text: string) => {
      manager.appendMessage({ role: 'user', content: text, timestamp: 2 });
      await new Promise<void>((resolve) => { releasePrompt = resolve });
    }) as never;

    const activePrompt = service.promptChat(widgetId, sessionId, 'running prompt');
    await expect(service.editChatMessage(widgetId, sessionId, userId, 'blocked edit')).rejects.toThrow('operation is already active');
    await expect(service.connectChat(widgetId, sessionId, 'replace')).rejects.toThrow('operation is already active');
    await expect(service.newChatSession(widgetId, sessionId)).rejects.toThrow('operation is already active');
    releasePrompt?.();
    await activePrompt;

    let releaseEdit: (() => void) | undefined;
    entry.session.prompt = (async (text: string) => {
      manager.appendMessage({ role: 'user', content: text, timestamp: 3 });
      await new Promise<void>((resolve) => { releaseEdit = resolve });
    }) as never;
    const activeEdit = service.editChatMessage(widgetId, sessionId, userId, 'first edit');
    for (let attempt = 0; attempt < 20 && !releaseEdit; attempt += 1) await Promise.resolve();
    await expect(service.editChatMessage(widgetId, sessionId, userId, 'second edit')).rejects.toThrow('operation is already active');
    await expect(service.promptChat(widgetId, sessionId, 'racing prompt')).rejects.toThrow('operation is already active');
    releaseEdit?.();
    await activeEdit;
  });

  test('waits for a pre-stream history edit to become abortable before canceling it', async () => {
    const service = await createService();
    const widgetId = 'widget-edit-cancel';
    const sessionId = 'session-edit-cancel';
    await service.connectChat(widgetId, sessionId);
    const entry = service.sessionMap[widgetId][sessionId];
    const manager = entry.sessionManager;
    const userId = manager.appendMessage({ role: 'user', content: 'original', timestamp: 1 });
    const navigateTree = entry.session.navigateTree.bind(entry.session);
    let releaseNavigation: (() => void) | undefined;
    let navigationStarted = false;
    entry.session.navigateTree = (async (...args: Parameters<typeof entry.session.navigateTree>) => {
      navigationStarted = true;
      await new Promise<void>((resolve) => { releaseNavigation = resolve });
      return navigateTree(...args);
    }) as typeof entry.session.navigateTree;

    let streaming = false;
    let releasePrompt: (() => void) | undefined;
    let abortCalls = 0;
    Object.defineProperty(entry.session, 'isStreaming', { configurable: true, get: () => streaming });
    entry.session.prompt = (async () => {
      streaming = true;
      await new Promise<void>((resolve) => { releasePrompt = resolve });
    }) as never;
    entry.session.abort = (async () => {
      abortCalls += 1;
      streaming = false;
      releasePrompt?.();
    }) as never;

    const activeEdit = service.editChatMessage(widgetId, sessionId, userId, 'corrected');
    for (let attempt = 0; attempt < 20 && !navigationStarted; attempt += 1) await Promise.resolve();
    const cancel = service.cancelChat(widgetId, sessionId);
    let cancelSettled = false;
    void cancel.finally(() => { cancelSettled = true });
    await Promise.resolve();
    expect(cancelSettled).toBe(false);

    releaseNavigation?.();
    await expect(cancel).resolves.toEqual({ canceled: true, running: false });
    expect(abortCalls).toBe(1);
    await activeEdit;
  });

  test('makes pending approvals from the abandoned tail stale when an edit branches', async () => {
    const service = await createService({
      createResource: async ({ kind, name }) => ({
        id: 'resource-abandoned',
        kind,
        name,
        status: 'ready',
        lastError: null,
        createdAtSec: '2026-08-08 00:00:00',
        updatedAtSec: '2026-08-08 00:00:00',
      }),
    });
    const widgetId = 'widget-edit-approval';
    const sessionId = 'session-edit-approval';
    await service.connectChat(widgetId, sessionId);
    const entry = service.sessionMap[widgetId][sessionId];
    const manager = entry.sessionManager;
    const userId = manager.appendMessage({ role: 'user', content: 'create a resource', timestamp: 1 });
    const createTool = entry.session.getToolDefinition('od_resource_create');
    if (!createTool) throw new Error('Resource create tool was not registered.');
    const abandonedTool = createTool.execute('tool-abandoned', { kind: 'kv', name: 'Abandoned' }, undefined, undefined, {} as never);
    await waitForChatApproval(service, widgetId, sessionId);
    entry.session.prompt = (async (text: string) => {
      manager.appendMessage({ role: 'user', content: text, timestamp: 2 });
    }) as never;

    await service.editChatMessage(widgetId, sessionId, userId, 'do something else');

    expect(service.listChatApprovals(widgetId, sessionId)).toEqual([]);
    const abandonedResult = await abandonedTool;
    expect((abandonedResult as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(abandonedResult.content)).toContain('abandoned chat branch');
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
