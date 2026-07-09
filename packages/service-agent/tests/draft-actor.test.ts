import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import { ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE, ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE } from '../src/tools/CONSTANTS';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
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
  await mkdir(join(cwd, 'widget'), { recursive: true });
  await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
    slug: 'draft-test',
    name: 'Draft Test',
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: { count: 0 },
      inputMsgSchema: {
        ping: { type: 'object', additionalProperties: true },
        'in.resetError': { type: 'object', additionalProperties: true },
      },
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
        error: {
          on: {
            'in.resetError': {
              func: ['tx.resetError'],
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
    '    "tx.resetError": async () => {},',
    '  },',
    '};',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(cwd, 'widget', 'main.ts'), [
    'import { html } from "@arrow-js/core";',
    'html`<p>Draft widget</p>`(document.body);',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(cwd, 'widget', 'main.css'), [
    'p { color: red; }',
    '',
  ].join('\n'), 'utf8');

  service.sessionMap[widgetId] = {
    [sessionId]: { unsub: () => {}, session: {} as never, sessionManager: { getEntries: () => [] } as never },
  };

  return { service, eventPublisher, widgetId, sessionId };
}

describe('AgentService draft actor runtime', () => {
  test('starts editing a published widget from a copied bumped draft', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-edit-'));
    tempDirs.push(dataPath);
    const configPath = join(dataPath, 'config');
    const publishedRoot = join(configPath, 'widgets', 'counter-widget');
    await mkdir(join(publishedRoot, 'actor'), { recursive: true });
    await mkdir(join(publishedRoot, 'widget'), { recursive: true });
    await mkdir(join(publishedRoot, 'node_modules', 'ignored'), { recursive: true });

    const manifest: TVibecanvasJson & { manifest_path: string } = {
      slug: 'counter-widget',
      name: 'Counter Widget',
      version: '1.2.3',
      description: 'Published counter',
      manifest_path: 'widgets/counter-widget/vibecanvas.json',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: { count: 0 },
        states: {},
      },
      widget: {
        relWidgetDir: './widget',
        tool: { label: 'Counter', behavior: { type: 'action' } },
      },
    };
    await writeFile(join(publishedRoot, 'vibecanvas.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(publishedRoot, 'actor', 'functions.ts'), 'export default { fn: {}, fx: {}, tx: {} };\n', 'utf8');
    await writeFile(join(publishedRoot, 'widget', 'main.ts'), 'export default null;\n', 'utf8');
    await writeFile(join(publishedRoot, 'node_modules', 'ignored', 'file.js'), 'ignored\n', 'utf8');

    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEventPublisherService(),
      actorService: {
        reload: async () => {},
        getVibecanvasJson: () => manifest,
      },
    });

    const result = await service.startWidgetEditWizzard('widget-edit', 'session-edit', 'Counter Widget');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.phase).toBe('implementation');
    expect(result.vcJson.version).toBe('1.2.4');
    expect(result.editSession.sourceName).toBe('Counter Widget');
    expect(result.editSession.previousVersion).toBe('1.2.3');
    expect(result.messageHistory.some((message) => {
      const record = message as unknown as Record<string, unknown>;
      return record.role === 'custom' && record.content === '[Widget Counter Widget loaded]';
    })).toBe(true);
    expect(service.sessionMap['widget-edit']['session-edit'].session.getActiveToolNames().sort()).toEqual(['edit', 'grep', 'read', 'vc_publish_widget', 'vc_validate_widget_files', 'web_fetch']);

    const draftRoot = join(dataPath, 'pi', 'agent', 'widget-cwd', 'widget-editsession-edit');
    const draftManifest = JSON.parse(await readFile(join(draftRoot, 'vibecanvas.json'), 'utf8'));
    expect(draftManifest.version).toBe('1.2.4');
    await expect(readFile(join(draftRoot, 'node_modules', 'ignored', 'file.js'), 'utf8')).rejects.toThrow();

    const sourceManifest = JSON.parse(await readFile(join(publishedRoot, 'vibecanvas.json'), 'utf8'));
    expect(sourceManifest.version).toBe('1.2.3');

    const entries = service.sessionMap['widget-edit']['session-edit'].sessionManager.getEntries();
    expect(entries.some((entry) => entry.type === 'custom' && entry.customType === ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE)).toBe(true);

    const reconnectResult = await service.connectWizzard('widget-edit', 'session-edit');
    expect(reconnectResult.messageHistory.some((message) => {
      const record = message as unknown as Record<string, unknown>;
      return record.role === 'custom' && record.content === '[Widget Counter Widget loaded]';
    })).toBe(true);
    expect(service.sessionMap['widget-edit']['session-edit'].session.getActiveToolNames().sort()).toEqual(['edit', 'grep', 'read', 'vc_publish_widget', 'vc_validate_widget_files', 'web_fetch']);
  });

  test('reads phase 1 manifest from actor candidate and patches only phase 2 vibecanvas.json', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-manifest-'));
    tempDirs.push(dataPath);
    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath: join(dataPath, 'config'),
      eventPublisherService: new TestEventPublisherService(),
    });
    const widgetId = 'widget-manifest';
    const sessionId = 'session-manifest';
    const cwd = join(dataPath, 'pi', 'agent', 'widget-cwd', widgetId + sessionId);
    await mkdir(cwd, { recursive: true });

    const manifest: TVibecanvasJson = {
      slug: 'candidate-test',
      name: 'Candidate Test',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: { count: 0 },
        dataSchema: { type: 'object' },
        states: {},
      },
      widget: {
        relWidgetDir: './widget-ui',
        tool: { label: 'Candidate Test', behavior: { type: 'action' } },
      },
    };
    const entries = [{
      type: 'custom',
      customType: ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE,
      data: { revision: 1, candidate: {} as never, manifest, validation: { ok: true }, updatedAt: 'now' },
    }];
    service.sessionMap[widgetId] = {
      [sessionId]: { unsub: () => {}, session: {} as never, sessionManager: { getEntries: () => entries } as never },
    };

    expect(await service.readDraftManifestWizzard(widgetId, sessionId)).toEqual({ ready: true, source: 'actor-candidate', manifest });
    expect(await service.patchDraftManifestWizzard(widgetId, sessionId, { name: 'No File Yet' })).toEqual({
      ok: false,
      reason: 'manifest-missing',
      message: 'Draft vibecanvas.json does not exist yet. Approve the actor candidate first before editing the manifest file.',
    });

    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const patchResult = await service.patchDraftManifestWizzard(widgetId, sessionId, { name: 'Patched Test', initialData: { count: 1 } });
    expect(patchResult.ok).toBe(true);
    if (!patchResult.ok) throw new Error(patchResult.message);
    expect(patchResult.manifest.name).toBe('Patched Test');
    expect(patchResult.manifest.actor.initialData).toEqual({ count: 1 });
    expect(await service.readDraftManifestWizzard(widgetId, sessionId)).toEqual({ ready: true, source: 'file', manifest: patchResult.manifest });
  });

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

  test('returns widget source files as filename to content map', async () => {
    const { service, widgetId, sessionId } = await createServiceFixture();

    const result = await service.previewSourceWizzard(widgetId, sessionId);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error(result.message);

    expect(Object.keys(result.sources).sort()).toEqual(['main.css', 'main.ts']);
    expect(result.sources['main.ts']).toContain('Draft widget');
    expect(result.sources['main.css']).toContain('color: red');
  });

  test('emits widget update event after publishing draft', async () => {
    const { service, eventPublisher, widgetId, sessionId } = await createServiceFixture();

    const result = await service.publishWizzard(widgetId, sessionId);
    expect(result.published).toBe(true);
    if (!result.published) throw new Error(result.message);

    const updateEvent = eventPublisher.agentEvents.find((event) => 'kind' in event && event.kind === 'widgetupdate');
    expect(updateEvent).toEqual({
      kind: 'widgetupdate',
      widgetId,
      sessionId,
      cwd: result.destination,
      files: result.files,
    });
  });

  test('patches draft tool icon metadata and rejects invalid lucid keys', async () => {
    const { service, widgetId, sessionId } = await createServiceFixture();

    const validLucid = await service.patchDraftManifestWizzard(widgetId, sessionId, {
      tool: { icon: { lucidIcon: 'Activity' } },
    });
    expect(validLucid.ok).toBe(true);
    if (!validLucid.ok) throw new Error(validLucid.message);
    expect(validLucid.manifest.widget.tool.icon).toEqual({ lucidIcon: 'Activity' });

    const customText = await service.patchDraftManifestWizzard(widgetId, sessionId, {
      tool: { icon: { svgIcon: '🔢' } },
    });
    expect(customText.ok).toBe(true);
    if (!customText.ok) throw new Error(customText.message);
    expect(customText.manifest.widget.tool.icon).toEqual({ svgIcon: '🔢' });

    const invalidLucid = await service.patchDraftManifestWizzard(widgetId, sessionId, {
      tool: { icon: { lucidIcon: 'not-a-lucide-icon' } },
    });
    expect(invalidLucid.ok).toBe(false);
    if (invalidLucid.ok) throw new Error('Expected invalid lucid icon patch to fail');
    expect(invalidLucid.reason).toBe('edit-invalid');
    expect(invalidLucid.issues?.some((issue) => issue.includes('widget.tool.icon.lucidIcon'))).toBe(true);

    const cleared = await service.patchDraftManifestWizzard(widgetId, sessionId, {
      tool: { icon: null },
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.manifest.widget.tool.icon).toBeUndefined();
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
