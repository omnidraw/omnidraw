/** @file Verifies dependency-ordered local publication for generated widget packages. */

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertWidgetPackageStageSupport,
  buildWorkspacePackageStage,
  localNpmUserConfigContents,
  publishDecision,
  withWorkspacePackageStage,
  widgetPackagePublishOrder,
  widgetPackagePublishTag,
  widgetPackageSyncSource,
} from './local-registry.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local registry npm user config', () => {
  test('routes the owned scope with only the npm publish sentinel', () => {
    const contents = localNpmUserConfigContents('http://127.0.0.1:4873/');
    expect(contents).toContain('registry=https://registry.npmjs.org/');
    expect(contents).toContain('@omnidraw:registry=http://127.0.0.1:4873/');
    expect(contents).toContain(
      '//127.0.0.1:4873/:_authToken=omnidraw-local-development',
    );
    expect(contents).not.toContain('always-auth');
  });
});

function entry(name, dependencies = {}, extras = {}) {
  return Object.freeze({
    name,
    version: '1.0.0',
    directory: `/workspace/${name}`,
    manifest: Object.freeze({
      name,
      version: '1.0.0',
      dependencies,
      ...extras,
    }),
  });
}

describe('local widget package publication', () => {
  test('publishes the SDK workspace dependency closure in dependency order', () => {
    const packages = [
      entry('@omnidraw/sdk', {
        '@omnidraw/capsule': '0.11.0',
      }),
      entry('@omnidraw/canvas-contract'),
      entry('@omnidraw/unrelated'),
    ];

    expect(widgetPackagePublishOrder(packages).map(({ name }) => name)).toEqual([
      '@omnidraw/sdk',
    ]);
  });

  test('includes local optional and peer dependencies but leaves registry packages alone', () => {
    const packages = [
      entry('@omnidraw/sdk', {}, {
        optionalDependencies: { '@omnidraw/local-optional': 'workspace:*' },
        peerDependencies: {
          '@omnidraw/local-peer': 'workspace:*',
          react: '^19.0.0',
        },
      }),
      entry('@omnidraw/local-optional'),
      entry('@omnidraw/local-peer'),
    ];

    expect(widgetPackagePublishOrder(packages).map(({ name }) => name)).toEqual([
      '@omnidraw/local-optional',
      '@omnidraw/local-peer',
      '@omnidraw/sdk',
    ]);
  });

  test('rejects a missing root or a versioned dependency cycle', () => {
    expect(() => widgetPackagePublishOrder([])).toThrow('is not a versioned workspace package');
    expect(() => widgetPackagePublishOrder([
      entry('@omnidraw/sdk', { '@omnidraw/theme': 'workspace:*' }),
      entry('@omnidraw/theme', { '@omnidraw/sdk': 'workspace:*' }),
    ])).toThrow('dependency cycle');
  });

  test('verifies local-only versions and rebuilds missing or conflicting versions', () => {
    expect(widgetPackageSyncSource('sha512-local', null)).toBe('workspace');
    expect(widgetPackageSyncSource('sha512-public', 'sha512-public')).toBe('upstream');
    expect(widgetPackageSyncSource('sha512-local', undefined)).toBe('available');
    expect(widgetPackageSyncSource(null, null)).toBe('workspace');
    expect(widgetPackageSyncSource('sha512-local', 'sha512-public')).toBe('workspace');
  });

  test('publishes an unoccupied version regardless of allowOverwrite (D9)', () => {
    expect(publishDecision(null, 'sha512-new', false)).toBe('publish');
    expect(publishDecision(null, 'sha512-new', true)).toBe('publish');
  });

  test('treats identical bytes at an occupied version as a no-op (D9)', () => {
    expect(publishDecision('sha512-same', 'sha512-same', false)).toBe('unchanged');
    expect(publishDecision('sha512-same', 'sha512-same', true)).toBe('unchanged');
  });

  test('rejects different bytes at an occupied version by default, matching real-npm immutability (D9)', () => {
    expect(publishDecision('sha512-old', 'sha512-new', false)).toBe('reject');
  });

  test('overwrites different bytes at an occupied version only when the caller opts in (D9)', () => {
    // This is what makes an edit to a workspace package's source never
    // require a manual `package.json` version bump just to unblock
    // `bun run dev` again: the internal workspace-sync path always opts in.
    expect(publishDecision('sha512-old', 'sha512-new', true)).toBe('overwrite');
  });

  test('publishes an exact workspace version without taking latest from another version', () => {
    expect(widgetPackagePublishTag('0.10.0', '0.8.0')).toBe('omnidraw-workspace');
    expect(widgetPackagePublishTag('0.7.0', '0.8.0')).toBe('omnidraw-workspace');
    expect(widgetPackagePublishTag('0.8.0', '0.8.0')).toBe('latest');
    expect(widgetPackagePublishTag(null, '0.8.0')).toBe('latest');
  });

  test('rejects unsupported dependency-closure growth before invoking a build', async () => {
    let built = false;
    const unsupported = entry('@omnidraw/sdk');
    expect(() => assertWidgetPackageStageSupport([unsupported])).toThrow('does not declare scripts.build:stage');
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-unsupported-stage-'));
    temporaryRoots.push(root);
    await expect(buildWorkspacePackageStage(unsupported, root, async () => {
      built = true;
    })).rejects.toThrow('will not fall back to a workspace build');
    expect(built).toBe(false);
  });

  test.each(['build', 'pack', 'registry', 'timeout', 'cancellation'])(
    'removes an isolated stage after %s failure',
    async (phase) => {
      const root = await mkdtemp(join(tmpdir(), `omnidraw-${phase}-stage-`));
      temporaryRoots.push(root);
      const stageDirectory = join(root, 'staging');
      const stagedEntry = entry('@omnidraw/sdk', {}, {
        scripts: { 'build:stage': 'stage' },
      });
      const runner = async (_command, _args, options) => {
        if (phase === 'build' || phase === 'timeout' || phase === 'cancellation') {
          throw new Error(`${phase} failed`);
        }
        const dist = options.env.OMNIDRAW_PACKAGE_DIST_ROOT;
        await mkdir(dist, { recursive: true });
        await Promise.all([
          writeFile(join(dist, 'index.js'), 'export const staged = true;\n'),
          writeFile(join(dist, 'package.json'), `${JSON.stringify({
            name: stagedEntry.name,
            version: stagedEntry.version,
            exports: { '.': './index.js' },
          })}\n`),
        ]);
      };
      await expect(withWorkspacePackageStage(
        stageDirectory,
        stagedEntry,
        async () => { throw new Error(`${phase} failed`); },
        runner,
      )).rejects.toThrow(`${phase} failed`);
      expect(await readdir(stageDirectory)).toEqual([]);
    },
  );

  test('builds the SDK from current source into a standalone stage without changing live outputs', async () => {
    const repositoryRoot = join(import.meta.dir, '..');
    const sdkRoot = join(repositoryRoot, 'packages', 'sdk');
    const manifest = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'));
    const stagedEntry = Object.freeze({
      name: manifest.name,
      version: manifest.version,
      directory: sdkRoot,
      manifest,
    });
    const outputPaths = [
      join(sdkRoot, 'dist'),
      join(sdkRoot, 'function-client'),
      join(sdkRoot, 'server'),
      join(sdkRoot, 'widget'),
    ];
    const snapshot = async () => {
      const hash = createHash('sha256');
      const walk = async (path) => {
        const details = await lstat(path).catch(() => null);
        if (details === null) {
          hash.update(`${path}:missing\n`);
          return;
        }
        hash.update(`${path}:${details.mode}:${details.size}:${details.mtimeMs}\n`);
        if (details.isFile()) {
          hash.update(await readFile(path));
          return;
        }
        if (!details.isDirectory() || details.isSymbolicLink()) return;
        for (const child of (await readdir(path)).sort()) await walk(join(path, child));
      };
      for (const path of outputPaths) await walk(path);
      return hash.digest('hex');
    };
    const before = await snapshot();
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-sdk-current-source-stage-'));
    temporaryRoots.push(root);
    const staged = await buildWorkspacePackageStage(stagedEntry, root);
    const stagedManifest = JSON.parse(await readFile(join(staged.distDirectory, 'package.json'), 'utf8'));

    const byteSnapshot = async (directory) => {
      const files = new Map();
      const walk = async (path, relative = '') => {
        for (const child of (await readdir(path)).sort()) {
          const childPath = join(path, child);
          const childRelative = relative === '' ? child : `${relative}/${child}`;
          const details = await lstat(childPath);
          if (details.isDirectory()) await walk(childPath, childRelative);
          else if (details.isFile()) files.set(childRelative, createHash('sha256').update(await readFile(childPath)).digest('hex'));
        }
      };
      await walk(directory);
      return [...files];
    };

    expect(await snapshot()).toBe(before);
    expect(await byteSnapshot(staged.distDirectory)).toEqual(await byteSnapshot(join(sdkRoot, 'dist')));
    expect(stagedManifest).toMatchObject({
      name: '@omnidraw/sdk',
      version: manifest.version,
      bin: { 'omnidraw-widget': './cli.js' },
      dependencies: {
        '@omnidraw/capsule': '0.14.0',
        effect: '4.0.0-rc.108',
        'lucide-static': '1.24.0',
      },
    });
    for (const file of ['contract.js', 'contract.d.ts', 'cli.js', 'LICENSE', 'README.md']) {
      expect((await lstat(join(staged.distDirectory, file))).isFile()).toBe(true);
    }
    for (const subpath of ['function-client', 'server', 'widget']) {
      expect((await lstat(join(root, 'workspace-fallback', subpath, 'index.js'))).isFile()).toBe(true);
    }
    const sourceConstants = await readFile(join(sdkRoot, 'src', 'contracts', 'CONSTANTS.ts'), 'utf8');
    const schemaUrl = sourceConstants.match(/WIDGET_MANIFEST_V1_SCHEMA_URL = '([^']+)'/)?.[1];
    expect(schemaUrl).toBeTruthy();
    expect(await readFile(join(staged.distDirectory, 'contract.js'), 'utf8')).toContain(schemaUrl);

    const packDirectory = join(root, 'pack');
    await mkdir(packDirectory);
    const packed = Bun.spawnSync({
      cmd: ['npm', 'pack', staged.distDirectory, '--pack-destination', packDirectory, '--ignore-scripts'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(packed.exitCode, new TextDecoder().decode(packed.stderr)).toBe(0);
    const tarballs = (await readdir(packDirectory)).filter((name) => name.endsWith('.tgz'));
    expect(tarballs).toHaveLength(1);
    const tarContract = Bun.spawnSync({
      cmd: ['tar', '-xOf', join(packDirectory, tarballs[0]), 'package/contract.js'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(tarContract.exitCode, new TextDecoder().decode(tarContract.stderr)).toBe(0);
    expect(new TextDecoder().decode(tarContract.stdout)).toContain(schemaUrl);
  });
});
