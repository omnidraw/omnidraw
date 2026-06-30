import type { TAsArray } from './interfaces';

/**
 * Executes callbacks sequentially (await each before next).
 * Use for ordered async lifecycles like boot and shutdown.
 */
export class AsyncSeriesHook<T> {
  #callbacks: ((...args: TAsArray<T>) => Promise<void>)[] = [];

  tapPromise(fn: (...args: TAsArray<T>) => Promise<void>) {
    this.#callbacks.push(fn);

    return () => {
      const index = this.#callbacks.indexOf(fn);
      if (index === -1) {
        return false;
      }

      this.#callbacks.splice(index, 1);
      return true;
    };
  }

  async promise(...args: TAsArray<T>): Promise<void> {
    for (const callback of this.#callbacks) {
      await callback(...args);
    }
  }
}
