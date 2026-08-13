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
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TWidgetManifestV1 } from '@omnidraw/sdk/contract';
import {
  NodeWidgetFilesystemWorkspace,
  createWidgetImportWorkspacePorts,
  createWidgetPreviewWorkspacePorts,
} from '../../widget-filesystem/workspace';

const temporaryRoots: string[] = [];

function manifest(slug = 'counter'): TWidgetManifestV1 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Counter',
    slug,
    description: 'A copied filesystem widget.',
    tool: { label: 'Counter', group: 'examples', priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  };
}

async function createWidgetRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-workspace-'));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(join(root, 'drafts')),
    mkdir(join(root, 'published')),
    mkdir(join(root, '.staging')),
    mkdir(join(root, '.preview')),
  ]);
  return root;
}

async function createCheckout(slug = 'counter'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-checkout-'));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(join(root, 'ui')),
    mkdir(join(root, '.git')),
    mkdir(join(root, 'node_modules')),
  ]);
  await Promise.all([
    writeFile(join(root, 'omnidraw.json'), JSON.stringify(manifest(slug))),
    writeFile(join(root, 'ui', 'main.ts'), 'export default 1;'),
    writeFile(join(root, '.git', 'config'), 'must not be copied'),
    writeFile(join(root, 'node_modules', 'dependency.js'), 'must not be copied'),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('NodeWidgetFilesystemWorkspace', () => {
  test('copies a bounded checkout, captures an exact digest, and atomically promotes it', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout();
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const staging = '.staging/import-counter-operation-1';
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal: new AbortController().signal,
    });
    const copied = await workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal: new AbortController().signal,
    });

    expect(copied.entries).toEqual([
      { path: 'omnidraw.json', kind: 'file' },
      { path: 'ui', kind: 'directory' },
      { path: 'ui/main.ts', kind: 'file' },
    ]);
    expect(copied.digestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(copied.byteSize).toBeGreaterThan(0);
    const inspected = await workspace.inspectManagedManifest({
      relativePath: staging,
      signal: new AbortController().signal,
    });
    expect(inspected).toMatchObject({
      slug: 'counter',
      treeDigestSha256: copied.digestSha256,
      manifest: { schemaVersion: 1, slug: 'counter' },
    });

    await workspace.promoteStaging({
      stagingRelativePath: staging,
      draftRelativePath: 'drafts/counter',
      expectedDraftAbsent: true,
      expectedTreeDigestSha256: copied.digestSha256,
      signal: new AbortController().signal,
    });
    expect(await workspace.listDraftDirectoryNames({
      signal: new AbortController().signal,
    })).toEqual(['counter']);
    expect(await readFile(join(widgetRoot, 'drafts', 'counter', 'ui', 'main.ts'), 'utf8'))
      .toBe('export default 1;');
    await expect(lstat(join(widgetRoot, staging))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects links and traversal without following bytes outside the checkout', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout('linked');
    await symlink('/etc/passwd', join(checkout, 'ui', 'escape'));
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const staging = '.staging/import-linked-operation-1';
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal: new AbortController().signal,
    });
    await expect(workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_LINK_NOT_ALLOWED' });
    await expect(workspace.prepareStaging({
      relativePath: '../escape',
      expectedAbsent: true,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_PATH_UNSAFE' });
    expect(await workspace.captureManagedTree({
      relativePath: staging,
      signal: new AbortController().signal,
    })).toMatchObject({ entries: [], byteSize: 0 });
  });

  test('digest-fences staging mutations immediately before promotion', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout();
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const staging = '.staging/import-counter-operation-2';
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal: new AbortController().signal,
    });
    const captured = await workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal: new AbortController().signal,
    });
    await writeFile(join(widgetRoot, staging, 'ui', 'main.ts'), 'mutated after build');

    await expect(workspace.promoteStaging({
      stagingRelativePath: staging,
      draftRelativePath: 'drafts/counter',
      expectedDraftAbsent: true,
      expectedTreeDigestSha256: captured.digestSha256,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_TREE_DIGEST_MISMATCH' });
    expect((await lstat(join(widgetRoot, staging))).isDirectory()).toBe(true);
    await expect(lstat(join(widgetRoot, 'drafts', 'counter'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('couples manifest inspection to one unchanged managed-tree observation', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout();
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const staging = '.staging/import-counter-observation-race';
    const signal = new AbortController().signal;
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal,
    });
    await workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal,
    });

    const captureManagedTree = workspace.captureManagedTree.bind(workspace);
    let captures = 0;
    Object.defineProperty(workspace, 'captureManagedTree', {
      configurable: true,
      value: async (args: Parameters<typeof captureManagedTree>[0]) => {
        const capture = await captureManagedTree(args);
        captures += 1;
        if (captures === 1) {
          await writeFile(join(widgetRoot, staging, 'ui', 'main.ts'), 'changed during inspection');
        }
        return capture;
      },
    });

    await expect(workspace.inspectManagedManifest({ relativePath: staging, signal }))
      .rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_MANIFEST_CHANGED' });
    expect(captures).toBe(2);
  });

  test('requires the staged manifest slug to match the exact draft promotion target', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout('source-widget');
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const staging = '.staging/import-source-widget-target-fence';
    const signal = new AbortController().signal;
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal,
    });
    const captured = await workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal,
    });

    await expect(workspace.promoteStaging({
      stagingRelativePath: staging,
      draftRelativePath: 'drafts/different-widget',
      expectedDraftAbsent: true,
      expectedTreeDigestSha256: captured.digestSha256,
      signal,
    })).rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_MANIFEST_SLUG_MISMATCH' });
    expect((await lstat(join(widgetRoot, staging))).isDirectory()).toBe(true);
    await expect(lstat(join(widgetRoot, 'drafts', 'different-widget')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('bounds iterative temporary-tree cleanup without following or recursing unboundedly', async () => {
    const widgetRoot = await createWidgetRoot();
    const workspace = await NodeWidgetFilesystemWorkspace.open({
      rootPath: widgetRoot,
      limits: { maxEntries: 2 },
    });
    const preview = '.preview/sessions/bounded-cleanup';
    await workspace.prepareTempPath({
      relativePath: preview,
      signal: new AbortController().signal,
    });
    await Promise.all([
      writeFile(join(widgetRoot, preview, 'a.txt'), 'a'),
      writeFile(join(widgetRoot, preview, 'b.txt'), 'b'),
      writeFile(join(widgetRoot, preview, 'c.txt'), 'c'),
    ]);

    await expect(workspace.removeTempPath({ relativePath: preview }))
      .rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_CLEANUP_LIMIT' });
    expect((await lstat(join(widgetRoot, preview))).isDirectory()).toBe(true);
    expect((await lstat(join(widgetRoot, preview, 'c.txt'))).isFile()).toBe(true);
  });

  test('bounds checkout bytes and rejects a symlinked managed root', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout();
    const workspace = await NodeWidgetFilesystemWorkspace.open({
      rootPath: widgetRoot,
      limits: { maxTotalBytes: 16 },
    });
    const staging = '.staging/import-counter-operation-3';
    await workspace.prepareStaging({
      relativePath: staging,
      expectedAbsent: true,
      signal: new AbortController().signal,
    });
    await expect(workspace.copyExternalCheckout({
      sourceRootPath: checkout,
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_TOTAL_SIZE_LIMIT' });

    const linkedRoot = join(tmpdir(), `omnidraw-workspace-link-${Date.now()}`);
    temporaryRoots.push(linkedRoot);
    await symlink(widgetRoot, linkedRoot);
    await expect(NodeWidgetFilesystemWorkspace.open({ rootPath: linkedRoot }))
      .rejects.toMatchObject({ code: 'WIDGET_WORKSPACE_ROOT_INVALID' });
  });

  test('exposes import and writer-leased Preview filesystem port compositions', async () => {
    const widgetRoot = await createWidgetRoot();
    const checkout = await createCheckout();
    const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetRoot });
    const importPorts = createWidgetImportWorkspacePorts({
      workspace,
      config: { checkoutRootPath: (value: { path: string }) => value.path },
    });
    const staging = '.staging/import-counter-operation-4';
    const signal = new AbortController().signal;
    await importPorts.prepareStaging({ relativePath: staging, expectedAbsent: true, signal });
    await importPorts.copyCheckout({
      checkout: { path: checkout },
      destinationRelativePath: staging,
      mode: 'copy-files-no-follow',
      signal,
    });
    expect((await importPorts.inspectManagedManifest({ relativePath: staging, signal })).slug)
      .toBe('counter');

    const leaseEvents: string[] = [];
    const previewPorts = createWidgetPreviewWorkspacePorts({
      workspace,
      writer: {
        async acquireWriterLease() {
          leaseEvents.push('acquire');
          return { async release() { leaseEvents.push('release'); } };
        },
      },
    });
    const preview = '.preview/sessions/session-1';
    await previewPorts.prepareTempPath({ relativePath: preview, signal });
    expect((await lstat(join(widgetRoot, preview))).isDirectory()).toBe(true);
    await previewPorts.removeTempPath({ relativePath: preview });
    await expect(lstat(join(widgetRoot, preview))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(leaseEvents).toEqual(['acquire', 'release', 'acquire', 'release']);
  });
});
