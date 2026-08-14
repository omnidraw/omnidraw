import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export type TLocalWidgetPackageRegistryExecute = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeout: number;
    maxBuffer: number;
    signal?: AbortSignal;
  }>,
) => Promise<void>;

type TStat = (path: string) => Promise<Readonly<{ isFile(): boolean }>>;

type TConfig = Readonly<{
  repositoryRoot: string;
  execute?: TLocalWidgetPackageRegistryExecute;
  stat?: TStat;
}>;

function quoteCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function processFailureSummary(error: Readonly<{
  name: string;
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}>): string {
  if (error.signal) return `terminated by signal ${error.signal}`;
  if (error.code !== undefined) return `failed with code ${error.code}`;
  if (error.killed) return 'was killed';
  return `failed (${error.name || 'unknown process error'})`;
}

function execute(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeout: number;
    maxBuffer: number;
    signal?: AbortSignal;
  }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      const attemptedCommand = [command, ...args].map(quoteCommandPart).join(' ');
      const stdoutText = String(stdout).trim();
      const stderrText = String(stderr).trim();
      const details = [
        'Local widget package synchronization failed.',
        `Command: ${attemptedCommand}`,
        `Process ${processFailureSummary(error)}.`,
        ...(stdoutText === '' ? [] : [`stdout:\n${stdoutText}`]),
        ...(stderrText === '' ? [] : [`stderr:\n${stderrText}`]),
      ];
      reject(Object.assign(new Error(details.join('\n')), {
        code: 'LOCAL_WIDGET_PACKAGE_SYNC_FAILED',
      }));
    });
  });
}

/** Serializes the development-only workspace package publication boundary. */
export class LocalWidgetPackageRegistrySync {
  readonly #repositoryRoot: string;
  readonly #execute: TLocalWidgetPackageRegistryExecute;
  readonly #stat: TStat;
  #active: Readonly<{
    promise: Promise<void>;
    controller: AbortController;
    waiters: Set<object>;
    settled: { value: boolean };
  }> | null = null;
  #synchronized = false;

  constructor(config: TConfig) {
    this.#repositoryRoot = config.repositoryRoot;
    this.#execute = config.execute ?? execute;
    this.#stat = config.stat ?? stat;
  }

  sync(signal?: AbortSignal): Promise<void> {
    if (this.#synchronized) return Promise.resolve();
    if (this.#active === null) {
      const controller = new AbortController();
      const waiters = new Set<object>();
      const settled = { value: false };
      const operation = this.#run(controller.signal);
      const tracked = operation
        .then(() => {
          this.#synchronized = true;
        })
        .finally(() => {
          settled.value = true;
          if (this.#active?.promise === tracked) this.#active = null;
        });
      this.#active = Object.freeze({ promise: tracked, controller, waiters, settled });
    }
    return this.#waitForActive(signal);
  }

  #waitForActive(signal?: AbortSignal): Promise<void> {
    const active = this.#active!;
    const waiter = Object.freeze({});
    active.waiters.add(waiter);
    const release = () => {
      active.waiters.delete(waiter);
      if (!active.settled.value && active.waiters.size === 0) active.controller.abort();
    };
    if (signal?.aborted) {
      release();
      return Promise.reject(new Error('Local widget package synchronization was cancelled.'));
    }
    return new Promise((resolve, reject) => {
      const cancelled = () => {
        release();
        reject(new Error('Local widget package synchronization was cancelled.'));
      };
      signal?.addEventListener('abort', cancelled, { once: true });
      void active.promise.then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', cancelled);
        release();
      });
    });
  }

  async #run(signal: AbortSignal): Promise<void> {
    const scriptPath = join(this.#repositoryRoot, 'scripts', 'local-registry.mjs');
    const script = await this.#stat(scriptPath).catch(() => null);
    if (script === null || !script.isFile()) {
      throw Object.assign(new Error(
        `Local widget package synchronization is unavailable: expected the registry script at '${scriptPath}'. Use a complete Omnidraw development checkout and configure its repository root at the backend runtime edge.`,
      ), { code: 'LOCAL_WIDGET_PACKAGE_SYNC_CONFIG_INVALID' });
    }
    await this.#execute(
      'node',
      [scriptPath, 'publish-widget-packages'],
      {
        cwd: this.#repositoryRoot,
        timeout: 5 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      },
    );
  }
}
