import type {
  TCanvasTransientTargetQuery,
  TCanvasTransientTargetRegistration,
  TCanvasTransientTargetResolver,
} from "./typed";

type TRegistryEntry = {
  token: symbol;
  resolve: TCanvasTransientTargetResolver;
};

export class CanvasTransientTargetRegistry {
  readonly #entries = new Map<string, TRegistryEntry>();
  #destroyed = false;

  readonly resolve: TCanvasTransientTargetResolver = (query) => {
    if (this.#destroyed) {
      return null;
    }
    return this.#entries.get(query.ownerId)?.resolve(query) ?? null;
  };

  register(
    ownerId: string,
    registration: TCanvasTransientTargetRegistration,
  ): () => void {
    this.#assertActive();
    if (ownerId.length === 0) {
      throw new RangeError("Transient target owner ID must not be empty.");
    }
    const token = Symbol(ownerId);
    const resolve = typeof registration === "function"
      ? registration
      : (_query: TCanvasTransientTargetQuery) => registration;
    this.#entries.set(ownerId, { token, resolve });
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      if (this.#entries.get(ownerId)?.token === token) {
        this.#entries.delete(ownerId);
      }
    };
  }

  clear(): void {
    if (this.#destroyed) {
      return;
    }
    this.#entries.clear();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#entries.clear();
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasTransientTargetRegistry has been destroyed.");
    }
  }
}
