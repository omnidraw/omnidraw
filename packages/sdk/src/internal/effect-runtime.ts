/** @file Instance-owned Effect runtime used behind Promise-shaped SDK APIs. */

import { Effect, Layer, ManagedRuntime } from 'effect';

type TTaskResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; error: unknown }>;

export type TSdkTask = (signal: AbortSignal) => Promise<void>;

/**
 * Keeps Effect ownership private. Public SDK declarations expose only promises,
 * abort signals, async iterables, and idempotent disposer functions.
 */
export class SdkEffectRuntime {
  readonly #runtime = ManagedRuntime.make(Layer.empty);
  #disposed = false;

  async run<TValue>(
    task: (signal: AbortSignal) => Promise<TValue>,
  ): Promise<TValue> {
    if (this.#disposed) throw new Error('The SDK lifecycle runtime is disposed.');
    const result = await this.#runtime.runPromise(Effect.promise(async (signal) => {
      try {
        return Object.freeze({ ok: true as const, value: await task(signal) });
      } catch (error) {
        return Object.freeze({ ok: false as const, error });
      }
    })) as TTaskResult<TValue>;
    if (!result.ok) throw result.error;
    return result.value;
  }

  fork(
    task: TSdkTask,
    onError: (error: unknown) => void = () => undefined,
  ): () => void {
    if (this.#disposed) throw new Error('The SDK lifecycle runtime is disposed.');
    let active = true;
    const cancel = this.#runtime.runCallback(
      Effect.promise(async (signal) => {
        try {
          await task(signal);
        } catch (error) {
          if (active) onError(error);
        }
      }),
      { onExit: () => { active = false; } },
    );
    return (): void => {
      if (!active) return;
      active = false;
      cancel();
    };
  }

  dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#disposed = true;
    return this.#runtime.dispose();
  }
}

export async function runSdkAsync<TValue>(
  task: (signal: AbortSignal) => Promise<TValue>,
): Promise<TValue> {
  const runtime = new SdkEffectRuntime();
  try {
    return await runtime.run(task);
  } finally {
    await runtime.dispose();
  }
}
