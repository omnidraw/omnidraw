import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  WidgetFilesystemCatalog,
} from '../widget-filesystem/catalog';
import { NodeWidgetFilesystemWorkspace } from '../widget-filesystem/workspace';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const temporaryRoots: string[] = [];
const CHAT_ID = testChatId('shared-draft-chat-a');
const SECOND_CHAT_ID = testChatId('shared-draft-chat-b');

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

async function createHome(): Promise<Readonly<{
  widgetsRoot: string;
  workspace: WidgetWorkspace;
}>> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-shared-drafts-'));
  temporaryRoots.push(root);
  const widgetsRoot = join(root, 'widgets');
  await Promise.all([
    mkdir(join(widgetsRoot, 'drafts'), { recursive: true }),
    mkdir(join(widgetsRoot, 'published'), { recursive: true }),
    mkdir(join(widgetsRoot, '.staging'), { recursive: true }),
    mkdir(join(widgetsRoot, '.preview'), { recursive: true }),
  ]);
  const workspace = new WidgetWorkspace({
    ...testWorkspaceWorld(),
    dataPath: join(root, 'agent'),
    draftRoot: join(widgetsRoot, 'drafts'),
  });
  await workspace.init();
  return { widgetsRoot, workspace };
}

function scaffoldManifest(name: string, slug: string) {
  return JSON.stringify({
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name,
    slug,
    description: `${name} fixture.`,
    tool: { label: name, group: null, priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  }, null, 2);
}

async function scaffoldHelloDraft(cwd: string, name = 'Hello App', slug = 'hello-app') {
  await mkdir(join(cwd, 'ui'), { recursive: true });
  await writeFile(join(cwd, 'omnidraw.json'), scaffoldManifest(name, slug));
  await writeFile(join(cwd, 'ui', 'main.ts'), 'export default 1;\n');
  return ['omnidraw.json', 'ui/main.ts'];
}

function createCatalog(widgetsRoot: string): WidgetFilesystemCatalog {
  return new WidgetFilesystemCatalog({
    rootPath: widgetsRoot,
    filesystem: new NodeWidgetCatalogFilesystem(),
    hash: new NodeWidgetCatalogHash(),
    capsule: {
      inspectCapsuleArtifact: async () => {
        throw new Error('No publication exists in this fixture.');
      },
    },
  });
}

describe('shared agent draft root', () => {
  test('new chats stay empty and reconnect preserves only explicitly loaded drafts', async () => {
    const { widgetsRoot, workspace } = await createHome();
    await Promise.all([
      scaffoldHelloDraft(join(widgetsRoot, 'drafts', 'hello-app')),
      scaffoldHelloDraft(
        join(widgetsRoot, 'drafts', 'other-app'),
        'Other App',
        'other-app',
      ),
    ]);

    const firstRoot = await workspace.ensureChat(CHAT_ID);
    expect(await readdir(join(firstRoot, 'widgets'))).toEqual([]);
    const beforeList = await readdir(join(firstRoot, 'widgets'));
    const available = await workspace.listAvailableWidgets(CHAT_ID);
    expect(available.map((entry) => entry.name)).toEqual(['Hello App', 'Other App']);
    expect(await readdir(join(firstRoot, 'widgets'))).toEqual(beforeList);

    await workspace.loadWidget(CHAT_ID, 'Hello App');
    await workspace.loadWidget(CHAT_ID, 'Hello App');
    expect((await workspace.listMounts(CHAT_ID)).map((mount) => mount.name)).toEqual(['Hello App']);
    await expect(workspace.resolveMountedPath(
      CHAT_ID,
      'widgets/Other App/ui/main.ts',
    )).rejects.toThrow("Widget 'Other App' is not a backend mount.");
    await workspace.ensureChat(CHAT_ID);
    expect((await workspace.listMounts(CHAT_ID)).map((mount) => mount.name)).toEqual(['Hello App']);

    const secondRoot = await workspace.ensureChat(SECOND_CHAT_ID);
    expect(await readdir(join(secondRoot, 'widgets'))).toEqual([]);
    await workspace.loadWidget(SECOND_CHAT_ID, 'Hello App');
    expect((await workspace.listMounts(SECOND_CHAT_ID)).map((mount) => mount.name)).toEqual(['Hello App']);
    expect((await workspace.listMounts(CHAT_ID)).map((mount) => mount.name)).toEqual(['Hello App']);
  });

  test('a chat-created draft lands in the shared root and appears in the app catalog, Preview, and Publish inputs', async () => {
    const { widgetsRoot, workspace } = await createHome();
    const created = await workspace.createDraft(
      CHAT_ID,
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );

    expect(created.mount.name).toBe('Hello App');
    expect(created.mount.targetPath).toBe(await realpath(join(widgetsRoot, 'drafts', 'hello-app')));
    expect(dirname(created.mount.targetPath)).toBe(await realpath(join(widgetsRoot, 'drafts')));
    const mountStat = await lstat(created.mount.mountPath);
    expect(mountStat.isSymbolicLink()).toBe(true);

    const snapshot = await createCatalog(widgetsRoot).refresh();
    const entry = snapshot.entries['hello-app'];
    expect(entry?.health).toBe('healthy');
    expect(entry?.draft?.health).toBe('healthy');
    expect(entry?.draft?.manifest?.name).toBe('Hello App');
    expect(entry?.differences.availability).toBe('draft-only');
    expect(snapshot.issues).toEqual([]);

    const filesystemWorkspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetsRoot });
    const capture = await filesystemWorkspace.captureDraftBuildInput({
      slug: 'hello-app',
      signal: new AbortController().signal,
    });
    expect(capture.manifest.name).toBe('Hello App');
    expect(capture.files.map((file) => file.path)).toEqual(['ui/main.ts']);

    const available = await workspace.listAvailableWidgets(CHAT_ID);
    expect(available).toEqual([{
      widgetKey: 'hello-app',
      name: 'Hello App',
      kind: 'widget',
      hasDraft: true,
      hasPublished: false,
      draftHealth: 'healthy',
      publishedHealth: null,
      mountedInThisChat: true,
      problemCode: null,
    }]);
  });

  test('reconnect removes a stale owned mount and only an explicit load mounts the renamed draft', async () => {
    const { widgetsRoot, workspace } = await createHome();
    await workspace.createDraft(
      CHAT_ID,
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );

    const draftPath = join(widgetsRoot, 'drafts', 'hello-app');
    await writeFile(join(draftPath, 'omnidraw.json'), scaffoldManifest('Renamed App', 'hello-app'));

    const chatRoot = await workspace.ensureChat(CHAT_ID);
    expect(await workspace.listMounts(CHAT_ID)).toEqual([]);
    expect(await lstat(join(chatRoot, 'widgets', 'Hello App')).catch(() => null)).toBeNull();

    await workspace.loadWidget(CHAT_ID, 'Renamed App');
    const mounts = await workspace.listMounts(CHAT_ID);
    expect(mounts.map((mount) => mount.name)).toEqual(['Renamed App']);
    expect(mounts[0]?.targetPath).toBe(await realpath(draftPath));

    const resolved = await workspace.resolveMountedPath(CHAT_ID, 'widgets/Renamed App/ui/main.ts');
    expect(await readFile(resolved.absolutePath, 'utf8')).toBe('export default 1;\n');

    const snapshot = await createCatalog(widgetsRoot).refresh();
    expect(snapshot.entries['hello-app']?.health).toBe('healthy');
    expect(snapshot.entries['hello-app']?.draft?.manifest?.name).toBe('Renamed App');
  });

  test('plans and removes every exact backend-owned draft mount after source retirement', async () => {
    const { widgetsRoot, workspace } = await createHome();
    await workspace.createDraft(
      CHAT_ID,
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );
    await workspace.createDraft(
      CHAT_ID,
      { name: 'Other App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name, 'other-app'),
    );
    await workspace.ensureChat(SECOND_CHAT_ID);

    const planned = await workspace.observeDraftMounts('hello-app');
    expect(planned.map((mount) => mount.chatId).sort()).toEqual([CHAT_ID, SECOND_CHAT_ID].sort());
    expect(planned.every((mount) => mount.name === 'Hello App')).toBe(true);
    await rm(join(widgetsRoot, 'drafts', 'hello-app'), { recursive: true });
    for (const mount of planned) await workspace.removeDraftMount('hello-app', mount);

    expect(await workspace.observeDraftMounts('hello-app')).toEqual([]);
    expect((await workspace.listMounts(CHAT_ID)).map((mount) => mount.name)).toEqual(['Other App']);
    expect((await workspace.listMounts(SECOND_CHAT_ID)).map((mount) => mount.name)).toEqual(['Other App']);
  });

  test('rejects duplicate display names and slug collisions at creation', async () => {
    const { workspace } = await createHome();
    await workspace.createDraft(
      CHAT_ID,
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );

    await expect(workspace.createDraft(
      SECOND_CHAT_ID,
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    )).rejects.toThrow("Widget name 'Hello App' is already in use.");

    await expect(workspace.createDraft(
      SECOND_CHAT_ID,
      { name: 'hello app' },
      ({ cwd }) => scaffoldHelloDraft(cwd, 'hello app'),
    )).rejects.toThrow("Widget name 'hello app' is already in use.");

    await expect(workspace.createDraft(
      SECOND_CHAT_ID,
      { name: 'Other App' },
      ({ cwd }) => scaffoldHelloDraft(cwd, 'Other App', 'hello-app'),
    )).rejects.toThrow("Widget draft 'hello-app' already exists.");
  });
});
