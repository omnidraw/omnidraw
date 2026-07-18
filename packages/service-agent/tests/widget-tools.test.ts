import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IEventPublisherService, TAgentEvent, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { AgentService } from '../src/AgentService';
import { fnBuildWidgetCreateManifest } from '../src/tools/fn.widget-create';
import { createWidgetWorkspaceTools } from '../src/tools/tool.widget-workspace';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { createFakeSessionManager, executeTool } from './tool.test-helpers';

class TestEvents implements IEventPublisherService {
  name = 'widget-test-events';
  publishDbEvent(_canvasId: string, _event: TDbEvent): void {}
  async *subscribeDbEvents(_canvasId: string): AsyncIterable<TDbEvent> {}
  publishActorEvent(_event: TActorEvent): void {}
  async *subscribeActorEvents(): AsyncIterable<TActorEvent> {}
  publishAgentEvent(_event: TAgentEvent): void {}
  async *subscribeAgentEvents(): AsyncIterable<TAgentEvent> {}
  publishFilesystemEvent(_path: string, _event: TFilesystemEvent): void {}
  async *subscribeFilesystemEvents(_path: string): AsyncIterable<TFilesystemEvent> {}
  publishNotification(_event: TNotificationEvent): void {}
  async *subscribeNotifications(): AsyncIterable<TNotificationEvent> {}
  getLatestNotification(): TNotificationEvent | null { return null; }
}

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vc-widget-tools-'));
  roots.push(root);
  const dataPath = join(root, 'data');
  const configPath = join(root, 'config');
  await mkdir(join(configPath, 'widgets'), { recursive: true });
  const workspace = new WidgetWorkspace({ dataPath, configPath });
  await workspace.init();
  return { root, dataPath, configPath, workspace };
}

async function createDiscoverableWidget(
  root: string,
  name: string,
  manifest: unknown = { name, kind: 'widget' },
) {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  const value = manifest as { name?: unknown; kind?: unknown };
  const content = typeof manifest === 'string'
    ? manifest
    : JSON.stringify(fnBuildWidgetCreateManifest({
        name: typeof value.name === 'string' ? value.name : name,
        kind: value.kind === 'actor-widget' ? value.kind : 'widget',
      }));
  await writeFile(join(folder, 'vibecanvas.json'), content, 'utf8');
}

function providerModelData(result: any): any {
  const text = result.content[0]?.text ?? '';
  const marker = 'Model data:\n';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing model data in: ${text}`);
  return JSON.parse(text.slice(start + marker.length));
}

describe('widget tools and publish integration', () => {
  test('lists drafts and published widgets with availability booleans, problems, and opaque stale cursors', async () => {
    const { workspace } = await fixture();
    await createDiscoverableWidget(workspace.draftRoot, 'Timer', { name: 'Timer', kind: 'actor-widget' });
    await createDiscoverableWidget(workspace.draftRoot, 'Weather', { name: 'Weather', kind: 'widget' });
    await createDiscoverableWidget(workspace.publishedRoot, 'Weather', { name: 'Weather', kind: 'widget' });
    await createDiscoverableWidget(workspace.publishedRoot, 'Published Only', { name: 'Published Only', kind: 'widget' });
    await createDiscoverableWidget(workspace.publishedRoot, 'Broken', '{bad json');
    await createDiscoverableWidget(workspace.draftRoot, 'Case', { name: 'Case', kind: 'widget' });
    await createDiscoverableWidget(workspace.publishedRoot, 'case', { name: 'case', kind: 'widget' });
    await workspace.loadWidget('chat-a', 'Timer');

    const list = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_list')!;
    expect(Object.keys((list.parameters as any).properties)).toEqual(['cursor', 'limit']);
    const first = await executeTool(list, { limit: 2 });
    const firstData = providerModelData(first);
    expect(firstData.totalCount).toBe(5);
    expect(firstData.widgets).toEqual([
      {
        name: 'Broken', kind: null, hasDraft: false, hasPublished: true, mountedInThisChat: false,
        problemCode: 'WIDGET_MANIFEST_INVALID',
      },
      {
        name: 'Case', kind: 'widget', hasDraft: true, hasPublished: true, mountedInThisChat: true,
        problemCode: 'WIDGET_NAME_AMBIGUOUS',
      },
    ]);
    expect(firstData.nextCursor).toStartWith('vw1.');
    expect(firstData.nextCursor).not.toContain('Case');
    expect(JSON.stringify(first)).not.toContain(workspace.draftRoot);
    expect(JSON.stringify(first)).not.toContain('vibecanvas.json');

    const all = providerModelData(await executeTool(list, { limit: 10 }));
    expect(all.widgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Timer', hasDraft: true, hasPublished: false }),
      expect.objectContaining({ name: 'Published Only', hasDraft: false, hasPublished: true }),
      expect.objectContaining({ name: 'Weather', hasDraft: true, hasPublished: true }),
    ]));
    expect(all.totalCount).toBe(5);

    await createDiscoverableWidget(workspace.draftRoot, 'Added Later');
    const stale = await executeTool(list, { cursor: firstData.nextCursor, limit: 2 });
    expect(providerModelData(stale)).toMatchObject({ error: { code: 'WIDGET_CURSOR_INVALID' } });

    let calls = 0;
    const denied = createWidgetWorkspaceTools({
      workspace,
      chatId: 'chat-a',
      authorize: async (name) => { calls += 1; return name !== 'vc_widget_list'; },
    }).find((tool) => tool.name === 'vc_widget_list')!;
    expect((await executeTool(denied, {})).isError).toBe(true);
    expect(calls).toBe(1);
  });

  test('creates a complete shared draft that another chat can validate without loading it', async () => {
    const { workspace } = await fixture();
    const mounted: string[] = [];
    const firstTools = createWidgetWorkspaceTools({
      workspace,
      chatId: 'chat-a',
      authorize: async () => true,
      onMounted: (mount) => mounted.push(mount.name),
    });
    const create = firstTools.find((tool) => tool.name === 'vc_widget_create')!;
    const created = await executeTool(create, { name: 'Shared Timer', kind: 'actor-widget', description: 'A shared timer.' });
    expect(created.isError).toBeUndefined();
    expect(created.content[0]?.text).toContain('"mountPath": "widgets/Shared Timer"');
    expect(created.content[0]?.text).toContain('"draft": true');
    expect(created.details.files).toEqual(expect.arrayContaining([
      'vibecanvas.json', 'package.json', 'tsconfig.json', 'actor/functions.ts', 'actor/types.ts', 'widget/main.ts', 'widget/main.css',
    ]));
    expect(mounted).toEqual(['Shared Timer']);
    expect(JSON.parse(await readFile(join(workspace.draftRoot, 'Shared Timer', 'vibecanvas.json'), 'utf8'))).toMatchObject({
      slug: 'shared-timer', name: 'Shared Timer', kind: 'actor-widget', description: 'A shared timer.',
    });
    expect(JSON.parse(await readFile(join(workspace.draftRoot, 'Shared Timer', 'package.json'), 'utf8'))).toMatchObject({
      dependencies: { '@vibecanvas/sdk': `file:${workspace.sdkPackagePath}` },
    });
    expect((await stat(join(workspace.sdkPackagePath, 'src', 'actor.ts'))).isFile()).toBe(true);

    const secondTools = createWidgetWorkspaceTools({ workspace, chatId: 'chat-b', authorize: async () => true });
    expect(secondTools.map((tool) => tool.name)).toEqual(['vc_widget_list', 'vc_widget_create', 'vc_widget_validate']);
    await workspace.ensureChat('chat-b');
    expect(await realpath(join(workspace.getChatRoot('chat-a'), 'widgets', 'Shared Timer')))
      .toBe(await realpath(join(workspace.getChatRoot('chat-b'), 'widgets', 'Shared Timer')));

    const validation = await executeTool(
      secondTools.find((tool) => tool.name === 'vc_widget_validate')!,
      { name: 'Shared Timer' },
    );
    expect(validation.details).toMatchObject({ name: 'Shared Timer', source: 'draft', ok: true });
    expect(validation.content[0]?.text).toContain('"ok": true');
    expect(validation.content[0]?.text).toContain('"errors": []');
    const unmounted = await executeTool(
      secondTools.find((tool) => tool.name === 'vc_widget_validate')!,
      { name: 'Not Loaded' },
    );
    expect(unmounted.isError).toBe(true);
  });

  test('does not expose published widgets until a backend draft exists', async () => {
    const { workspace } = await fixture();
    const published = join(workspace.publishedRoot, 'Weather');
    await mkdir(join(published, 'widget'), { recursive: true });
    await writeFile(join(published, 'vibecanvas.json'), `${JSON.stringify({ name: 'Weather' })}\n`, 'utf8');
    await writeFile(join(published, 'widget', 'main.ts'), 'published', 'utf8');
    const tools = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true });
    const validate = tools.find((tool) => tool.name === 'vc_widget_validate')!;

    const missingDraft = await executeTool(validate, { name: 'Weather' });
    expect(missingDraft.isError).toBe(true);
    expect(tools.some((tool) => tool.name === 'vc_widget_load')).toBe(false);

    await workspace.syncDraftFromPublished('chat-a', 'Weather');
    expect(await readFile(join(workspace.draftRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('published');
    expect(await realpath(join(workspace.getChatRoot('chat-a'), 'widgets', 'Weather')))
      .toBe(await realpath(join(workspace.draftRoot, 'Weather')));
  });

  test('rolls back failed first publish and preserves every draft mount', async () => {
    const { dataPath, configPath, workspace } = await fixture();
    const create = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_create')!;
    await executeTool(create, { name: 'Rollback Timer', kind: 'widget' });
    await workspace.loadWidget('chat-b', 'Rollback Timer');

    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEvents(),
      actorService: { reload: async () => { throw new Error('reload failed'); } },
    });
    service.sessionMap.widget = {
      'chat-a': { unsub: () => {}, session: {} as never, sessionManager: createFakeSessionManager() as never },
    };

    const result = await service.publishChat('widget', 'chat-a');
    expect(result).toMatchObject({ published: false, message: 'reload failed' });
    expect((await stat(join(workspace.draftRoot, 'Rollback Timer'))).isDirectory()).toBe(true);
    await expect(lstat(join(workspace.publishedRoot, 'Rollback Timer'))).rejects.toThrow();
    await expect(lstat(join(configPath, 'widgets', 'rollback-timer'))).rejects.toThrow();
    expect((await workspace.listMounts('chat-a'))[0]).toMatchObject({ name: 'Rollback Timer', source: 'draft' });
    expect((await workspace.listMounts('chat-b'))[0]).toMatchObject({ name: 'Rollback Timer', source: 'draft' });
  });

  test('rolls back first publish when post-reload binding reconciliation fails', async () => {
    const { dataPath, configPath, workspace } = await fixture();
    const create = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_create')!;
    await executeTool(create, { name: 'Binding Rollback', kind: 'widget' });
    await workspace.loadWidget('chat-b', 'Binding Rollback');
    let reloads = 0;

    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEvents(),
      actorService: {
        reload: async () => { reloads += 1; },
        listResourceBindingsForDefinition: async () => { throw new Error('binding reconciliation failed'); },
      },
    });
    service.sessionMap.widget = {
      'chat-a': { unsub: () => {}, session: {} as never, sessionManager: createFakeSessionManager() as never },
    };

    const result = await service.publishChat('widget', 'chat-a');
    expect(result).toMatchObject({ published: false, message: 'binding reconciliation failed' });
    expect(reloads).toBe(2);
    expect((await stat(join(workspace.draftRoot, 'Binding Rollback'))).isDirectory()).toBe(true);
    await expect(lstat(join(workspace.publishedRoot, 'Binding Rollback'))).rejects.toThrow();
    await expect(lstat(join(configPath, 'widgets', 'binding-rollback'))).rejects.toThrow();
    expect((await workspace.listMounts('chat-a'))[0]).toMatchObject({ name: 'Binding Rollback', source: 'draft' });
    expect((await workspace.listMounts('chat-b'))[0]).toMatchObject({ name: 'Binding Rollback', source: 'draft' });
  });

  test('first publish snapshots the draft while every chat remains mounted to the draft', async () => {
    const { dataPath, configPath, workspace } = await fixture();
    const create = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_create')!;
    await executeTool(create, { name: 'Published Timer', kind: 'widget' });
    await workspace.loadWidget('chat-b', 'Published Timer');

    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEvents(),
      actorService: { reload: async () => {} },
    });
    service.sessionMap.widget = {
      'chat-a': { unsub: () => {}, session: {} as never, sessionManager: createFakeSessionManager() as never },
    };

    const result = await service.publishChat('widget', 'chat-a');
    expect(result.published).toBe(true);
    expect((await workspace.listMounts('chat-a'))[0]).toMatchObject({ name: 'Published Timer', source: 'draft' });
    expect((await workspace.listMounts('chat-b'))[0]).toMatchObject({ name: 'Published Timer', source: 'draft' });
    expect(await realpath(join(workspace.getChatRoot('chat-a'), 'widgets', 'Published Timer')))
      .toBe(await realpath(join(workspace.draftRoot, 'Published Timer')));
    expect((await stat(join(configPath, 'widgets', 'published-timer'))).isDirectory()).toBe(true);
    expect((await stat(join(workspace.publishedRoot, 'Published Timer'))).isDirectory()).toBe(true);
    expect((await stat(join(workspace.draftRoot, 'Published Timer'))).isDirectory()).toBe(true);

    await writeFile(join(workspace.draftRoot, 'Published Timer', 'widget', 'main.css'), '.republished { color: red; }\n', 'utf8');
    const republished = await service.publishChat('widget', 'chat-a');
    expect(republished.published).toBe(true);
    expect(await readFile(join(workspace.publishedRoot, 'Published Timer', 'widget', 'main.css'), 'utf8')).toContain('.republished');
    expect(await readFile(join(configPath, 'widgets', 'published-timer', 'widget', 'main.css'), 'utf8')).toContain('.republished');
    expect((await workspace.listMounts('chat-a'))[0]).toMatchObject({ name: 'Published Timer', source: 'draft' });
  });

  test('restores the previous canonical and installed widget when an existing publish fails after copy', async () => {
    const { dataPath, configPath, workspace } = await fixture();
    const create = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_create')!;
    await executeTool(create, { name: 'Atomic Timer', kind: 'widget' });
    let rejectReload = false;
    const service = new AgentService({
      cachePath: join(dataPath, 'cache'),
      dataPath,
      configPath,
      eventPublisherService: new TestEvents(),
      actorService: { reload: async () => { if (rejectReload) throw new Error('reload failed'); } },
    });
    service.sessionMap.widget = {
      'chat-a': { unsub: () => {}, session: {} as never, sessionManager: createFakeSessionManager() as never },
    };

    expect((await service.publishChat('widget', 'chat-a')).published).toBe(true);
    await writeFile(join(workspace.draftRoot, 'Atomic Timer', 'widget', 'main.css'), '.new-draft { color: red; }\n', 'utf8');
    rejectReload = true;

    const failed = await service.publishChat('widget', 'chat-a');
    expect(failed).toMatchObject({ published: false, message: 'reload failed' });
    expect(await readFile(join(workspace.draftRoot, 'Atomic Timer', 'widget', 'main.css'), 'utf8')).toContain('.new-draft');
    expect(await readFile(join(workspace.publishedRoot, 'Atomic Timer', 'widget', 'main.css'), 'utf8')).not.toContain('.new-draft');
    expect(await readFile(join(configPath, 'widgets', 'atomic-timer', 'widget', 'main.css'), 'utf8')).not.toContain('.new-draft');
  });
});
