import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fnResolveOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('compiled Preview inspection composition', () => {
  test('requires target-specific staged release evidence before browser discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-compiled-'));
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
    const config: ICliConfig = {
      cwd: root,
      dev: false,
      compiled: true,
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['omnidraw', 'serve'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };

    const { previewInspectionBrowser, widgetCatalog } = setupServices(config);
    try {
      await widgetCatalog.start();
      await expect(previewInspectionBrowser.preflight()).resolves.toMatchObject({
        ok: false,
        code: 'BROWSER_RELEASE_MANIFEST_MISSING',
      });
    } finally {
      await previewInspectionBrowser.stop();
      await widgetCatalog.stop();
    }
  });
});
