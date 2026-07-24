import type {
  TCanvasSceneApplyArgs,
  TCanvasSceneApplyResult,
  TCanvasSceneCommandApplyArgs,
} from "../CanvasEngineAdapter";
import type {
  ICanvasProjectionRuntimePort,
  TCanvasProjectionOwnershipArgs,
  TCanvasProjectionSceneApplyArgs,
} from "../ProjectionCoordinator";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../interface";
import type {
  TCanvasOwnedPortal,
} from "../portals/PortalOwnership";
import type {
  TCanvasOwnedResource,
  TCanvasResourceStageOptions,
} from "../resources/ResourceOwnership";
import { fnCanvasProjectionCommands } from "./fn.commands";
import {
  PortalContentBridge,
  type TCanvasPortalContentBridgeArgs,
} from "./PortalContentBridge";

const PROJECTION_OWNER_ID = "vibecanvas:projection";

export interface ICanvasProjectionAdapter {
  readonly resources: {
    stage(
      ownerId: string,
      resources: readonly TCanvasOwnedResource[],
      options?: TCanvasResourceStageOptions,
    ): ICanvasEngineOwnershipStage;
    release(ownerId: string): Promise<void>;
  };
  readonly portals: {
    stage(
      ownerId: string,
      portals: readonly TCanvasOwnedPortal[],
    ): ICanvasEngineOwnershipStage;
    release(ownerId: string): Promise<void>;
  };
  applyScene(args: TCanvasSceneApplyArgs): Promise<TCanvasSceneApplyResult>;
  applyCommands(
    args: TCanvasSceneCommandApplyArgs,
  ): Promise<TCanvasSceneApplyResult>;
}

export type TCanvasProjectionRuntimePortArgs =
  & TCanvasPortalContentBridgeArgs
  & {
    adapter: ICanvasProjectionAdapter;
    preloadResources?: boolean;
  };

export type TCanvasProjectionRuntimeErrorCode =
  | "ADAPTER_APPLY_FAILED"
  | "DESTROYED"
  | "OWNERSHIP_STAGE_MISSING";

export class CanvasProjectionRuntimeError extends Error {
  readonly code: TCanvasProjectionRuntimeErrorCode;
  readonly revision: number;
  readonly fatal: boolean;
  readonly restored: boolean;
  readonly cause: unknown;

  constructor(args: {
    code: TCanvasProjectionRuntimeErrorCode;
    message: string;
    revision: number;
    fatal?: boolean;
    restored?: boolean;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "CanvasProjectionRuntimeError";
    this.code = args.code;
    this.revision = args.revision;
    this.fatal = args.fatal ?? false;
    this.restored = args.restored ?? false;
    this.cause = args.cause;
  }
}

class CompositeProjectionOwnershipStage implements ICanvasEngineOwnershipStage {
  readonly label = "projection-ownership:vibecanvas:projection";
  readonly #contentStage: ICanvasEngineOwnershipStage;
  readonly #resourceStage: ICanvasEngineOwnershipStage;
  readonly #portalStage: ICanvasEngineOwnershipStage;
  #state: TCanvasEngineOwnershipStageState = "staged";

  constructor(args: {
    contentStage: ICanvasEngineOwnershipStage;
    resourceStage: ICanvasEngineOwnershipStage;
    portalStage: ICanvasEngineOwnershipStage;
  }) {
    this.#contentStage = args.contentStage;
    this.#resourceStage = args.resourceStage;
    this.#portalStage = args.portalStage;
  }

  get state(): TCanvasEngineOwnershipStageState {
    return this.#state;
  }

  async prepare(): Promise<void> {
    if (this.#state === "prepared") {
      return;
    }
    if (this.#state !== "staged") {
      throw new TypeError(`Cannot prepare projection ownership from '${this.#state}'.`);
    }
    const stages = [
      this.#contentStage,
      this.#resourceStage,
      this.#portalStage,
    ];
    try {
      for (const stage of stages) {
        await stage.prepare();
      }
      this.#state = "prepared";
    } catch (error) {
      for (const stage of [...stages].reverse()) {
        await stage.rollback().catch(() => undefined);
      }
      this.#state = "rolled-back";
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (this.#state === "committed") {
      return;
    }
    if (this.#state !== "prepared") {
      throw new TypeError(`Cannot commit projection ownership from '${this.#state}'.`);
    }
    await this.#resourceStage.commit();
    await this.#portalStage.commit();
    await this.#contentStage.commit();
    this.#state = "committed";
  }

  async rollback(): Promise<void> {
    if (this.#state === "rolled-back" || this.#state === "committed") {
      return;
    }
    for (const stage of [
      this.#portalStage,
      this.#resourceStage,
      this.#contentStage,
    ]) {
      await stage.rollback().catch(() => undefined);
    }
    this.#state = "rolled-back";
  }
}

class DeferredProjectionOwnershipStage implements ICanvasEngineOwnershipStage {
  readonly label: string;
  readonly underlying: ICanvasEngineOwnershipStage;
  readonly #onSettled: () => void;
  #state: TCanvasEngineOwnershipStageState = "staged";

  constructor(args: {
    revision: number;
    underlying: ICanvasEngineOwnershipStage;
    onSettled(): void;
  }) {
    this.label = `deferred-projection-ownership:${args.revision}`;
    this.underlying = args.underlying;
    this.#onSettled = args.onSettled;
  }

  get state(): TCanvasEngineOwnershipStageState {
    return this.#state;
  }

  async prepare(): Promise<void> {
    if (this.#state === "prepared") {
      return;
    }
    if (this.#state !== "staged") {
      throw new TypeError(`Cannot arm projection ownership from '${this.#state}'.`);
    }
    this.#state = "prepared";
  }

  async commit(): Promise<void> {
    if (this.#state === "committed") {
      return;
    }
    if (this.#state !== "prepared" || this.underlying.state !== "committed") {
      throw new TypeError("Adapter did not commit projection ownership.");
    }
    this.#state = "committed";
    this.#onSettled();
  }

  async rollback(): Promise<void> {
    if (this.#state === "rolled-back" || this.#state === "committed") {
      return;
    }
    await this.underlying.rollback().catch(() => undefined);
    this.#state = "rolled-back";
    this.#onSettled();
  }
}

/**
 * Concrete coordinator port backed by CanvasEngineAdapter's atomic mutation
 * methods and its resource/portal ownership wrappers.
 */
export class CanvasProjectionRuntimePort implements ICanvasProjectionRuntimePort {
  readonly #adapter: ICanvasProjectionAdapter;
  readonly #portalContent: PortalContentBridge;
  readonly #preloadResources: boolean;
  readonly #stages = new Map<number, DeferredProjectionOwnershipStage>();
  #destroyPromise: Promise<void> | null = null;
  #destroyed = false;

  constructor(args: TCanvasProjectionRuntimePortArgs) {
    this.#adapter = args.adapter;
    this.#portalContent = new PortalContentBridge({
      mountContent: args.mountContent,
      ...(args.onUpdateError === undefined
        ? {}
        : { onUpdateError: args.onUpdateError }),
    });
    this.#preloadResources = args.preloadResources ?? true;
  }

  stageOwnership(
    args: TCanvasProjectionOwnershipArgs,
  ): ICanvasEngineOwnershipStage {
    this.#assertOperational(args.revision);
    if (this.#stages.has(args.revision)) {
      throw new TypeError(`Projection revision '${args.revision}' is already staged.`);
    }

    const staged: ICanvasEngineOwnershipStage[] = [];
    try {
      const resourceStage = this.#adapter.resources.stage(
        PROJECTION_OWNER_ID,
        args.next.resources,
        { preload: this.#preloadResources },
      );
      staged.push(resourceStage);
      const contentStage = this.#portalContent.stage(args.next.portals);
      staged.push(contentStage);
      const portalStage = this.#adapter.portals.stage(
        PROJECTION_OWNER_ID,
        args.next.portals.map((portal) => {
          return this.#portalContent.ownedPortal(portal);
        }),
      );
      staged.push(portalStage);
      const underlying = new CompositeProjectionOwnershipStage({
        contentStage,
        resourceStage,
        portalStage,
      });
      const deferred = new DeferredProjectionOwnershipStage({
        revision: args.revision,
        underlying,
        onSettled: () => {
          this.#stages.delete(args.revision);
        },
      });
      this.#stages.set(args.revision, deferred);
      return deferred;
    } catch (error) {
      for (const stage of [...staged].reverse()) {
        void stage.rollback().catch(() => undefined);
      }
      throw error;
    }
  }

  async applyScene(args: TCanvasProjectionSceneApplyArgs): Promise<void> {
    this.#assertOperational(args.revision);
    const stage = this.#stages.get(args.revision);
    if (stage === undefined || stage.state !== "prepared") {
      throw new CanvasProjectionRuntimeError({
        code: "OWNERSHIP_STAGE_MISSING",
        message: `Projection revision '${args.revision}' has no armed ownership stage.`,
        revision: args.revision,
      });
    }
    const mutationOptions = {
      source: `vibecanvas:projection:${args.origin}:${args.revision}`,
      coalesceKey: "vibecanvas:authoritative-projection",
      render: args.origin === "initial" ? "none" : "schedule",
      stages: [stage.underlying],
    } as const;
    const result = args.mode.kind === "replace"
      ? await this.#adapter.applyScene({
          ...mutationOptions,
          snapshot: args.next.snapshot,
        })
      : await this.#adapter.applyCommands({
          ...mutationOptions,
          commands: fnCanvasProjectionCommands({
            previous: args.previous!,
            next: args.next,
            diff: args.mode.diff,
          }),
        });
    if (!result.ok) {
      throw new CanvasProjectionRuntimeError({
        code: "ADAPTER_APPLY_FAILED",
        message: `Canvas adapter failed projection revision '${args.revision}'.`,
        revision: args.revision,
        fatal: result.fatal,
        restored: result.restored,
        cause: result.error,
      });
    }
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise !== null) {
      return this.#destroyPromise;
    }
    this.#destroyed = true;
    this.#destroyPromise = (async () => {
      for (const stage of this.#stages.values()) {
        await stage.rollback();
      }
      this.#stages.clear();
      await this.#adapter.portals.release(PROJECTION_OWNER_ID).catch(() => undefined);
      await this.#adapter.resources.release(PROJECTION_OWNER_ID).catch(() => undefined);
      this.#portalContent.destroy();
    })();
    return this.#destroyPromise;
  }

  #assertOperational(revision: number): void {
    if (this.#destroyed) {
      throw new CanvasProjectionRuntimeError({
        code: "DESTROYED",
        message: "CanvasProjectionRuntimePort is destroyed.",
        revision,
      });
    }
  }
}
