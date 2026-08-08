import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempDirectories: string[] = [];
const APP_ROOT = resolve(import.meta.dir, '..');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

async function installFakeNpm(root: string): Promise<string> {
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const npm = join(bin, 'npm');
  await writeFile(npm, [
    '#!/bin/sh',
    'mkdir -p node_modules',
    `printf '%s\\n' '${JSON.stringify({
      name: 'a114-inspection-fixture',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    })}' > package-lock.json`,
    '',
  ].join('\n'), 'utf8');
  await chmod(npm, 0o700);
  return bin;
}

describe('A114 widget-debug-tools black-box scenario', () => {
  test('creates, validates, and inspects through public agent API methods', async () => {
    const scenarioSource = await readFile(
      join(APP_ROOT, 'src', 'a114-preview-inspect-scenario.ts'),
      'utf8',
    );
    expect(scenarioSource).not.toMatch(/sessionMap|_customTools|_refreshToolRegistry/);

    const root = await mkdtemp(join(tmpdir(), 'omnidraw-a114-debug-tools-'));
    tempDirectories.push(root);
    const bin = await installFakeNpm(root);
    const child = Bun.spawn([
      'bun',
      'run',
      'src/a114-preview-inspect-scenario.ts',
      '--home',
      join(root, 'home'),
    ], {
      cwd: APP_ROOT,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    const passLine = stdout.split('\n').find((line) => (
      line.startsWith('A114_PREVIEW_INSPECTION_PASS ')
    ));
    expect(passLine, stdout).toBeDefined();
    const result = JSON.parse(passLine!.slice('A114_PREVIEW_INSPECTION_PASS '.length));
    expect(result).toEqual({
      scenario: 'a114-public-agent-preview-inspect',
      passed: true,
      toolOrder: [
        'od_widget_create',
        'od_widget_validate',
        'od_widget_preview_inspect',
      ],
      validation: { ok: true, previewExecution: 'passed' },
      inspection: {
        status: 'completed',
        overall: 'artifact_exact',
        source: 'exact',
        artifact: 'exact',
        bindings: 'none',
        network: 'denied',
        imageCount: 1,
        screenshot: {
          mimeType: 'image/png',
          width: 160,
          height: 120,
          byteSize: 155,
          digestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
  }, 20_000);
});
