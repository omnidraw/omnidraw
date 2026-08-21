#!/usr/bin/env bun

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertSourceReleaseBuild,
  collectSourceReleaseOutputRecords,
} from '../apps/backend/src/shell/release/source-release-build';

const ROOT = resolve(import.meta.dir, '..');
const READY_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

type TRunningRelease = Readonly<{
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  processGroupId: number;
  ready: Promise<void>;
  stdout: Promise<string>;
  stderr: Promise<string>;
}>;

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onText?: (text: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const text = decoder.decode(result.value, { stream: true });
    output += text;
    onText?.(output);
  }
  output += decoder.decode();
  onText?.(output);
  return output;
}

async function waitForReady(
  running: TRunningRelease,
): Promise<void> {
  const outcome = await Promise.race([
    running.ready.then(() => 'ready' as const),
    running.child.exited.then((exitCode) => ({ exitCode })),
    Bun.sleep(READY_TIMEOUT_MS).then(() => 'timeout' as const),
  ]);
  if (outcome === 'ready') return;
  if (outcome === 'timeout') throw new Error('Timed out waiting for the readiness message.');
  throw new Error(`Source release exited ${outcome.exitCode} before readiness.`);
}

function startRelease(
  args: readonly string[],
  environment: Record<string, string>,
  expectedReady: string,
): TRunningRelease {
  const child = Bun.spawn([
    process.execPath,
    'run',
    'start',
    '--',
    ...args,
  ], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, ...environment },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  return {
    child,
    processGroupId: child.pid,
    ready,
    stdout: readStream(child.stdout, (output) => {
      if (output.includes(expectedReady)) resolveReady();
    }),
    stderr: readStream(child.stderr),
  };
}

function killProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function processGroupMembers(processGroupId: number): Promise<number[]> {
  const child = Bun.spawn(['ps', '-axo', 'pid=,pgid='], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Could not inspect the source-release process group.\n${stderr}`);
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match || Number(match[2]) !== processGroupId) return [];
    return [Number(match[1])];
  });
}

async function assertProcessGroupExited(processGroupId: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const members = await processGroupMembers(processGroupId);
    if (members.length === 0) return;
    if (attempt < 19) await Bun.sleep(50);
  }
  const leaked = await processGroupMembers(processGroupId);
  killProcessGroup(processGroupId, 'SIGKILL');
  throw new Error(`Source release leaked child processes after shutdown: ${leaked.join(', ')}.`);
}

async function assertHttpSurface(port: number): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error(`/health returned ${health.status}.`);
  const healthBody = await health.json() as Record<string, unknown>;
  if (healthBody.ok !== true || healthBody.runtime !== 'source') {
    throw new Error(`/health returned an unexpected source identity: ${JSON.stringify(healthBody)}`);
  }

  for (const pathname of ['/', '/canvases/source-release-probe']) {
    const response = await fetch(`${base}${pathname}`);
    const body = await response.text();
    if (!response.ok || !body.includes('id="root"')) {
      throw new Error(`${pathname} did not serve the built SPA (status ${response.status}).`);
    }
  }

  await new Promise<void>((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
    const timeout = setTimeout(() => {
      socket.close();
      rejectOpen(new Error('The application WebSocket did not open.'));
    }, 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      socket.close();
      resolveOpen();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      rejectOpen(new Error('The application WebSocket failed to open.'));
    }, { once: true });
  });
}

async function shutdownRelease(running: TRunningRelease, port: number): Promise<void> {
  running.child.kill('SIGINT');
  const exitCode = await Promise.race([
    running.child.exited,
    Bun.sleep(SHUTDOWN_TIMEOUT_MS).then(() => null),
  ]);
  if (exitCode === null) {
    killProcessGroup(running.processGroupId, 'SIGKILL');
    throw new Error(`Source release did not shut down within ${SHUTDOWN_TIMEOUT_MS}ms.`);
  }
  await assertProcessGroupExited(running.processGroupId);
  const [stdout, stderr] = await Promise.all([running.stdout, running.stderr]);
  if (exitCode !== 0) {
    throw new Error(`Source release exited ${exitCode}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    throw new Error(`Server still answered after shutdown (${response.status}).`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Server still answered')) throw error;
  }
}

async function runRelease(args: Readonly<{
  port: number;
  cliArgs: readonly string[];
  environment: Record<string, string>;
}>): Promise<void> {
  const expectedReady = `Omnidraw is ready at http://127.0.0.1:${args.port}/`;
  const running = startRelease(args.cliArgs, args.environment, expectedReady);
  try {
    await waitForReady(running);
    await assertHttpSurface(args.port);
  } catch (error) {
    killProcessGroup(running.processGroupId, 'SIGKILL');
    const [stdout, stderr] = await Promise.all([running.stdout, running.stderr]);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  await shutdownRelease(running, args.port);
}

await assertSourceReleaseBuild(ROOT);
const before = await collectSourceReleaseOutputRecords(ROOT);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'omnidraw-source-release-'));
const defaultHome = join(temporaryRoot, 'default-home');
const environmentHome = join(temporaryRoot, 'environment-home');
const cliHome = join(temporaryRoot, 'cli-home');

try {
  await runRelease({
    port: 7496,
    cliArgs: ['--data-dir', defaultHome],
    environment: {},
  });
  await stat(join(defaultHome, 'main.db'));

  await runRelease({
    port: 8080,
    cliArgs: ['--port', '8080', '--data-dir', cliHome],
    environment: { OMNIDRAW_HOME: environmentHome },
  });
  await stat(join(cliHome, 'main.db'));
  try {
    await stat(environmentHome);
    throw new Error('--data-dir did not take precedence over OMNIDRAW_HOME.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const after = await collectSourceReleaseOutputRecords(ROOT);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error('bun run start changed sealed build outputs.');
  }
  await assertSourceReleaseBuild(ROOT);
  console.log('[source-release] default and override starts passed without changing build outputs.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

// Bun keeps the WebSocket client's event-loop handle alive after a completed
// close handshake. All subprocesses and probes have been awaited above.
process.exit(0);
