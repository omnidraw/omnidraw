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
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  WidgetFilesystemCatalog,
} from '../src/widget-filesystem/catalog';
import { NodeWidgetFilesystemWorkspace } from '../src/widget-filesystem/workspace';

const temporaryRoots: string[] = [];

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
  test('a chat-created draft lands in the shared root and appears in the app catalog, Preview, and Publish inputs', async () => {
    const { widgetsRoot, workspace } = await createHome();
    const created = await workspace.createDraft(
      'chat-a',
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

    const available = await workspace.listAvailableWidgets('chat-a');
    expect(available).toEqual([{
      name: 'Hello App',
      kind: 'widget',
      hasDraft: true,
      hasPublished: false,
      mountedInThisChat: true,
      problemCode: null,
    }]);
  });

  test('mounts follow the manifest display name across a rename while the slug folder stays', async () => {
    const { widgetsRoot, workspace } = await createHome();
    await workspace.createDraft(
      'chat-a',
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );

    const draftPath = join(widgetsRoot, 'drafts', 'hello-app');
    await writeFile(join(draftPath, 'omnidraw.json'), scaffoldManifest('Renamed App', 'hello-app'));

    const chatRoot = await workspace.ensureChat('chat-a');
    const mounts = await workspace.listMounts('chat-a');
    expect(mounts.map((mount) => mount.name)).toEqual(['Renamed App']);
    expect(mounts[0]?.targetPath).toBe(await realpath(draftPath));
    expect(await lstat(join(chatRoot, 'widgets', 'Hello App')).catch(() => null)).toBeNull();

    const resolved = await workspace.resolveMountedPath('chat-a', 'widgets/Renamed App/ui/main.ts');
    expect(await readFile(resolved.absolutePath, 'utf8')).toBe('export default 1;\n');

    const snapshot = await createCatalog(widgetsRoot).refresh();
    expect(snapshot.entries['hello-app']?.health).toBe('healthy');
    expect(snapshot.entries['hello-app']?.draft?.manifest?.name).toBe('Renamed App');
  });

  test('rejects duplicate display names and slug collisions at creation', async () => {
    const { workspace } = await createHome();
    await workspace.createDraft(
      'chat-a',
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    );

    await expect(workspace.createDraft(
      'chat-b',
      { name: 'Hello App' },
      ({ cwd, name }) => scaffoldHelloDraft(cwd, name),
    )).rejects.toThrow("Widget name 'Hello App' is already in use.");

    await expect(workspace.createDraft(
      'chat-b',
      { name: 'hello app' },
      ({ cwd }) => scaffoldHelloDraft(cwd, 'hello app'),
    )).rejects.toThrow('collides with existing');

    await expect(workspace.createDraft(
      'chat-b',
      { name: 'Other App' },
      ({ cwd }) => scaffoldHelloDraft(cwd, 'Other App', 'hello-app'),
    )).rejects.toThrow("Widget draft 'hello-app' already exists.");
  });
});
