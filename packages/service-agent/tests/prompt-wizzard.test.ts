import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { txAppendActorCandidateApprovalRecord } from '../src/core/tx.session-candidate';
import { fxEffectiveWidgetDraftResourceBindingSelectionRecord, fxLatestWidgetResourceSelectionRecord } from '../src/core/fx.session-candidate';
import { createFakeSessionManager, executeTool, sampleCandidate } from './tool.test-helpers';
import { createProposeDbChangeTool } from '../src/tools/tool.propose-db-change';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { WIDGET_WIZZARD_SYSTEM_PROMPT } from '../src/prompts';

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

describe('AgentService.promptWizzard', () => {
  test('teaches widget agents the actor lifecycle and activity contract', () => {
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('New transitions use `{ func: ["tx.name"], targetState: "ready" }`');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('Never write a loop or sleep/retry cycle inside it');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('args.msg.kind === "activity.tick"');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('recover: { targetState: "ready" }');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('accepted only so existing widgets keep working');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('widget.tool.group: omit by default');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('actor.resources: optional definition-level map');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('portal.resources.kv("slot")');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('Secret values are currently stored as plaintext');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('portal.resources.db("notes").invoke');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('DB slots are schema-agnostic');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).toContain('ordinary SQLite-compatible');
    expect(WIDGET_WIZZARD_SYSTEM_PROMPT).not.toContain('Host-published DbResource schema context');
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

    await service.promptWizzard('widget', 'session', '', {
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

    await expect(service.promptWizzard('widget', 'session', 'describe this', {
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

    await service.promptWizzard('widget', 'session', 'Use @Notes Database', { resourceIds: ['db-1'] });
    expect(fxLatestWidgetResourceSelectionRecord({ sessionManager: sessionManager as never }, {})).toEqual({
      resources: [{ id: 'db-1', kind: 'db', name: 'Notes Database', status: 'ready' }],
      selectedAt: expect.any(String),
    });
    await service.promptWizzard('widget', 'session', 'Do not use a resource now', { resourceIds: [] });
    expect(fxLatestWidgetResourceSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([]);
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([
      { id: 'db-1', kind: 'db', name: 'Notes Database', status: 'ready' },
    ]);
    const proposal = await executeTool(createProposeDbChangeTool({
      sessionManager: sessionManager as never,
      actorService: {
        reload: async () => {},
        getResource: async () => null,
      },
    }), { resourceId: 'db-1', sql: 'DROP TABLE notes;', reason: 'No longer authorized.' });
    expect(proposal.isError).toBe(true);
    expect(proposal.content[0].text).toContain('@mention');
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

    await service.promptWizzard('widget', 'session', 'Use these resources', { resourceIds: ['db-1', 'kv-1'] });
    await service.promptWizzard('widget', 'session', 'Switch to @Manual QA Database', { resourceIds: ['db-2'] });
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})?.resources).toEqual([
      { id: 'kv-1', kind: 'kv', name: 'Preferences', status: 'ready' },
      { id: 'db-2', kind: 'db', name: 'Manual QA Database', status: 'ready' },
    ]);

    expect(service.clearDraftResourceBindingsWizzard('widget', 'session')).toEqual({ cleared: true });
    expect(fxEffectiveWidgetDraftResourceBindingSelectionRecord({ sessionManager: sessionManager as never }, {})).toMatchObject({
      resources: [],
      source: 'explicit-clear',
    });
  });

  test('refreshes phase tools after approval before the next prompt', async () => {
    const service = await createService();
    const widgetId = 'widget-tools';
    const sessionId = 'session-tools';
    await service.connectWizzard(widgetId, sessionId);

    const phaseOneTools = service.sessionMap[widgetId][sessionId].session.getActiveToolNames();
    expect(phaseOneTools.sort()).toEqual(['vc_approve_actor_candidate', 'vc_inspect_resource', 'vc_list_resources', 'vc_propose_db_change', 'vc_set_actor_candidate', 'web_fetch']);

    const manifest = {
      slug: 'counter-widget',
      name: 'Counter Widget',
      description: 'A generated counter widget.',
      actor: {
        ...sampleCandidate().actor,
        relFunctionPath: './actor/functions.ts',
      },
      widget: {
        relWidgetDir: './widget',
        tool: sampleCandidate().widget.tool,
      },
    };

    txAppendActorCandidateApprovalRecord({ sessionManager: service.sessionMap[widgetId][sessionId].sessionManager }, {
      candidateRevision: 1,
      manifest,
      files: ['vibecanvas.json'],
      approvedAt: new Date().toISOString(),
    });

    await expect(service.promptWizzard(widgetId, sessionId, 'implement this', {
      images: [{ mimeType: 'image/svg+xml', data: 'PHN2Zy8+' }],
    })).rejects.toThrow('Unsupported prompt image MIME type: image/svg+xml');

    const phaseTwoTools = service.sessionMap[widgetId][sessionId].session.getActiveToolNames();
    expect(phaseTwoTools.sort()).toEqual(['edit', 'grep', 'read', 'vc_inspect_resource', 'vc_list_resources', 'vc_propose_db_change', 'vc_publish_widget', 'vc_validate_widget_files', 'web_fetch']);
  });
});
