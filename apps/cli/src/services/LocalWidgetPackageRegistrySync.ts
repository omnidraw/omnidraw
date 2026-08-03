import { execFile } from 'node:child_process';
import { join } from 'node:path';

type TExecute = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; timeout: number; maxBuffer: number }>,
) => Promise<void>;

type TConfig = Readonly<{
  repositoryRoot: string;
  execute?: TExecute;
}>;

function execute(
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; timeout: number; maxBuffer: number }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error === null) {
        resolve();
        return;
      }
      const output = [String(stdout).trim(), String(stderr).trim()]
        .filter(Boolean)
        .join('\n');
      reject(Object.assign(new Error(
        output === ''
          ? `Local widget package synchronization failed: ${error.message}`
          : `Local widget package synchronization failed: ${error.message}\n${output}`,
      ), { code: 'LOCAL_WIDGET_PACKAGE_SYNC_FAILED' }));
    });
  });
}

/** Serializes the development-only workspace package publication boundary. */
export class LocalWidgetPackageRegistrySync {
  readonly #repositoryRoot: string;
  readonly #execute: TExecute;
  #active: Promise<void> | null = null;
  #synchronized = false;

  constructor(config: TConfig) {
    this.#repositoryRoot = config.repositoryRoot;
    this.#execute = config.execute ?? execute;
  }

  sync(): Promise<void> {
    if (this.#synchronized) return Promise.resolve();
    if (this.#active !== null) return this.#active;
    const operation = this.#execute(
      'node',
      [join(this.#repositoryRoot, 'scripts', 'local-registry.mjs'), 'publish-widget-packages'],
      {
        cwd: this.#repositoryRoot,
        timeout: 5 * 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const tracked = operation
      .then(() => {
        this.#synchronized = true;
      })
      .finally(() => {
        if (this.#active === tracked) this.#active = null;
      });
    this.#active = tracked;
    return tracked;
  }
}
