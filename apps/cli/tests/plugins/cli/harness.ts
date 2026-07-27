import { expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../../../..');

export type TProcessResult = {
  cmd: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type TCliTestContext = {
  tempRoot: string;
  homeDir: string;
  dbPath: string;
  cleanup(): Promise<void>;
  runProcess(args: {
    cmd: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdinText?: string;
  }): Promise<TProcessResult>;
  runVibecanvasCli(args: readonly string[]): Promise<TProcessResult>;
};

function sanitizeEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? process.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function createCliTestContext(): Promise<TCliTestContext> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-cli-'));
  const homeDir = join(tempRoot, 'vibecanvas');
  const dbPath = join(homeDir, 'main.db');
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await rm(tempRoot, { recursive: true, force: true });
  };

  const runProcess = async (args: {
    cmd: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdinText?: string;
  }): Promise<TProcessResult> => new Promise((resolvePromise, rejectPromise) => {
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
      if (signal) {
        rejectPromise(
          new Error(`Process ${args.cmd.join(' ')} exited via signal ${signal}`),
        );
        return;
      }
      resolvePromise({
        cmd: [...args.cmd],
        cwd: args.cwd ?? REPO_ROOT,
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });
    if (args.stdinText !== undefined) proc.stdin.write(args.stdinText);
    proc.stdin.end();
  });

  return {
    tempRoot,
    homeDir,
    dbPath,
    cleanup,
    runProcess,
    runVibecanvasCli: (args) => runProcess({
      cmd: ['bun', 'run', 'apps/cli/src/main.ts', ...args],
      cwd: REPO_ROOT,
      env: { ...process.env, VIBECANVAS_HOME: homeDir },
    }),
  };
}

export function expectExitCode(
  result: TProcessResult,
  expectedExitCode: number,
): void {
  expect(
    result.exitCode,
    `stdout:\n${result.stdout || '<empty>'}\n\nstderr:\n${result.stderr || '<empty>'}`,
  ).toBe(expectedExitCode);
}

export function expectNoStderr(result: TProcessResult): void {
  expect(result.stderr).toBe('');
}

export function parseJsonStdout<T>(result: TProcessResult): T {
  return JSON.parse(result.stdout) as T;
}
