import type {
  TAgentBashCapability,
  TAgentBashRunArgs,
} from '@vibecanvas/service-agent';

const OUTPUT_HEAD_CHARACTER_LIMIT = 32 * 1_024;
const OUTPUT_TAIL_CHARACTER_LIMIT = 32 * 1_024;
const OUTPUT_TRUNCATION_MARKER = '\n\n[output truncated; middle omitted]\n\n';
const LIVE_UPDATE_INTERVAL_MS = 100;
const LIVE_UPDATE_MAX_COUNT = 100;
const TERMINATION_SIGNAL = 'SIGTERM';

type TAgentBashTerminal = Readonly<{
  close(): void;
  readonly closed?: boolean;
}>;

type TAgentBashTerminalOptions = Readonly<{
  cols: number;
  rows: number;
  name: string;
  data(data: Uint8Array): void;
  exit(exitCode: number, signal: string | null): void;
}>;

type TAgentBashSpawnOptions = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeout: number;
  killSignal: NodeJS.Signals;
  terminal: TAgentBashTerminal;
}>;

type TAgentBashProcess = Readonly<{
  exited: Promise<number>;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}>;

export type TAgentBashProcessPortal = Readonly<{
  env: NodeJS.ProcessEnv;
  which(executable: string): string | null;
  createTerminal(options: TAgentBashTerminalOptions): TAgentBashTerminal;
  spawn(command: readonly string[], options: TAgentBashSpawnOptions): TAgentBashProcess;
}>;

export type TAgentBashProcessStatus =
  | 'running'
  | 'succeeded'
  | 'non_zero'
  | 'signaled'
  | 'timed_out'
  | 'cancelled'
  | 'missing_bash'
  | 'spawn_failed'
  | 'cleanup_failed';

export type TAgentBashProcessDetails = Readonly<{
  status: TAgentBashProcessStatus;
  code?: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  output: string;
  outputBytes: number;
  outputTruncated: boolean;
  terminalCreated: boolean;
  terminalClosed: boolean;
  updateSequence?: number;
}>;

type TAgentBashResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: TAgentBashProcessDetails;
  isError?: boolean;
};

type TOutputRetention = Readonly<{
  append(text: string, byteLength: number): void;
  read(normalizeCarriageReturns: boolean): Readonly<{
    output: string;
    outputBytes: number;
    truncated: boolean;
  }>;
}>;

const DEFAULT_PROCESS_PORTAL: TAgentBashProcessPortal = Object.freeze({
  env: process.env,
  which: (executable) => Bun.which(executable),
  createTerminal: (options) => new Bun.Terminal({
    cols: options.cols,
    rows: options.rows,
    name: options.name,
    data: (_terminal, data) => options.data(data),
    exit: (_terminal, exitCode, signal) => options.exit(exitCode, signal),
  }),
  spawn: (command, options) => Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    timeout: options.timeout,
    killSignal: options.killSignal,
    terminal: options.terminal as Bun.Terminal,
  }),
});

function createOutputRetention(): TOutputRetention {
  let head = '';
  let tail = '';
  let outputBytes = 0;
  let outputCharacters = 0;
  const maximumCharacters = OUTPUT_HEAD_CHARACTER_LIMIT + OUTPUT_TAIL_CHARACTER_LIMIT;

  return {
    append(text, byteLength) {
      outputBytes += byteLength;
      outputCharacters += text.length;
      let remainder = text;
      const availableHead = OUTPUT_HEAD_CHARACTER_LIMIT - head.length;
      if (availableHead > 0) {
        head += remainder.slice(0, availableHead);
        remainder = remainder.slice(availableHead);
      }
      if (remainder.length > 0) {
        tail = `${tail}${remainder}`.slice(-OUTPUT_TAIL_CHARACTER_LIMIT);
      }
    },
    read(normalizeCarriageReturns) {
      const truncated = outputCharacters > maximumCharacters;
      const retained = truncated
        ? `${head}${OUTPUT_TRUNCATION_MARKER}${tail}`
        : `${head}${tail}`;
      return {
        output: normalizeCarriageReturns
          ? retained.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
          : retained,
        outputBytes,
        truncated,
      };
    },
  };
}

function resultCode(status: TAgentBashProcessStatus): string | undefined {
  if (status === 'non_zero') return 'BASH_EXIT_NON_ZERO';
  if (status === 'signaled') return 'BASH_SIGNALED';
  if (status === 'timed_out') return 'BASH_TIMED_OUT';
  if (status === 'cancelled') return 'BASH_CANCELLED';
  if (status === 'missing_bash') return 'BASH_EXECUTABLE_UNAVAILABLE';
  if (status === 'spawn_failed') return 'BASH_SPAWN_FAILED';
  if (status === 'cleanup_failed') return 'BASH_TERMINAL_CLOSE_FAILED';
  return undefined;
}

function renderResult(details: TAgentBashProcessDetails): string {
  const metadata = [
    `status: ${details.status}`,
    `exitCode: ${details.exitCode ?? 'null'}`,
    `signal: ${details.signal ?? 'null'}`,
    `timedOut: ${details.timedOut}`,
    `cancelled: ${details.cancelled}`,
    `durationMs: ${details.durationMs}`,
    `outputTruncated: ${details.outputTruncated}`,
    `outputBytes: ${details.outputBytes}`,
  ];
  const code = details.code ? [`code: ${details.code}`] : [];
  return [
    details.status === 'running' ? 'Bash is running.' : 'Bash command settled.',
    ...code,
    ...metadata,
    '',
    'Output:',
    details.output || '[no output]',
  ].join('\n');
}

function createResult(details: TAgentBashProcessDetails): TAgentBashResult {
  return {
    content: [{ type: 'text', text: renderResult(details) }],
    details,
    ...(details.status !== 'running' && details.status !== 'succeeded'
      ? { isError: true }
      : {}),
  };
}

function closeTerminal(terminal: TAgentBashTerminal): Error | null {
  try {
    terminal.close();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function publishUpdate(
  onUpdate: TAgentBashRunArgs['onUpdate'],
  result: TAgentBashResult,
): void {
  try {
    onUpdate?.(result);
  } catch {
    // A UI/model update consumer cannot interrupt process draining or cleanup.
  }
}

export function createBunAgentBashCapability(
  portal: TAgentBashProcessPortal = DEFAULT_PROCESS_PORTAL,
) {
  return {
    async run(args: TAgentBashRunArgs): Promise<TAgentBashResult> {
      const startedAtMs = Date.now();
      const bashPath = portal.which('bash');
      if (bashPath === null) {
        const details: TAgentBashProcessDetails = {
          status: 'missing_bash',
          code: resultCode('missing_bash'),
          cwd: args.cwd,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          durationMs: Date.now() - startedAtMs,
          output: '',
          outputBytes: 0,
          outputTruncated: false,
          terminalCreated: false,
          terminalClosed: true,
        };
        const result = createResult(details);
        publishUpdate(args.onUpdate, result);
        return result;
      }

      if (args.signal?.aborted) {
        const details: TAgentBashProcessDetails = {
          status: 'cancelled',
          code: resultCode('cancelled'),
          cwd: args.cwd,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: true,
          durationMs: Date.now() - startedAtMs,
          output: '',
          outputBytes: 0,
          outputTruncated: false,
          terminalCreated: false,
          terminalClosed: true,
        };
        const result = createResult(details);
        publishUpdate(args.onUpdate, result);
        return result;
      }

      const retention = createOutputRetention();
      const decoder = new TextDecoder();
      let updateCount = 0;
      let updateTimer: ReturnType<typeof setTimeout> | null = null;
      let lastUpdateAtMs = Number.NEGATIVE_INFINITY;
      let terminationReason: 'timed_out' | 'cancelled' | null = null;
      let resolveTerminalExit: (() => void) | null = null;
      const terminalExited = new Promise<void>((resolve) => {
        resolveTerminalExit = resolve;
      });

      const runningDetails = (updateSequence: number): TAgentBashProcessDetails => {
        const retained = retention.read(false);
        return {
          status: 'running',
          cwd: args.cwd,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          durationMs: Date.now() - startedAtMs,
          output: retained.output,
          outputBytes: retained.outputBytes,
          outputTruncated: retained.truncated,
          terminalCreated: true,
          terminalClosed: false,
          updateSequence,
        };
      };
      const emitRunningUpdate = () => {
        updateTimer = null;
        if (!args.onUpdate || updateCount >= LIVE_UPDATE_MAX_COUNT) return;
        updateCount += 1;
        lastUpdateAtMs = Date.now();
        publishUpdate(args.onUpdate, createResult(runningDetails(updateCount)));
      };
      const scheduleRunningUpdate = () => {
        if (!args.onUpdate || updateCount >= LIVE_UPDATE_MAX_COUNT || updateTimer !== null) return;
        const delayMs = Math.max(0, LIVE_UPDATE_INTERVAL_MS - (Date.now() - lastUpdateAtMs));
        if (delayMs === 0) {
          emitRunningUpdate();
          return;
        }
        updateTimer = setTimeout(emitRunningUpdate, delayMs);
        (updateTimer as unknown as { unref?: () => void }).unref?.();
      };

      const terminal = portal.createTerminal({
        cols: 120,
        rows: 40,
        name: 'xterm-256color',
        data(data) {
          const decoded = decoder.decode(data, { stream: true });
          retention.append(decoded, data.byteLength);
          scheduleRunningUpdate();
        },
        exit() {
          resolveTerminalExit?.();
          resolveTerminalExit = null;
        },
      });

      const onAbort = () => {
        terminationReason ??= 'cancelled';
      };
      args.signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutMs = Math.max(1, Math.ceil(args.timeoutSeconds * 1_000));
      const timeoutMarker = setTimeout(() => {
        terminationReason ??= 'timed_out';
      }, timeoutMs);
      (timeoutMarker as unknown as { unref?: () => void }).unref?.();

      let process: TAgentBashProcess;
      try {
        process = portal.spawn([bashPath, '-lc', args.command], {
          cwd: args.cwd,
          env: portal.env,
          signal: args.signal,
          timeout: timeoutMs,
          killSignal: TERMINATION_SIGNAL,
          terminal,
        });
      } catch (error) {
        clearTimeout(timeoutMarker);
        args.signal?.removeEventListener('abort', onAbort);
        if (updateTimer !== null) clearTimeout(updateTimer);
        const closeError = closeTerminal(terminal);
        const message = error instanceof Error ? error.message : String(error);
        retention.append(`Unable to spawn Bash: ${message}`, 0);
        if (closeError) retention.append(`\nUnable to close terminal: ${closeError.message}`, 0);
        const retained = retention.read(true);
        const status = closeError ? 'cleanup_failed' : 'spawn_failed';
        const details: TAgentBashProcessDetails = {
          status,
          code: resultCode(status),
          cwd: args.cwd,
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          durationMs: Date.now() - startedAtMs,
          output: retained.output,
          outputBytes: retained.outputBytes,
          outputTruncated: retained.truncated,
          terminalCreated: true,
          terminalClosed: closeError === null,
        };
        const result = createResult(details);
        publishUpdate(args.onUpdate, result);
        return result;
      }

      let awaitedExitCode: number;
      try {
        awaitedExitCode = await process.exited;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        retention.append(`\nBash process settlement failed: ${message}`, 0);
        awaitedExitCode = process.exitCode ?? 1;
      } finally {
        clearTimeout(timeoutMarker);
        args.signal?.removeEventListener('abort', onAbort);
        if (updateTimer !== null) clearTimeout(updateTimer);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const closeError = closeTerminal(terminal);
      if (closeError === null) await terminalExited;
      const flushed = decoder.decode();
      if (flushed.length > 0) retention.append(flushed, 0);
      if (closeError) retention.append(`\nUnable to close terminal: ${closeError.message}`, 0);

      const retained = retention.read(true);
      const cancelled = terminationReason === 'cancelled';
      const timedOut = terminationReason === 'timed_out';
      const exitCode = process.exitCode ?? awaitedExitCode;
      const status: TAgentBashProcessStatus = closeError
        ? 'cleanup_failed'
        : cancelled
          ? 'cancelled'
          : timedOut
            ? 'timed_out'
            : process.signalCode !== null
              ? 'signaled'
              : exitCode === 0
                ? 'succeeded'
                : 'non_zero';
      const details: TAgentBashProcessDetails = {
        status,
        code: resultCode(status),
        cwd: args.cwd,
        exitCode,
        signal: process.signalCode,
        timedOut,
        cancelled,
        durationMs: Date.now() - startedAtMs,
        output: retained.output,
        outputBytes: retained.outputBytes,
        outputTruncated: retained.truncated,
        terminalCreated: true,
        terminalClosed: closeError === null,
        updateSequence: updateCount + 1,
      };
      const result = createResult(details);
      publishUpdate(args.onUpdate, result);
      return result;
    },
  } satisfies TAgentBashCapability;
}
