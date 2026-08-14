#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const BACKEND = join(ROOT, 'apps/backend');
const FRONTEND = join(ROOT, 'apps/frontend');
const AI_CHAT = join(ROOT, 'packages/component-ai-chat');
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
  'bun',
  'x',
  'tsc',
  '-p',
  'tsconfig.dev.json',
  '--watch',
  '--preserveWatchOutput',
], {
  cwd: AI_CHAT,
  stdout: 'pipe',
  stderr: 'pipe',
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
    Promise.all([ready, aiChatWatcherReady]),
    Bun.sleep(10_000).then(() => {
      throw new Error('Timed out waiting for the source-run consumers.');
    }),
  ]);
  if (!aiChatWatcherOutput.includes('Found 0 errors.')) {
    throw new Error(`AI Chat dev type watcher did not start cleanly.\n${aiChatWatcherOutput}`);
  }
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
    if (!response.ok || body.pid !== healthy.pid || body.sdkVersion !== '0.8.0') {
      throw new Error(`Source-run backend health changed during build: ${JSON.stringify(body)}`);
    }
    healthChecks += 1;
    await Bun.sleep(2);
  } while (!buildFinished);

  const exitCode = await buildExit;
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
  console.log(`[source-run-imports] backend and AI Chat dev types stayed healthy across build:public (${healthChecks} checks)`);
} finally {
  try {
    buildProcess?.kill('SIGTERM');
  } catch {
    // A completed build no longer has a process to signal.
  }
  await buildProcess?.exited;
  aiChatWatcher.kill('SIGTERM');
  await aiChatWatcher.exited;
  await consumeAiChatWatcher;
  consumer.kill('SIGTERM');
  await consumer.exited;
  await consumeStdout;
  const stderr = await outputText(consumer.stderr);
  const aiChatWatcherStderr = await outputText(aiChatWatcher.stderr);
  if (consumerOutput !== '' && readyCount === 0) process.stderr.write(consumerOutput);
  if (stderr !== '') process.stderr.write(stderr);
  if (aiChatWatcherStderr !== '') process.stderr.write(aiChatWatcherStderr);
}
