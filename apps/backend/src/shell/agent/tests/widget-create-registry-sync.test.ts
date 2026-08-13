import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWidgetWorkspaceTools } from '../tools/tool.widget-workspace';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const roots: string[] = [];
const CHAT_ID = testChatId('widget-create-registry-sync');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(
  prepareNpmDependencies: () => Promise<void>,
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
) {
  return createWidgetWorkspaceTools({
    workspace,
    chatId: CHAT_ID,
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
});
