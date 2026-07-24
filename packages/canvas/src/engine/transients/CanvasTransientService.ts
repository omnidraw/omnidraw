import type {
  ITransientScene,
  ITransientSceneOwner,
  TTransientSceneProjection,
} from "@vibecanvas/canvas-engine";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../interface";

export type TCanvasTransientOwner = {
  readonly id: string;
  replace(projection: TTransientSceneProjection): void;
  clear(): void;
  destroy(): void;
};

export type TCanvasTransientServiceErrorCode =
  | "DESTROYED"
  | "DUPLICATE_OWNER"
  | "OWNER_DESTROYED"
  | "TRANSIENT_STAGE_STATE";

export class CanvasTransientServiceError extends Error {
  readonly code: TCanvasTransientServiceErrorCode;
  readonly ownerId?: string;

  constructor(
    code: TCanvasTransientServiceErrorCode,
    message: string,
    details?: { ownerId?: string },
  ) {
    super(message);
    this.name = "CanvasTransientServiceError";
    this.code = code;
    this.ownerId = details?.ownerId;
  }
}

type TOwnerRecord = {
  owner: ITransientSceneOwner;
  destroyed: boolean;
};

type TTransientServiceArgs = {
  transients: ITransientScene;
};

/**
 * The application sees owner-scoped replace/clear operations, never the raw
 * engine transient scene or its durable effective-scene view.
 */
export class CanvasTransientService {
  readonly #transients: ITransientScene;
  readonly #owners = new Map<string, TOwnerRecord>();
  #destroyed = false;

  constructor(args: TTransientServiceArgs) {
    this.#transients = args.transients;
  }

  get ownerCount(): number {
    return this.#owners.size;
  }

  ownerIds(): readonly string[] {
    return [...this.#owners.keys()].sort();
  }

  has(ownerId: string): boolean {
    return this.#owners.has(ownerId);
  }

  createOwner(ownerId: string): TCanvasTransientOwner {
    this.#assertOperational();
    if (ownerId.length === 0) {
      throw new TypeError("Transient owner ID must be non-empty.");
    }
    if (this.#owners.has(ownerId)) {
      throw new CanvasTransientServiceError(
        "DUPLICATE_OWNER",
        `Transient owner '${ownerId}' already exists.`,
        { ownerId },
      );
    }

    const record: TOwnerRecord = {
      owner: this.#transients.createOwner(ownerId),
      destroyed: false,
    };
    this.#owners.set(ownerId, record);

    return {
      id: ownerId,
      replace: (projection) => {
        this.#assertOwner(record, ownerId);
        record.owner.replace(projection);
      },
      clear: () => {
        this.#assertOwner(record, ownerId);
        record.owner.clear();
      },
      destroy: () => {
        this.#destroyOwner(ownerId, record);
      },
    };
  }

  sync(ownerId: string, projection: TTransientSceneProjection): void {
    this.#assertOperational();
    const existing = this.#owners.get(ownerId);
    if (existing !== undefined) {
      this.#assertOwner(existing, ownerId);
      existing.owner.replace(projection);
      return;
    }

    const owner = this.createOwner(ownerId);
    try {
      owner.replace(projection);
    } catch (error) {
      owner.destroy();
      throw error;
    }
  }

  clear(ownerId: string): void {
    this.#assertOperational();
    this.#owners.get(ownerId)?.owner.clear();
  }

  release(ownerId: string): void {
    this.#assertOperational();
    const record = this.#owners.get(ownerId);
    if (record !== undefined) {
      this.#destroyOwner(ownerId, record);
    }
  }

  /**
   * Useful for durable/transient handoff: clearing or replacing is deferred
   * until the retained scene has committed.
   */
  stage(
    ownerId: string,
    projection: TTransientSceneProjection | null,
  ): ICanvasEngineOwnershipStage {
    this.#assertOperational();
    let state: TCanvasEngineOwnershipStageState = "staged";
    return {
      label: `transient:${ownerId}`,
      get state() {
        return state;
      },
      prepare: async () => {
        this.#assertOperational();
        if (state !== "staged") {
          throw this.#stageStateError(ownerId, state, "staged");
        }
        state = "prepared";
      },
      commit: async () => {
        this.#assertOperational();
        if (state !== "prepared") {
          throw this.#stageStateError(ownerId, state, "prepared");
        }
        if (projection === null) {
          this.clear(ownerId);
        } else {
          this.sync(ownerId, projection);
        }
        state = "committed";
      },
      rollback: async () => {
        if (state === "committed" || state === "rolled-back") {
          return;
        }
        state = "rolled-back";
      },
    };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    let failed = false;
    for (const ownerId of [...this.#owners.keys()].sort()) {
      const record = this.#owners.get(ownerId);
      if (record !== undefined) {
        try {
          this.#destroyOwner(ownerId, record);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
    }
    this.#owners.clear();
    if (failed) {
      throw firstError;
    }
  }

  #destroyOwner(ownerId: string, record: TOwnerRecord): void {
    if (record.destroyed) {
      return;
    }
    record.destroyed = true;
    record.owner.destroy();
    if (this.#owners.get(ownerId) === record) {
      this.#owners.delete(ownerId);
    }
  }

  #assertOperational(): void {
    if (this.#destroyed) {
      throw new CanvasTransientServiceError(
        "DESTROYED",
        "CanvasTransientService is destroyed.",
      );
    }
  }

  #assertOwner(record: TOwnerRecord, ownerId: string): void {
    this.#assertOperational();
    if (record.destroyed || this.#owners.get(ownerId) !== record) {
      throw new CanvasTransientServiceError(
        "OWNER_DESTROYED",
        `Transient owner '${ownerId}' is destroyed.`,
        { ownerId },
      );
    }
  }

  #stageStateError(
    ownerId: string,
    actual: TCanvasEngineOwnershipStageState,
    expected: TCanvasEngineOwnershipStageState,
  ): CanvasTransientServiceError {
    return new CanvasTransientServiceError(
      "TRANSIENT_STAGE_STATE",
      `Transient stage '${ownerId}' is '${actual}', expected '${expected}'.`,
      { ownerId },
    );
  }
}
