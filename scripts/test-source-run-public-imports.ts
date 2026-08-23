#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const BACKEND = join(ROOT, 'apps/backend');
const FRONTEND = join(ROOT, 'apps/frontend');
const AI_CHAT = join(ROOT, 'packages/component-ai-chat');
const CANVAS = join(ROOT, 'packages/canvas');
const SDK_VERSION = (JSON.parse(
  await readFile(join(ROOT, 'packages/sdk/package.json'), 'utf8'),
) as Readonly<{ version: string }>).version;
const TYPESCRIPT_PACKAGE = dirname(Bun.resolveSync('typescript/package.json', CANVAS));
const TSC = resolve(
  TYPESCRIPT_PACKAGE,
  '..',
  '@typescript',
  `typescript-${process.platform}-${process.arch}`,
  'lib',
  process.platform === 'win32' ? 'tsc.exe' : 'tsc',
);
const backendEntries = Object.freeze([
  '@omnidraw/canvas-contract',
  '@omnidraw/canvas-contract/CONSTANTS',
  '@omnidraw/canvas-contract/types',
  '@omnidraw/sdk',
  '@omnidraw/sdk/contract',
  '@omnidraw/sdk/package.json',
  '@omnidraw/sdk/server',
  '@omnidraw/sdk/widget',
]);
const frontendEntries = Object.freeze([
  '@omnidraw/canvas',
  '@omnidraw/canvas-contract',
  '@omnidraw/component-ai-chat',
  '@omnidraw/sdk',
  '@omnidraw/sdk/host',
  '@omnidraw/theme',
]);

function outputText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream === null ? Promise.resolve('') : new Response(stream).text();
}

async function stopProcess(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(2_000).then(() => false),
  ]);
  if (stopped) return;
  child.kill('SIGKILL');
  await Promise.race([child.exited, Bun.sleep(2_000)]);
}

let readyCount = 0;
let readyResolve!: (value: Readonly<{ port: number; pid: number }>) => void;
const ready = new Promise<Readonly<{ port: number; pid: number }>>((resolveReady) => {
  readyResolve = resolveReady;
});
let consumerOutput = '';
let buildProcess: ReturnType<typeof Bun.spawn> | null = null;
let aiChatWatcherOutput = '';
let aiChatWatcherReadyResolve!: () => void;
const aiChatWatcherReady = new Promise<void>((resolveReady) => {
  aiChatWatcherReadyResolve = resolveReady;
});
const aiChatWatcher = Bun.spawn([
  TSC,
  '-p',
  'tsconfig.dev.json',
  '--watch',
  '--preserveWatchOutput',
], {
  cwd: AI_CHAT,
  stdout: 'pipe',
  stderr: 'inherit',
});
const consumeAiChatWatcher = (async () => {
  const reader = aiChatWatcher.stdout.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    aiChatWatcherOutput += decoder.decode(value, { stream: true });
    if (aiChatWatcherOutput.includes('Watching for file changes.')) {
      aiChatWatcherReadyResolve();
    }
  }
})();
let canvasWatcherOutput = '';
let canvasWatcherReadyResolve!: () => void;
const canvasWatcherReady = new Promise<void>((resolveReady) => {
  canvasWatcherReadyResolve = resolveReady;
});
const canvasWatcher = Bun.spawn([
  TSC,
  '-b',
  'tsconfig.dev.json',
  '--watch',
  '--preserveWatchOutput',
], {
  cwd: CANVAS,
  stdout: 'pipe',
  stderr: 'inherit',
});
const consumeCanvasWatcher = (async () => {
  const reader = canvasWatcher.stdout.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    canvasWatcherOutput += decoder.decode(value, { stream: true });
    if (canvasWatcherOutput.includes('Watching for file changes.')) {
      canvasWatcherReadyResolve();
    }
  }
})();
const consumer = Bun.spawn([
  'bun',
  '--watch',
  'tests/fixtures/live-public-import-consumer.ts',
], {
  cwd: BACKEND,
  stdout: 'pipe',
  stderr: 'pipe',
});
const consumeStdout = (async () => {
  const reader = consumer.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      consumerOutput += `${line}\n`;
      const match = /^READY (\d+) (\d+)$/.exec(line);
      if (match === null) continue;
      readyCount += 1;
      if (readyCount === 1) readyResolve({ port: Number(match[1]), pid: Number(match[2]) });
    }
  }
})();

try {
  const [healthy] = await Promise.race([
    Promise.all([ready, aiChatWatcherReady, canvasWatcherReady]),
    Bun.sleep(10_000).then(() => {
      throw new Error('Timed out waiting for the source-run consumers.');
    }),
  ]);
  if (!aiChatWatcherOutput.includes('Found 0 errors.')) {
    throw new Error(`AI Chat dev type watcher did not start cleanly.\n${aiChatWatcherOutput}`);
  }
  if (!canvasWatcherOutput.includes('Found 0 errors.')) {
    throw new Error(`Canvas dev declaration watcher did not start cleanly.\n${canvasWatcherOutput}`);
  }
  console.log('[source-run-imports] live consumers and declaration watchers are ready');
  const build = Bun.spawn(['bun', 'run', 'build:public'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  buildProcess = build;
  let buildFinished = false;
  const buildExit = build.exited.then((exitCode) => {
    buildFinished = true;
    return exitCode;
  });
  let healthChecks = 0;
  do {
    for (const [directory, entries] of [
      [BACKEND, backendEntries],
      [FRONTEND, frontendEntries],
    ] as const) {
      for (const specifier of entries) {
        const target = Bun.resolveSync(specifier, directory);
        if (specifier.endsWith('/package.json')) {
          if (target !== join(ROOT, 'packages/sdk/package.json')) {
            throw new Error(`${specifier} resolved through an unstable package output: ${target}`);
          }
        } else if (!target.includes(`${join(ROOT, 'packages')}/`) || !target.includes('/src/')) {
          throw new Error(`${specifier} resolved outside its supported source entrypoint: ${target}`);
        }
        await readFile(target);
      }
    }
    const response = await fetch(`http://127.0.0.1:${healthy.port}/health`);
    const body = await response.json() as Readonly<{ pid: number; sdkVersion: string }>;
    if (!response.ok || body.pid !== healthy.pid || body.sdkVersion !== SDK_VERSION) {
      throw new Error(`Source-run backend health changed during build: ${JSON.stringify(body)}`);
    }
    healthChecks += 1;
    await Bun.sleep(2);
  } while (!buildFinished);

  const exitCode = await buildExit;
  console.log(`[source-run-imports] concurrent build:public exited with code ${exitCode}`);
  const [stdout, stderr] = await Promise.all([
    outputText(build.stdout),
    outputText(build.stderr),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Concurrent build:public failed (${exitCode}).\n${stdout}\n${stderr}`);
  }
  if (readyCount !== 1 || healthChecks < 2) {
    throw new Error(`Expected one uninterrupted source-run process and repeated health checks; got ${readyCount} starts and ${healthChecks} checks.`);
  }
  if (aiChatWatcher.exitCode !== null || /error TS\d+|Cannot find module '@omnidraw\/canvas'/.test(aiChatWatcherOutput)) {
    throw new Error(`AI Chat dev type watcher failed during build:public.\n${aiChatWatcherOutput}`);
  }
  if (
    canvasWatcher.exitCode !== null
    || /error TS\d+|Cannot find module '@omnidraw\/canvas-contract(?:\/CONSTANTS)?'/.test(canvasWatcherOutput)
  ) {
    throw new Error(`Canvas dev declaration watcher failed during build:public.\n${canvasWatcherOutput}`);
  }
  await readFile(join(CANVAS, 'dist/index.d.ts'));
  console.log(`[source-run-imports] backend, Canvas declarations, and AI Chat dev types stayed healthy across build:public (${healthChecks} checks)`);
} finally {
  console.log('[source-run-imports] stopping live consumers and declaration watchers');
  if (!aiChatWatcherOutput.includes('Watching for file changes.')) {
    process.stderr.write(`AI Chat watcher output:\n${aiChatWatcherOutput}`);
  }
  if (!canvasWatcherOutput.includes('Watching for file changes.')) {
    process.stderr.write(`Canvas watcher output:\n${canvasWatcherOutput}`);
  }
  if (buildProcess !== null) await stopProcess(buildProcess);
  await Promise.all([
    stopProcess(aiChatWatcher),
    stopProcess(canvasWatcher),
    stopProcess(consumer),
  ]);
  await Promise.race([
    Promise.all([consumeAiChatWatcher, consumeCanvasWatcher, consumeStdout]),
    Bun.sleep(2_000),
  ]);
  const stderr = await outputText(consumer.stderr);
  if (consumerOutput !== '' && readyCount === 0) process.stderr.write(consumerOutput);
  if (stderr !== '') process.stderr.write(stderr);
}
