import type {
  IService,
  IStartableService,
  IStoppableService,
} from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import type {
  TCanvasProjectionCoordinatorResult,
  TCanvasProjectionUpdate,
} from "../../engine/ProjectionCoordinator";
import type {
  CrdtService,
  TCrdtChangeSummary,
} from "../crdt/CrdtService";

export interface ICanvasProjectionCoordinatorPort {
  hydrateInitial(
    document: TCanvasDoc,
    revision: number,
  ): Promise<TCanvasProjectionCoordinatorResult>;
  enqueue(
    update: TCanvasProjectionUpdate,
  ): Promise<TCanvasProjectionCoordinatorResult>;
  stop(): void;
}

export type TCrdtProjectionServiceHooks = {
  result: SyncHook<[TCanvasProjectionCoordinatorResult]>;
  error: SyncHook<[unknown, number]>;
};

export type TCrdtProjectionServiceArgs = {
  crdt: Pick<CrdtService, "doc" | "hooks" | "revision">;
  coordinator: ICanvasProjectionCoordinatorPort;
};

type TCrdtProjectionServiceState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped";

export class CrdtProjectionService
implements
  IService<TCrdtProjectionServiceHooks>,
  IStartableService,
  IStoppableService {
  readonly name = "projection";
  readonly hooks: TCrdtProjectionServiceHooks = {
    result: new SyncHook(),
    error: new SyncHook(),
  };

  #state: TCrdtProjectionServiceState = "idle";
  #removeChangeListener: (() => void) | null = null;
  #pending = new Set<Promise<void>>();

  constructor(private readonly args: TCrdtProjectionServiceArgs) {}

  get state() {
    return this.#state;
  }

  async start() {
    if (this.#state === "running") {
      return;
    }
    if (this.#state !== "idle") {
      throw new Error(`Projection service cannot start from '${this.#state}'.`);
    }

    this.#state = "starting";
    this.#removeChangeListener = this.args.crdt.hooks.change.tap((summary) => {
      this.#track(this.#applySummary(summary));
    });

    try {
      const result = await this.args.coordinator.hydrateInitial(
        this.args.crdt.doc(),
        this.args.crdt.revision,
      );
      this.hooks.result.call(result);
      if (result.status === "failed") {
        throw result.error;
      }
      if (result.status === "rejected") {
        throw new Error(
          `Initial canvas projection was rejected: ${result.reason}.`,
        );
      }
      if (this.#state === "starting") {
        this.#state = "running";
      }
    } catch (error) {
      this.hooks.error.call(error, this.args.crdt.revision);
      this.#removeChangeListener?.();
      this.#removeChangeListener = null;
      this.args.coordinator.stop();
      this.#state = "stopped";
      throw error;
    }
  }

  async stop() {
    if (this.#state === "stopped" || this.#state === "stopping") {
      return;
    }

    this.#state = "stopping";
    this.#removeChangeListener?.();
    this.#removeChangeListener = null;
    this.args.coordinator.stop();
    await Promise.allSettled([...this.#pending]);
    this.#pending.clear();
    this.#state = "stopped";
  }

  async #applySummary(summary: TCrdtChangeSummary) {
    try {
      const result = await this.args.coordinator.enqueue({
        document: this.args.crdt.doc(),
        revision: summary.revision,
        origin: summary.origin,
        fullReload: summary.fullReload,
        changes: {
          elements: {
            added: summary.elements.added,
            updated: summary.elements.updated,
            deleted: summary.elements.deleted,
          },
          groups: {
            added: summary.groups.added,
            updated: summary.groups.updated,
            deleted: summary.groups.deleted,
          },
        },
      });
      this.hooks.result.call(result);
      if (result.status === "failed") {
        this.hooks.error.call(result.error, summary.revision);
      }
    } catch (error) {
      this.hooks.error.call(error, summary.revision);
    }
  }

  #track(promise: Promise<void>) {
    this.#pending.add(promise);
    void promise.finally(() => {
      this.#pending.delete(promise);
    });
  }
}
