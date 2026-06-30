import { afterEach, describe, expect, test } from 'bun:test';
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
    expect(result.stdout).not.toContain('Canvas subcommands:');
    expect(result.stdout).not.toContain('vibecanvas canvas');
  });

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
  });
});
