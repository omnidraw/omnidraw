import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { fnNormalizeWidgetName } from '../src/workspace/fn.names';
import { createWorkspaceFileTools } from '../src/tools/tool.workspace-files';
import { executeTool } from './tool.test-helpers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createWorkspace(platform?: NodeJS.Platform) {
  const root = await mkdtemp(join(tmpdir(), 'vc-widget-workspace-'));
  temporaryRoots.push(root);
  const dataPath = join(root, 'data');
  const configPath = join(root, 'config');
  await mkdir(join(configPath, 'widgets'), { recursive: true });
  let sequence = 0;
  const workspace = new WidgetWorkspace({
    dataPath,
    configPath,
    platform,
    createId: () => `id-${++sequence}`,
  });
  await workspace.init();
  return { root, dataPath, configPath, workspace };
}

async function createWidgetFolder(root: string, name: string, content = 'initial') {
  const folder = join(root, name);
  await mkdir(join(folder, 'widget'), { recursive: true });
  await writeFile(join(folder, 'vibecanvas.json'), `${JSON.stringify({ name })}\n`, 'utf8');
  await writeFile(join(folder, 'widget', 'main.ts'), content, 'utf8');
  return folder;
}

describe('widget names', () => {
  test('normalizes human-readable spacing and rejects unsafe or reserved names', () => {
    expect(fnNormalizeWidgetName('  Shared   Weather  ')).toEqual({
      ok: true,
      value: 'Shared Weather',
      caseKey: 'shared weather',
    });
    expect(fnNormalizeWidgetName('../Weather').ok).toBe(false);
    expect(fnNormalizeWidgetName('CON').ok).toBe(false);
    expect(fnNormalizeWidgetName('bad/name').ok).toBe(false);
    expect(fnNormalizeWidgetName('bad\u0000name').ok).toBe(false);
  });
});

describe('WidgetWorkspace', () => {
  test('uses one persistent workspace per chat with stable identity metadata', async () => {
    const { workspace } = await createWorkspace();
    const first = await workspace.ensureChat('chat-a');
    expect(await readdir(join(first, 'widgets'))).toEqual([]);
    expect(await workspace.ensureChat('chat-a')).toBe(first);
    const second = await workspace.ensureChat('chat-b');
    expect(second).not.toBe(first);
    expect(first).toEndWith('chats/legacy/chat-a/workspace');
    expect(JSON.parse(await readFile(join(first, '..', 'chat.json'), 'utf8'))).toEqual({
      version: 1, sessionId: 'chat-a', legacy: true,
    });
  });

  test('groups dated chat IDs directly and fails closed on metadata mismatch', async () => {
    const { workspace } = await createWorkspace();
    const sessionId = '2026-07-18T07-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e';
    const root = await workspace.ensureChat(sessionId);
    expect(root).toEndWith(`chats/2026-07-18/${sessionId}/workspace`);
    const metadataPath = join(root, '..', 'chat.json');
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual({
      version: 1,
      sessionId,
      createdAt: '2026-07-18T07:51:37.118Z',
      legacy: false,
    });
    await writeFile(metadataPath, `${JSON.stringify({ version: 1, sessionId: 'other', legacy: false })}\n`, 'utf8');
    await expect(workspace.ensureChat(sessionId)).rejects.toThrow('does not match');
    await expect(workspace.ensureChat('2026-02-30T07-51-37-118Z--cebc287c-52c5-4658-a3ff-6f968af1401e')).rejects.toThrow('invalid');
  });

  test('reconciles shared drafts into concurrent independent chat workspaces', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Weather');
    const roots = await Promise.all([
      workspace.ensureChat('chat-a'),
      workspace.ensureChat('chat-b'),
      workspace.ensureChat('chat-c'),
    ]);
    expect(new Set(roots).size).toBe(3);
    for (const root of roots) {
      expect(await readdir(join(root, 'widgets'))).toEqual(['Weather']);
      expect(await realpath(join(root, 'widgets', 'Weather'))).toBe(await realpath(join(workspace.draftRoot, 'Weather')));
    }
  });

  test('reconciles a missing canonical published folder without overwriting it later', async () => {
    const { workspace, configPath } = await createWorkspace();
    await createWidgetFolder(join(configPath, 'widgets'), 'weather-installed', 'installed-v1');
    await writeFile(
      join(configPath, 'widgets', 'weather-installed', 'vibecanvas.json'),
      `${JSON.stringify({ name: 'Weather' })}\n`,
      'utf8',
    );
    expect(await workspace.reconcilePublishedWidgets()).toMatchObject({ created: ['Weather'] });
    await writeFile(join(workspace.publishedRoot, 'Weather', 'widget', 'main.ts'), 'canonical-edit', 'utf8');
    await workspace.reconcilePublishedWidgets();
    expect(await readFile(join(workspace.publishedRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('canonical-edit');
  });

  test('never exposes a partial canonical folder when reconciliation copy fails', async () => {
    const { workspace, configPath } = await createWorkspace();
    const installed = await createWidgetFolder(join(configPath, 'widgets'), 'weather-installed', 'installed-v1');
    await writeFile(join(installed, 'vibecanvas.json'), `${JSON.stringify({ name: 'Weather' })}\n`, 'utf8');
    await symlink(join(installed, 'missing-file'), join(installed, 'broken-link'));

    await expect(workspace.reconcilePublishedWidgets()).rejects.toThrow();
    await expect(lstat(join(workspace.publishedRoot, 'Weather'))).rejects.toThrow();
    expect((await readdir(workspace.publishedRoot)).filter((name) => name.startsWith('.reconcile-'))).toEqual([]);
  });

  test('reconciles a missing canonical snapshot alongside an existing same-name draft', async () => {
    const { workspace, configPath } = await createWorkspace();
    const installed = await createWidgetFolder(join(configPath, 'widgets'), 'weather-installed', 'published');
    await writeFile(join(installed, 'vibecanvas.json'), `${JSON.stringify({ name: 'Weather' })}\n`, 'utf8');
    await createWidgetFolder(workspace.draftRoot, 'Weather', 'draft changes');

    expect(await workspace.reconcilePublishedWidgets()).toMatchObject({ created: ['Weather'] });
    expect(await readFile(join(workspace.publishedRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('published');
    expect(await readFile(join(workspace.draftRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('draft changes');
  });

  test('syncs published content into one shared draft mounted by two chats', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Weather');
    const first = await workspace.syncDraftFromPublished('chat-a', 'Weather');
    const second = await workspace.loadWidget('chat-b', 'Weather');

    expect(await realpath(first.mountPath)).toBe(await realpath(join(workspace.draftRoot, 'Weather')));
    expect(await realpath(second.mountPath)).toBe(await realpath(join(workspace.draftRoot, 'Weather')));
    await workspace.writeMountedFileAtomic('chat-a', 'widgets/Weather/widget/main.ts', 'shared-change');
    expect((await workspace.readMountedFile('chat-b', 'widgets/Weather/widget/main.ts')).toString()).toBe('shared-change');
    expect(await readFile(join(workspace.publishedRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('initial');
  });

  test('overwrites an existing shared draft only when explicitly synced from published', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Weather', 'published');
    await createWidgetFolder(workspace.draftRoot, 'Weather', 'draft changes');
    await workspace.loadWidget('chat-a', 'Weather');

    expect(await readFile(join(workspace.draftRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('draft changes');
    await workspace.syncDraftFromPublished('chat-b', 'Weather');
    expect(await readFile(join(workspace.draftRoot, 'Weather', 'widget', 'main.ts'), 'utf8')).toBe('published');
    expect((await workspace.listMounts('chat-a'))[0]).toMatchObject({ name: 'Weather', source: 'draft' });
  });

  test('serializes complete edits from two chat mount paths on the shared real widget folder', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Weather', 'alpha\nbeta\n');
    await workspace.syncDraftFromPublished('chat-a', 'Weather');
    await workspace.loadWidget('chat-b', 'Weather');
    const first = createWorkspaceFileTools({
      workspace,
      chatId: 'chat-a',
      cwd: workspace.getChatRoot('chat-a'),
      authorize: async () => true,
    }).find((tool) => tool.name === 'edit')!;
    const second = createWorkspaceFileTools({
      workspace,
      chatId: 'chat-b',
      cwd: workspace.getChatRoot('chat-b'),
      authorize: async () => true,
    }).find((tool) => tool.name === 'edit')!;

    const [firstResult, secondResult] = await Promise.all([
      executeTool(first, { path: 'widgets/Weather/widget/main.ts', edits: [{ oldText: 'alpha', newText: 'first' }] }),
      executeTool(second, { path: 'widgets/Weather/widget/main.ts', edits: [{ oldText: 'beta', newText: 'second' }] }),
    ]);
    expect(firstResult.isError).toBeUndefined();
    expect(secondResult.isError).toBeUndefined();
    expect((await workspace.readMountedFile('chat-a', 'widgets/Weather/widget/main.ts')).toString()).toBe('first\nsecond\n');
  });

  test('rejects regex patterns with unbounded backtracking constructs before reading files', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Weather', `${'a'.repeat(10_000)}!`);
    await workspace.loadWidget('chat-a', 'Weather');

    await expect(workspace.grepMountedFiles('chat-a', { pattern: '(a+)+$' })).rejects.toThrow('groups');
    await expect(workspace.grepMountedFiles('chat-a', { pattern: '(a+)+$', literal: true })).resolves.toMatchObject({ matches: [] });
  });

  test('keeps valid mounts across reconnect and makes repeated loads idempotent', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Weather');
    const first = await workspace.loadWidget('chat-a', 'Weather');
    const second = await workspace.loadWidget('chat-a', 'Weather');
    expect(second).toEqual(first);
    expect(await workspace.listMounts('chat-a')).toEqual([first]);
  });

  test('replaces and cleans up legacy published mounts without exposing them to file tools', async () => {
    const { workspace } = await createWorkspace();
    const published = await createWidgetFolder(workspace.publishedRoot, 'Weather', 'published');
    await createWidgetFolder(workspace.draftRoot, 'Weather', 'draft');
    const firstChat = await workspace.ensureChat('chat-a');
    await rm(join(firstChat, 'widgets', 'Weather'));
    await symlink(published, join(firstChat, 'widgets', 'Weather'), 'dir');

    const resolved = await workspace.resolveMountedPath('chat-a', 'widgets/Weather/widget/main.ts');
    expect(await readFile(resolved.absolutePath, 'utf8')).toBe('draft');
    const mount = await workspace.loadWidget('chat-a', 'Weather');
    expect(await realpath(mount.mountPath)).toBe(await realpath(join(workspace.draftRoot, 'Weather')));

    const secondChat = await workspace.ensureChat('chat-b');
    expect(secondChat).not.toBe(firstChat);
    expect(await workspace.removeAllMounts('chat-b')).toBe(1);
    expect(await readdir(join(secondChat, 'widgets'))).toEqual([]);
    expect(await readdir(join(firstChat, 'widgets'))).toEqual(['Weather']);
  });

  test('rejects root collisions, case collisions, conflicting mounts, and direct access', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Weather');
    await createWidgetFolder(workspace.draftRoot, 'Timer');
    await workspace.syncDraftFromPublished('chat-a', 'Weather');
    await expect(workspace.loadWidget('chat-a', 'weather')).rejects.toThrow('case-insensitive');
    await expect(workspace.resolveMountedPath('chat-a', workspace.publishedRoot)).rejects.toThrow('relative');
    await expect(workspace.resolveMountedPath('chat-a', 'widget-cwd/Weather/widget/main.ts')).rejects.toThrow('only through');
    await expect(workspace.createDraft('chat-a', { name: 'Timer' }, async () => [])).rejects.toThrow('already in use');
  });

  test('rejects an injected mount and a nested symlink escaping its registered widget', async () => {
    const { workspace, root } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Weather');
    const chatRoot = await workspace.ensureChat('chat-a');
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
    await symlink(outside, join(chatRoot, 'widgets', 'Injected'), 'dir');
    await expect(workspace.resolveMountedPath('chat-a', 'widgets/Injected/secret.txt')).rejects.toThrow('shared draft');

    await workspace.syncDraftFromPublished('chat-a', 'Weather');
    await symlink(outside, join(workspace.draftRoot, 'Weather', 'escape'), 'dir');
    await expect(workspace.resolveMountedPath('chat-a', 'widgets/Weather/escape/secret.txt')).rejects.toThrow('outside');
  });

  test('rejects draft symlinks before a Preview snapshot can follow their targets', async () => {
    const { workspace, root } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Weather');
    const outside = join(root, 'outside-preview-target');
    await mkdir(outside);
    await writeFile(join(outside, 'large-secret.txt'), 'must-not-be-copied', 'utf8');
    await symlink(outside, join(workspace.draftRoot, 'Weather', 'escape'), 'dir');
    const draft = await workspace.getDraft('Weather');
    if (!draft) throw new Error('Expected Weather draft.');

    await expect(workspace.createPreviewSnapshot('Weather', draft.revision))
      .rejects.toMatchObject({ code: 'WIDGET_DRAFT_SYMLINK_FORBIDDEN' });
    expect(await readdir(workspace.previewSnapshotRoot)).toEqual([]);
  });

  test('rolls back partial draft scaffolds and atomically mounts complete drafts', async () => {
    const { workspace } = await createWorkspace();
    await expect(workspace.createDraft('chat-a', { name: 'Broken' }, async ({ cwd }) => {
      await writeFile(join(cwd, 'partial.txt'), 'partial', 'utf8');
      throw new Error('scaffold failed');
    })).rejects.toThrow('scaffold failed');
    expect(await readdir(workspace.draftRoot)).toEqual([]);

    const created = await workspace.createDraft('chat-a', { name: 'Timer' }, async ({ cwd, name }) => {
      await mkdir(join(cwd, 'widget'), { recursive: true });
      await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({ name })}\n`, 'utf8');
      await writeFile(join(cwd, 'widget', 'main.ts'), 'complete', 'utf8');
      return ['vibecanvas.json', 'widget/main.ts'];
    });
    expect(created.mount.source).toBe('draft');
    expect(created.files).toEqual(['vibecanvas.json', 'widget/main.ts']);
  });

  test('records a committed draft revision while retaining drafts and every chat mount', async () => {
    const { root, dataPath, configPath, workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Timer');
    await workspace.loadWidget('chat-a', 'Timer');
    await workspace.loadWidget('chat-b', 'Timer');
    const unrelatedTarget = await createWidgetFolder(root, 'unrelated-timer');
    const unrelatedRoot = await workspace.ensureChat('chat-unrelated');
    const unrelatedMount = join(unrelatedRoot, 'widgets', 'Timer');
    await rm(unrelatedMount, { force: true });
    await symlink(unrelatedTarget, unrelatedMount, 'dir');

    const accepted = await workspace.getDraft('Timer');
    const snapshot = await workspace.beginDraftPublish('Timer', undefined, accepted!.revision);
    expect((await workspace.listMounts('chat-a'))[0]?.source).toBe('draft');
    expect((await workspace.listMounts('chat-b'))[0]?.targetPath).toBe(await realpath(join(workspace.draftRoot, 'Timer')));
    expect(await readFile(join(snapshot.canonicalPath, 'widget', 'main.ts'), 'utf8')).toBe('initial');
    await snapshot.commit();
    await snapshot.commit();

    expect(await workspace.getDraft('Timer')).toMatchObject({ revision: accepted!.revision });
    expect(await workspace.getCleanDraftRevision('Timer')).toBe(accepted!.revision);
    expect(await realpath(join(workspace.getChatRoot('chat-a'), 'widgets', 'Timer')))
      .toBe(await realpath(join(workspace.draftRoot, 'Timer')));
    expect(await realpath(join(workspace.getChatRoot('chat-b'), 'widgets', 'Timer')))
      .toBe(await realpath(join(workspace.draftRoot, 'Timer')));
    expect(await realpath(unrelatedMount)).toBe(await realpath(unrelatedTarget));
    expect(await readFile(join(snapshot.canonicalPath, 'widget', 'main.ts'), 'utf8')).toBe('initial');
    expect(await readdir(workspace.publicationBackupRoot)).toEqual([]);
    expect(await readdir(workspace.installedPublicationBackupRoot)).toEqual([]);
    const restarted = new WidgetWorkspace({ dataPath, configPath });
    await restarted.init();
    expect(await restarted.getCleanDraftRevision('Timer')).toBe(accepted!.revision);
  });

  test('prevents concurrent publishes from claiming the same installed slug', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Timer');
    await createWidgetFolder(workspace.draftRoot, 'Clock');
    const timer = await workspace.beginDraftPublish('Timer', 'shared-slug');
    await expect(workspace.beginDraftPublish('Clock', 'shared-slug')).rejects.toThrow('already being published');
    await timer.rollback();
    const clock = await workspace.beginDraftPublish('Clock', 'shared-slug');
    await clock.rollback();
  });

  test('preserves the exact draft and mounts when the accepted revision changes before commit', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Timer', 'accepted');
    const mount = await workspace.loadWidget('chat-a', 'Timer');
    const accepted = await workspace.getDraft('Timer');
    const snapshot = await workspace.beginDraftPublish('Timer', undefined, accepted!.revision);

    await writeFile(join(workspace.draftRoot, 'Timer', 'widget', 'main.ts'), 'changed while publishing', 'utf8');
    await expect(snapshot.commit()).rejects.toThrow('changed');
    await snapshot.rollback();

    expect(await readFile(join(workspace.draftRoot, 'Timer', 'widget', 'main.ts'), 'utf8')).toBe('changed while publishing');
    expect(await realpath(mount.mountPath)).toBe(await realpath(join(workspace.draftRoot, 'Timer')));
    expect(await workspace.getCleanDraftRevision('Timer')).toBeNull();
    await expect(lstat(snapshot.canonicalPath)).rejects.toThrow();
  });

  test('restores the previous canonical snapshot when a publish rolls back', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.publishedRoot, 'Timer', 'published');
    await createWidgetFolder(workspace.draftRoot, 'Timer', 'draft changes');
    await workspace.loadWidget('chat-a', 'Timer');

    const snapshot = await workspace.beginDraftPublish('Timer');
    expect(snapshot.wasExisting).toBe(true);
    expect(await readFile(join(workspace.publishedRoot, 'Timer', 'widget', 'main.ts'), 'utf8')).toBe('draft changes');
    await snapshot.rollback();
    expect((await workspace.listMounts('chat-a'))[0]?.source).toBe('draft');
    expect(await readFile(join(workspace.publishedRoot, 'Timer', 'widget', 'main.ts'), 'utf8')).toBe('published');
    expect(await readFile(join(workspace.draftRoot, 'Timer', 'widget', 'main.ts'), 'utf8')).toBe('draft changes');
  });

  test('uses the Windows junction adapter contract when configured for win32', async () => {
    const { workspace } = await createWorkspace('win32');
    const target = await createWidgetFolder(workspace.draftRoot, 'Weather');
    const mount = await workspace.loadWidget('chat-a', 'Weather');
    expect(await readlink(mount.mountPath)).toBe(await realpath(target));
  });

  test('removes only backend mounts during chat cleanup', async () => {
    const { workspace } = await createWorkspace();
    await createWidgetFolder(workspace.draftRoot, 'Timer');
    await workspace.loadWidget('chat-a', 'Timer');
    expect(await workspace.removeAllMounts('chat-a')).toBe(1);
    expect(await readdir(join(workspace.getChatRoot('chat-a'), 'widgets'))).toEqual([]);
    expect(await readFile(join(workspace.draftRoot, 'Timer', 'widget', 'main.ts'), 'utf8')).toBe('initial');
  });
});
