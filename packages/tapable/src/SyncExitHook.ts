import type { TAsArray } from './interfaces';

/**
 * List of callbacks that can be called in a loop.
 * The loop will be exited if any of the callbacks return true.
 */
export class SyncExitHook<T> {
  #callbacks: ((...args: TAsArray<T>) => boolean)[] = [];

  tap(fn: (...args: TAsArray<T>) => boolean) {
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

  call(...argsArr: TAsArray<T>): boolean {
    if (this.#callbacks.length) {
      for (let i = 0; i < this.#callbacks.length; i++) {
        const callback = this.#callbacks[i];
        const cancel = callback(...(argsArr as TAsArray<T>));
        if (cancel) return true;
      }
    }

    return false;
  }
}
