import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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

  test('runs the real omnidraw CLI help entry point end to end', async () => {
    const context = await createContext();
    const result = await context.runOmnidrawCli(['--help']);

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('Commands:');
    expect(result.stdout).toContain('serve     Start the omnidraw runtime');
    expect(result.stdout).toContain('canvas    Query and mutate a running canvas server');
    expect(result.stdout).not.toContain('upgrade');
    expect(result.stdout).not.toContain('uninstall');
    expect(result.stdout).toContain('--data-dir <path>');
    expect(result.stdout).toContain('OMNIDRAW_HOME');
    expect(result.stdout).toContain('default: 7496');
    expect(result.stdout).toContain('serve --port 8080');
    expect(result.stdout).not.toContain('--db');
    expect(result.stdout).not.toContain('Canvas subcommands:');
    expect(result.stdout).toContain('omnidraw canvas list --json');
    expect(existsSync(context.homeDir)).toBe(false);
  }, 15_000);

  test('shows help without probing the widget toolchain', async () => {
    const context = await createContext();
    const result = await context.runProcess({
      cmd: [process.execPath, 'run', 'apps/backend/src/main.ts', '--help'],
      env: { ...process.env, PATH: '', OMNIDRAW_HOME: context.homeDir },
    });

    expectExitCode(result, 0);
    expectNoStderr(result);
    expect(result.stdout).toContain('Usage:');
    expect(existsSync(context.homeDir)).toBe(false);
  }, 15_000);

  test('suggests nearest remaining commands for unknown root commands', async () => {
    const context = await createContext();

    const rootUnknown = await context.runOmnidrawCli(['canvs', '--json']);
    expectExitCode(rootUnknown, 1);
    expect(rootUnknown.stdout).toBe('');
    expect(JSON.parse(rootUnknown.stderr)).toMatchObject({
      ok: false,
      command: 'cli',
      code: 'CLI_COMMAND_UNKNOWN',
      hint: "Did you mean 'canvas'?",
      next: 'Try: omnidraw canvas --help',
      suggestions: ['canvas'],
    });
  }, 15_000);
});
