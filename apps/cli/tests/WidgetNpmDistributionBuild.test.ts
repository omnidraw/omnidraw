import { describe, expect, test } from 'bun:test';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWidgetNpmDistributionBuild,
  runProcess,
} from '../src/services/WidgetNpmDistributionBuild';
import {
  buildCapsuleGuest,
  fnVibecanvasCapsuleBuildPolicy,
  fnVibecanvasCapsuleBuildTarget,
} from '@vibecanvas/capsule-vibecanvas/build';

const encoder = new TextEncoder();

function sourceFile(path: string, value: string) {
  return { path, bytes: encoder.encode(value) };
}

describe('WidgetNpmDistributionBuild', () => {
  test('executes a real guest npm build and ingests its dist through Capsule', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-capsule-test-'));
    try {
      const build = createWidgetNpmDistributionBuild({ scratchDirectory });
      const input = await build({
        sourceRevision: 'real-npm-fixture',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', JSON.stringify({
            name: 'real-npm-fixture',
            version: '1.0.0',
            private: true,
            type: 'module',
            scripts: { build: 'node build.mjs' },
          })),
          sourceFile('package-lock.json', JSON.stringify({
            name: 'real-npm-fixture',
            version: '1.0.0',
            lockfileVersion: 3,
            requires: true,
            packages: {
              '': { name: 'real-npm-fixture', version: '1.0.0' },
            },
          })),
          sourceFile('build.mjs', [
            'import { mkdir, writeFile } from "node:fs/promises";',
            'await mkdir("dist", { recursive: true });',
            'await writeFile("dist/main.js", "document.body.textContent=\\"real npm build\\";");',
          ].join('\n')),
          sourceFile('ui/main.ts', 'document.body.textContent = "source";'),
        ],
      });
      const capsule = await buildCapsuleGuest({
        input,
        target: fnVibecanvasCapsuleBuildTarget({
          entry: 'ui/main.ts',
          target: {
            runtimeAbi: 'quickjs-release-sync-v1',
            domProfile: 'dom-core-v2',
            featureProfiles: [],
          },
        }),
        capabilityRequests: [],
        parkability: { parkable: false },
        requestedBudgets: {},
        policy: fnVibecanvasCapsuleBuildPolicy(),
      });
      expect(capsule.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(capsule.diagnostics).toContainEqual(expect.objectContaining({
        code: 'CAPSULE_EXTERNAL_DISTRIBUTION_INGESTED',
      }));
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('runs frozen npm install and the guest build before capturing bounded dist bytes', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-build-test-'));
    const calls: string[] = [];
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        runProcess: async (command, args, options) => {
          calls.push(`${command} ${args.join(' ')}`);
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'run') {
            expect(await readFile(join(options.cwd, 'ui', 'main.ts'), 'utf8')).toBe([
              'import "../__vibecanvas_guest_bridge__.mjs";',
              'document.body.textContent="source";',
            ].join('\n'));
            expect(await readFile(
              join(options.cwd, '__vibecanvas_guest_bridge__.mjs'),
              'utf8',
            )).toContain('subscribeHostLifecycle(() => undefined).unsubscribe()');
            await mkdir(join(options.cwd, 'dist', 'assets'), { recursive: true });
            await writeFile(
              join(options.cwd, 'dist', 'main.js'),
              'document.body.textContent="built";',
            );
            await writeFile(
              join(options.cwd, 'dist', 'assets', 'style.css'),
              'body{color:green}',
            );
          }
        },
      });

      const result = await build({
        sourceRevision: 'source-revision',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', JSON.stringify({
            scripts: { build: 'vite build' },
          })),
          sourceFile('package-lock.json', JSON.stringify({
            lockfileVersion: 3,
            packages: {},
          })),
          sourceFile('ui/main.ts', 'document.body.textContent="source";'),
        ],
      });

      expect(calls).toEqual([
        'npm --version',
        'node -p JSON.stringify({nodeVersion:process.version,platform:process.platform,architecture:process.arch})',
        'npm ci',
        'npm run build',
      ]);
      expect(result).toMatchObject({
        kind: 'external-distribution',
        entry: 'main.js',
        cssRoots: ['assets/style.css'],
        producer: {
          name: 'vibecanvas-npm-build',
          version: '1+npm.11.0.0',
          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
        sourceRevision: 'source-revision',
        dependencyLockDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        buildConfigurationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
      expect(result.snapshot.files.map((file) => file.path)).toEqual([
        'assets/style.css',
        'main.js',
      ]);
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('stages local file dependencies, excludes node_modules, and regenerates the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'widget-npm-local-dependency-test-'));
    const scratchDirectory = join(root, 'scratch');
    const linkedPackage = join(root, 'linked-sdk');
    const nestedPackage = join(root, 'nested-package');
    const calls: string[] = [];
    try {
      await mkdir(join(linkedPackage, 'node_modules', 'excluded'), { recursive: true });
      await mkdir(nestedPackage, { recursive: true });
      await writeFile(join(nestedPackage, 'package.json'), JSON.stringify({
        name: '@fixture/nested',
        version: '1.0.0',
      }));
      await writeFile(join(nestedPackage, 'index.js'), 'export const nested = true;\n');
      await writeFile(join(linkedPackage, 'package.json'), JSON.stringify({
        name: '@fixture/linked-sdk',
        version: '1.0.0',
        files: ['index.js'],
        dependencies: {
          '@fixture/internal-workspace': 'workspace:*',
          '@fixture/nested': `file:${nestedPackage}`,
        },
      }));
      await writeFile(join(linkedPackage, 'index.js'), 'export const linked = true;\n');
      await writeFile(join(linkedPackage, 'not-published.js'), 'excluded\n');
      await writeFile(join(linkedPackage, 'node_modules', 'excluded', 'index.js'), 'excluded\n');
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        runProcess: async (command, args, options) => {
          calls.push(`${command} ${args.join(' ')}`);
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'install') {
            const packageJson = JSON.parse(
              await readFile(join(options.cwd, 'package.json'), 'utf8'),
            ) as { dependencies: Record<string, string> };
            expect(packageJson.dependencies['@fixture/linked-sdk'])
              .toBe('file:./.vibecanvas-links/dependency-0');
            const stagedManifest = JSON.parse(await readFile(
              join(options.cwd, '.vibecanvas-links', 'dependency-0', 'package.json'),
              'utf8',
            )) as { dependencies: Record<string, string> };
            expect(stagedManifest.dependencies).toEqual({
              '@fixture/nested': 'file:../dependency-1',
            });
            const stagedLock = JSON.parse(await readFile(
              join(options.cwd, 'package-lock.json'),
              'utf8',
            )) as {
              packages: Record<string, {
                dependencies?: Record<string, string>;
                resolved?: string;
              }>;
            };
            expect(stagedLock.packages['']?.dependencies?.['@fixture/linked-sdk'])
              .toBe('file:./.vibecanvas-links/dependency-0');
            expect(stagedLock.packages['node_modules/@fixture/linked-sdk'])
              .toBeUndefined();
            expect(await readFile(
              join(options.cwd, '.vibecanvas-links', 'dependency-0', 'index.js'),
              'utf8',
            )).toContain('linked');
            expect(await readFile(
              join(options.cwd, '.vibecanvas-links', 'dependency-1', 'index.js'),
              'utf8',
            )).toContain('nested');
            await expect(access(
              join(options.cwd, '.vibecanvas-links', 'dependency-0', 'node_modules'),
            )).rejects.toThrow();
            await expect(access(
              join(options.cwd, '.vibecanvas-links', 'dependency-0', 'not-published.js'),
            )).rejects.toThrow();
            await writeFile(join(options.cwd, 'package-lock.json'), JSON.stringify({
              name: 'local-dependency-fixture',
              lockfileVersion: 3,
              packages: {
                '': {
                  dependencies: {
                    '@fixture/linked-sdk': 'file:./.vibecanvas-links/dependency-0',
                  },
                },
                'node_modules/@fixture/linked-sdk': {
                  resolved: 'file:.vibecanvas-links/dependency-0',
                  link: true,
                },
              },
            }));
          }
          if (args[0] === 'run') {
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'dist', 'main.js'), 'export default true;\n');
          }
        },
      });

      const result = await build({
        sourceRevision: 'local-dependency-source',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', JSON.stringify({
            name: 'local-dependency-fixture',
            scripts: { build: 'vite build' },
            dependencies: {
              '@fixture/linked-sdk': `file:${linkedPackage}`,
            },
          })),
          sourceFile('package-lock.json', JSON.stringify({
            name: 'local-dependency-fixture',
            lockfileVersion: 3,
            packages: {
              '': {
                dependencies: {
                  '@fixture/linked-sdk': `file:${linkedPackage}`,
                },
              },
              'node_modules/@fixture/linked-sdk': {
                resolved: '../../../../../../linked-sdk',
                link: true,
              },
            },
          })),
          sourceFile('ui/main.ts', 'export default true;\n'),
        ],
      });

      expect(calls).toEqual([
        'npm --version',
        'node -p JSON.stringify({nodeVersion:process.version,platform:process.platform,architecture:process.arch})',
        'npm install --package-lock-only --ignore-scripts',
        'npm ci',
        'npm run build',
      ]);
      expect(result.dependencyLockDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects non-v3 locks before executing guest code and cleans up', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-build-lock-test-'));
    let calls = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        runProcess: async () => {
          calls += 1;
        },
      });
      await expect(build({
        sourceRevision: 'source-revision',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":2}'),
          sourceFile('ui/main.ts', ''),
        ],
      })).rejects.toThrow('lockfileVersion 3');
      expect(calls).toBe(0);
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('rejects symlinked distribution content and cleans up failed guest builds', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-build-symlink-test-'));
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        runProcess: async (_command, args, options) => {
          if (args[0] === '--version') return '11.0.0';
          if (args[0] === '-p') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'run') {
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'outside.js'), 'document.body.textContent="x";');
            await symlink('../outside.js', join(options.cwd, 'dist', 'main.js'));
          }
        },
      });
      await expect(build({
        sourceRevision: 'source-revision',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"node build.mjs"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{}}'),
          sourceFile('ui/main.ts', ''),
        ],
      })).rejects.toThrow('unsupported file');
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('waits for inherited output pipes to close before enforcing the byte bound', async () => {
    const delayedWriter = [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e",',
      '  "setTimeout(() => process.stdout.write(\'x\'.repeat(2048)), 20)"',
      '], { stdio: ["ignore", "inherit", "inherit"] });',
      'child.unref();',
    ].join('\n');

    await expect(runProcess('node', ['-e', delayedWriter], {
      cwd: tmpdir(),
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    })).rejects.toThrow('output exceeded 1024 bytes');
  });
});
