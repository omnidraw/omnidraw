/**
 * Sequential async hook where each callback receives the previous result.
 * Short-circuits when a callback returns a non-undefined value.
 * Use for HTTP middleware chains.
 */
export class AsyncWaterfallHook<T> {
  #callbacks: ((value: T) => Promise<T | undefined>)[] = [];

  tapPromise(fn: (value: T) => Promise<T | undefined>) {
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

  async promise(initial: T): Promise<T> {
    let value = initial;
    for (const callback of this.#callbacks) {
      const result = await callback(value);
      if (result !== undefined) {
        value = result;
      }
    }
    return value;
  }
}
