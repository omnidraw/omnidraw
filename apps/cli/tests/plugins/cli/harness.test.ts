import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCliTestContext, expectExitCode, expectNoStderr, parseJsonStdout, type TCliTestContext } from './harness';

const activeContexts = new Set<TCliTestContext>();

async function createContext(): Promise<TCliTestContext> {
  const context = await createCliTestContext();
  activeContexts.add(context);
  return context;
}

afterEach(async () => {
  for (const context of activeContexts) {
    await context.cleanup();
  }
  activeContexts.clear();
});

describe('CLI test harness', () => {
  test('standardizes subprocess assertions for exit code stdout stderr and json payloads', async () => {
    const context = await createContext();
    const result = await context.runProcess({ cmd: ['bun', '-e', 'console.log(JSON.stringify({ ok: true, value: 7 })); console.error("warn"); process.exit(3)'] });

    expectExitCode(result, 3);
    expect(result.stderr).toContain('warn');
    expect(parseJsonStdout<{ ok: boolean; value: number }>(result)).toEqual({ ok: true, value: 7 });
  });

  test('runs the real vibecanvas CLI help entry point end to end', async () => {
    const context = await createContext();
    const result = await context.runVibecanvasCli(['--help']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('Commands:');
    expect(result.stdout).toContain('serve     Start the vibecanvas runtime');
    expect(result.stdout).toContain('upgrade   Check for and install updates');
    expect(result.stdout).toContain('uninstall Remove the installed binary');
    expect(result.stdout).toContain('--data-dir <path>');
    expect(result.stdout).toContain('VIBECANVAS_HOME');
    expect(result.stdout).not.toContain('--db');
    expect(result.stdout).not.toContain('Canvas subcommands:');
    expect(result.stdout).not.toContain('vibecanvas canvas');
    expect(existsSync(context.homeDir)).toBe(false);
  }, 15_000);

  test('shows help without probing the widget toolchain', async () => {
    const context = await createContext();
    const result = await context.runProcess({
      cmd: [process.execPath, 'run', 'apps/cli/src/main.ts', '--help'],
      env: { ...process.env, PATH: '', VIBECANVAS_HOME: context.homeDir },
    });

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain('Usage:');
    expect(existsSync(context.homeDir)).toBe(false);
  }, 15_000);

  test('refuses an unknown home before creating directories or a database', async () => {
    const context = await createContext();
    const actorEraDatabase = join(context.homeDir, 'vibecanvas.turso');
    const originalBytes = Buffer.from('actor-era-database-marker\n');
    await mkdir(context.homeDir, { recursive: true });
    await writeFile(actorEraDatabase, originalBytes);

    const result = await context.runVibecanvasCli(['serve', '--port', '30991']);

    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(context.homeDir);
    expect(result.stderr).toContain('Actor-era and unknown non-empty layouts are unsupported.');
    expect(result.stderr).toContain('Archive or move');
    expect(result.stderr).toContain('--data-dir <fresh-path>');
    expect(await readdir(context.homeDir)).toEqual(['vibecanvas.turso']);
    expect(await readFile(actorEraDatabase)).toEqual(originalBytes);
    expect(existsSync(context.dbPath)).toBe(false);
  }, 15_000);

  test('suggests nearest remaining commands for unknown root commands', async () => {
    const context = await createContext();

    const rootUnknown = await context.runVibecanvasCli(['upgarde', '--json']);
    expectExitCode(rootUnknown, 1);
    expect(rootUnknown.stdout).toBe('');
    expect(JSON.parse(rootUnknown.stderr)).toMatchObject({
      ok: false,
      command: 'cli',
      code: 'CLI_COMMAND_UNKNOWN',
      hint: "Did you mean 'upgrade'?",
      next: 'Try: vibecanvas upgrade --help',
      suggestions: ['upgrade'],
    });

    const uninstallUnknown = await context.runVibecanvasCli(['uninstal', '--json']);
    expectExitCode(uninstallUnknown, 1);
    expect(JSON.parse(uninstallUnknown.stderr)).toMatchObject({
      hint: "Did you mean 'uninstall'?",
      next: 'Try: vibecanvas uninstall --help',
      suggestions: ['uninstall'],
    });
  }, 15_000);

  test('runs uninstall dry-run without deleting test config', async () => {
    const context = await createContext();
    const result = await context.runVibecanvasCli(['uninstall', '--dry-run']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain('[Uninstall] Dry-run');
    expect(result.stdout).toContain('home dir');
    expect(existsSync(context.homeDir)).toBe(false);
  }, 15_000);
});
