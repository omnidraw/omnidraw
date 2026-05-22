import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'bun:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const cliEntrypoint = path.join(repoRoot, 'apps/cli/src/main.ts');
const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const candidate = cleanupPaths.pop();
    if (!candidate) continue;
    await rm(candidate, { recursive: true, force: true });
  }
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const proc = spawn('bun', ['run', cliEntrypoint, ...args], { cwd: repoRoot, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

describe('canvas CLI --db bootstrap', () => {
  test('cli --db wins over VIBECANVAS_CONFIG and opens the explicit sqlite path', async () => {
    const sandbox = await createTempDir('vc-cli-db-');
    const configDir = path.join(sandbox, 'config-fallback');
    const explicitDir = path.join(sandbox, 'explicit', 'nested');
    const explicitDbPath = path.join(explicitDir, 'canvas-under-test.sqlite');

    await mkdir(configDir, { recursive: true });

    const result = await runCli(['canvas', 'list', '--db', explicitDbPath, '--json'], { VIBECANVAS_CONFIG: configDir });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');

    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toMatchObject({ ok: true, command: 'canvas', subcommand: 'list', dbPath: explicitDbPath, count: 0, canvases: [] });

    const explicitStat = await stat(explicitDbPath);
    expect(explicitStat.isFile()).toBe(true);
    expect(stat(path.join(configDir, 'vibecanvas.turso'))).rejects.toThrow();
  });

  test('missing --db value fails before stateful imports and returns json error', async () => {
    const sandbox = await createTempDir('vc-cli-db-missing-');
    const configDir = path.join(sandbox, 'fallback-config');
    await mkdir(configDir, { recursive: true });

    const result = await runCli(['canvas', 'list', '--db', '--json'], { VIBECANVAS_CONFIG: configDir });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe('');

    const parsed = JSON.parse(result.stderr.trim());
    expect(parsed).toMatchObject({
      ok: false,
      command: null,
      code: 'DB_FLAG_MISSING_VALUE',
      hint: 'Pass one SQLite file path right after --db.',
      next: 'Try: vibecanvas canvas list --db ./tmp/vibecanvas.turso --json',
    });
    expect(stat(path.join(configDir, 'vibecanvas.turso'))).rejects.toThrow();
  });
});
