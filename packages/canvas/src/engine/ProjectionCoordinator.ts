import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ICanvasEngineOwnershipStage } from "./interface";
import type {
  TCanvasDocumentProjection,
  TCanvasProjectionDependencies,
  TCanvasProjectionDiff,
  TCanvasProjectionIndex,
  TCanvasProjectionTheme,
  TCanvasProjectionWork,
} from "./typed";
import type { ProjectionRegistry } from "./projection/ProjectionRegistry";
import { fnDiffCanvasProjections } from "./projection/fn.diff";
import {
  fnProjectCanvasDocumentIncremental,
  type TCanvasIncrementalElementChanges,
} from "./projection/fn.incremental-document";
import { fnProjectCanvasDocument } from "./projection/fn.project-document";
import {
  fnCreatePersistentStringSet,
  fnPatchPersistentStringSet,
} from "./projection/fn.persistent-record";
import { CanvasPortalOwnershipError } from "./portals/PortalOwnership";
import { CanvasPortalContentMountError } from "./projection-runtime/PortalContentBridge";
import { CanvasResourceOwnershipError } from "./resources/ResourceOwnership";

export type TCanvasProjectionOrigin =
  | "initial"
  | "local"
  | "remote"
  | "theme"
  | "extension"
  | "view";

export type TCanvasProjectionApplyMode =
  | {
      kind: "replace";
      reason: "initial" | "full-reload";
    }
  | {
      kind: "diff";
      diff: TCanvasProjectionDiff;
    };

export type TCanvasProjectionOwnershipArgs = {
  previous: TCanvasDocumentProjection | null;
  next: TCanvasDocumentProjection;
  diff: TCanvasProjectionDiff | null;
  revision: number;
};

export type TCanvasProjectionSceneApplyArgs = {
  previous: TCanvasDocumentProjection | null;
  next: TCanvasDocumentProjection;
  revision: number;
  origin: TCanvasProjectionOrigin;
  mode: TCanvasProjectionApplyMode;
};

/**
 * Engine-independent retained-scene boundary. The concrete adapter owns how a
 * node/resource/portal diff is translated to engine transactions.
 *
 * `applyScene` must reject only after restoring its own last-good scene.
 */
export interface ICanvasProjectionRuntimePort {
  stageOwnership(
    args: TCanvasProjectionOwnershipArgs,
  ): ICanvasEngineOwnershipStage;
  applyScene(args: TCanvasProjectionSceneApplyArgs): Promise<void>;
}

export type TCanvasProjectionPruneArgs = {
  revision: number;
  elementIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
};

export type TProjectionCoordinatorArgs = {
  registry: ProjectionRegistry;
  theme: TCanvasProjectionTheme;
  dependencies: TCanvasProjectionDependencies;
  runtime: ICanvasProjectionRuntimePort;
  onPruneSelectionAndFocus?(args: TCanvasProjectionPruneArgs): void;
};

export type TCanvasProjectionUpdate = {
  document: TCanvasDoc;
  revision: number;
  origin: "local" | "remote";
  fullReload?: boolean;
  changes?: {
    elements: TCanvasIncrementalElementChanges;
    groups: {
      added: readonly string[];
      updated: readonly string[];
      deleted: readonly string[];
    };
  };
};

export type TCanvasProjectionCoordinatorResult =
  | {
      status: "applied" | "noop";
      revision: number;
      origin: TCanvasProjectionOrigin;
      mode: TCanvasProjectionApplyMode["kind"];
      work: TCanvasProjectionWork;
    }
  | {
      status: "failed";
      revision: number;
      origin: TCanvasProjectionOrigin;
      error: unknown;
    }
  | {
      status: "rejected";
      revision: number;
      origin: TCanvasProjectionOrigin;
      reason: "disposed" | "stale-revision";
    };

type TQueuedProjection = {
  document: TCanvasDoc;
  revision: number;
  origin: TCanvasProjectionOrigin;
  fullReload: boolean;
  changes: NonNullable<TCanvasProjectionUpdate["changes"]> | null;
  generation: number;
  resolve(result: TCanvasProjectionCoordinatorResult): void;
};

type TProjectionOwnershipFallback = {
  elementId: string;
  code: "PORTAL_REGISTRATION_FAILED" | "RESOURCE_PRELOAD_FAILED";
  message: string;
};

function elementIdForOwnedId(
  valuesByElementId: Readonly<Record<string, readonly string[]>>,
  ownedId: string,
): string | null {
  return Object.entries(valuesByElementId).find(([, ids]) => {
    return ids.includes(ownedId);
  })?.[0] ?? null;
}

function projectionOwnershipFallback(
  error: unknown,
  projection: TCanvasDocumentProjection,
): TProjectionOwnershipFallback | null {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null
    && typeof current === "object"
    && !visited.has(current)
  ) {
    visited.add(current);
    if (
      current instanceof CanvasResourceOwnershipError
      && current.resourceId !== undefined
    ) {
      const elementId = elementIdForOwnedId(
        projection.index.elementResourceIds,
        current.resourceId,
      );
      if (elementId !== null) {
        return {
          elementId,
          code: "RESOURCE_PRELOAD_FAILED",
          message: `Element '${elementId}' resource '${current.resourceId}' could not be prepared: ${current.message}`,
        };
      }
    }
    if (
      current instanceof CanvasPortalOwnershipError
      && current.portalId !== undefined
    ) {
      const elementId = elementIdForOwnedId(
        projection.index.elementPortalIds,
        current.portalId,
      );
      if (elementId !== null) {
        return {
          elementId,
          code: "PORTAL_REGISTRATION_FAILED",
          message: `Element '${elementId}' portal '${current.portalId}' could not be registered: ${current.message}`,
        };
      }
    }
    if (current instanceof CanvasPortalContentMountError) {
      const elementId = elementIdForOwnedId(
        projection.index.elementPortalIds,
        current.portalId,
      );
      if (elementId !== null) {
        return {
          elementId,
          code: "PORTAL_REGISTRATION_FAILED",
          message: `Element '${elementId}' portal '${current.portalId}' content could not mount: ${current.message}`,
        };
      }
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return null;
}

function groupUpdateViolatesIncrementalInvariant(
  document: TCanvasDoc,
  groupIds: readonly string[],
): boolean {
  for (const groupId of groupIds) {
    const visited = new Set<string>();
    let currentId: string | null = groupId;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        return true;
      }
      visited.add(currentId);
      currentId = document.groups[currentId]?.parentGroupId ?? null;
    }
  }
  return false;
}

function cloneDocument(document: TCanvasDoc): TCanvasDoc {
  return JSON.parse(JSON.stringify(document)) as TCanvasDoc;
}

function disposedResult(
  item: Pick<TQueuedProjection, "origin" | "revision">,
): TCanvasProjectionCoordinatorResult {
  return {
    status: "rejected",
    revision: item.revision,
    origin: item.origin,
    reason: "disposed",
  };
}

/**
 * Serializes authoritative CRDT snapshots through one projection path.
 *
 * The coordinator never receives a CRDT writer and therefore cannot mutate,
 * delete, or repair collaborative product data.
 */
export class ProjectionCoordinator {
  #registry: ProjectionRegistry;
  #theme: TCanvasProjectionTheme;
  #gridVisible = true;
  readonly #dependencies: TCanvasProjectionDependencies;
  readonly #runtime: ICanvasProjectionRuntimePort;
  readonly #onPruneSelectionAndFocus:
    | ((args: TCanvasProjectionPruneArgs) => void)
    | undefined;
  readonly #queue: TQueuedProjection[] = [];

  #draining = false;
  #disposed = false;
  #generation = 0;
  #highestAcceptedRevision: number | null = null;
  #lastGoodProjection: TCanvasDocumentProjection | null = null;
  #publishedElementIds: ReadonlySet<string> = fnCreatePersistentStringSet([]);
  #publishedGroupIds: ReadonlySet<string> = fnCreatePersistentStringSet([]);
  #publishedIdsInitialized = false;

  constructor(args: TProjectionCoordinatorArgs) {
    this.#registry = args.registry;
    this.#theme = args.theme;
    this.#dependencies = args.dependencies;
    this.#runtime = args.runtime;
    this.#onPruneSelectionAndFocus = args.onPruneSelectionAndFocus;
  }

  get lastAppliedRevision(): number | null {
    return this.#lastGoodProjection?.index.lastAppliedRevision ?? null;
  }

  get lastGoodProjection(): TCanvasDocumentProjection | null {
    return this.#lastGoodProjection;
  }

  get projectionIndex(): TCanvasProjectionIndex | null {
    return this.#lastGoodProjection?.index ?? null;
  }

  hydrateInitial(
    document: TCanvasDoc,
    revision: number,
  ): Promise<TCanvasProjectionCoordinatorResult> {
    return this.#enqueue({
      document,
      revision,
      origin: "initial",
      fullReload: true,
    });
  }

  enqueue(
    update: TCanvasProjectionUpdate,
  ): Promise<TCanvasProjectionCoordinatorResult> {
    return this.#enqueue({
      ...update,
      fullReload: update.fullReload ?? false,
    });
  }

  setTheme(theme: TCanvasProjectionTheme): void {
    if (this.#disposed) {
      return;
    }
    this.#theme = theme;
  }

  setRegistry(registry: ProjectionRegistry): void {
    if (this.#disposed) {
      return;
    }
    this.#registry = registry;
  }

  setGridVisible(visible: boolean): void {
    if (this.#disposed) {
      return;
    }
    this.#gridVisible = visible;
  }

  reproject(
    document: TCanvasDoc,
    revision: number,
    origin: Extract<
      TCanvasProjectionOrigin,
      "theme" | "extension" | "view"
    > = "theme",
  ): Promise<TCanvasProjectionCoordinatorResult> {
    return this.#enqueue({
      document,
      revision,
      origin,
      fullReload: false,
      acceptEqualRevision: true,
    });
  }

  stop(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    for (const item of this.#queue.splice(0)) {
      item.resolve(disposedResult(item));
    }
  }

  dispose(): void {
    this.stop();
  }

  #enqueue(args: {
    document: TCanvasDoc;
    revision: number;
    origin: TCanvasProjectionOrigin;
    fullReload: boolean;
    changes?: TCanvasProjectionUpdate["changes"];
    acceptEqualRevision?: boolean;
  }): Promise<TCanvasProjectionCoordinatorResult> {
    if (!Number.isSafeInteger(args.revision) || args.revision < 0) {
      return Promise.reject(new TypeError(
        `Canvas projection revision must be a non-negative safe integer; received '${args.revision}'.`,
      ));
    }
    if (this.#disposed) {
      return Promise.resolve(disposedResult(args));
    }
    if (
      this.#highestAcceptedRevision !== null
      && (
        args.revision < this.#highestAcceptedRevision
        || (
          args.revision === this.#highestAcceptedRevision
          && args.acceptEqualRevision !== true
        )
      )
    ) {
      return Promise.resolve({
        status: "rejected",
        revision: args.revision,
        origin: args.origin,
        reason: "stale-revision",
      });
    }

    this.#highestAcceptedRevision = args.revision;
    return new Promise((resolve) => {
      this.#queue.push({
        document: args.changes === undefined
          ? cloneDocument(args.document)
          : args.document,
        revision: args.revision,
        origin: args.origin,
        fullReload: args.fullReload,
        changes: args.changes ?? null,
        generation: this.#generation,
        resolve,
      });
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#draining) {
      return;
    }
    this.#draining = true;
    try {
      while (!this.#disposed && this.#queue.length > 0) {
        const item = this.#queue.shift();
        if (item === undefined) {
          continue;
        }
        item.resolve(await this.#apply(item));
      }
    } finally {
      this.#draining = false;
    }
  }

  async #apply(
    item: TQueuedProjection,
  ): Promise<TCanvasProjectionCoordinatorResult> {
    if (!this.#isCurrent(item)) {
      return disposedResult(item);
    }

    const previous = this.#lastGoodProjection;
    const forcedPlaceholders: Record<
      string,
      Omit<TProjectionOwnershipFallback, "elementId">
    > = {};
    const recoveryElementIds = new Set<string>();
    const maximumAttempts = 2;
    let recoveryPasses = 0;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      let ownershipStage: ICanvasEngineOwnershipStage | null = null;
      const hasGroupInvariantFailure = item.changes !== null
        && groupUpdateViolatesIncrementalInvariant(
          item.document,
          [
            ...item.changes.groups.added,
            ...item.changes.groups.updated,
          ],
        );
      const incremental = previous !== null
        && !item.fullReload
        && item.changes !== null
        && !hasGroupInvariantFailure
        ? fnProjectCanvasDocumentIncremental({
            previous,
            document: item.document,
            changes: {
              added: item.changes.elements.added,
              updated: [
                ...item.changes.elements.updated,
                ...recoveryElementIds,
              ],
              deleted: item.changes.elements.deleted,
            },
            groupChanges: item.changes.groups,
            registry: this.#registry,
            theme: this.#theme,
            dependencies: this.#dependencies,
            revision: item.revision,
            forcedPlaceholders,
          })
        : null;
      const next = incremental?.projection ?? fnProjectCanvasDocument({
        document: item.document,
        registry: this.#registry,
        theme: this.#theme,
        dependencies: this.#dependencies,
        revision: item.revision,
        gridVisible: this.#gridVisible,
        forcedPlaceholders,
      });
      const work: TCanvasProjectionWork = incremental?.work ?? {
        collectionCopies: 1,
        collectionScans: 1,
        projectedRoots:
          Object.keys(item.document.elements).length
          + Object.keys(item.document.groups).length,
        projectedNodes: next.snapshot.nodes.length,
        copiedNodeSlots: 0,
        recoveryPasses,
        invariantFallbacks: hasGroupInvariantFailure ? 1 : 0,
      };
      work.recoveryPasses = recoveryPasses;
      const diff = previous === null
        ? null
        : incremental?.diff
          ?? fnDiffCanvasProjections({ previous, next });
      let mode: TCanvasProjectionApplyMode;
      if (previous === null) {
        mode = { kind: "replace", reason: "initial" };
      } else if (item.fullReload) {
        mode = { kind: "replace", reason: "full-reload" };
      } else {
        mode = {
          kind: "diff",
          diff: diff!,
        };
      }

      if (mode.kind === "diff" && !mode.diff.changed) {
        if (!this.#isCurrent(item)) {
          return disposedResult(item);
        }
        this.#publishSuccess(item, next);
        const result = {
          status: "noop",
          revision: item.revision,
          origin: item.origin,
          mode: "diff",
          work,
        } as const;
        return result;
      }

      try {
        ownershipStage = this.#runtime.stageOwnership({
          previous,
          next,
          diff,
          revision: item.revision,
        });
        await ownershipStage.prepare();
        if (!this.#isCurrent(item)) {
          await ownershipStage.rollback().catch(() => undefined);
          return disposedResult(item);
        }

        await this.#runtime.applyScene({
          previous,
          next,
          revision: item.revision,
          origin: item.origin,
          mode,
        });
        if (!this.#isCurrent(item)) {
          await ownershipStage.rollback().catch(() => undefined);
          return disposedResult(item);
        }

        await ownershipStage.commit();
        if (!this.#isCurrent(item)) {
          return disposedResult(item);
        }

        this.#publishSuccess(item, next);
        const result = {
          status: "applied",
          revision: item.revision,
          origin: item.origin,
          mode: mode.kind,
          work,
        } as const;
        return result;
      } catch (error) {
        await ownershipStage?.rollback().catch(() => undefined);
        const fallback = projectionOwnershipFallback(error, next);
        if (
          fallback === null
          || forcedPlaceholders[fallback.elementId] !== undefined
          || attempt + 1 >= maximumAttempts
        ) {
          return {
            status: "failed",
            revision: item.revision,
            origin: item.origin,
            error,
          };
        }
        forcedPlaceholders[fallback.elementId] = {
          code: fallback.code,
          message: fallback.message,
        };
        recoveryElementIds.add(fallback.elementId);
        recoveryPasses += 1;
      }
    }
    return {
      status: "failed",
      revision: item.revision,
      origin: item.origin,
      error: new Error(
        `Projection revision '${item.revision}' exhausted ownership fallback attempts.`,
      ),
    };
  }

  #isCurrent(item: TQueuedProjection): boolean {
    return !this.#disposed && item.generation === this.#generation;
  }

  #publishSuccess(
    item: TQueuedProjection,
    projection: TCanvasDocumentProjection,
  ): void {
    this.#lastGoodProjection = projection;
    if (!this.#publishedIdsInitialized || item.changes === null) {
      this.#publishedElementIds = fnCreatePersistentStringSet(
        Object.keys(item.document.elements),
      );
      this.#publishedGroupIds = fnCreatePersistentStringSet(
        Object.keys(item.document.groups),
      );
      this.#publishedIdsInitialized = true;
    } else {
      this.#publishedElementIds = fnPatchPersistentStringSet({
        previous: this.#publishedElementIds,
        added: item.changes.elements.added,
        deleted: item.changes.elements.deleted,
      });
      this.#publishedGroupIds = fnPatchPersistentStringSet({
        previous: this.#publishedGroupIds,
        added: item.changes.groups.added,
        deleted: item.changes.groups.deleted,
      });
    }
    this.#onPruneSelectionAndFocus?.({
      revision: item.revision,
      elementIds: this.#publishedElementIds,
      groupIds: this.#publishedGroupIds,
    });
  }
}
