import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { txAppendActorCandidateApprovalRecord } from '../src/core/tx.session-candidate';
import { sampleCandidate } from './tool.test-helpers';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { WIDGET_WIZZARD_SYSTEM_PROMPT } from '../src/prompts';
import { fxBuildDbSchemaContextPrompt } from '../src/fx.db-schema-context';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

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

async function createService() {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-prompt-'));
  tempDirs.push(dataPath);

  return new AgentService({
    cachePath: join(dataPath, 'cache'),
    dataPath,
    configPath: join(dataPath, 'config'),
    eventPublisherService: new TestEventPublisherService(),
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
  });

  test('supplies exact published DbResource migrations through the declared version', async () => {
    const base = sampleCandidate();
    const manifest: TVibecanvasJson = {
      slug: 'db-widget',
      name: 'DB Widget',
      actor: {
        ...base.actor,
        relFunctionPath: './actor/functions.ts',
        resources: {
          notes: {
            kind: 'db',
            required: true,
            scope: ['read'],
            schema: { id: 'notes', version: 2 },
          },
        },
      },
      widget: { relWidgetDir: './widget', tool: base.widget.tool },
    };
    const calls: Array<[string, number]> = [];
    const sql = 'CREATE TABLE notes (id TEXT);\nINSERT INTO notes VALUES ("seed");';
    const prompt = await fxBuildDbSchemaContextPrompt({
      getDbSchemaContext: async (schemaId, version) => {
        calls.push([schemaId, version]);
        return {
          schema: { id: schemaId, name: 'Notes', description: 'Shared notes.', status: 'published' },
          migrations: [
            { schema_id: schemaId, version: 1, name: 'initial', sql, checksum: 'sha256:first', status: 'published' },
            { schema_id: schemaId, version: 2, name: 'index', sql: 'CREATE INDEX notes_id ON notes(id);', checksum: 'sha256:second', status: 'published' },
          ],
        };
      },
    }, { manifest });

    expect(calls).toEqual([['notes', 2]]);
    expect(prompt).toContain('# Host-published DbResource schema context');
    expect(prompt).toContain('## notes@2 — Notes');
    expect(prompt).toContain(JSON.stringify(sql));
    expect(prompt).toContain('sha256:second');
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

  test('refreshes phase tools after approval before the next prompt', async () => {
    const service = await createService();
    const widgetId = 'widget-tools';
    const sessionId = 'session-tools';
    await service.connectWizzard(widgetId, sessionId);

    const phaseOneTools = service.sessionMap[widgetId][sessionId].session.getActiveToolNames();
    expect(phaseOneTools.sort()).toEqual(['vc_approve_actor_candidate', 'vc_set_actor_candidate', 'web_fetch']);

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
    expect(phaseTwoTools.sort()).toEqual(['edit', 'grep', 'read', 'vc_publish_widget', 'vc_validate_widget_files', 'web_fetch']);
  });
});
