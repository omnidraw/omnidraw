export class AsyncParallelHook<T, R = void> {
  #callbacks: ((...args: T[]) => Promise<R>)[] = [];

  getCallbacksNum() {
    return this.#callbacks.length;
  }

  tapPromise(fn: (...args: T[]) => Promise<R>) {
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

  promise(...args: T[]): Promise<R[]> {
    return Promise.all(
      this.#callbacks.map((callback) => {
        return callback(...args);
      }),
    );
  }
}
