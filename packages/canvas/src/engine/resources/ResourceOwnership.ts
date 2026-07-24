import type {
  IResourceManager,
  TResourceDescriptor,
  TResourceId,
  TResourceSource,
  TResourceState,
} from "@vibecanvas/canvas-engine";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../interface";

export type TCanvasOwnedResource = {
  descriptor: TResourceDescriptor;
  source?: TResourceSource;
};

export type TCanvasResourceStageOptions = {
  preload?: boolean;
  signal?: AbortSignal;
};

export type TCanvasResourceOwnershipErrorCode =
  | "DESTROYED"
  | "DUPLICATE_RESOURCE_ID"
  | "EXTERNAL_RESOURCE_CONFLICT"
  | "RESOURCE_IDENTITY_CONFLICT"
  | "RESOURCE_OWNER_BUSY"
  | "RESOURCE_PRELOAD_FAILED"
  | "RESOURCE_STAGE_STATE";

export class CanvasResourceOwnershipError extends Error {
  readonly code: TCanvasResourceOwnershipErrorCode;
  readonly ownerId?: string;
  readonly resourceId?: string;
  readonly cause?: unknown;

  constructor(
    code: TCanvasResourceOwnershipErrorCode,
    message: string,
    details?: { ownerId?: string; resourceId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "CanvasResourceOwnershipError";
    this.code = code;
    this.ownerId = details?.ownerId;
    this.resourceId = details?.resourceId;
    this.cause = details?.cause;
  }
}

type TResourceRecord = {
  descriptor: TResourceDescriptor;
  source: TResourceSource | undefined;
  committedOwners: Set<string>;
  pendingOwners: Set<string>;
};

type TResourceStageData = {
  ownerId: string;
  desired: Map<TResourceId, TCanvasOwnedResource>;
  additions: TResourceId[];
  removals: TResourceId[];
  options: TCanvasResourceStageOptions;
  state: TCanvasEngineOwnershipStageState;
};

type TResourceOwnershipArgs = {
  resources: IResourceManager;
};

function canonicalDescriptor(descriptor: TResourceDescriptor): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(descriptor)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function sameSource(
  left: TResourceSource | undefined,
  right: TResourceSource | undefined,
): boolean {
  if (left === right || right === undefined) {
    return true;
  }
  if (left === undefined || left.type !== right.type) {
    return false;
  }
  switch (left.type) {
    case "url":
      return right.type === "url"
        && left.url === right.url
        && canonicalHeaders(left.headers) === canonicalHeaders(right.headers);
    case "blob":
      return right.type === "blob" && left.blob === right.blob;
    case "array-buffer":
      return right.type === "array-buffer" && left.data === right.data;
    case "image-bitmap":
      return right.type === "image-bitmap" && left.bitmap === right.bitmap;
    case "object":
      return right.type === "object" && left.value === right.value;
  }
}

function canonicalHeaders(headers: Record<string, string> | undefined): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(headers ?? {}).sort(([left], [right]) => {
      return left.localeCompare(right);
    })),
  );
}

function sameResource(
  left: Pick<TCanvasOwnedResource, "descriptor" | "source">,
  right: Pick<TCanvasOwnedResource, "descriptor" | "source">,
): boolean {
  return canonicalDescriptor(left.descriptor) === canonicalDescriptor(right.descriptor)
    && sameSource(left.source, right.source);
}

function cloneDescriptor(descriptor: TResourceDescriptor): TResourceDescriptor {
  return { ...descriptor };
}

function cloneSource(source: TResourceSource | undefined): TResourceSource | undefined {
  if (source?.type === "url") {
    return {
      ...source,
      ...(source.headers === undefined ? {} : { headers: { ...source.headers } }),
    };
  }
  return source;
}

function ownerToken(ownerId: string): string {
  return `vibecanvas:resource-owner:${ownerId}`;
}

/**
 * Owns only resources registered through this boundary. A changed descriptor or
 * source must use a new resource ID so the currently rendered generation stays
 * available until the new scene commits.
 */
export class ResourceOwnership {
  readonly #resources: IResourceManager;
  readonly #owners = new Map<string, Set<TResourceId>>();
  readonly #records = new Map<TResourceId, TResourceRecord>();
  readonly #activeStages = new Map<string, TResourceStageData>();
  #destroyed = false;

  constructor(args: TResourceOwnershipArgs) {
    this.#resources = args.resources;
  }

  get ownerCount(): number {
    return this.#owners.size;
  }

  get resourceCount(): number {
    return this.#records.size;
  }

  ownerResourceIds(ownerId: string): readonly string[] {
    return [...(this.#owners.get(ownerId) ?? [])].sort();
  }

  state(resourceId: string): TResourceState | null {
    return this.#resources.state(resourceId);
  }

  stage(
    ownerId: string,
    resources: readonly TCanvasOwnedResource[],
    options: TCanvasResourceStageOptions = {},
  ): ICanvasEngineOwnershipStage {
    this.#assertOperational();
    if (ownerId.length === 0) {
      throw new TypeError("Resource owner ID must be non-empty.");
    }
    if (this.#activeStages.has(ownerId)) {
      throw new CanvasResourceOwnershipError(
        "RESOURCE_OWNER_BUSY",
        `Resource owner '${ownerId}' already has an active stage.`,
        { ownerId },
      );
    }

    const desired = new Map<TResourceId, TCanvasOwnedResource>();
    for (const resource of resources) {
      const resourceId = resource.descriptor.id;
      if (desired.has(resourceId)) {
        throw new CanvasResourceOwnershipError(
          "DUPLICATE_RESOURCE_ID",
          `Resource owner '${ownerId}' contains duplicate resource ID '${resourceId}'.`,
          { ownerId, resourceId },
        );
      }
      desired.set(resourceId, {
        descriptor: cloneDescriptor(resource.descriptor),
        ...(resource.source === undefined ? {} : { source: cloneSource(resource.source) }),
      });
    }

    const current = this.#owners.get(ownerId) ?? new Set<TResourceId>();
    for (const [resourceId, resource] of desired) {
      const record = this.#records.get(resourceId);
      if (record !== undefined && !sameResource(record, resource)) {
        throw new CanvasResourceOwnershipError(
          "RESOURCE_IDENTITY_CONFLICT",
          `Resource '${resourceId}' changed descriptor or source without changing ID.`,
          { ownerId, resourceId },
        );
      }
      if (record === undefined && this.#resources.state(resourceId) !== null) {
        throw new CanvasResourceOwnershipError(
          "EXTERNAL_RESOURCE_CONFLICT",
          `Resource '${resourceId}' is registered outside ResourceOwnership.`,
          { ownerId, resourceId },
        );
      }
    }

    const data: TResourceStageData = {
      ownerId,
      desired,
      additions: [...desired.keys()].filter((resourceId) => !current.has(resourceId)).sort(),
      removals: [...current].filter((resourceId) => !desired.has(resourceId)).sort(),
      options,
      state: "staged",
    };
    this.#activeStages.set(ownerId, data);

    return {
      label: `resources:${ownerId}`,
      get state() {
        return data.state;
      },
      prepare: async () => {
        await this.#prepare(data);
      },
      commit: async () => {
        this.#commit(data);
      },
      rollback: async () => {
        this.#rollback(data);
      },
    };
  }

  async sync(
    ownerId: string,
    resources: readonly TCanvasOwnedResource[],
    options: TCanvasResourceStageOptions = {},
  ): Promise<void> {
    const stage = this.stage(ownerId, resources, options);
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

    for (const data of [...this.#activeStages.values()].sort((left, right) => {
      return left.ownerId.localeCompare(right.ownerId);
    })) {
      try {
        this.#rollback(data);
      } catch (error) {
        capture(error);
      }
    }

    for (const ownerId of [...this.#owners.keys()].sort()) {
      const token = ownerToken(ownerId);
      for (const resourceId of [...(this.#owners.get(ownerId) ?? [])].sort()) {
        const record = this.#records.get(resourceId);
        record?.committedOwners.delete(ownerId);
        try {
          this.#resources.release(resourceId, token);
        } catch (error) {
          capture(error);
        }
      }
    }
    this.#owners.clear();

    for (const resourceId of [...this.#records.keys()].sort()) {
      try {
        this.#resources.unregister(resourceId);
      } catch (error) {
        capture(error);
      }
    }
    this.#records.clear();
    this.#activeStages.clear();
    if (failed) {
      throw firstError;
    }
  }

  async #prepare(data: TResourceStageData): Promise<void> {
    this.#assertStageState(data, "staged");
    try {
      for (const resourceId of data.additions) {
        const resource = data.desired.get(resourceId)!;
        let record = this.#records.get(resourceId);
        if (record === undefined) {
          this.#resources.register(resource.descriptor, resource.source);
          record = {
            descriptor: resource.descriptor,
            source: resource.source,
            committedOwners: new Set(),
            pendingOwners: new Set(),
          };
          this.#records.set(resourceId, record);
        }
        this.#resources.retain(resourceId, ownerToken(data.ownerId));
        record.pendingOwners.add(data.ownerId);
      }
      if (data.options.preload === true && data.additions.length > 0) {
        await Promise.all(data.additions.map(async (resourceId) => {
          try {
            await this.#resources.preload([resourceId], {
              ...(data.options.signal === undefined
                ? {}
                : { signal: data.options.signal }),
            });
          } catch (error) {
            throw new CanvasResourceOwnershipError(
              "RESOURCE_PRELOAD_FAILED",
              `Resource '${resourceId}' failed to preload.`,
              {
                ownerId: data.ownerId,
                resourceId,
                cause: error,
              },
            );
          }
        }));
      }
      data.state = "prepared";
    } catch (error) {
      this.#rollbackPreparedAdditions(data);
      data.state = "rolled-back";
      this.#activeStages.delete(data.ownerId);
      throw error;
    }
  }

  #commit(data: TResourceStageData): void {
    this.#assertStageState(data, "prepared");
    for (const resourceId of data.additions) {
      const record = this.#records.get(resourceId);
      record?.pendingOwners.delete(data.ownerId);
      record?.committedOwners.add(data.ownerId);
    }

    const token = ownerToken(data.ownerId);
    for (const resourceId of data.removals) {
      const record = this.#records.get(resourceId);
      record?.committedOwners.delete(data.ownerId);
      this.#resources.release(resourceId, token);
      this.#cleanupRecord(resourceId);
    }

    if (data.desired.size === 0) {
      this.#owners.delete(data.ownerId);
    } else {
      this.#owners.set(data.ownerId, new Set(data.desired.keys()));
    }
    data.state = "committed";
    this.#activeStages.delete(data.ownerId);
  }

  #rollback(data: TResourceStageData): void {
    if (data.state === "rolled-back" || data.state === "committed") {
      return;
    }
    if (data.state === "prepared") {
      this.#rollbackPreparedAdditions(data);
    }
    data.state = "rolled-back";
    this.#activeStages.delete(data.ownerId);
  }

  #rollbackPreparedAdditions(data: TResourceStageData): void {
    const token = ownerToken(data.ownerId);
    for (const resourceId of [...data.additions].reverse()) {
      const record = this.#records.get(resourceId);
      if (record?.pendingOwners.delete(data.ownerId)) {
        this.#resources.release(resourceId, token);
      }
      this.#cleanupRecord(resourceId);
    }
  }

  #cleanupRecord(resourceId: TResourceId): void {
    const record = this.#records.get(resourceId);
    if (
      record === undefined
      || record.committedOwners.size > 0
      || record.pendingOwners.size > 0
    ) {
      return;
    }
    this.#resources.unregister(resourceId);
    this.#records.delete(resourceId);
  }

  #assertOperational(): void {
    if (this.#destroyed) {
      throw new CanvasResourceOwnershipError(
        "DESTROYED",
        "ResourceOwnership is destroyed.",
      );
    }
  }

  #assertStageState(
    data: TResourceStageData,
    expected: TCanvasEngineOwnershipStageState,
  ): void {
    this.#assertOperational();
    if (data.state !== expected) {
      throw new CanvasResourceOwnershipError(
        "RESOURCE_STAGE_STATE",
        `Resource stage '${data.ownerId}' is '${data.state}', expected '${expected}'.`,
        { ownerId: data.ownerId },
      );
    }
  }
}
