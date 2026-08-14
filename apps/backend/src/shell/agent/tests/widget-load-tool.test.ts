import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWidgetWorkspaceTools } from '../tools/tool.widget-workspace';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const roots: string[] = [];
const CHAT_ID = testChatId('explicit-widget-load-tool');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('AI Chat explicit widget loading', () => {
  test('lists without mounting and loads exactly one resolved draft idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-load-tool-'));
    roots.push(root);
    const draftRoot = join(root, 'widgets', 'drafts');
    const first = join(draftRoot, 'first-widget');
    const second = join(draftRoot, 'second-widget');
    await Promise.all([
      mkdir(join(first, 'ui'), { recursive: true }),
      mkdir(join(second, 'ui'), { recursive: true }),
    ]);
    const manifest = (name: string, slug: string) => JSON.stringify({
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      name,
      slug,
      description: `${name} fixture.`,
      tool: { label: name, group: null, priority: 0 },
      ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    });
    await Promise.all([
      writeFile(join(first, 'omnidraw.json'), manifest('First Widget', 'first-widget')),
      writeFile(join(first, 'ui', 'main.ts'), 'export default 1;\n'),
      writeFile(join(second, 'omnidraw.json'), manifest('Second Widget', 'second-widget')),
      writeFile(join(second, 'ui', 'main.ts'), 'export default 2;\n'),
    ]);
    const workspace = new WidgetWorkspace({
      ...testWorkspaceWorld(),
      dataPath: join(root, 'agent'),
      draftRoot,
    });
    await workspace.init();
    const chatRoot = await workspace.ensureChat(CHAT_ID);
    let loadCalls = 0;
    const tools = createWidgetWorkspaceTools({
      workspace,
      chatId: CHAT_ID,
      authorize: async () => true,
      listAvailableWidgets: async () => [{
        widgetKey: 'first-widget',
        name: 'First Widget',
        kind: 'widget',
        hasDraft: true,
        hasPublished: true,
        draftHealth: 'healthy',
        publishedHealth: 'healthy',
        mountedInThisChat: false,
        problemCode: null,
      }],
      loadWidget: async () => {
        loadCalls += 1;
        const mounted = await workspace.mountResolvedDraft(CHAT_ID, {
          name: 'First Widget',
          slug: 'first-widget',
        });
        return {
          mount: mounted.mount,
          resolution: {
            widgetKey: 'first-widget',
            displayName: 'First Widget',
            slug: 'first-widget',
            treeDigestSha256: 'a'.repeat(64),
            sourceDecision: 'existing-draft',
            materialized: false,
          },
        };
      },
    });
    const list = tools.find((tool) => tool.name === 'od_widget_list')!;
    const load = tools.find((tool) => tool.name === 'od_widget_load')!;

    const before = await readdir(join(chatRoot, 'widgets'));
    const listed = await executeTool(list, {});
    expect(listed.details.widgets).toEqual([expect.objectContaining({
      widgetKey: 'first-widget',
      hasPublished: true,
    })]);
    expect(await readdir(join(chatRoot, 'widgets'))).toEqual(before);

    const firstLoad = await executeTool(load, { name: 'First Widget' });
    const secondLoad = await executeTool(load, { name: 'first-widget' });
    expect(firstLoad.details).toMatchObject({
      widgetKey: 'first-widget',
      mountedPath: 'widgets/First Widget',
      materialized: false,
    });
    expect(secondLoad.isError).not.toBe(true);
    expect(loadCalls).toBe(2);
    expect(await readdir(join(chatRoot, 'widgets'))).toEqual(['First Widget']);
    await expect(workspace.readMountedFile(
      CHAT_ID,
      'widgets/Second Widget/ui/main.ts',
    )).rejects.toThrow("Widget 'Second Widget' is not a backend mount.");
  });
});
