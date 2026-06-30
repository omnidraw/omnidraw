import type { TAsArray } from './interfaces';

export class SyncHook<T, R = void> {
  #callbacks: ((...args: TAsArray<T>) => R)[] = [];

  tap(fn: (...args: TAsArray<T>) => R) {
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

  call(...argsArr: TAsArray<T>): R[] {
    return this.#callbacks.map(function (callback) {
      return callback.apply(void 0, argsArr);
    });
  }
}
