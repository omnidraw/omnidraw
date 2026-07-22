import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import type { TWidgetSourceSnapshot } from '@vibecanvas/widget-contract';
import typescript from 'typescript';
import { WidgetTypeScriptValidator } from '../src/services/WidgetTypeScriptValidator';
import { fxTypecheckWidgetSnapshot } from '../src/services/fx.typecheck-widget-snapshot';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');

function sourceSnapshot(
  files: Readonly<Record<string, string>>,
): TWidgetSourceSnapshot {
  const ordered = Object.entries(files)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, source]) => Object.freeze({ path, bytes: Buffer.from(source) }));
  const hash = createHash('sha256');
  for (const file of ordered) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
    hash.update(';');
  }
  return Object.freeze({
    id: '00000000-0000-4000-8000-000000000901',
    digestSha256: hash.digest('hex'),
    files: Object.freeze(ordered),
    createdAtMs: 1,
  });
}

function compilerPortal() {
  return {
    typescript,
    decodeUtf8: (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8'),
    assertCompilerBudget: () => undefined,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for compiler state.');
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

describe('host-owned widget TypeScript validation', () => {
  test('keeps documented SDK, zod inference, Arrow, and UI client imports in sync', () => {
    const valid = sourceSnapshot({
      'ui/main.ts': [
        'import { html, reactive } from "@arrow-js/core";',
        'import { createServerFunctionProxy } from "@vibecanvas/sdk/function-client";',
        'import { getCollaborativeState } from "@vibecanvas/sdk/widget";',
        'import "./styles.css";',
        'const state = reactive({ count: 0 });',
        'const calculate = createServerFunctionProxy<{ value: number }, { doubled: number }>("calculate");',
        'void calculate({ value: state.count });',
        'void getCollaborativeState<{ count: number }>();',
        'export default html`<button>${() => state.count}</button>`;',
      ].join('\n'),
      'ui/styles.css': 'button { color: red; }\n',
      'server/main.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        'export const calculate = defineServerFunction({',
        '  effect: "fn",',
        '  input: z.object({ value: z.number().finite() }),',
        '  output: z.object({ doubled: z.number().finite() }),',
        '}, async (_context, input) => ({ doubled: input.value * 2 }));',
      ].join('\n'),
    });
    expect(fxTypecheckWidgetSnapshot(compilerPortal(), { snapshot: valid })).toEqual([]);

    const invalid = sourceSnapshot({
      'server/main.server.ts': [
        'import { defineServerFunction } from "@vibecanvas/sdk/server";',
        'import { z } from "zod";',
        'export const calculate = defineServerFunction({',
        '  effect: "fn",',
        '  input: z.object({ value: z.number().finite() }),',
        '  output: z.object({ doubled: z.number().finite() }),',
        '}, async (_context, input) => ({ doubled: input.value.toUpperCase() }));',
      ].join('\n'),
    });
    expect(fxTypecheckWidgetSnapshot(compilerPortal(), { snapshot: invalid })).toEqual([
      "server/main.server.ts:7:55 TS2339: Property 'toUpperCase' does not exist on type 'number'.",
    ]);
  });

  test('denies package and snapshot escape imports without reading host paths', () => {
    const diagnostics = fxTypecheckWidgetSnapshot(compilerPortal(), {
      snapshot: sourceSnapshot({
        'ui/main.ts': [
          'import "../../../../private/host-secret";',
          'import "untrusted-package";',
          'export default true;',
        ].join('\n'),
      }),
    });

    expect(diagnostics).toEqual([
      "ui/main.ts:1:8 TS2307: Cannot find module '../../../../private/host-secret' or its corresponding type declarations.",
      "ui/main.ts:2:8 TS2307: Cannot find module 'untrusted-package' or its corresponding type declarations.",
    ]);
  });

  test('bounds diagnostics deterministically', () => {
    const source = Array.from(
      { length: 20 },
      (_, index) => `const value${index}: string = ${index};`,
    ).join('\n');
    const diagnostics = fxTypecheckWidgetSnapshot(compilerPortal(), {
      snapshot: sourceSnapshot({ 'ui/main.ts': source }),
    });
    expect(diagnostics).toHaveLength(8);
    expect(diagnostics.at(-1)).toBe('TypeScript: 13 additional errors omitted.');
  });

  test('terminates timed-out or over-memory workers and rejects compiler overload', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-typecheck-timeout-'));
    const workerPath = join(temporaryRoot, 'hanging-worker.ts');
    await writeFile(workerPath, [
      'if (typeof process.send !== "function") throw new Error("IPC required");',
      'process.send({ type: "ready" });',
      'process.on("message", () => { while (true) {} });',
      '',
    ].join('\n'));
    const validator = new WidgetTypeScriptValidator({
      workerPath,
      timeoutMs: 150,
      memorySampleMs: 10,
      readRssBytes: async () => 0,
      maxConcurrentValidations: 1,
    });
    const snapshot = sourceSnapshot({ 'ui/main.ts': 'export default true;\n' });

    try {
      const first = validator.validate(snapshot);
      void first.catch(() => undefined);
      await waitUntil(() => validator.diagnostics().activeProcessCount === 1);
      expect(validator.diagnostics()).toMatchObject({
        activeProcessCount: 1,
        activeValidationCount: 1,
        maximumConcurrency: 1,
      });
      await expect(validator.validate(snapshot)).rejects.toMatchObject({
        code: 'WIDGET_TYPESCRIPT_OVERLOADED',
      });
      expect(validator.diagnostics().activeProcessCount).toBe(1);
      await expect(first).rejects.toMatchObject({ code: 'WIDGET_TYPESCRIPT_TIMEOUT' });
      expect(validator.diagnostics()).toEqual({
        activeProcessCount: 0,
        activeProcessIds: [],
        activeValidationCount: 0,
        maximumConcurrency: 1,
      });

      const memoryValidator = new WidgetTypeScriptValidator({
        workerPath,
        timeoutMs: 1_000,
        memoryLimitBytes: 1_024,
        memorySampleMs: 5,
        readRssBytes: async () => 1_025,
      });
      await expect(memoryValidator.validate(snapshot)).rejects.toMatchObject({
        code: 'WIDGET_TYPESCRIPT_MEMORY_LIMIT',
      });
      expect(memoryValidator.diagnostics()).toEqual({
        activeProcessCount: 0,
        activeProcessIds: [],
        activeValidationCount: 0,
        maximumConcurrency: 1,
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('tracked SDK declaration assets match a fresh declaration emit', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-sdk-declarations-'));
    const sdkRoot = join(REPOSITORY_ROOT, 'packages', 'sdk');
    const typescriptPackage = Bun.resolveSync('typescript/package.json', join(sdkRoot, 'package.json'));
    const tscPath = join(resolve(typescriptPackage, '..'), 'bin', 'tsc');
    try {
      const child = Bun.spawn([
        process.execPath,
        tscPath,
        '-p',
        join(sdkRoot, 'tsconfig.build.json'),
        '--outDir',
        temporaryRoot,
      ], { stdout: 'pipe', stderr: 'pipe', env: {} });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(`${stdout}\n${stderr}`.trim()).toBe('');
      expect(exitCode).toBe(0);
      for (const fileName of [
        'collaborative-state-client.d.ts',
        'function-client.d.ts',
        'server.d.ts',
        'shared.d.ts',
        'widget.d.ts',
      ]) {
        const [generated, tracked] = await Promise.all([
          readFile(join(temporaryRoot, fileName), 'utf8'),
          readFile(join(
            REPOSITORY_ROOT,
            'apps',
            'cli',
            'src',
            'services',
            'widget-typescript-declarations',
            `sdk-${fileName}`,
          ), 'utf8'),
        ]);
        expect(tracked).toBe(generated);
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('compiled binary validates with embedded declarations outside the repository', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-typecheck-compiled-'));
    const buildRoot = join(temporaryRoot, 'build');
    const executionRoot = join(temporaryRoot, 'standalone');
    const entryPath = join(buildRoot, 'entry.ts');
    const buildExecutable = join(buildRoot, 'typecheck-probe');
    const standaloneExecutable = join(executionRoot, 'typecheck-probe');
    await mkdir(buildRoot, { recursive: true });
    await mkdir(executionRoot, { recursive: true });
    await writeFile(entryPath, [
      'import { Buffer } from "node:buffer";',
      'import { createHash } from "node:crypto";',
      'import process from "node:process";',
      `import { WidgetTypeScriptValidator } from ${JSON.stringify(join(REPOSITORY_ROOT, 'apps/cli/src/services/WidgetTypeScriptValidator.ts'))};`,
      `import { runWidgetTypecheckWorker } from ${JSON.stringify(join(REPOSITORY_ROOT, 'apps/cli/src/services/widget-typecheck-worker.ts'))};`,
      'function snapshot(source: string) {',
      '  const path = "ui/main.ts";',
      '  const bytes = Buffer.from(source, "utf8");',
      '  const pathBytes = Buffer.from(path, "utf8");',
      '  const hash = createHash("sha256");',
      '  hash.update(`${pathBytes.byteLength}:`);',
      '  hash.update(pathBytes);',
      '  hash.update(`:${bytes.byteLength}:`);',
      '  hash.update(bytes);',
      '  hash.update(";");',
      '  return {',
      '    id: "00000000-0000-4000-8000-000000000902",',
      '    digestSha256: hash.digest("hex"),',
      '    files: [{ path, bytes }],',
      '    createdAtMs: 1,',
      '  };',
      '}',
      'if (process.argv.includes("--widget-typecheck-worker")) {',
      '  runWidgetTypecheckWorker();',
      '} else {',
      '  const validator = new WidgetTypeScriptValidator({',
      '    compiledExecutable: true,',
      '    executable: process.execPath,',
      '    timeoutMs: 10_000,',
      '    readRssBytes: async () => 0,',
      '  });',
      '  const valid = await validator.validate(snapshot("const value: string = \\"valid\\";\\nexport default value;\\n"));',
      '  const invalid = await validator.validate(snapshot("const value: string = 42;\\nexport default value;\\n"));',
      '  console.log(JSON.stringify({ valid, invalid }));',
      '}',
      '',
    ].join('\n'));

    try {
      const build = Bun.spawn([
        process.execPath,
        'build',
        '--compile',
        entryPath,
        '--outfile',
        buildExecutable,
      ], {
        cwd: buildRoot,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {},
      });
      const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
        new Response(build.stdout).text(),
        new Response(build.stderr).text(),
        build.exited,
      ]);
      if (buildExitCode !== 0) {
        throw new Error(`Standalone compiler build failed: ${buildStdout}\n${buildStderr}`);
      }
      await rename(buildExecutable, standaloneExecutable);
      await rm(buildRoot, { recursive: true, force: true });

      const execution = Bun.spawn([standaloneExecutable], {
        cwd: executionRoot,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {},
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(execution.stdout).text(),
        new Response(execution.stderr).text(),
        execution.exited,
      ]);
      expect(stderr.trim()).toBe('');
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        valid: [],
        invalid: [
          "ui/main.ts:1:7 TS2322: Type 'number' is not assignable to type 'string'.",
        ],
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
