import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createWidgetSdkSourceCheck } from './WidgetSdkSourceCheck';

const roots: string[] = [];

afterEach(async () => Promise.all(
  roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
));

const manifest = JSON.stringify({
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Host Source Check Fixture',
  slug: 'host-source-check-fixture',
  description: 'Exercises host-owned SDK source validation.',
  tool: { label: 'Host Source Check', group: null, priority: 0 },
  ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
});

const files = [
  {
    path: 'package.json',
    bytes: new TextEncoder().encode(JSON.stringify({
      name: 'host-source-check-fixture',
      private: true,
      scripts: {
        check: 'omnidraw-widget check .',
        build: 'omnidraw-widget build .',
      },
      dependencies: { '@omnidraw/sdk': '0.1.0' },
      devDependencies: { typescript: '5.9.3' },
    })),
  },
  {
    path: 'package-lock.json',
    bytes: new TextEncoder().encode('{"lockfileVersion":3}'),
  },
  {
    path: 'tsconfig.json',
    bytes: new TextEncoder().encode('{}'),
  },
  {
    path: 'ui/main.ts',
    bytes: new TextEncoder().encode('window.addEventListener("pagehide", () => undefined);\n'),
  },
] as const;

const failedReport = JSON.stringify({
  schemaVersion: 1,
  ok: false,
  scope: 'offline-project',
  checks: [{
    phase: 'policy',
    code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
    severity: 'error',
    summary: 'pagehide is unsupported.',
    location: { file: 'widget://ui/main.ts', line: 1, column: 1 },
  }],
  limitations: ['resource-existence-not-checked', 'preview-runtime-not-checked'],
  truncated: false,
});

describe('createWidgetSdkSourceCheck', () => {
  test('checks an isolated capture with prepared dependencies and the source SDK CLI', async () => {
    const scratchDirectory = await mkdtemp('/tmp/omnidraw-host-source-check-');
    roots.push(scratchDirectory);
    const calls: Array<Readonly<{
      command: string;
      args: readonly string[];
      cwd: string;
      allowedExitCodes?: readonly number[];
    }>> = [];
    let prepared = 0;
    let operationRoot = '';
    const check = createWidgetSdkSourceCheck({
      scratchDirectory,
      npmUserConfigPath: '/tmp/host-source-check.npmrc',
      prepareNpmDependencies: async () => { prepared += 1; },
      runProcess: async (command, args, options) => {
        operationRoot = dirname(options.cwd);
        calls.push({
          command,
          args,
          cwd: options.cwd,
          ...(options.allowedExitCodes === undefined
            ? {}
            : { allowedExitCodes: options.allowedExitCodes }),
        });
        if (options.cwd.endsWith('/project')) {
          expect(await readFile(join(options.cwd, 'ui/main.ts'), 'utf8')).toContain('pagehide');
          expect(JSON.parse(await readFile(join(options.cwd, 'omnidraw.json'), 'utf8'))).toMatchObject({
            slug: 'host-source-check-fixture',
          });
        } else {
          expect(JSON.parse(await readFile(join(options.cwd, 'package.json'), 'utf8'))).toMatchObject({
            name: 'omnidraw-host-widget-source-check',
          });
        }
        return command === process.execPath ? failedReport : '';
      },
    });

    const report = await check({
      files,
      canonicalManifestJson: manifest,
      signal: new AbortController().signal,
    });

    expect(prepared).toBe(1);
    expect(report.checks).toContainEqual(expect.objectContaining({
      code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
    }));
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      command: 'npm',
      args: ['ci', '--ignore-scripts', '--userconfig', '/tmp/host-source-check.npmrc'],
    });
    expect(calls[1]).toMatchObject({
      command: 'npm',
      args: expect.arrayContaining([
        'install',
        '--ignore-scripts',
        '--package-lock=false',
        '@omnidraw/sdk@0.14.0',
      ]),
    });
    expect(calls[2]?.args).toEqual(expect.arrayContaining([
      'check',
      '.',
      '--json',
    ]));
    expect(calls[2]?.args.some((argument) => (
      argument.endsWith('/toolchain/node_modules/@omnidraw/sdk/cli.js')
    ))).toBe(true);
    expect(calls[2]?.allowedExitCodes).toEqual([0, 3]);
    await expect(lstat(operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('removes the isolated capture when dependency preparation fails', async () => {
    const scratchDirectory = await mkdtemp('/tmp/omnidraw-host-source-check-fail-');
    roots.push(scratchDirectory);
    let operationRoot = '';
    const check = createWidgetSdkSourceCheck({
      scratchDirectory,
      npmUserConfigPath: '/tmp/host-source-check.npmrc',
      runProcess: async (_command, _args, options) => {
        operationRoot = options.cwd;
        throw Object.assign(new Error('cancelled install'), { code: 'ABORT_ERR' });
      },
    });

    await expect(check({
      files,
      canonicalManifestJson: manifest,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await expect(lstat(operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
