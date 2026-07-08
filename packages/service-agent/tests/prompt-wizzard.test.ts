import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { txAppendActorCandidateApprovalRecord } from '../src/core/tx.session-candidate';
import { sampleCandidate } from './tool.test-helpers';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';

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
    expect(phaseOneTools.sort()).toEqual(['vc_approve_actor_candidate', 'vc_set_actor_candidate']);

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
    expect(phaseTwoTools.sort()).toEqual(['edit', 'grep', 'read', 'vc_publish_widget', 'vc_validate_widget_files']);
  });
});
