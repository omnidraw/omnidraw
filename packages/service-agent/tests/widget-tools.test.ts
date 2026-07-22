import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Check } from 'typebox/value';
import { fnBuildWidgetCreateManifest } from '../src/tools/fn.widget-create';
import { createWorkspaceFileTools } from '../src/tools/tool.workspace-files';
import { createWidgetWorkspaceTools } from '../src/tools/tool.widget-workspace';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';

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
  const value = manifest as { name?: unknown };
  const content = typeof manifest === 'string'
    ? manifest
    : JSON.stringify({
        ...fnBuildWidgetCreateManifest({ name: typeof value.name === 'string' ? value.name : name }),
      });
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
    expect(Object.keys((create.parameters as any).properties)).toEqual(['name', 'description']);
    expect(Check(create.parameters as any, { name: 'Shared Timer' })).toBe(true);
    expect(Check(create.parameters as any, { name: 'Shared Timer', description: 'A shared timer.' })).toBe(true);
    expect(Check(create.parameters as any, { name: 'Shared Timer', kind: 'actor-widget' })).toBe(false);
    expect(fnBuildWidgetCreateManifest({ name: 'Minimal Draft' })).not.toHaveProperty('description');
    expect(fnBuildWidgetCreateManifest({ name: 'Minimal Draft' })).not.toHaveProperty('kind');
    const rejectedKind = await executeTool(create, { name: 'Legacy Choice', kind: 'actor-widget' });
    expect(providerModelData(rejectedKind)).toMatchObject({ error: { code: 'WIDGET_CREATE_INPUT_INVALID' } });
    await expect(lstat(join(workspace.draftRoot, 'Legacy Choice'))).rejects.toThrow();

    const created = await executeTool(create, { name: 'Shared Timer', description: 'A shared timer.' });
    expect(created.isError).toBeUndefined();
    expect(created.content[0]?.text).toContain('"mountPath": "widgets/Shared Timer"');
    expect(created.content[0]?.text).toContain('"draft": true');
    expect(created.details).toEqual({
      name: 'Shared Timer',
      mountPath: 'widgets/Shared Timer',
      source: 'draft',
      draft: true,
      files: [
        'vibecanvas.json', 'package.json', 'tsconfig.json', 'ui/main.ts', 'ui/styles.css',
      ],
    });
    expect(JSON.stringify(created)).not.toContain('"kind"');
    expect(JSON.stringify(created)).not.toContain(workspace.draftRoot);
    expect(mounted).toEqual(['Shared Timer']);
    const manifest = JSON.parse(await readFile(join(workspace.draftRoot, 'Shared Timer', 'vibecanvas.json'), 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      slug: 'shared-timer',
      name: 'Shared Timer',
      description: 'A shared timer.',
      ui: { entry: 'ui/main.ts' },
    });
    expect(manifest.server).toBeUndefined();
    expect(manifest.resources).toBeUndefined();
    expect(manifest.kind).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('in.update');
    expect(JSON.stringify(manifest)).not.toContain('tx.update');
    const widgetSource = await readFile(join(workspace.draftRoot, 'Shared Timer', 'ui', 'main.ts'), 'utf8');
    expect(widgetSource).toContain('reactive({ count: 0 })');
    expect(widgetSource).toContain('state.count += 1');
    expect(widgetSource).toContain('Widget under construction');
    expect(widgetSource).not.toContain('@vibecanvas/sdk/actor');
    const generatedSources = await Promise.all(created.details.files.map((file: string) => (
      readFile(join(workspace.draftRoot, 'Shared Timer', file), 'utf8')
    )));
    expect(generatedSources.every((source) => !source.includes('not implemented yet'))).toBe(true);
    expect(JSON.parse(await readFile(join(workspace.draftRoot, 'Shared Timer', 'package.json'), 'utf8'))).toMatchObject({
      dependencies: { '@vibecanvas/sdk': `file:${workspace.sdkPackagePath}` },
    });
    expect((await stat(join(workspace.sdkPackagePath, 'src', 'server.ts'))).isFile()).toBe(true);
    expect((await stat(join(workspace.sdkPackagePath, 'src', 'function-client.ts'))).isFile()).toBe(true);
    expect((await stat(join(workspace.draftRoot, 'Shared Timer', 'server'))).isDirectory()).toBe(true);

    const fileTools = createWorkspaceFileTools({
      workspace,
      chatId: 'chat-a',
      cwd: workspace.getChatRoot('chat-a'),
      authorize: async () => true,
    });
    const patch = fileTools.find((tool) => tool.name === 'patch')!;
    const edit = fileTools.find((tool) => tool.name === 'edit')!;
    const serverSource = [
      'import { defineServerFunction } from "@vibecanvas/sdk/server";',
      'import { z } from "zod";',
      '',
      'export const calculate = defineServerFunction({',
      '  effect: "fn",',
      '  input: z.object({ value: z.number().finite() }),',
      '  output: z.object({ doubled: z.number().finite() }),',
      '}, async (_context, input) => ({ doubled: input.value * 2 }));',
    ];
    const serverPatch = ['@@ -1,1 +1,8 @@', '-', ...serverSource.map((line) => `+${line}`)].join('\n');
    expect((await executeTool(patch, {
      path: 'widgets/Shared Timer/server/main.server.ts',
      patch: serverPatch,
    })).isError).toBeUndefined();
    const oldManifestTail = '  "ui": {\n    "entry": "ui/main.ts"\n  }\n}';
    const newManifestTail = '  "ui": {\n    "entry": "ui/main.ts"\n  },\n  "server": {\n    "entry": "server/main.server.ts",\n    "runtimeAbi": "vibecanvas-function-v1"\n  }\n}';
    expect((await executeTool(edit, {
      path: 'widgets/Shared Timer/vibecanvas.json',
      edits: [{ oldText: oldManifestTail, newText: newManifestTail }],
    })).isError).toBeUndefined();
    expect(await readFile(
      join(workspace.draftRoot, 'Shared Timer', 'server', 'main.server.ts'),
      'utf8',
    )).toContain('export const calculate = defineServerFunction');

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
    expect(validation.details.files).toContain('server/main.server.ts');
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

  test('keeps v2 publication out of the explicit legacy chat adapter', async () => {
    const { workspace } = await fixture();
    const create = createWidgetWorkspaceTools({ workspace, chatId: 'chat-a', authorize: async () => true })
      .find((tool) => tool.name === 'vc_widget_create')!;
    await executeTool(create, { name: 'V2 Only Timer' });
    const manifest = JSON.parse(await readFile(
      join(workspace.draftRoot, 'V2 Only Timer', 'vibecanvas.json'),
      'utf8',
    ));
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.actor).toBeUndefined();
    expect(await workspace.getDraft('V2 Only Timer')).not.toBeNull();
    await expect(lstat(join(workspace.publishedRoot, 'V2 Only Timer'))).rejects.toThrow();
  });
});
