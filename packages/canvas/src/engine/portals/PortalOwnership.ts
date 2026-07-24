import type {
  IHtmlPortalManager,
  TMat3,
  TPortalGeometry,
  TPortalId,
  TPortalState,
} from "@vibecanvas/canvas-engine";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../interface";

export type TCanvasPortalMountContext = {
  portalId: string;
  host: HTMLDivElement;
};

export type TCanvasOwnedPortal = {
  portalId: string;
  /**
   * Stable identity for a mount binding. Changing it under one portal ID is
   * rejected so the last mounted widget is not torn down before scene commit.
   */
  registrationKey?: string;
  interactive?: boolean;
  mount(
    context: TCanvasPortalMountContext,
  ): void | (() => void) | Promise<void | (() => void)>;
  onVisibilityChange?(visible: boolean): void;
  onGeometryChange?(geometry: TPortalGeometry): void;
};

export type TCanvasPortalOwnershipErrorCode =
  | "DESTROYED"
  | "DUPLICATE_PORTAL_ID"
  | "EXTERNAL_PORTAL_CONFLICT"
  | "PORTAL_IDENTITY_CONFLICT"
  | "PORTAL_OWNER_BUSY"
  | "PORTAL_OWNERSHIP_CONFLICT"
  | "PORTAL_REGISTRATION_FAILED"
  | "PORTAL_STAGE_STATE";

export class CanvasPortalOwnershipError extends Error {
  readonly code: TCanvasPortalOwnershipErrorCode;
  readonly ownerId?: string;
  readonly portalId?: string;
  readonly cause?: unknown;

  constructor(
    code: TCanvasPortalOwnershipErrorCode,
    message: string,
    details?: { ownerId?: string; portalId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "CanvasPortalOwnershipError";
    this.code = code;
    this.ownerId = details?.ownerId;
    this.portalId = details?.portalId;
    this.cause = details?.cause;
  }
}

type TPortalRecord = {
  ownerId: string;
  portal: TCanvasOwnedPortal;
  interactive: boolean;
  dispose: () => void;
  pending: boolean;
};

type TPortalStageData = {
  ownerId: string;
  desired: Map<TPortalId, TCanvasOwnedPortal>;
  additions: TPortalId[];
  removals: TPortalId[];
  state: TCanvasEngineOwnershipStageState;
};

type TPortalOwnershipArgs = {
  portals: IHtmlPortalManager;
};

function samePortalRegistration(
  left: TCanvasOwnedPortal,
  right: TCanvasOwnedPortal,
): boolean {
  if (left.registrationKey !== undefined || right.registrationKey !== undefined) {
    return left.registrationKey !== undefined
      && left.registrationKey === right.registrationKey;
  }
  return left.mount === right.mount
    && left.onVisibilityChange === right.onVisibilityChange
    && left.onGeometryChange === right.onGeometryChange;
}

function cloneMatrix(matrix: TMat3): TMat3 {
  return [...matrix] as unknown as TMat3;
}

function cloneGeometry(geometry: TPortalGeometry): TPortalGeometry {
  return {
    ...geometry,
    viewportMatrix: cloneMatrix(geometry.viewportMatrix),
    viewportBounds: { ...geometry.viewportBounds },
    visibleWorldBounds: { ...geometry.visibleWorldBounds },
  };
}

function cloneState(state: TPortalState): TPortalState {
  return {
    ...state,
    geometry: state.geometry === null ? null : cloneGeometry(state.geometry),
  };
}

/**
 * Registers application portal callbacks without forwarding the engine from
 * the engine's native mount context.
 */
export class PortalOwnership {
  readonly #portals: IHtmlPortalManager;
  readonly #owners = new Map<string, Set<TPortalId>>();
  readonly #records = new Map<TPortalId, TPortalRecord>();
  readonly #activeStages = new Map<string, TPortalStageData>();
  readonly #subscriptions = new Set<() => void>();
  #destroyed = false;

  constructor(args: TPortalOwnershipArgs) {
    this.#portals = args.portals;
  }

  get ownerCount(): number {
    return this.#owners.size;
  }

  get portalCount(): number {
    return this.#records.size;
  }

  ownerPortalIds(ownerId: string): readonly string[] {
    return [...(this.#owners.get(ownerId) ?? [])].sort();
  }

  has(portalId: string): boolean {
    return this.#records.has(portalId) && this.#portals.has(portalId);
  }

  state(portalId: string): TPortalState | null {
    const state = this.#portals.state(portalId);
    return state === null ? null : cloneState(state);
  }

  stage(
    ownerId: string,
    portals: readonly TCanvasOwnedPortal[],
  ): ICanvasEngineOwnershipStage {
    this.#assertOperational();
    if (ownerId.length === 0) {
      throw new TypeError("Portal owner ID must be non-empty.");
    }
    if (this.#activeStages.has(ownerId)) {
      throw new CanvasPortalOwnershipError(
        "PORTAL_OWNER_BUSY",
        `Portal owner '${ownerId}' already has an active stage.`,
        { ownerId },
      );
    }

    const desired = new Map<TPortalId, TCanvasOwnedPortal>();
    for (const portal of portals) {
      if (desired.has(portal.portalId)) {
        throw new CanvasPortalOwnershipError(
          "DUPLICATE_PORTAL_ID",
          `Portal owner '${ownerId}' contains duplicate portal ID '${portal.portalId}'.`,
          { ownerId, portalId: portal.portalId },
        );
      }
      desired.set(portal.portalId, { ...portal });
    }

    const current = this.#owners.get(ownerId) ?? new Set<TPortalId>();
    for (const [portalId, portal] of desired) {
      const record = this.#records.get(portalId);
      if (record !== undefined && record.ownerId !== ownerId) {
        throw new CanvasPortalOwnershipError(
          "PORTAL_OWNERSHIP_CONFLICT",
          `Portal '${portalId}' is already owned by '${record.ownerId}'.`,
          { ownerId, portalId },
        );
      }
      if (record !== undefined && !samePortalRegistration(record.portal, portal)) {
        throw new CanvasPortalOwnershipError(
          "PORTAL_IDENTITY_CONFLICT",
          `Portal '${portalId}' changed its mount registration without changing ID.`,
          { ownerId, portalId },
        );
      }
      if (record === undefined && this.#portals.has(portalId)) {
        throw new CanvasPortalOwnershipError(
          "EXTERNAL_PORTAL_CONFLICT",
          `Portal '${portalId}' is registered outside PortalOwnership.`,
          { ownerId, portalId },
        );
      }
    }

    const data: TPortalStageData = {
      ownerId,
      desired,
      additions: [...desired.keys()].filter((portalId) => !current.has(portalId)).sort(),
      removals: [...current].filter((portalId) => !desired.has(portalId)).sort(),
      state: "staged",
    };
    this.#activeStages.set(ownerId, data);

    return {
      label: `portals:${ownerId}`,
      get state() {
        return data.state;
      },
      prepare: async () => {
        this.#prepare(data);
      },
      commit: async () => {
        this.#commit(data);
      },
      rollback: async () => {
        this.#rollback(data);
      },
    };
  }

  async sync(ownerId: string, portals: readonly TCanvasOwnedPortal[]): Promise<void> {
    const stage = this.stage(ownerId, portals);
    try {
      await stage.prepare();
      await stage.commit();
    } catch (error) {
      await stage.rollback().catch(() => undefined);
      throw error;
    }
  }

  async release(ownerId: string): Promise<void> {
    await this.sync(ownerId, []);
  }

  setInteractive(portalId: string, interactive: boolean): void {
    this.#assertOperational();
    const record = this.#records.get(portalId);
    if (record === undefined || record.pending) {
      throw new CanvasPortalOwnershipError(
        "PORTAL_OWNERSHIP_CONFLICT",
        `Portal '${portalId}' is not a committed owned portal.`,
        { portalId },
      );
    }
    this.#portals.setInteractive(portalId, interactive);
    record.interactive = interactive;
  }

  syncNow(portalId?: string): void {
    this.#assertOperational();
    this.#portals.syncNow(portalId);
  }

  subscribe(listener: (state: TPortalState) => void): () => void {
    this.#assertOperational();
    const unsubscribeEngine = this.#portals.subscribe((state) => {
      listener(cloneState(state));
    });
    let active = true;
    const unsubscribe = () => {
      if (!active) {
        return;
      }
      active = false;
      this.#subscriptions.delete(unsubscribe);
      unsubscribeEngine();
    };
    this.#subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    let failed = false;
    const capture = (error: unknown) => {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    };

    for (const unsubscribe of [...this.#subscriptions]) {
      try {
        unsubscribe();
      } catch (error) {
        capture(error);
      }
    }
    for (const data of [...this.#activeStages.values()].sort((left, right) => {
      return left.ownerId.localeCompare(right.ownerId);
    })) {
      try {
        this.#rollback(data);
      } catch (error) {
        capture(error);
      }
    }
    for (const portalId of [...this.#records.keys()].sort()) {
      try {
        this.#records.get(portalId)?.dispose();
      } catch (error) {
        capture(error);
      }
    }
    this.#subscriptions.clear();
    this.#activeStages.clear();
    this.#records.clear();
    this.#owners.clear();
    if (failed) {
      throw firstError;
    }
  }

  #prepare(data: TPortalStageData): void {
    this.#assertStageState(data, "staged");
    try {
      for (const portalId of data.additions) {
        const portal = data.desired.get(portalId)!;
        let dispose: () => void;
        try {
          dispose = this.#portals.register({
            portalId,
            mount: ({ host }) => portal.mount({ portalId, host }),
            ...(portal.onVisibilityChange === undefined
              ? {}
              : { onVisibilityChange: portal.onVisibilityChange }),
            ...(portal.onGeometryChange === undefined
              ? {}
              : {
                  onGeometryChange: (geometry) => {
                    portal.onGeometryChange?.(cloneGeometry(geometry));
                  },
                }),
          });
        } catch (error) {
          throw new CanvasPortalOwnershipError(
            "PORTAL_REGISTRATION_FAILED",
            `Portal '${portalId}' failed to register.`,
            {
              ownerId: data.ownerId,
              portalId,
              cause: error,
            },
          );
        }
        const interactive = portal.interactive ?? true;
        this.#records.set(portalId, {
          ownerId: data.ownerId,
          portal,
          interactive,
          dispose,
          pending: true,
        });
        this.#portals.setInteractive(portalId, interactive);
      }
      data.state = "prepared";
    } catch (error) {
      this.#rollbackPreparedAdditions(data);
      data.state = "rolled-back";
      this.#activeStages.delete(data.ownerId);
      throw error;
    }
  }

  #commit(data: TPortalStageData): void {
    this.#assertStageState(data, "prepared");

    for (const portalId of data.additions) {
      const record = this.#records.get(portalId);
      if (record !== undefined) {
        record.pending = false;
      }
    }
    for (const portalId of data.removals) {
      this.#records.get(portalId)?.dispose();
      this.#records.delete(portalId);
    }
    for (const [portalId, portal] of data.desired) {
      const record = this.#records.get(portalId);
      if (record === undefined) {
        continue;
      }
      const interactive = portal.interactive ?? true;
      if (record.interactive !== interactive) {
        this.#portals.setInteractive(portalId, interactive);
        record.interactive = interactive;
      }
    }

    if (data.desired.size === 0) {
      this.#owners.delete(data.ownerId);
    } else {
      this.#owners.set(data.ownerId, new Set(data.desired.keys()));
    }
    data.state = "committed";
    this.#activeStages.delete(data.ownerId);
  }

  #rollback(data: TPortalStageData): void {
    if (data.state === "rolled-back" || data.state === "committed") {
      return;
    }
    if (data.state === "prepared") {
      this.#rollbackPreparedAdditions(data);
    }
    data.state = "rolled-back";
    this.#activeStages.delete(data.ownerId);
  }

  #rollbackPreparedAdditions(data: TPortalStageData): void {
    for (const portalId of [...data.additions].reverse()) {
      const record = this.#records.get(portalId);
      if (record?.pending === true && record.ownerId === data.ownerId) {
        record.dispose();
        this.#records.delete(portalId);
      }
    }
  }

  #assertOperational(): void {
    if (this.#destroyed) {
      throw new CanvasPortalOwnershipError(
        "DESTROYED",
        "PortalOwnership is destroyed.",
      );
    }
  }

  #assertStageState(
    data: TPortalStageData,
    expected: TCanvasEngineOwnershipStageState,
  ): void {
    this.#assertOperational();
    if (data.state !== expected) {
      throw new CanvasPortalOwnershipError(
        "PORTAL_STAGE_STATE",
        `Portal stage '${data.ownerId}' is '${data.state}', expected '${expected}'.`,
        { ownerId: data.ownerId },
      );
    }
  }
}
