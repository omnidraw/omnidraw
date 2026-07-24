import type {
  IResourceRegistrationOwner,
  TResourceRegistrationClaim,
} from "@omnidraw/cangine";
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
import { fnCanvasProjectionCommands } from "./fn.commands";
import {
  PortalContentBridge,
  type TCanvasPortalContentBridgeArgs,
} from "./PortalContentBridge";

const PROJECTION_OWNER_ID = "vibecanvas:projection";

export interface ICanvasProjectionAdapter {
  readonly portals: {
    stage(
      ownerId: string,
      portals: readonly TCanvasOwnedPortal[],
    ): ICanvasEngineOwnershipStage;
    release(ownerId: string): Promise<void>;
  };
  createResourceRegistrationOwner(ownerId: string): IResourceRegistrationOwner;
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
    onResourcePreloadError?(error: unknown): void;
    onPresentationCommitError?(args: {
      stage: string;
      error: unknown;
    }): void;
  };

export type TCanvasProjectionRuntimeErrorCode =
  | "ADAPTER_APPLY_FAILED"
  | "DESTROYED"
  | "OWNERSHIP_STAGE_MISSING";

export class CanvasProjectionRuntimeError extends Error {
  readonly code: TCanvasProjectionRuntimeErrorCode;
  readonly revision: number;
  readonly fatal: boolean;
  readonly cause: unknown;

  constructor(args: {
    code: TCanvasProjectionRuntimeErrorCode;
    message: string;
    revision: number;
    fatal?: boolean;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "CanvasProjectionRuntimeError";
    this.code = args.code;
    this.revision = args.revision;
    this.fatal = args.fatal ?? false;
    this.cause = args.cause;
  }
}

class CompositeProjectionOwnershipStage implements ICanvasEngineOwnershipStage {
  readonly label = "projection-ownership:vibecanvas:projection";
  readonly #contentStage: ICanvasEngineOwnershipStage;
  readonly #portalStage: ICanvasEngineOwnershipStage;
  readonly #resourceOwner: IResourceRegistrationOwner;
  readonly #previousResources: readonly TResourceRegistrationClaim[];
  readonly #nextResources: readonly TResourceRegistrationClaim[];
  readonly #preloadResources: boolean;
  readonly #onResourcePreloadError: ((error: unknown) => void) | undefined;
  readonly #onPresentationCommitError:
    | ((args: { stage: string; error: unknown }) => void)
    | undefined;
  readonly #onCommit: () => void;
  readonly #onRollback: () => void;
  #state: TCanvasEngineOwnershipStageState = "staged";

  constructor(args: {
    contentStage: ICanvasEngineOwnershipStage;
    portalStage: ICanvasEngineOwnershipStage;
    resourceOwner: IResourceRegistrationOwner;
    previousResources: readonly TResourceRegistrationClaim[];
    nextResources: readonly TResourceRegistrationClaim[];
    preloadResources: boolean;
    onResourcePreloadError?: (error: unknown) => void;
    onPresentationCommitError?: (args: {
      stage: string;
      error: unknown;
    }) => void;
    onCommit(): void;
    onRollback(): void;
  }) {
    this.#contentStage = args.contentStage;
    this.#portalStage = args.portalStage;
    this.#resourceOwner = args.resourceOwner;
    this.#previousResources = args.previousResources;
    this.#nextResources = args.nextResources;
    this.#preloadResources = args.preloadResources;
    this.#onResourcePreloadError = args.onResourcePreloadError;
    this.#onPresentationCommitError = args.onPresentationCommitError;
    this.#onCommit = args.onCommit;
    this.#onRollback = args.onRollback;
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
      this.#portalStage,
    ];
    try {
      this.#resourceOwner.replace(this.#nextResources);
      for (const stage of stages) {
        await stage.prepare();
      }
      if (this.#preloadResources) {
        void this.#resourceOwner.preload().catch((error) => {
          this.#onResourcePreloadError?.(error);
        });
      }
      this.#state = "prepared";
    } catch (error) {
      for (const stage of [...stages].reverse()) {
        await stage.rollback().catch(() => undefined);
      }
      this.#resourceOwner.replace(this.#previousResources);
      this.#state = "rolled-back";
      this.#onRollback();
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
    for (const stage of [this.#portalStage, this.#contentStage]) {
      try {
        await stage.commit();
      } catch (error) {
        await stage.rollback().catch((rollbackError) => {
          this.#reportPresentationCommitError(
            `${stage.label}:rollback`,
            rollbackError,
          );
        });
        this.#reportPresentationCommitError(stage.label, error);
      }
    }
    this.#state = "committed";
    this.#onCommit();
  }

  async rollback(): Promise<void> {
    if (this.#state === "rolled-back" || this.#state === "committed") {
      return;
    }
    for (const stage of [
      this.#portalStage,
      this.#contentStage,
    ]) {
      await stage.rollback().catch(() => undefined);
    }
    this.#resourceOwner.replace(this.#previousResources);
    this.#state = "rolled-back";
    this.#onRollback();
  }

  #reportPresentationCommitError(stage: string, error: unknown): void {
    try {
      this.#onPresentationCommitError?.({ stage, error });
    } catch {
      // Presentation diagnostics cannot reverse an authoritative scene commit.
    }
  }
}

/**
 * Concrete coordinator port backed by CanvasEngineAdapter's atomic mutation
 * methods and its resource/portal ownership wrappers.
 */
export class CanvasProjectionRuntimePort implements ICanvasProjectionRuntimePort {
  readonly #adapter: ICanvasProjectionAdapter;
  readonly #portalContent: PortalContentBridge;
  readonly #resourceOwner: IResourceRegistrationOwner;
  readonly #preloadResources: boolean;
  readonly #onResourcePreloadError: ((error: unknown) => void) | undefined;
  readonly #onPresentationCommitError:
    | ((args: { stage: string; error: unknown }) => void)
    | undefined;
  readonly #stages = new Map<number, CompositeProjectionOwnershipStage>();
  #resourceClaims: readonly TResourceRegistrationClaim[] = [];
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
    this.#resourceOwner = args.adapter.createResourceRegistrationOwner(
      PROJECTION_OWNER_ID,
    );
    this.#preloadResources = args.preloadResources ?? true;
    this.#onResourcePreloadError = args.onResourcePreloadError;
    this.#onPresentationCommitError = args.onPresentationCommitError;
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
        portalStage,
        resourceOwner: this.#resourceOwner,
        previousResources: this.#resourceClaims,
        nextResources: args.next.resources,
        preloadResources: this.#preloadResources,
        ...(this.#onResourcePreloadError === undefined
          ? {}
          : { onResourcePreloadError: this.#onResourcePreloadError }),
        ...(this.#onPresentationCommitError === undefined
          ? {}
          : { onPresentationCommitError: this.#onPresentationCommitError }),
        onCommit: () => {
          this.#resourceClaims = args.next.resources;
          this.#stages.delete(args.revision);
        },
        onRollback: () => {
          this.#stages.delete(args.revision);
        },
      });
      this.#stages.set(args.revision, underlying);
      return underlying;
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
      this.#resourceOwner.destroy();
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
