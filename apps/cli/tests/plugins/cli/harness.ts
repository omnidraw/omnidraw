import type { TCanvasDoc, TElement, TElementStyle, TGroup, TRectData } from '@vibecanvas/service-automerge/types/canvas-doc';
import * as schema from '@vibecanvas/service-db/schema';
import { expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../../../..');
const EXPECTED_MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/service-db/database-migrations');

type TCanvasRow = typeof schema.canvas.$inferSelect;

export type TProcessResult = {
  cmd: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type TSeedCanvasArgs = {
  name?: string;
  docId?: string;
  docName?: string;
  createdAtUnixSeconds?: number;
  elements?: Record<string, TElement>;
  groups?: Record<string, TGroup>;
};

export type TSeededCanvas = {
  canvas: TCanvasRow;
  automergeUrl: string;
};

export type TCliTestContext = {
  tempRoot: string;
  dataDir: string;
  cacheDir: string;
  configDir: string;
  dbPath: string;
  cleanup: () => Promise<void>;
  listCanvases: () => Promise<TCanvasRow[]>;
  seedCanvasFixture: (args?: TSeedCanvasArgs) => Promise<TSeededCanvas>;
  readCanvasDoc: (automergeUrl: string) => Promise<TCanvasDoc>;
  runProcess: (args: { cmd: string[]; cwd?: string; env?: NodeJS.ProcessEnv; stdinText?: string }) => Promise<TProcessResult>;
  runVibecanvasCli: (args: readonly string[]) => Promise<TProcessResult>;
  runCanvasCli: (args: readonly string[]) => Promise<TProcessResult>;
};

function sanitizeEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(env ?? process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export async function createCliTestContext(): Promise<TCliTestContext> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-cli-'));
  const dataDir = join(tempRoot, 'data');
  const cacheDir = join(tempRoot, 'cache');
  const configDir = join(tempRoot, 'config');
  const dbPath = join(dataDir, 'vibecanvas.sqlite');

  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
  ]);

  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await rm(tempRoot, { recursive: true, force: true });
  };

  const runProcess = async (args: { cmd: string[]; cwd?: string; env?: NodeJS.ProcessEnv; stdinText?: string }): Promise<TProcessResult> => {
    return new Promise<TProcessResult>((resolvePromise, rejectPromise) => {
      const proc = spawn(args.cmd[0]!, args.cmd.slice(1), {
        cwd: args.cwd ?? REPO_ROOT,
        env: sanitizeEnv(args.env),
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', rejectPromise);
      proc.on('close', (code, signal) => {
        if (signal) return rejectPromise(new Error(`Process ${args.cmd.join(' ')} exited via signal ${signal}`));
        resolvePromise({ cmd: [...args.cmd], cwd: args.cwd ?? REPO_ROOT, exitCode: code ?? 0, stdout, stderr });
      });

      if (args.stdinText !== undefined) {
        proc.stdin.write(args.stdinText);
      }

      proc.stdin.end();
    });
  };

  const runVibecanvasCli = (args: readonly string[]) => runProcess({ cmd: ['bun', 'run', 'apps/cli/src/main.ts', ...args], cwd: REPO_ROOT, env: { ...process.env, VIBECANVAS_CONFIG: configDir } });

  const runCanvasCli = (args: readonly string[]) => {
    if (args.includes('--db')) throw new Error('runCanvasCli() appends --db automatically; tests must not pass it twice.');
    return runVibecanvasCli(['canvas', ...args, '--db', dbPath]);
  };

  const runHarnessWorker = async <TResult>(command: string, payload: unknown): Promise<TResult> => {
    const result = await runProcess({ cmd: ['bun', 'run', 'apps/cli/tests/plugins/cli/harness.worker.ts', command, encodePayload(payload)], cwd: REPO_ROOT, env: { ...process.env, VIBECANVAS_CONFIG: configDir } });
    if (result.exitCode !== 0) throw new Error(`Harness worker failed for ${command}: ${result.stderr || result.stdout}`);
    return result.stdout.trim() ? JSON.parse(result.stdout) as TResult : (undefined as TResult);
  };

  const dbServiceEntry = resolve(REPO_ROOT, 'packages/service-db/src/DbServiceBunSqlite/index.ts');
  const migrateResult = await runProcess({
    cmd: [
      'bun',
      '-e',
      `import { createSqliteDb } from ${JSON.stringify(dbServiceEntry)}; const db = await createSqliteDb({ databasePath: process.env.VIBECANVAS_DB, dataDir: process.env.VIBECANVAS_DATA_DIR, cacheDir: process.env.VIBECANVAS_CACHE_DIR, silentMigrations: false }); await db.stop();`,
    ],
    cwd: REPO_ROOT,
    env: { ...process.env, VIBECANVAS_DB: dbPath, VIBECANVAS_DATA_DIR: dataDir, VIBECANVAS_CACHE_DIR: cacheDir, VIBECANVAS_CONFIG: configDir },
  });

  if (migrateResult.exitCode !== 0) throw new Error(`Failed to initialize CLI test database: ${migrateResult.stderr || migrateResult.stdout}`);
  if (!migrateResult.stdout.includes(`[DB] Applying migrations from ${EXPECTED_MIGRATIONS_DIR}`)) throw new Error(`CLI test harness must bootstrap from ${EXPECTED_MIGRATIONS_DIR}. Received stdout: ${migrateResult.stdout}`);

  return {
    tempRoot,
    dataDir,
    cacheDir,
    configDir,
    dbPath,
    cleanup,
    listCanvases: () => runHarnessWorker<TCanvasRow[]>('list-canvases', { dbPath }),
    seedCanvasFixture: (args: TSeedCanvasArgs = {}) => runHarnessWorker<TSeededCanvas>('seed-canvas', { dbPath, args }),
    readCanvasDoc: (automergeUrl: string) => runHarnessWorker<TCanvasDoc>('read-canvas-doc', { dbPath, automergeUrl }),
    runProcess,
    runVibecanvasCli,
    runCanvasCli,
  };
}

export function createRectElement(args: Omit<Partial<TElement>, 'data' | 'style'> & { data?: Partial<TRectData>; style?: TElementStyle } = {}): TElement {
  const now = Date.now();
  return {
    id: args.id ?? crypto.randomUUID(),
    x: args.x ?? 0,
    y: args.y ?? 0,
    rotation: args.rotation ?? 0,
    zIndex: args.zIndex ?? 'a0',
    parentGroupId: args.parentGroupId ?? null,
    bindings: structuredClone(args.bindings ?? []),
    locked: args.locked ?? false,
    createdAt: args.createdAt ?? now,
    updatedAt: args.updatedAt ?? now,
    data: { type: 'rect', w: 120, h: 80, ...args.data },
    style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: 1, opacity: 1, ...args.style },
  };
}

export function createTextElement(args: Omit<Partial<TElement>, 'data' | 'style'> & { data?: Partial<Extract<TCanvasDoc['elements'][string]['data'], { type: 'text' }>>; style?: TElementStyle } = {}): TElement {
  const now = Date.now();
  return {
    id: args.id ?? crypto.randomUUID(),
    x: args.x ?? 0,
    y: args.y ?? 0,
    rotation: args.rotation ?? 0,
    zIndex: args.zIndex ?? 'a0',
    parentGroupId: args.parentGroupId ?? null,
    bindings: structuredClone(args.bindings ?? []),
    locked: args.locked ?? false,
    createdAt: args.createdAt ?? now,
    updatedAt: args.updatedAt ?? now,
    data: {
      type: 'text',
      w: 120,
      h: 40,
      text: 'hello',
      originalText: 'hello',
      fontSize: 16,
      fontFamily: 'Inter',
      textAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      link: null,
      containerId: null,
      autoResize: false,
      ...args.data,
    },
    style: { backgroundColor: '#ffffff', strokeColor: '#111111', strokeWidth: 1, opacity: 1, ...args.style },
  };
}

export function createGroup(args: Partial<TGroup> = {}): TGroup {
  return { id: args.id ?? crypto.randomUUID(), parentGroupId: args.parentGroupId ?? null, zIndex: args.zIndex ?? 'a0', locked: args.locked ?? false, createdAt: args.createdAt ?? Date.now() };
}

export function expectExitCode(result: TProcessResult, expectedExitCode: number): void {
  expect(result.exitCode, `stdout:\n${result.stdout || '<empty>'}\n\nstderr:\n${result.stderr || '<empty>'}`).toBe(expectedExitCode);
}

export function expectNoStderr(result: TProcessResult): void {
  expect(result.stderr).toBe('');
}

export function parseJsonStdout<T>(result: TProcessResult): T {
  return JSON.parse(result.stdout) as T;
}
