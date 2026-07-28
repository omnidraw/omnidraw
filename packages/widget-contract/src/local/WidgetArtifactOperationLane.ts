import { AsyncLocalStorage } from 'node:async_hooks';

type TWidgetArtifactOperationScope = {
  active: boolean;
};

/** One bounded organization-local mutation lane shared by publication and artifact GC. */
export class WidgetArtifactOperationLane {
  readonly #activeScope = new AsyncLocalStorage<TWidgetArtifactOperationScope>();
  #tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#activeScope.getStore()?.active === true) return operation();
    const invoke = () => {
      const scope: TWidgetArtifactOperationScope = { active: true };
      return this.#activeScope.run(scope, async () => {
        try {
          return await operation();
        } finally {
          scope.active = false;
        }
      });
    };
    const result = this.#tail.then(invoke, invoke);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
