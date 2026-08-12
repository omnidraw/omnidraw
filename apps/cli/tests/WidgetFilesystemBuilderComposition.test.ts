import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeWidgetFilesystemWorkspace } from '@omnidraw/service-agent';
import {
  fnCanonicalizeWidgetBuildReceipt,
  fnCreateWidgetBuildReceipt,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  type TWidgetManifestV1,
} from '@omnidraw/widget-contract';
import { fnResolveOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import { testWidgetDistributionBuild } from './widget-capsule.fixture';
import sdkPackage from '../../../packages/sdk/package.json';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeDraft(
  draftsRoot: string,
  manifest: TWidgetManifestV1,
): Promise<void> {
  const root = join(draftsRoot, manifest.slug);
  await mkdir(join(root, 'ui'), { recursive: true });
  await writeFile(
    join(root, 'omnidraw.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(join(root, 'ui', 'main.ts'), 'export default 1;\n');
  if (manifest.server !== undefined) {
    await mkdir(join(root, 'server'), { recursive: true });
    await writeFile(join(root, 'server', 'main.ts'), [
      "import { defineServerFunction } from '@omnidraw/sdk/server';",
      "import { z } from 'zod';",
      'export const ping = defineServerFunction({',
      "  effect: 'fn',",
      '  input: z.object({ value: z.number() }),',
      '  output: z.object({ value: z.number() }),',
      '}, async (_context, input) => ({ value: input.value }));',
      '',
    ].join('\n'));
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeAcceptedReceipt(
  widgetsRoot: string,
  widgetKey: string,
): Promise<void> {
  const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: widgetsRoot });
  const capture = await workspace.captureDraftBuildInput({
    slug: widgetKey,
    signal: new AbortController().signal,
  });
  const outputBytes = new TextEncoder().encode(
    'const root=document.createElement("div");document.body.append(root);',
  );
  const receipt = fnCreateWidgetBuildReceipt({
    sourceDigestSha256: fnWidgetPortableSourceDigest({
      files: capture.files,
      digestSha256: sha256,
    }),
    manifestDigestSha256: fnWidgetManifestV1Digest({
      manifest: capture.manifest,
      digestSha256: sha256,
    }),
    executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
      manifest: capture.manifest,
      files: capture.files,
      digestSha256: sha256,
    }),
    sdkVersion: sdkPackage.version,
    outputs: [{
      path: 'dist/main.js',
      byteSize: outputBytes.byteLength,
      sha256: sha256(outputBytes),
    }],
    digestSha256: sha256,
  });
  const dist = join(widgetsRoot, 'drafts', widgetKey, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'main.js'), outputBytes);
  await writeFile(
    join(dist, 'omnidraw.build.json'),
    fnCanonicalizeWidgetBuildReceipt(receipt),
  );
}

function manifest(
  slug: string,
  serverRuntimeAbi?: string,
): TWidgetManifestV1 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: slug,
    slug,
    description: `${slug} composition fixture`,
    tool: { label: slug, group: 'tests', priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    ...(serverRuntimeAbi === undefined
      ? {}
      : { server: { entry: 'server/main.ts', runtimeAbi: serverRuntimeAbi } }),
  };
}

describe('production filesystem widget builder composition', () => {
  test('publishes UI-only and bun-v1 server widgets through one catalog service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-builder-composition-'));
    roots.push(root);
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: root,
      dataDir: root,
      env: {},
      homedir: root,
    });
    await Promise.all([
      home.homeDir,
      home.cacheRoot,
      home.tempRoot,
      home.widgetDraftsRoot,
      home.widgetPublishedRoot,
      home.widgetStagingRoot,
      home.widgetPreviewRoot,
      home.widgetTrashRoot,
      home.widgetQuarantineRoot,
    ].map((path) => mkdir(path, { recursive: true })));
    await writeDraft(home.widgetDraftsRoot, manifest('ui-only'));
    await writeDraft(home.widgetDraftsRoot, manifest('with-server', 'bun-v1'));

    const config: ICliConfig = {
      cwd: root,
      dev: false,
      compiled: false,
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['omnidraw', 'serve'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const { widgetBuildGeneration, widgetCatalog } = setupServices(config, {
      distributionBuild: testWidgetDistributionBuild,
    });
    expect((await lstat(join(home.tempRoot, 'function-runtime'))).isDirectory()).toBe(true);
    await widgetCatalog.start();
    await writeAcceptedReceipt(home.widgetsRoot, 'ui-only');
    await writeAcceptedReceipt(home.widgetsRoot, 'with-server');
    await widgetBuildGeneration.view('ui-only');
    await widgetBuildGeneration.view('with-server');

    for (const widgetKey of ['ui-only', 'with-server']) {
      const snapshot = widgetCatalog.current();
      const draft = snapshot.entries[widgetKey]?.draft;
      if (draft?.health !== 'healthy' || draft.manifestDigestSha256 === null) {
        throw new Error(`Draft '${widgetKey}' did not scan as healthy.`);
      }
      await widgetCatalog.buildAndPublish({
        widgetKey,
        expectedManifestDigestSha256: draft.manifestDigestSha256,
        expectedCatalogDigestSha256: snapshot.digestSha256,
      });
    }

    const uiOnly = await widgetCatalog.resolveRuntime('ui-only');
    const withServer = await widgetCatalog.resolveRuntime('with-server');
    expect(uiOnly.release.server).toBeNull();
    expect(uiOnly.serverEntryBytes).toBeNull();
    expect(withServer.release.server?.runtimeAbi).toBe('bun-v1');
    expect(withServer.serverEntryBytes?.byteLength).toBeGreaterThan(0);
    expect(widgetCatalog.current().entries['ui-only']?.published?.health).toBe('healthy');
    expect(widgetCatalog.current().entries['with-server']?.published?.health).toBe('healthy');
  }, 30_000);
});
