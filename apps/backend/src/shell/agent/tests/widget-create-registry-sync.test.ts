import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWidgetWorkspaceTools } from '../tools/tool.widget-workspace';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { LocalWidgetPackageRegistrySync } from '../../widget/LocalWidgetPackageRegistrySync';
import { executeTool } from './tool.test-helpers';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const roots: string[] = [];
const CHAT_ID = testChatId('widget-create-registry-sync');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(
  prepareNpmDependencies: (signal?: AbortSignal) => Promise<void>,
): Promise<Readonly<{ root: string; workspace: WidgetWorkspace }>> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-create-sync-'));
  roots.push(root);
  const workspace = new WidgetWorkspace({
    ...testWorkspaceWorld(),
    dataPath: join(root, 'agent'),
    draftRoot: join(root, 'widgets', 'drafts'),
    prepareNpmDependencies,
  });
  await workspace.init();
  return { root, workspace };
}

function createTool(
  workspace: WidgetWorkspace,
  events: string[],
  chatId = CHAT_ID,
) {
  return createWidgetWorkspaceTools({
    workspace,
    chatId,
    authorize: async () => true,
    npmInstall: async (cwd) => {
      events.push('install');
      await writeFile(join(cwd, 'package-lock.json'), '{}\n');
      return { status: 'success' as const, stdout: '', stderr: '' };
    },
    onMounted: () => {
      events.push('mounted');
    },
    onDraftChanged: async () => {
      events.push('catalog changed');
    },
    previewBuild: async () => {
      events.push('initial build');
      return { ok: true, errors: [] };
    },
  }).find((tool) => tool.name === 'od_widget_create')!;
}

describe('od_widget_create local package synchronization', () => {
  test('synchronizes before install and promotes, mounts, and builds the validated draft', async () => {
    const events: string[] = [];
    const { workspace } = await createFixture(async () => {
      events.push('registry sync');
    });

    const result = await executeTool(createTool(workspace, events), {
      name: 'Pomodoro',
      description: 'A compact focus timer.',
    });

    expect(result.isError).not.toBe(true);
    expect(events).toEqual([
      'registry sync',
      'install',
      'mounted',
      'catalog changed',
      'initial build',
    ]);
    expect((await lstat(join(workspace.draftRoot, 'pomodoro'))).isDirectory()).toBe(true);
    expect((await lstat(join(
      workspace.getChatRoot(CHAT_ID),
      'widgets',
      'Pomodoro',
    ))).isSymbolicLink()).toBe(true);
    expect(await readdir(workspace.transientRoot)).toEqual([]);
  });

  test('a synchronization failure leaves no draft, mount, or transient scaffold', async () => {
    const events: string[] = [];
    const message = 'Local widget package synchronization is unavailable: expected registry script at /missing/scripts/local-registry.mjs.';
    const { workspace } = await createFixture(async () => {
      events.push('registry sync');
      throw new Error(message);
    });

    const result = await executeTool(createTool(workspace, events), {
      name: 'Pomodoro',
    });

    expect(result.isError).toBe(true);
    const output = result.content[0]?.text ?? '';
    expect(output.match(/expected registry script/g)).toHaveLength(1);
    expect(events).toEqual(['registry sync']);
    expect(await readdir(workspace.draftRoot)).toEqual([]);
    expect(await readdir(join(workspace.getChatRoot(CHAT_ID), 'widgets'))).toEqual([]);
    expect(await readdir(workspace.transientRoot)).toEqual([]);
  });

  test('concurrent live create paths coalesce the first process-local synchronization', async () => {
    let calls = 0;
    let executing!: () => void;
    const started = new Promise<void>((resolve) => { executing = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const registry = new LocalWidgetPackageRegistrySync({
      repositoryRoot: '/workspace',
      stat: async () => ({ isFile: () => true }),
      execute: async () => {
        calls += 1;
        executing();
        await blocked;
      },
    });
    const { workspace } = await createFixture((signal) => registry.sync(signal));
    const events: string[] = [];
    const first = executeTool(createTool(workspace, events, testChatId('concurrent-a')), {
      name: 'Concurrent A',
    });
    const second = executeTool(createTool(workspace, events, testChatId('concurrent-b')), {
      name: 'Concurrent B',
    });
    await started;
    expect(calls).toBe(1);
    release();
    const results = await Promise.all([first, second]);

    expect(results.every((result) => result.isError !== true)).toBe(true);
    expect(calls).toBe(1);
    expect(events.filter((event) => event === 'install')).toHaveLength(2);
    expect((await lstat(join(workspace.draftRoot, 'concurrent-a'))).isDirectory()).toBe(true);
    expect((await lstat(join(workspace.draftRoot, 'concurrent-b'))).isDirectory()).toBe(true);
    expect(await readdir(workspace.transientRoot)).toEqual([]);
  });

  test('a cancelled synchronization returns one bounded create failure and removes its scaffold', async () => {
    let started!: () => void;
    const preparing = new Promise<void>((resolve) => { started = resolve; });
    const { workspace } = await createFixture(async (signal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        const cancel = () => reject(new Error('Local widget package synchronization was cancelled.'));
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
      });
    });
    const controller = new AbortController();
    const tool = createTool(workspace, []);
    const pending = tool.execute('tool-call', { name: 'Cancelled Widget' }, controller.signal);
    await preparing;
    controller.abort();
    const result = await pending;

    expect(result.isError).toBe(true);
    const output = result.content[0]?.text ?? '';
    expect(output.match(/WIDGET_CREATE_FAILED/g)).toHaveLength(1);
    expect(output.length).toBeLessThan(5_000);
    expect(await readdir(workspace.draftRoot)).toEqual([]);
    expect(await readdir(workspace.transientRoot)).toEqual([]);
  });

  test('the next workspace owner reclaims an interrupted direct create scaffold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-create-restart-'));
    roots.push(root);
    const config = {
      ...testWorkspaceWorld(),
      dataPath: join(root, 'agent'),
      draftRoot: join(root, 'widgets', 'drafts'),
    };
    const previous = new WidgetWorkspace(config);
    await previous.init();
    const orphan = 'create-efdb2b40-9a34-49c5-8677-74f51dbb3bf4';
    await mkdir(join(previous.transientRoot, orphan));
    await writeFile(join(previous.transientRoot, orphan, 'omnidraw.json'), '{}\n');

    const restarted = new WidgetWorkspace(config);
    await restarted.init();

    expect(await readdir(restarted.transientRoot)).toEqual([]);
    expect(await readdir(restarted.draftRoot)).toEqual([]);
    expect(await readdir(join(restarted.getChatRoot(CHAT_ID), 'widgets')).catch(() => [])).toEqual([]);
  });

  test('startup cleanup unlinks escaping owned-name symlinks and ignores foreign entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-create-cleanup-'));
    roots.push(root);
    const workspace = new WidgetWorkspace({
      ...testWorkspaceWorld(),
      dataPath: join(root, 'agent'),
      draftRoot: join(root, 'widgets', 'drafts'),
    });
    await mkdir(workspace.transientRoot, { recursive: true });
    const external = join(root, 'external');
    await mkdir(external);
    await writeFile(join(external, 'sentinel'), 'keep\n');
    const ownedDirectory = 'create-bca81fb3-8802-4bf8-a110-53d3ec240fd6';
    const ownedSymlink = 'create-44e69e7e-aa86-4999-9e61-eb47d895ae64';
    await mkdir(join(workspace.transientRoot, ownedDirectory));
    await symlink(external, join(workspace.transientRoot, ownedSymlink));
    await mkdir(join(workspace.transientRoot, 'foreign'));
    await mkdir(join(workspace.transientRoot, 'foreign', 'create-nested'));
    await mkdir(join(workspace.transientRoot, 'create-'));
    await writeFile(join(workspace.transientRoot, 'create-regular-file'), 'foreign\n');
    await mkdir(join(workspace.draftRoot, 'create-draft-name'), { recursive: true });

    await workspace.init();

    expect(await lstat(join(workspace.transientRoot, ownedDirectory)).catch(() => null)).toBeNull();
    expect(await lstat(join(workspace.transientRoot, ownedSymlink)).catch(() => null)).toBeNull();
    expect((await lstat(external)).isDirectory()).toBe(true);
    expect((await lstat(join(external, 'sentinel'))).isFile()).toBe(true);
    expect((await lstat(join(workspace.transientRoot, 'foreign', 'create-nested'))).isDirectory()).toBe(true);
    expect((await lstat(join(workspace.transientRoot, 'create-'))).isDirectory()).toBe(true);
    expect((await lstat(join(workspace.transientRoot, 'create-regular-file'))).isFile()).toBe(true);
    expect((await lstat(join(workspace.draftRoot, 'create-draft-name'))).isDirectory()).toBe(true);
  });
});
