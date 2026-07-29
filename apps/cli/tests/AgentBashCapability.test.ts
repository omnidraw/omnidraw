import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createBunAgentBashCapability,
  type TAgentBashProcessDetails,
  type TAgentBashProcessPortal,
} from '../src/services/AgentBashCapability';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createCapturingPortal(terminals: Bun.Terminal[]): TAgentBashProcessPortal {
  return {
    env: process.env,
    which: (executable) => Bun.which(executable),
    createTerminal: (options) => {
      const terminal = new Bun.Terminal({
        cols: options.cols,
        rows: options.rows,
        name: options.name,
        data: (_terminal, data) => options.data(data),
        exit: (_terminal, exitCode, signal) => options.exit(exitCode, signal),
      });
      terminals.push(terminal);
      return terminal;
    },
    spawn: (command, options) => Bun.spawn([...command], {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      timeout: options.timeout,
      killSignal: options.killSignal,
      terminal: options.terminal as Bun.Terminal,
    }),
  };
}

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibecanvas-agent-bash-'));
  roots.push(root);
  const workspace = join(root, 'workspace with spaces');
  await mkdir(workspace);
  return realpath(workspace);
}

describe('Bun Agent Bash capability', () => {
  test('starts in the exact cwd while preserving traversal, combined PTY output, UTF-8, and TTY behavior', async () => {
    const cwd = await createWorkspace();
    const terminals: Bun.Terminal[] = [];
    const capability = createBunAgentBashCapability(createCapturingPortal(terminals));
    const command = [
      'printf "stdout-line\\n"',
      'printf "stderr-line\\n" >&2',
      '[ -t 1 ] && printf "TTY_TRUE\\n"',
      'printf "start=%s\\n" "$PWD"',
      'cd ..',
      'printf "parent=%s\\n" "$PWD"',
      "printf '\\342'",
      'sleep 0.02',
      "printf '\\202\\254\\n'",
    ].join('; ');

    const result = await capability.run({
      toolCallId: 'bash-real',
      command,
      cwd,
      timeoutSeconds: 5,
    });

    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      status: 'succeeded',
      cwd,
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      outputTruncated: false,
      terminalCreated: true,
      terminalClosed: true,
    });
    expect(result.details.output).toContain('stdout-line\n');
    expect(result.details.output).toContain('stderr-line\n');
    expect(result.details.output).toContain('TTY_TRUE\n');
    expect(result.details.output).toContain(`start=${cwd}\n`);
    expect(result.details.output).toContain(`parent=${dirname(cwd)}\n`);
    expect(result.details.output).toContain('€\n');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.closed).toBe(true);
  });

  test('reports exact non-zero and signal outcomes', async () => {
    const cwd = await createWorkspace();
    const terminals: Bun.Terminal[] = [];
    const capability = createBunAgentBashCapability(createCapturingPortal(terminals));

    const nonZero = await capability.run({
      toolCallId: 'bash-non-zero',
      command: 'exit 23',
      cwd,
      timeoutSeconds: 5,
    });
    expect(nonZero.isError).toBe(true);
    expect(nonZero.details).toMatchObject({
      status: 'non_zero',
      code: 'BASH_EXIT_NON_ZERO',
      exitCode: 23,
      signal: null,
    });

    const signaled = await capability.run({
      toolCallId: 'bash-signal',
      command: 'kill -TERM $$',
      cwd,
      timeoutSeconds: 5,
    });
    expect(signaled.isError).toBe(true);
    expect(signaled.details).toMatchObject({
      status: 'signaled',
      code: 'BASH_SIGNALED',
      signal: 'SIGTERM',
    });
    expect(terminals).toHaveLength(2);
    expect(terminals.every((terminal) => terminal.closed)).toBe(true);
  });

  test('forwards timeout and caller cancellation and settles each child', async () => {
    const cwd = await createWorkspace();
    const terminals: Bun.Terminal[] = [];
    const capability = createBunAgentBashCapability(createCapturingPortal(terminals));

    const timedOut = await capability.run({
      toolCallId: 'bash-timeout',
      command: 'printf "timeout-ready\\n"; while :; do :; done',
      cwd,
      timeoutSeconds: 1,
    });
    expect(timedOut.isError).toBe(true);
    expect(timedOut.details).toMatchObject({
      status: 'timed_out',
      code: 'BASH_TIMED_OUT',
      timedOut: true,
      cancelled: false,
    });
    expect(timedOut.details.output).toContain('timeout-ready\n');

    const controller = new AbortController();
    const cancelledRun = capability.run({
      toolCallId: 'bash-cancelled',
      command: 'printf "cancel-ready\\n"; while :; do :; done',
      cwd,
      timeoutSeconds: 5,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 1_000);
    const cancelled = await cancelledRun;
    expect(cancelled.isError).toBe(true);
    expect(cancelled.details).toMatchObject({
      status: 'cancelled',
      code: 'BASH_CANCELLED',
      timedOut: false,
      cancelled: true,
    });
    expect(cancelled.details.output).toContain('cancel-ready\n');
    expect(terminals).toHaveLength(2);
    expect(terminals.every((terminal) => terminal.closed)).toBe(true);
  });

  test('enforces positive sub-millisecond timeout values', async () => {
    const cwd = await createWorkspace();
    const terminals: Bun.Terminal[] = [];
    const capability = createBunAgentBashCapability(createCapturingPortal(terminals));

    const result = await capability.run({
      toolCallId: 'bash-sub-millisecond-timeout',
      command: 'sleep 0.2',
      cwd,
      timeoutSeconds: 0.0001,
    });

    expect(result.details).toMatchObject({
      status: 'timed_out',
      code: 'BASH_TIMED_OUT',
      timedOut: true,
      signal: 'SIGTERM',
    });
    expect(result.details.exitCode).not.toBe(0);
    expect(terminals[0]?.closed).toBe(true);
  });

  test('bounds retained noisy output and emits bounded ordered updates', async () => {
    const cwd = await createWorkspace();
    const terminals: Bun.Terminal[] = [];
    const capability = createBunAgentBashCapability(createCapturingPortal(terminals));
    const sequences: number[] = [];
    const updateOutputLengths: number[] = [];

    const result = await capability.run({
      toolCallId: 'bash-noisy',
      command: "i=0; while [ \"$i\" -lt 20000 ]; do printf '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\\n'; i=$((i + 1)); done",
      cwd,
      timeoutSeconds: 10,
      onUpdate: (update) => {
        const details = update.details as TAgentBashProcessDetails;
        if (details.updateSequence !== undefined) sequences.push(details.updateSequence);
        updateOutputLengths.push(details.output.length);
      },
    });

    expect(result.details.status).toBe('succeeded');
    expect(result.details.outputTruncated).toBe(true);
    expect(result.details.outputBytes).toBeGreaterThan(1_000_000);
    expect(result.details.output.length).toBeLessThan(66_000);
    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences.length).toBeLessThanOrEqual(101);
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    expect(Math.max(...updateOutputLengths)).toBeLessThan(66_000);
    expect(terminals[0]?.closed).toBe(true);
  });

  test('returns stable missing-executable and spawn-failure results', async () => {
    const cwd = await createWorkspace();
    let spawnCount = 0;
    let terminalClosed = false;

    const missing = createBunAgentBashCapability({
      env: {},
      which: () => null,
      createTerminal: () => {
        throw new Error('terminal must not be created');
      },
      spawn: () => {
        spawnCount += 1;
        throw new Error('process must not spawn');
      },
    });
    const missingResult = await missing.run({
      toolCallId: 'bash-missing',
      command: 'pwd',
      cwd,
      timeoutSeconds: 5,
    });
    expect(missingResult.details).toMatchObject({
      status: 'missing_bash',
      code: 'BASH_EXECUTABLE_UNAVAILABLE',
      terminalCreated: false,
      terminalClosed: true,
    });
    expect(spawnCount).toBe(0);

    const failed = createBunAgentBashCapability({
      env: {},
      which: () => '/bin/bash',
      createTerminal: () => ({
        close: () => {
          terminalClosed = true;
        },
      }),
      spawn: () => {
        spawnCount += 1;
        throw new Error('synthetic spawn failure');
      },
    });
    const failedResult = await failed.run({
      toolCallId: 'bash-spawn-failure',
      command: 'pwd',
      cwd,
      timeoutSeconds: 5,
    });
    expect(failedResult.details).toMatchObject({
      status: 'spawn_failed',
      code: 'BASH_SPAWN_FAILED',
      terminalCreated: true,
      terminalClosed: true,
    });
    expect(failedResult.details.output).toContain('synthetic spawn failure');
    expect(spawnCount).toBe(1);
    expect(terminalClosed).toBe(true);
  });
});
