import { describe, expect, test } from 'bun:test';
import {
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
  createWidgetDockerProcessAdapter,
  createWidgetNpmDistributionBuild,
  fnWidgetNpmBuildEnvironmentIdentity,
  resolveWidgetNpmBuildRunner,
  runProcess,
} from '../src/shell/widget/WidgetNpmDistributionBuild';
import {
  buildCapsuleGuest,
  fnOmnidrawCapsuleBuildPolicy,
} from '#backend/shell/widget-runtime/build';

const encoder = new TextEncoder();

function sourceFile(path: string, value: string) {
  return { path, bytes: encoder.encode(value) };
}

describe('WidgetNpmDistributionBuild', () => {
  test('executes a real guest npm build and ingests its dist through Capsule', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-capsule-test-'));
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: join(scratchDirectory, 'npmrc'),
        runProcess,
      });
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
        apis: ['DOM'],
        capabilityRequests: [],
        parkability: { parkable: false },
        policy: fnOmnidrawCapsuleBuildPolicy(),
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
        npmUserConfigPath: '/registry/npmrc',
        mutableRegistryUrl: 'http://127.0.0.1:4873/',
        prepareNpmDependencies: async () => {
          calls.push('registry sync');
        },
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
          if (args[0] === 'ci') {
            const lock = JSON.parse(await readFile(
              join(options.cwd, 'package-lock.json'),
              'utf8',
            ));
            expect(lock.packages['node_modules/@omnidraw/sdk'].integrity).toBeUndefined();
            expect(lock.packages['node_modules/zod'].integrity).toBe('sha512-public-zod');
          }
          if (args[0] === 'run') {
            expect(await readFile(join(options.cwd, 'ui', 'main.ts'), 'utf8')).toBe([
              'import "../__omnidraw_guest_bridge__.mjs";',
              'document.body.textContent="source";',
            ].join('\n'));
            expect(await readFile(
              join(options.cwd, '__omnidraw_guest_bridge__.mjs'),
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
            packages: {
              '': {},
              'node_modules/@omnidraw/sdk': {
                resolved: 'http://127.0.0.1:4873/@omnidraw/sdk/-/sdk-0.10.0.tgz',
                integrity: 'sha512-stale-sdk',
              },
              'node_modules/zod': {
                resolved: 'https://registry.npmjs.org/zod/-/zod-4.4.3.tgz',
                integrity: 'sha512-public-zod',
              },
            },
          })),
          sourceFile('ui/main.ts', 'document.body.textContent="source";'),
        ],
      });

      expect(calls).toEqual([
        'npm --version',
        'node -p JSON.stringify({nodeVersion:process.version,platform:process.platform,architecture:process.arch})',
        'registry sync',
        'npm ci --userconfig /registry/npmrc',
        'npm run build',
      ]);
      expect(result).toMatchObject({
        kind: 'external-distribution',
        entry: 'main.js',
        cssRoots: ['assets/style.css'],
        producer: {
          name: 'omnidraw-npm-build',
          version: '1+runner.host-v1.npm.11.0.0',
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

  test('materializes a portable UI-only manifest from the executable projection', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-portable-manifest-test-'));
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
        runProcess: async (command, args, options) => {
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] !== 'run') return;
          const manifest = JSON.parse(
            await readFile(join(options.cwd, 'omnidraw.json'), 'utf8'),
          );
          expect(manifest).toMatchObject({
            $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
            schemaVersion: 1,
            ui: { runtime: 'capsule', entry: 'ui/main.ts' },
            resources: [{
              slot: 'rows',
              required: true,
              kinds: ['database'],
              effect: 'read',
            }],
          });
          expect(manifest.server).toBeUndefined();
          expect(JSON.stringify(manifest)).not.toContain('resource-local-id');
          expect(await readFile(join(options.cwd, 'ui', 'main.ts'), 'utf8'))
            .toBe('document.body.textContent="source";');
          await expect(readFile(join(options.cwd, '__omnidraw_guest_bridge__.mjs')))
            .rejects.toMatchObject({ code: 'ENOENT' });
          await mkdir(join(options.cwd, 'dist'), { recursive: true });
          await writeFile(join(options.cwd, 'dist', 'main.js'), 'built();');
        },
      });

      await expect(build({
        sourceRevision: 'portable-manifest-source',
        entry: 'ui/main.ts',
        executableManifest: {
          schemaVersion: 1,
          ui: {
            runtime: 'capsule',
            entry: 'ui/main.ts',
            apis: ['DOM'],
          },
          server: {
            entry: 'server/main.server.ts',
          },
          resources: [{
            slot: 'rows',
            required: true,
            kinds: ['database'],
            effect: 'read',
          }],
        },
        files: [
          sourceFile('package.json', JSON.stringify({
            scripts: { build: 'omnidraw-widget build .' },
          })),
          sourceFile('package-lock.json', JSON.stringify({
            lockfileVersion: 3,
            packages: { '': {} },
          })),
          sourceFile('ui/main.ts', 'document.body.textContent="source";'),
        ],
      })).resolves.toMatchObject({ entry: 'main.js' });
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('keeps a draft-private warm workspace and skips install for source-only edits', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-warm-test-'));
    const calls: string[] = [];
    const phases: string[] = [];
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
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
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            const source = await readFile(join(options.cwd, 'ui', 'main.ts'), 'utf8');
            await writeFile(join(options.cwd, 'dist', 'main.js'), source);
          }
        },
      });
      const packageFiles = [
        sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
        sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
      ];

      const first = await build({
        sourceRevision: 'source-one',
        workspaceKey: 'tenant-draft-a',
        entry: 'ui/main.ts',
        files: [...packageFiles, sourceFile('ui/main.ts', 'first();')],
        reportProgress: (phase) => phases.push(phase),
      });
      const second = await build({
        sourceRevision: 'source-two',
        workspaceKey: 'tenant-draft-a',
        entry: 'ui/main.ts',
        files: [...packageFiles, sourceFile('ui/main.ts', 'second();')],
        reportProgress: (phase) => phases.push(phase),
      });

      expect(calls.filter((call) => call.startsWith('npm ci '))).toHaveLength(1);
      expect(calls.filter((call) => call === 'npm run build')).toHaveLength(2);
      expect(phases).toEqual(['installing', 'building', 'building']);
      expect(Buffer.from(first.snapshot.files[0]!.bytes).toString()).toContain('first()');
      expect(Buffer.from(second.snapshot.files[0]!.bytes).toString()).toContain('second()');
      expect(await readdir(scratchDirectory)).toHaveLength(1);

      await build.closeWorkspace('tenant-draft-a');
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('invalidates a warm workspace install when dependency inputs change', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-warm-lock-test-'));
    let installs = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
        runProcess: async (command, args, options) => {
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'ci') installs += 1;
          if (args[0] === 'run') {
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'dist', 'main.js'), 'built();');
          }
        },
      });
      const request = {
        sourceRevision: 'source',
        workspaceKey: 'tenant-draft-b',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
          sourceFile('ui/main.ts', 'source();'),
        ],
      };
      await build(request);
      await build({
        ...request,
        sourceRevision: 'dependency-change',
        files: request.files.map((file) => file.path === 'package-lock.json'
          ? sourceFile(
            'package-lock.json',
            '{"lockfileVersion":3,"packages":{"":{"dependencies":{"zod":"4.0.0"}}}}',
          )
          : file),
      });

      expect(installs).toBe(2);
      await build.close();
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('reinstalls warm dependencies when the mutable registry may replace same-version bytes', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-mutable-warm-test-'));
    let installs = 0;
    let registrySyncs = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
        mutableRegistryUrl: 'http://127.0.0.1:4873/',
        prepareNpmDependencies: async () => {
          registrySyncs += 1;
        },
        runProcess: async (command, args, options) => {
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'ci') installs += 1;
          if (args[0] === 'run') {
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'dist', 'main.js'), 'built();');
          }
        },
      });
      const request = {
        sourceRevision: 'source-one',
        workspaceKey: 'mutable-draft',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
          sourceFile('ui/main.ts', 'first();'),
        ],
      };

      await build(request);
      await build({
        ...request,
        sourceRevision: 'source-two',
        files: request.files.map((file) => file.path === 'ui/main.ts'
          ? sourceFile('ui/main.ts', 'second();')
          : file),
      });

      expect(installs).toBe(2);
      expect(registrySyncs).toBe(2);
      await build.close();
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('keeps a successful warm install when the following guest build fails', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-warm-failure-test-'));
    let installs = 0;
    let builds = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
        runProcess: async (command, args, options) => {
          if (command === 'npm' && args[0] === '--version') return '11.0.0';
          if (command === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.14.0',
              platform: 'linux',
              architecture: 'x64',
            });
          }
          if (args[0] === 'ci') installs += 1;
          if (args[0] === 'run') {
            builds += 1;
            if (builds === 1) throw new Error('Injected source build failure.');
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'dist', 'main.js'), 'fixed();');
          }
        },
      });
      const request = {
        sourceRevision: 'source',
        workspaceKey: 'tenant-draft-build-failure',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
          sourceFile('ui/main.ts', 'source();'),
        ],
      };

      await expect(build(request)).rejects.toThrow('Injected source build failure.');
      await expect(build({
        ...request,
        sourceRevision: 'source-fixed',
        files: request.files.map((file) => file.path === 'ui/main.ts'
          ? sourceFile('ui/main.ts', 'fixed();')
          : file),
      })).resolves.toMatchObject({ sourceRevision: 'source-fixed' });

      expect(installs).toBe(1);
      expect(builds).toBe(2);
      await build.close();
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('rejects local package dependencies instead of staging them', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-local-dependency-test-'));
    let calls = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
        runProcess: async () => {
          calls += 1;
        },
      });

      await expect(build({
        sourceRevision: 'local-dependency-source',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', JSON.stringify({
            name: 'local-dependency-fixture',
            scripts: { build: 'vite build' },
            dependencies: {
              '@fixture/linked-sdk': 'file:/temporary/linked-sdk',
            },
          })),
          sourceFile('package-lock.json', JSON.stringify({
            name: 'local-dependency-fixture',
            lockfileVersion: 3,
            packages: {
              '': {
                dependencies: {
                  '@fixture/linked-sdk': 'file:/temporary/linked-sdk',
                },
              },
              'node_modules/@fixture/linked-sdk': {
                resolved: 'file:/temporary/linked-sdk',
                link: true,
              },
            },
          })),
          sourceFile('ui/main.ts', 'export default true;\n'),
        ],
      })).rejects.toThrow('must use a registry version');
      expect(calls).toBe(0);
      expect(await readdir(scratchDirectory)).toEqual([]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('rejects non-v3 locks before executing guest code and cleans up', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-npm-build-lock-test-'));
    let calls = 0;
    try {
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath: '/registry/npmrc',
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
        npmUserConfigPath: '/registry/npmrc',
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
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
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

  test('returns bounded output for an explicitly accepted diagnostic exit code', async () => {
    const output = await runProcess('node', ['-e', [
      'process.stdout.write(JSON.stringify({ok:false}));',
      'process.exit(3);',
    ].join('')], {
      cwd: tmpdir(),
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
      allowedExitCodes: [0, 3],
    });

    expect(output).toBe('{"ok":false}');
  });

  test('enforces the deadline when a command ignores graceful termination', async () => {
    const startedAt = Date.now();
    await expect(runProcess('node', ['-e', [
      'process.on("SIGTERM", () => undefined);',
      'setInterval(() => undefined, 1000);',
    ].join('')], {
      cwd: tmpdir(),
      timeoutMs: 50,
      maxOutputBytes: 1_024,
    })).rejects.toMatchObject({
      diagnostic: { code: 'WIDGET_COMMAND_TIMEOUT' },
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('redacts ambient credentials from failed guest process diagnostics', async () => {
    const environmentName = 'OMNIDRAW_WIDGET_BUILD_TEST_TOKEN';
    const secret = 'test-only-widget-build-secret-42';
    process.env[environmentName] = secret;
    try {
      const error = await runProcess('node', ['-e', [
        `process.stderr.write(String(process.env.${environmentName}));`,
        'process.stderr.write("\\nAuthorization: Bearer "',
        '+["guest","controlled","token"].join("-"));',
        'process.exit(1);',
      ].join('')], {
        cwd: tmpdir(),
        timeoutMs: 5_000,
        maxOutputBytes: 16 * 1024,
      }).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toContain(secret);
      expect(String((error as {
        diagnostic?: { reason?: unknown };
      }).diagnostic?.reason)).not.toContain(secret);
      expect(String((error as Error).message)).toContain('undefined');
      expect(String((error as Error).message)).not.toContain('guest-controlled-token');
      expect(String((error as Error).message)).toContain(
        'Authorization: [redacted] [redacted]',
      );
    } finally {
      delete process.env[environmentName];
    }
  });

  test('runs the build port in bounded ephemeral Docker containers and records its identity', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-docker-build-test-'));
    const npmUserConfigPath = join(scratchDirectory, 'npmrc');
    const image = `registry.example/omnidraw/widget-builder@sha256:${'a'.repeat(64)}`;
    const dockerCalls: Array<Readonly<{
      args: readonly string[];
      signal?: AbortSignal;
    }>> = [];
    let containerSequence = 0;
    try {
      await writeFile(npmUserConfigPath, 'registry=https://registry.example/\n');
      const runner = createWidgetDockerProcessAdapter({
        image,
        npmUserConfigPath,
        cpus: 1.5,
        memoryMb: 768,
        pidsLimit: 48,
        user: '501:20',
        createId: () => `test-${containerSequence += 1}`,
        runProcess: async (command, args, options) => {
          expect(command).toBe('docker');
          dockerCalls.push({
            args: [...args],
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          if (args[0] === 'rm') return;
          const imageIndex = args.indexOf(image);
          expect(imageIndex).toBeGreaterThan(0);
          const innerCommand = args[imageIndex + 1];
          const innerArgs = args.slice(imageIndex + 2);
          if (innerCommand === 'npm' && innerArgs[0] === '--version') return '11.2.0';
          if (innerCommand === 'node') {
            return JSON.stringify({
              nodeVersion: 'v22.15.0',
              platform: 'linux',
              architecture: 'arm64',
            });
          }
          if (innerCommand === 'npm' && innerArgs[0] === 'run') {
            await mkdir(join(options.cwd, 'dist'), { recursive: true });
            await writeFile(join(options.cwd, 'dist', 'main.js'), 'dockerBuilt();');
          }
        },
      });
      const build = createWidgetNpmDistributionBuild({
        scratchDirectory,
        npmUserConfigPath,
        runProcess: runner.runProcess,
        runnerIdentity: runner.identity,
      });

      const result = await build({
        sourceRevision: 'docker-source',
        entry: 'ui/main.ts',
        files: [
          sourceFile('package.json', '{"scripts":{"build":"vite build"}}'),
          sourceFile('package-lock.json', '{"lockfileVersion":3,"packages":{"":{}}}'),
          sourceFile('ui/main.ts', 'source();'),
        ],
      });

      expect(runner.identity).toMatch(/^docker-v1\.sha256\.[0-9a-f]{64}$/);
      expect(result.producer.version).toBe(
        `1+runner.${runner.identity}.npm.11.2.0`,
      );
      expect(result.producer.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.buildConfigurationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(dockerCalls).toHaveLength(8);
      const install = dockerCalls.find((call) => {
        const imageIndex = call.args.indexOf(image);
        return imageIndex > 0
          && call.args[imageIndex + 1] === 'npm'
          && call.args[imageIndex + 2] === 'ci';
      });
      expect(install?.args).toEqual(expect.arrayContaining([
        '--pull',
        'never',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--cpus',
        '1.5',
        '--memory',
        '768m',
        '--memory-swap',
        '768m',
        '--pids-limit',
        '48',
        '--user',
        '501:20',
      ]));
      expect(install?.args).toContain(
        `type=bind,source=${npmUserConfigPath},`
          + 'target=/run/omnidraw-npmrc,readonly',
      );
      expect(install?.args.slice(-4)).toEqual([
        'npm',
        'ci',
        '--userconfig',
        '/run/omnidraw-npmrc',
      ]);
      const cleanupNames = dockerCalls
        .filter((call) => call.args[0] === 'rm')
        .map((call) => call.args[3]);
      expect(cleanupNames).toEqual([
        'omnidraw-widget-build-test-1',
        'omnidraw-widget-build-test-2',
        'omnidraw-widget-build-test-3',
        'omnidraw-widget-build-test-4',
      ]);
      await expect(runner.runProcess('sh', ['-c', 'echo unsafe'], {
        cwd: scratchDirectory,
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      })).rejects.toThrow("rejected command 'sh -c echo unsafe'");
      expect(dockerCalls).toHaveLength(8);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('force-removes a Docker build container when the process is cancelled', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-docker-cancel-test-'));
    const npmUserConfigPath = join(scratchDirectory, 'npmrc');
    const image = `registry.example/omnidraw/widget-builder@sha256:${'b'.repeat(64)}`;
    const controller = new AbortController();
    const calls: string[][] = [];
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      notifyStarted = resolveStarted;
    });
    try {
      await writeFile(npmUserConfigPath, '');
      const runner = createWidgetDockerProcessAdapter({
        image,
        npmUserConfigPath,
        createId: () => 'cancelled',
        runProcess: async (_command, args, options) => {
          calls.push([...args]);
          if (args[0] === 'rm') return;
          notifyStarted?.();
          await new Promise<void>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new Error('injected cancellation'));
            }, { once: true });
          });
        },
      });
      const pending = runner.runProcess('npm', ['run', 'build'], {
        cwd: scratchDirectory,
        timeoutMs: 60_000,
        maxOutputBytes: 1_024,
        signal: controller.signal,
      });
      await started;
      controller.abort();

      await expect(pending).rejects.toThrow('injected cancellation');
      expect(calls.at(-1)).toEqual([
        'rm',
        '--force',
        '--volumes',
        'omnidraw-widget-build-cancelled',
      ]);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('fails closed when Docker cannot confirm forced container removal', async () => {
    const scratchDirectory = await mkdtemp(join(tmpdir(), 'widget-docker-cleanup-test-'));
    const npmUserConfigPath = join(scratchDirectory, 'npmrc');
    const image = `registry.example/omnidraw/widget-builder@sha256:${'c'.repeat(64)}`;
    let cleanupAttempts = 0;
    try {
      await writeFile(npmUserConfigPath, '');
      const runner = createWidgetDockerProcessAdapter({
        image,
        npmUserConfigPath,
        createId: () => 'unconfirmed',
        runProcess: async (_command, args) => {
          if (args[0] !== 'rm') return;
          cleanupAttempts += 1;
          throw new Error('injected Docker daemon failure');
        },
      });
      await expect(runner.runProcess('npm', ['run', 'build'], {
        cwd: scratchDirectory,
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      })).rejects.toMatchObject({
        code: 'WIDGET_DOCKER_CLEANUP_FAILED',
      });
      expect(cleanupAttempts).toBe(3);
    } finally {
      await rm(scratchDirectory, { recursive: true, force: true });
    }
  });

  test('keeps host default and narrowly validates Docker environment configuration', () => {
    const injected = async () => undefined;
    const host = resolveWidgetNpmBuildRunner({
      env: {},
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'host',
    });
    expect(host).toEqual({
      kind: 'host',
      identity: 'host-v1',
      runProcess: injected,
    });
    const docker = resolveWidgetNpmBuildRunner({
      env: {
        OMNIDRAW_WIDGET_BUILD_RUNNER: 'docker',
        OMNIDRAW_WIDGET_BUILD_DOCKER_IMAGE:
          `node@sha256:${'d'.repeat(64)}`,
        OMNIDRAW_WIDGET_BUILD_DOCKER_CPUS: '1.25',
        OMNIDRAW_WIDGET_BUILD_DOCKER_MEMORY_MB: '512',
        OMNIDRAW_WIDGET_BUILD_DOCKER_PIDS_LIMIT: '32',
      },
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'docker',
    });
    expect(docker.kind).toBe('docker');
    expect(docker.identity).toMatch(/^docker-v1\.sha256\.[0-9a-f]{64}$/);

    expect(() => resolveWidgetNpmBuildRunner({
      env: { OMNIDRAW_WIDGET_BUILD_RUNNER: 'remote' },
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'invalid',
    })).toThrow("must be 'host' or 'docker'");
    expect(() => resolveWidgetNpmBuildRunner({
      env: { OMNIDRAW_WIDGET_BUILD_RUNNER: 'docker' },
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'invalid',
    })).toThrow('OMNIDRAW_WIDGET_BUILD_DOCKER_IMAGE is required');
    expect(() => resolveWidgetNpmBuildRunner({
      env: {
        OMNIDRAW_WIDGET_BUILD_RUNNER: 'docker',
        OMNIDRAW_WIDGET_BUILD_DOCKER_IMAGE: 'node:22',
      },
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'invalid',
    })).toThrow('pinned by sha256');
    expect(() => resolveWidgetNpmBuildRunner({
      env: {
        OMNIDRAW_WIDGET_BUILD_RUNNER: 'docker',
        OMNIDRAW_WIDGET_BUILD_DOCKER_IMAGE:
          `node@sha256:${'c'.repeat(64)}`,
        OMNIDRAW_WIDGET_BUILD_DOCKER_CPUS: '0.1',
      },
      npmUserConfigPath: '/registry/npmrc',
      runProcess: injected,
      createId: () => 'invalid',
    })).toThrow('CPU limit');
  });

  test('canonicalizes every pre-build runner and toolchain identity input', () => {
    const input = {
      runnerIdentity: 'host-v1',
      nodeVersion: 'v24.1.0',
      npmVersion: '11.4.0',
      platform: 'darwin',
      architecture: 'arm64',
      toolchainPinnedByRunner: false,
    } as const;
    const identity = fnWidgetNpmBuildEnvironmentIdentity(input);
    const parsed = JSON.parse(identity) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      format: 'omnidraw.widget-npm-build-environment.v1',
      approvedTransformsDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      buildConfigurationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      runnerIdentity: 'host-v1',
      toolchain: {
        authority: 'explicit',
        nodeVersion: 'v24.1.0',
        packageManager: 'npm',
        packageManagerVersion: '11.4.0',
        platform: 'darwin',
        architecture: 'arm64',
      },
    });
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      runnerIdentity: 'host-v2',
    })).not.toBe(identity);
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      nodeVersion: 'v24.2.0',
    })).not.toBe(identity);
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      npmVersion: '11.5.0',
    })).not.toBe(identity);
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      platform: 'linux',
    })).not.toBe(identity);
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      architecture: 'x64',
    })).not.toBe(identity);
    expect(fnWidgetNpmBuildEnvironmentIdentity({
      ...input,
      toolchainPinnedByRunner: true,
    })).not.toBe(identity);
  });
});
