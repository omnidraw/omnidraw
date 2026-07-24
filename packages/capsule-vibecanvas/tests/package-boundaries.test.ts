import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dir, '..');
const SOURCE_ROOT = join(PACKAGE_ROOT, 'src');
const EXPECTED_EXPORTS = Object.freeze({
  './contract': './src/contract/index.ts',
  './build': './src/build/index.ts',
  './build-runner': './src/build-runner/index.ts',
  './builder': './src/builder/index.ts',
  './host': './src/host/index.ts',
  './capabilities': './src/capabilities/index.ts',
  './testkit': './src/testkit/index.ts',
});
const CAPSULE_FILE_DEPENDENCY = 'file:/Users/omarezzat/Workspace/vibecanvas/capsule';
const SUPPORTED_CAPSULE_IMPORTS = new Set([
  '@omnidraw/capsule',
  '@omnidraw/capsule/build',
  '@omnidraw/capsule/build-runner',
  '@omnidraw/capsule/guest',
  '@omnidraw/capsule/protocol',
  '@omnidraw/capsule/schema',
  '@omnidraw/capsule/sign',
  '@omnidraw/capsule/testkit',
  '@omnidraw/capsule/webgl',
  '@omnidraw/capsule/webgpu',
]);
const TOOLING_CAPSULE_IMPORTS = new Set([
  '@omnidraw/capsule/build',
  '@omnidraw/capsule/build-runner',
  '@omnidraw/capsule/sign',
]);

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }))).flat().sort();
}

function moduleSpecifiers(source: string): string[] {
  const declarations = source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;'"`]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  );
  const dynamicImports = source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  return [
    ...[...declarations].map((match) => match[1]!),
    ...[...dynamicImports].map((match) => match[1]!),
  ];
}

async function sourceImports(directory: string): Promise<Array<{
  file: string;
  specifier: string;
}>> {
  const files = (await filesUnder(directory))
    .filter((path) => ['.ts', '.tsx'].includes(extname(path)));
  return (await Promise.all(files.map(async (file) => (
    moduleSpecifiers(await readFile(file, 'utf8')).map((specifier) => ({
      file: relative(PACKAGE_ROOT, file),
      specifier,
    }))
  )))).flat();
}

describe('Capsule adapter package boundary', () => {
  test('exposes only the seven environment-specific adapter subpaths', async () => {
    const manifest = JSON.parse(
      await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(manifest.name).toBe('@vibecanvas/capsule-vibecanvas');
    expect(manifest.exports).toEqual(EXPECTED_EXPORTS);
    expect(manifest.exports['.']).toBeUndefined();
    expect(manifest.dependencies).toEqual({
      '@omnidraw/capsule': CAPSULE_FILE_DEPENDENCY,
      '@types/react': '19.2.17',
      '@types/react-dom': '19.2.3',
      '@vibecanvas/sdk': 'workspace:*',
      '@vibecanvas/tenant-core': 'workspace:*',
      '@vibecanvas/widget-contract': 'workspace:*',
      csstype: '3.2.3',
      react: '19.2.7',
      'react-dom': '19.2.7',
      scheduler: '0.27.0',
    });
  });

  test('imports Capsule only through supported public package entries', async () => {
    const violations = (await sourceImports(SOURCE_ROOT))
      .filter(({ specifier }) => specifier.startsWith('@omnidraw/'))
      .filter(({ specifier }) => !SUPPORTED_CAPSULE_IMPORTS.has(specifier));

    expect(violations).toEqual([]);
  });

  test('keeps build, build-runner, and signing out of browser-safe entries', async () => {
    const browserRoots = ['contract', 'host', 'capabilities']
      .map((directory) => join(SOURCE_ROOT, directory));
    const imports = (await Promise.all(browserRoots.map(sourceImports))).flat();
    const violations = imports.filter(({ specifier }) => (
      TOOLING_CAPSULE_IMPORTS.has(specifier)
    ));

    expect(violations).toEqual([]);
  });

  test('keeps the OCI build-runner bundle free of source compiler dependencies', async () => {
    const result = await Bun.build({
      entrypoints: [join(PACKAGE_ROOT, 'tests/fixtures/build-runner-import.ts')],
      target: 'bun',
    });
    expect(result.success).toBe(true);
    const output = (await Promise.all(result.outputs.map((item) => item.text()))).join('\n');
    expect(output).toContain('runCapsuleOciBuild');
    expect(output).not.toContain('@vue/compiler-sfc');
    expect(output).not.toContain('vueCompilerDistributionPath');
    expect(output).not.toContain('buildCapsuleGuest');
  });

  test('rejects private Capsule workspace and deep imports by construction', async () => {
    const capsuleRoot = CAPSULE_FILE_DEPENDENCY.slice('file:'.length);
    const capsuleManifest = JSON.parse(
      await readFile(join(capsuleRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: Record<string, unknown>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const exportedSpecifiers = new Set(Object.keys(capsuleManifest.exports).map((key) => (
      key === '.' ? '@omnidraw/capsule' : `@omnidraw/capsule/${key.slice(2)}`
    )));
    const capsuleDependencies = [
      ...Object.keys(capsuleManifest.dependencies ?? {}),
      ...Object.keys(capsuleManifest.devDependencies ?? {}),
    ];

    expect(capsuleManifest.name).toBe('@omnidraw/capsule');
    expect(exportedSpecifiers).toEqual(SUPPORTED_CAPSULE_IMPORTS);
    expect(exportedSpecifiers.has('@omnidraw/capsule/packages/host')).toBe(false);
    expect(exportedSpecifiers.has('@omnidraw/capsule/dist/index.js')).toBe(false);
    expect(capsuleDependencies.some((name) => name.startsWith('@vibecanvas/'))).toBe(false);
  });

  test('resolves every supported Capsule entry and rejects private paths', () => {
    for (const specifier of SUPPORTED_CAPSULE_IMPORTS) {
      expect(Bun.resolveSync(specifier, PACKAGE_ROOT), specifier).toBeString();
    }
    for (const specifier of [
      '@omnidraw/capsule/packages/host',
      '@omnidraw/capsule/dist/index.js',
      '@omnidraw/capsule/src/index.ts',
      '@omnidraw/capsule-host',
    ]) {
      expect(() => Bun.resolveSync(specifier, PACKAGE_ROOT), specifier).toThrow();
    }
  });
});
