import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../src/AgentService';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { createFakeSessionManager } from './tool.test-helpers';

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

async function createMountedWidgetRoot(args: {
  dataPath: string;
  sessionId: string;
  name: string;
}): Promise<string> {
  const root = join(args.dataPath, 'pi', 'agent', 'widget-drafts', args.name);
  const widgetsRoot = join(args.dataPath, 'pi', 'agent', 'shared-cwd', 'widgets');
  await mkdir(join(args.dataPath, 'pi', 'agent', 'widget-cwd'), { recursive: true });
  await mkdir(join(args.dataPath, 'pi', 'agent', 'widget-drafts'), { recursive: true });
  await mkdir(root, { recursive: true });
  await mkdir(widgetsRoot, { recursive: true });
  await symlink(root, join(widgetsRoot, args.name), 'dir');
  return root;
}

async function createServiceFixture(actorService?: ConstructorParameters<typeof AgentService>[0]['actorService']) {
  const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-'));
  tempDirs.push(dataPath);

  const eventPublisher = new TestEventPublisherService();
  const service = new AgentService({
    cachePath: join(dataPath, 'cache'),
    dataPath,
    configPath: join(dataPath, 'config'),
    eventPublisherService: eventPublisher,
    actorService,
  });

  const widgetId = 'widget-a';
  const sessionId = 'session-a';
  const cwd = await createMountedWidgetRoot({ dataPath, sessionId, name: 'Draft Test' });
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
  test('keeps the mentioned database bound after a mentionless continuation prompt', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-resource-continuation-'));
    tempDirs.push(dataPath);
    const widgetId = 'manual-qa-data-viewer';
    const sessionId = 'resource-continuation';
    const cwd = await createMountedWidgetRoot({ dataPath, sessionId, name: 'Manual QA Data Viewer' });
    await mkdir(join(cwd, 'actor'), { recursive: true });
    await mkdir(join(cwd, 'widget'), { recursive: true });

    const resources = [
      {
        id: 'qa-database',
        kind: 'db' as const,
        name: 'QA Database',
        status: 'ready' as const,
        last_error: null,
        created_at: '2026-07-13T00:00:00.000Z',
        updated_at: '2026-07-13T00:00:00.000Z',
      },
      {
        id: 'manual-qa-database',
        kind: 'db' as const,
        name: 'Manual QA Database',
        status: 'ready' as const,
        last_error: null,
        created_at: '2026-07-13T00:00:00.000Z',
        updated_at: '2026-07-13T00:00:00.000Z',
      },
    ];
    const directCalls: Array<{ call: unknown; binding: unknown }> = [];
    const persistedBindings: unknown[] = [];
    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath: join(dataPath, 'config'),
      eventPublisherService: new TestEventPublisherService(),
      actorService: {
        reload: async () => {},
        listResources: async () => resources,
        getResource: async (id) => resources.find((resource) => resource.id === id) ?? null,
        bindResource: async (binding) => { persistedBindings.push(binding); return {}; },
        callWithDirectResourceBinding: async (call, binding) => {
          directCalls.push({ call, binding });
          return [
            { id: 1n, title: 'First QA row' },
            { id: 250n, title: 'Last QA row' },
          ];
        },
      },
    });
    const sessionManager = createFakeSessionManager();
    service.sessionMap[widgetId] = {
      [sessionId]: {
        unsub: () => {},
        sessionManager: sessionManager as never,
        session: { prompt: async () => {} } as never,
      },
    };

    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
      slug: 'manual-qa-data-viewer',
      name: 'Manual QA Data Viewer',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: { loaded: false, rows: [] },
        resources: {
          database: {
            kind: 'db',
            required: true,
            scope: ['read'],
            arbitrarySql: false,
            operations: {
              listQaRows: {
                effect: 'read',
                sql: 'SELECT id, title FROM qa_rows ORDER BY id',
                result: 'rows',
              },
            },
          },
        },
        states: {
          ready: { onEnter: ['fx.loadRows'], on: {} },
          error: {
            on: {
              'in.resetError': { func: ['tx.resetError'], targetState: 'ready' },
            },
          },
        },
        inputMsgSchema: {
          'in.resetError': { type: 'object', additionalProperties: false },
        },
        outputMsgSchema: {},
      },
      widget: {
        relWidgetDir: './widget',
        tool: { label: 'Manual QA rows', behavior: { type: 'action' } },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(cwd, 'actor', 'functions.ts'), [
      'export default {',
      '  fn: {},',
      '  fx: {',
      '    "fx.loadRows": async (portal, args) => {',
      '      const rows = await portal.resources.db("database").invoke("listQaRows", {});',
      '      await portal.setData({ ...args.data, loaded: true, rows: rows.map((row) => ({ id: String(row.id), title: row.title })) });',
      '      return portal.next();',
      '    },',
      '  },',
      '  tx: { "tx.resetError": async () => {} },',
      '};',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(cwd, 'widget', 'main.ts'), 'export default null;\n', 'utf8');
    await writeFile(join(cwd, 'widget', 'main.css'), ':root {}\n', 'utf8');

    await service.promptChat(widgetId, sessionId, 'Use @Manual QA Database', {
      resourceIds: ['manual-qa-database'],
    });
    await service.promptChat(widgetId, sessionId, 'yes continue', { resourceIds: [] });

    const startResult = await service.startDraftActorChat(widgetId, sessionId);
    expect(startResult.ready).toBe(true);
    if (!startResult.ready) throw new Error(startResult.message);

    let snapshot = service.inspectDraftActorChat(widgetId, sessionId);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (snapshot.ready && (snapshot.snapshot.context as { loaded?: boolean }).loaded === true) break;
      await Bun.sleep(10);
      snapshot = service.inspectDraftActorChat(widgetId, sessionId);
    }

    expect(snapshot).toMatchObject({
      ready: true,
      snapshot: {
        state: 'ready',
        context: {
          loaded: true,
          rows: [
            { id: '1', title: 'First QA row' },
            { id: '250', title: 'Last QA row' },
          ],
        },
      },
    });
    expect(directCalls).toHaveLength(1);
    expect(directCalls[0]).toMatchObject({
      call: { slot: 'database', kind: 'db', operation: 'invoke' },
      binding: {
        resourceId: 'manual-qa-database',
        requirement: { kind: 'db', required: true, scope: ['read'] },
        scope: ['read'],
      },
    });
    const publishResult = await service.publishChat(widgetId, sessionId);
    if (!publishResult.published) throw new Error(publishResult.message);
    expect(publishResult.published).toBe(true);
    expect(persistedBindings).toEqual([{
      definitionName: 'Manual QA Data Viewer',
      slot: 'database',
      resourceId: 'manual-qa-database',
      scope: ['read'],
    }]);
  });

  test('preserves the actor-service receiver during implicit Preview resource discovery', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-resource-receiver-'));
    tempDirs.push(dataPath);
    const widgetId = 'implicit-resource-widget';
    const sessionId = 'implicit-resource-session';
    const cwd = await createMountedWidgetRoot({ dataPath, sessionId, name: 'Implicit Resource Widget' });
    await mkdir(join(cwd, 'actor'), { recursive: true });
    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
      slug: 'implicit-resource-widget',
      name: 'Implicit Resource Widget',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: {},
        resources: {
          store: { kind: 'kv', required: true, scope: ['read', 'write'] },
        },
        states: { ready: { on: {} }, error: { on: {} } },
        inputMsgSchema: {},
        outputMsgSchema: {},
      },
      widget: { relWidgetDir: './widget', tool: { label: 'Implicit resource', behavior: { type: 'action' } } },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(cwd, 'actor', 'functions.ts'), 'export default { fn: {}, fx: {}, tx: {} };\n', 'utf8');

    class StatefulActorService {
      readonly resources = [{
        id: 'only-kv',
        kind: 'kv' as const,
        name: 'Only KV',
        status: 'ready' as const,
        last_error: null,
        created_at: '2026-07-14T00:00:00.000Z',
        updated_at: '2026-07-14T00:00:00.000Z',
      }];

      async reload() {}
      async listResources() { return this.resources; }
      async callWithDirectResourceBinding() {}
    }

    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath: join(dataPath, 'config'),
      eventPublisherService: new TestEventPublisherService(),
      actorService: new StatefulActorService(),
    });
    service.sessionMap[widgetId] = {
      [sessionId]: {
        unsub: () => {},
        session: {} as never,
        sessionManager: createFakeSessionManager() as never,
      },
    };

    try {
      const result = await service.startDraftActorChat(widgetId, sessionId);
      expect(result.ready).toBe(true);
    } finally {
      service.stopDraftActorChat(widgetId, sessionId);
    }
  });

  test('refuses Preview before actor startup when required binding intent is ambiguous', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'vc-agent-draft-resource-ambiguous-'));
    tempDirs.push(dataPath);
    const widgetId = 'ambiguous-resource-widget';
    const sessionId = 'ambiguous-resource-session';
    const cwd = await createMountedWidgetRoot({ dataPath, sessionId, name: 'Ambiguous Resource Widget' });
    await mkdir(join(cwd, 'actor'), { recursive: true });
    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
      slug: 'ambiguous-resource-widget',
      name: 'Ambiguous Resource Widget',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: {},
        resources: {
          database: { kind: 'db', required: true, scope: ['read'], arbitrarySql: false, operations: {} },
        },
        states: { ready: { on: {} }, error: { on: {} } },
        inputMsgSchema: {},
        outputMsgSchema: {},
      },
      widget: { relWidgetDir: './widget', tool: { label: 'Ambiguous', behavior: { type: 'action' } } },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(cwd, 'actor', 'functions.ts'), 'export default { fn: {}, fx: {}, tx: {} };\n', 'utf8');
    let gatewayCalls = 0;
    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath: join(dataPath, 'config'),
      eventPublisherService: new TestEventPublisherService(),
      actorService: {
        reload: async () => {},
        listResources: async () => ['qa', 'manual'].map((id) => ({
          id,
          kind: 'db' as const,
          name: id === 'qa' ? 'QA Database' : 'Manual QA Database',
          status: 'ready' as const,
          last_error: null,
          created_at: '2026-07-13T00:00:00.000Z',
          updated_at: '2026-07-13T00:00:00.000Z',
        })),
        callWithDirectResourceBinding: async () => { gatewayCalls += 1; return []; },
      },
    });
    service.sessionMap[widgetId] = {
      [sessionId]: {
        unsub: () => {},
        session: {} as never,
        sessionManager: createFakeSessionManager() as never,
      },
    };

    const result = await service.startDraftActorChat(widgetId, sessionId);
    expect(result).toMatchObject({
      ready: false,
      reason: 'resource-binding-invalid',
    });
    if (result.ready) throw new Error('Expected ambiguous binding to block Preview');
    expect(result.message).toContain('@mention');
    expect(service.inspectDraftActorChat(widgetId, sessionId)).toMatchObject({ ready: false, reason: 'actor-not-running' });
    expect(gatewayCalls).toBe(0);
  });

  test('starts editing a published widget through a synced shared draft mount', async () => {
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

    const result = await service.startWidgetEditChat('widget-edit', 'session-edit', 'Counter Widget');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.vcJson.version).toBe('1.2.3');
    expect(result.editSession.sourceName).toBe('Counter Widget');
    expect(result.editSession.previousVersion).toBe('1.2.3');
    expect(service.sessionMap['widget-edit']['session-edit'].sessionManager.getEntries().some((entry) => (
      entry.type === 'custom' && entry.customType === 'vibecanvas.activeWidgetMount'
    ))).toBe(true);
    expect(service.sessionMap['widget-edit']['session-edit'].session.getActiveToolNames().sort()).toEqual([
      'edit', 'grep', 'patch', 'read', 'vc_resource_create', 'vc_resource_data_read',
      'vc_resource_data_write', 'vc_resource_delete', 'vc_resource_inspect', 'vc_resource_list',
      'vc_resource_update', 'vc_widget_create', 'vc_widget_validate', 'web_fetch',
    ]);

    const canonicalRoot = join(dataPath, 'pi', 'agent', 'widget-cwd', 'Counter Widget');
    const draftRoot = join(dataPath, 'pi', 'agent', 'widget-drafts', 'Counter Widget');
    const canonicalManifest = JSON.parse(await readFile(join(canonicalRoot, 'vibecanvas.json'), 'utf8'));
    expect(canonicalManifest.version).toBe('1.2.3');
    await expect(readFile(join(canonicalRoot, 'node_modules', 'ignored', 'file.js'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(dataPath, 'pi', 'agent', 'shared-cwd', 'widgets', 'Counter Widget', 'vibecanvas.json'), 'utf8'))
      .toBe(await readFile(join(draftRoot, 'vibecanvas.json'), 'utf8'));
    expect(await readFile(join(draftRoot, 'vibecanvas.json'), 'utf8')).toBe(await readFile(join(canonicalRoot, 'vibecanvas.json'), 'utf8'));

    const sourceManifest = JSON.parse(await readFile(join(publishedRoot, 'vibecanvas.json'), 'utf8'));
    expect(sourceManifest.version).toBe('1.2.3');

    const reconnectResult = await service.connectChat('widget-edit', 'session-edit');
    expect(reconnectResult.vcJson?.name).toBe('Counter Widget');
    expect(service.sessionMap['widget-edit']['session-edit'].session.getActiveToolNames()).toHaveLength(14);
  });

  test('reads and patches the mounted manifest as the only current authority', async () => {
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
    const cwd = await createMountedWidgetRoot({ dataPath, sessionId, name: 'Candidate Test' });
    const manifest: TVibecanvasJson = {
      slug: 'candidate-test',
      name: 'Candidate Test',
      actor: {
        relFunctionPath: './actor/functions.ts',
        initialState: 'ready',
        initialData: { count: 0 },
        resources: { storage: { kind: 'kv', required: true, scope: ['read', 'write'] } },
        states: { ready: { on: {} }, error: { on: {} } },
        inputMsgSchema: {},
        outputMsgSchema: {},
      },
      widget: { relWidgetDir: './widget', tool: { label: 'Candidate Test', behavior: { type: 'action' } } },
    };
    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const sessionManager = createFakeSessionManager();
    service.sessionMap[widgetId] = {
      [sessionId]: { unsub: () => {}, session: {} as never, sessionManager: sessionManager as never },
    };

    expect(await service.readDraftManifestChat(widgetId, sessionId)).toEqual({ ready: true, source: 'file', manifest });
    const patchResult = await service.patchDraftManifestChat(widgetId, sessionId, {
      tool: {
        label: 'Saved Mounted Tool',
        group: 'Saved',
        priority: 3,
      },
      initialData: { count: 1 },
    });
    expect(patchResult.ok).toBe(true);
    if (!patchResult.ok) throw new Error(patchResult.message);
    expect(patchResult.source).toBe('file');
    expect(patchResult.manifest.widget.tool.label).toBe('Saved Mounted Tool');
    expect(patchResult.manifest.widget.tool.group).toBe('Saved');
    expect(patchResult.manifest.widget.tool.priority).toBe(3);
    expect(patchResult.manifest.actor.initialData).toEqual({ count: 1 });
    expect(await service.readDraftManifestChat(widgetId, sessionId)).toEqual({ ready: true, source: 'file', manifest: patchResult.manifest });

    const renameResult = await service.patchDraftManifestChat(widgetId, sessionId, { name: 'Patched Test' });
    expect(renameResult).toMatchObject({ ok: false, reason: 'edit-invalid' });
  });

  test('starts, inspects, sends, resets, reloads, and stops a draft actor', async () => {
    const { service, eventPublisher, widgetId, sessionId } = await createServiceFixture();

    const startResult = await service.startDraftActorChat(widgetId, sessionId);
    expect(startResult.ready).toBe(true);
    if (!startResult.ready) throw new Error(startResult.message);
    expect(startResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const inspectResult = service.inspectDraftActorChat(widgetId, sessionId);
    expect(inspectResult.ready).toBe(true);
    if (!inspectResult.ready) throw new Error(inspectResult.message);
    expect(inspectResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const sendResult = service.sendDraftActorChat(widgetId, sessionId, 'ping', {});
    expect(sendResult.ready).toBe(true);
    if (!sendResult.ready) throw new Error(sendResult.message);
    expect(sendResult.messageId.length).toBeGreaterThan(0);

    await Bun.sleep(300);
    const afterSend = service.inspectDraftActorChat(widgetId, sessionId);
    expect(afterSend.ready).toBe(true);
    if (!afterSend.ready) throw new Error(afterSend.message);
    expect(afterSend.snapshot).toEqual({ state: 'ready', context: { count: 1 } });
    expect(eventPublisher.agentEvents.some((event) => 'kind' in event && event.kind === 'draft-actor')).toBe(true);

    const resetResult = await service.resetDraftActorChat(widgetId, sessionId);
    expect(resetResult.ready).toBe(true);
    if (!resetResult.ready) throw new Error(resetResult.message);
    expect(resetResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    const reloadResult = await service.reloadDraftActorChat(widgetId, sessionId);
    expect(reloadResult.ready).toBe(true);
    if (!reloadResult.ready) throw new Error(reloadResult.message);
    expect(reloadResult.snapshot).toEqual({ state: 'ready', context: { count: 0 } });

    expect(service.stopDraftActorChat(widgetId, sessionId)).toEqual({ stopped: true });
    const stoppedInspect = service.inspectDraftActorChat(widgetId, sessionId);
    expect(stoppedInspect.ready).toBe(false);
  });

  test('returns widget source files as filename to content map', async () => {
    const { service, widgetId, sessionId } = await createServiceFixture();

    const result = await service.previewSourceChat(widgetId, sessionId);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error(result.message);

    expect(Object.keys(result.sources).sort()).toEqual(['main.css', 'main.ts']);
    expect(result.sources['main.ts']).toContain('Draft widget');
    expect(result.sources['main.css']).toContain('color: red');
  });

  test('emits widget update event after publishing draft', async () => {
    const { service, eventPublisher, widgetId, sessionId } = await createServiceFixture();

    const result = await service.publishChat(widgetId, sessionId);
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

  test('service publish removes persisted bindings for slots deleted from the manifest', async () => {
    const persistedBindings = new Map([['removed-database', 'db-old']]);
    const { service, widgetId, sessionId } = await createServiceFixture({
      reload: async () => {},
      listResourceBindingsForDefinition: async () => [...persistedBindings].map(([slot_name, resource_id]) => ({ slot_name, resource_id })),
      unbindResource: async ({ slot }) => persistedBindings.delete(slot),
    });

    const result = await service.publishChat(widgetId, sessionId);

    expect(result.published).toBe(true);
    expect(persistedBindings.size).toBe(0);
  });

  test('patches draft tool icon metadata and rejects invalid lucid keys', async () => {
    const { service, widgetId, sessionId } = await createServiceFixture();

    const validLucid = await service.patchDraftManifestChat(widgetId, sessionId, {
      tool: { icon: { lucidIcon: 'Activity' } },
    });
    expect(validLucid.ok).toBe(true);
    if (!validLucid.ok) throw new Error(validLucid.message);
    expect(validLucid.manifest.widget.tool.icon).toEqual({ lucidIcon: 'Activity' });

    const customText = await service.patchDraftManifestChat(widgetId, sessionId, {
      tool: { icon: { svgIcon: '🔢' } },
    });
    expect(customText.ok).toBe(true);
    if (!customText.ok) throw new Error(customText.message);
    expect(customText.manifest.widget.tool.icon).toEqual({ svgIcon: '🔢' });

    const invalidLucid = await service.patchDraftManifestChat(widgetId, sessionId, {
      tool: { icon: { lucidIcon: 'not-a-lucide-icon' } },
    });
    expect(invalidLucid.ok).toBe(false);
    if (invalidLucid.ok) throw new Error('Expected invalid lucid icon patch to fail');
    expect(invalidLucid.reason).toBe('edit-invalid');
    expect(invalidLucid.issues?.some((issue) => issue.includes('widget.tool.icon.lucidIcon'))).toBe(true);

    const cleared = await service.patchDraftManifestChat(widgetId, sessionId, {
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

    const result = await service.startDraftActorChat('widget', 'session');
    expect(result).toEqual({
      ready: false,
      reason: 'manifest-missing',
      message: "Draft vibecanvas.json does not exist for widget 'widget' and session 'session'",
    });
  });
});
