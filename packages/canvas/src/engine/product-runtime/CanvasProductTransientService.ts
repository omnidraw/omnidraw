import { fnCanvasEngineTransientProjection } from "./fn.transient";
import type { TCanvasProductRuntimeEnginePorts } from "./interface";
import type {
  TCanvasProductTransientOwner,
  TCanvasProductTransientOwnerOptions,
} from "./typed";

type TTransientPorts = Pick<
  TCanvasProductRuntimeEnginePorts,
  "transients" | "transientTargets"
>;

type TOwnerRecord = {
  owner: ReturnType<TTransientPorts["transients"]["createOwner"]>;
  releaseTarget: () => void;
  destroyed: boolean;
};

export class CanvasProductTransientService {
  readonly #ports: TTransientPorts;
  readonly #owners = new Map<string, TOwnerRecord>();
  #destroyed = false;

  constructor(ports: TTransientPorts) {
    this.#ports = ports;
  }

  createOwner(
    options: TCanvasProductTransientOwnerOptions,
  ): TCanvasProductTransientOwner {
    this.#assertActive();
    if (this.#owners.has(options.ownerId)) {
      throw new Error(`Transient owner '${options.ownerId}' already exists.`);
    }
    const owner = this.#ports.transients.createOwner(options.ownerId);
    const registration = options.resolveTarget ?? options.target;
    let releaseTarget: () => void;
    try {
      releaseTarget = registration === undefined
        ? () => undefined
        : this.#ports.transientTargets.register(options.ownerId, registration);
    } catch (error) {
      owner.destroy();
      throw error;
    }
    const record: TOwnerRecord = {
      owner,
      releaseTarget,
      destroyed: false,
    };
    this.#owners.set(options.ownerId, record);
    return {
      id: options.ownerId,
      replace: (projection) => {
        this.#assertOwner(options.ownerId, record);
        owner.replace(fnCanvasEngineTransientProjection({
          ownerId: options.ownerId,
          projection,
        }));
      },
      clear: () => {
        this.#assertOwner(options.ownerId, record);
        owner.clear();
      },
      destroy: () => {
        this.#destroyOwner(options.ownerId, record);
      },
    };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    for (const [ownerId, record] of [...this.#owners]) {
      try {
        this.#destroyOwner(ownerId, record);
      } catch (error) {
        firstError ??= error;
      }
    }
    this.#owners.clear();
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #destroyOwner(ownerId: string, record: TOwnerRecord): void {
    if (record.destroyed) {
      return;
    }
    record.destroyed = true;
    let firstError: unknown;
    try {
      record.releaseTarget();
    } catch (error) {
      firstError = error;
    }
    try {
      record.owner.destroy();
    } catch (error) {
      firstError ??= error;
    }
    if (this.#owners.get(ownerId) === record) {
      this.#owners.delete(ownerId);
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #assertOwner(ownerId: string, record: TOwnerRecord): void {
    this.#assertActive();
    if (record.destroyed || this.#owners.get(ownerId) !== record) {
      throw new Error(`Transient owner '${ownerId}' has been destroyed.`);
    }
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasProductTransientService has been destroyed.");
    }
  }
}
