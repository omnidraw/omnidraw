import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fnNormalizeApprovalPolicy } from './fn.approval-policy';
import type { TApprovalPolicy } from './types';

export class ApprovalPolicyStore {
  readonly #path: string;
  readonly #temporaryPath: string;
  #saveLane: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
    this.#temporaryPath = `${path}.next`;
  }

  async load(): Promise<TApprovalPolicy> {
    try {
      return fnNormalizeApprovalPolicy(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT'
        || error instanceof SyntaxError
      ) {
        return Object.freeze({ mode: 'manual' });
      }
      throw error;
    }
  }

  async save(policy: TApprovalPolicy): Promise<TApprovalPolicy> {
    const normalized = fnNormalizeApprovalPolicy(policy);
    const operation = this.#saveLane.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await writeFile(this.#temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(this.#temporaryPath, this.#path);
      return normalized;
    });
    this.#saveLane = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
