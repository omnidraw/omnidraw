import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';

class TestEventPublisherService implements IEventPublisherService {
  name = 'test-event-publisher';
  agentEvents: TAgentEvent[] = [];

  publishDbEvent(canvasId: string, event: TDbEvent): void { void canvasId; void event; }
  async *subscribeDbEvents(canvasId: string): AsyncIterable<TDbEvent> { void canvasId; }
  publishActorEvent(event: TActorEvent): void { void event; }
  async *subscribeActorEvents(): AsyncIterable<TActorEvent> { }
  publishAgentEvent(event: TAgentEvent): void { this.agentEvents.push(event); }
  async *subscribeAgentEvents(): AsyncIterable<TAgentEvent> { yield* this.agentEvents; }
  publishFilesystemEvent(path: string, event: TFilesystemEvent): void { void path; void event; }
  async *subscribeFilesystemEvents(path: string): AsyncIterable<TFilesystemEvent> { void path; }
  publishNotification(event: TNotificationEvent): void { void event; }
  async *subscribeNotifications(): AsyncIterable<TNotificationEvent> { }
  getLatestNotification(): TNotificationEvent | null { return null; }
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createServiceFixture() {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-'));
  tempDirs.push(dataPath);

  const eventPublisher = new TestEventPublisherService();
  const service = new AgentService({
    cachePath: join(dataPath, 'cache'),
    dataPath,
    configPath: join(dataPath, 'config'),
    eventPublisherService: eventPublisher,
  });

  const widgetId = 'widget-a';
  const sessionId = 'session-a';
  const cwd = join(dataPath, 'pi', 'agent', 'widget-cwd', widgetId + sessionId);
  await mkdir(join(cwd, 'actor'), { recursive: true });
  await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
    slug: 'draft-test',
    name: 'Draft Test',
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: { count: 0 },
      inputMsgSchema: { ping: { type: 'object', additionalProperties: true } },
      outputMsgSchema: {},
      states: {
        ready: {
          on: {
            ping: {
              func: ['tx.increment'],
              allowedTargetStates: ['ready'],
            },
          },
        },
      },
    },
    widget: {
      relWidgetDir: './widget',
      tool: {
        label: 'Draft Test',
        behavior: { type: 'action' },
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(cwd, 'actor', 'functions.ts'), [
    'export default {',
    '  fn: {},',
    '  fx: {},',
    '  tx: {',
    '    "tx.increment": async (portal, args) => {',
    '      await portal.setData({ count: (args.data.count ?? 0) + 1 });',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n'), 'utf8');

  service.sessionMap[widgetId] = {
    [sessionId]: { unsub: () => {}, session: {} as never, sessionManager: {} as never },
  };

  return { service, eventPublisher, widgetId, sessionId };
}

describe('AgentService draft actor runtime', () => {
  test('starts, inspects, sends, resets, reloads, and stops a draft actor', async () => {
    const { service, eventPublisher, widgetId, sessionId } = await createServiceFixture();

    const startResult = await service.startDraftActorWizzard(widgetId, sessionId);
    expect(startResult.ready).toBe(true);
    if (!startResult.ready) throw new Error(startResult.message);
    expect(startResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const inspectResult = service.inspectDraftActorWizzard(widgetId, sessionId);
    expect(inspectResult.ready).toBe(true);
    if (!inspectResult.ready) throw new Error(inspectResult.message);
    expect(inspectResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const sendResult = service.sendDraftActorWizzard(widgetId, sessionId, 'ping', {});
    expect(sendResult.ready).toBe(true);
    if (!sendResult.ready) throw new Error(sendResult.message);
    expect(sendResult.messageId.length).toBeGreaterThan(0);

    await Bun.sleep(300);
    const afterSend = service.inspectDraftActorWizzard(widgetId, sessionId);
    expect(afterSend.ready).toBe(true);
    if (!afterSend.ready) throw new Error(afterSend.message);
    expect(afterSend.snapshot).toEqual({ state: 'ready', context: { count: 1 } });
    expect(eventPublisher.agentEvents.some((event) => 'kind' in event && event.kind === 'draft-actor')).toBe(true);

    const resetResult = await service.resetDraftActorWizzard(widgetId, sessionId);
    expect(resetResult.ready).toBe(true);
    if (!resetResult.ready) throw new Error(resetResult.message);
    expect(resetResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const reloadResult = await service.reloadDraftActorWizzard(widgetId, sessionId);
    expect(reloadResult.ready).toBe(true);
    if (!reloadResult.ready) throw new Error(reloadResult.message);
    expect(reloadResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    expect(service.stopDraftActorWizzard(widgetId, sessionId)).toEqual({ stopped: true });
    const stoppedInspect = service.inspectDraftActorWizzard(widgetId, sessionId);
    expect(stoppedInspect.ready).toBe(false);
  });

  test('returns not-ready when manifest is missing', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-missing-'));
    tempDirs.push(dataPath);
    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath: join(dataPath, 'config'),
      eventPublisherService: new TestEventPublisherService(),
    });
    service.sessionMap.widget = {
      session: { unsub: () => {}, session: {} as never, sessionManager: {} as never },
    };

    const result = await service.startDraftActorWizzard('widget', 'session');
    expect(result).toEqual({
      ready: false,
      reason: 'manifest-missing',
      message: 'Draft vibecanvas.json does not exist yet.',
    });
  });
});
