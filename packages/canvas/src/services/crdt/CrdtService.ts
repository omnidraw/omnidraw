import type { DocHandle, DocHandleChangePayload, DocHandleDeletePayload, DocHandleEphemeralMessagePayload } from "@automerge/automerge-repo";
import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { TCanvasDoc, TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { fxCreateCrdtBuilder, type TCrdtBuilder, type TCrdtRecordedOp } from "./fxBuilder";
import { txApplyCrdtOps } from "./tx.apply-ops";
import { txMigrateWidgetWindow } from "./tx.migrate-widget-window";

export type TCrdtServiceArgs = {
  docHandle: DocHandle<TCanvasDoc>;
};

export type TCrdtChangeOrigin = "local" | "remote";

export type TCrdtEntityChange<TEntity> = {
  kind: "added" | "updated" | "deleted";
  before: TEntity | null;
  after: TEntity | null;
  changedFields: string[];
};

export type TCrdtEntityChangeSet<TEntity = TElement | TGroup> = {
  added: string[];
  updated: string[];
  deleted: string[];
  changes: Record<string, TCrdtEntityChange<TEntity>>;
};

export type TCrdtChangeSummary = {
  revision: number;
  origin: TCrdtChangeOrigin;
  fullReload: boolean;
  elements: TCrdtEntityChangeSet<TElement>;
  groups: TCrdtEntityChangeSet<TGroup>;
};

export interface TCrdtServiceHooks {
  change: SyncHook<[TCrdtChangeSummary]>;
  write: SyncHook<[TCrdtRecordedOp[]]>;
}

export type TCrdtCommitResult = ReturnType<TCrdtBuilder["commit"]>;

type TEntitySnapshot<TEntity> = {
  hash: string;
  entity: TEntity;
};

type TDocSnapshot = {
  elements: Map<string, TEntitySnapshot<TElement>>;
  groups: Map<string, TEntitySnapshot<TGroup>>;
};

function cloneEntity<TEntity extends TElement | TGroup>(entity: TEntity): TEntity {
  return JSON.parse(JSON.stringify(entity)) as TEntity;
}

function createEmptyEntityChangeSet<TEntity>(): TCrdtEntityChangeSet<TEntity> {
  return {
    added: [],
    updated: [],
    deleted: [],
    changes: {},
  };
}

function createFullReloadChangeSummary(args: {
  origin: TCrdtChangeOrigin;
  revision: number;
}): TCrdtChangeSummary {
  return {
    revision: args.revision,
    origin: args.origin,
    fullReload: true,
    elements: createEmptyEntityChangeSet(),
    groups: createEmptyEntityChangeSet(),
  };
}

function hashEntity(entity: TElement | TGroup) {
  return JSON.stringify(entity);
}

function snapshotEntities<TEntity extends TElement | TGroup>(entities: Record<string, TEntity>) {
  return new Map(Object.entries(entities).map(([id, entity]) => {
    return [id, {
      hash: hashEntity(entity),
      entity: cloneEntity(entity),
    } satisfies TEntitySnapshot<TEntity>];
  }));
}

function snapshotDoc(doc: TCanvasDoc | undefined | null): TDocSnapshot {
  return {
    elements: snapshotEntities(doc?.elements ?? {}),
    groups: snapshotEntities(doc?.groups ?? {}),
  };
}

function changedFields<TEntity extends TElement | TGroup>(
  before: TEntity,
  after: TEntity,
) {
  return [...new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])].filter((field) => {
    return JSON.stringify(before[field as keyof TEntity])
      !== JSON.stringify(after[field as keyof TEntity]);
  }).sort();
}

function diffEntitySnapshots<TEntity extends TElement | TGroup>(args: {
  previous: Map<string, TEntitySnapshot<TEntity>>;
  nextEntities: Record<string, TEntity>;
}) {
  const next = snapshotEntities(args.nextEntities);
  const changeSet = createEmptyEntityChangeSet<TEntity>();

  next.forEach((snapshot, id) => {
    const previousSnapshot = args.previous.get(id);
    if (!previousSnapshot) {
      changeSet.added.push(id);
      changeSet.changes[id] = {
        kind: "added",
        before: null,
        after: cloneEntity(snapshot.entity),
        changedFields: Object.keys(snapshot.entity).sort(),
      };
      return;
    }

    if (previousSnapshot.hash !== snapshot.hash) {
      changeSet.updated.push(id);
      changeSet.changes[id] = {
        kind: "updated",
        before: cloneEntity(previousSnapshot.entity),
        after: cloneEntity(snapshot.entity),
        changedFields: changedFields(previousSnapshot.entity, snapshot.entity),
      };
    }
  });

  args.previous.forEach((snapshot, id) => {
    if (!next.has(id)) {
      changeSet.deleted.push(id);
      changeSet.changes[id] = {
        kind: "deleted",
        before: cloneEntity(snapshot.entity),
        after: null,
        changedFields: Object.keys(snapshot.entity).sort(),
      };
    }
  });

  changeSet.added.sort();
  changeSet.updated.sort();
  changeSet.deleted.sort();
  return { changeSet, next };
}

function diffDocSnapshots(args: {
  previous: TDocSnapshot;
  nextDoc: TCanvasDoc | undefined | null;
  origin: TCrdtChangeOrigin;
  revision: number;
}): { summary: TCrdtChangeSummary; snapshot: TDocSnapshot } {
  if (!args.nextDoc) {
    return {
      summary: createFullReloadChangeSummary({
        origin: args.origin,
        revision: args.revision,
      }),
      snapshot: snapshotDoc(args.nextDoc),
    };
  }

  const elements = diffEntitySnapshots({
    previous: args.previous.elements,
    nextEntities: args.nextDoc.elements,
  });
  const groups = diffEntitySnapshots({
    previous: args.previous.groups,
    nextEntities: args.nextDoc.groups,
  });

  return {
    summary: {
      revision: args.revision,
      origin: args.origin,
      fullReload: false,
      elements: elements.changeSet,
      groups: groups.changeSet,
    },
    snapshot: {
      elements: elements.next,
      groups: groups.next,
    },
  };
}

/**
 * Thin runtime facade around the canvas CRDT document.
 *
 * Responsibilities:
 * - expose read access to the current Automerge doc
 * - build granular write batches through `build()`
 * - replay concrete recorded ops through `applyOps()`
 * - mark local writes so runtime consumers like scene hydration can skip
 *   re-applying changes that already originated from the local UI
 * - forward document lifecycle events through service hooks
 */
export class CrdtService implements IService<TCrdtServiceHooks>, IStartableService, IStoppableService {
  readonly name = "crdt";
  readonly docHandle: DocHandle<TCanvasDoc>;
  readonly hooks: TCrdtServiceHooks = {
    change: new SyncHook<[TCrdtChangeSummary]>(),
    write: new SyncHook<[TCrdtRecordedOp[]]>(),
  };

  started = false;

  #pendingLocalChangeEvents = 0;
  #localWriteDepth = 0;
  #revision = 0;
  #docSnapshot: TDocSnapshot;
  #onDocChange = (_payload: DocHandleChangePayload<TCanvasDoc>) => {
    const nextDoc = this.docHandle.doc();
    const revision = this.#revision + 1;
    const origin = this.#localWriteDepth > 0 ? "local" : "remote";
    if (origin === "local") {
      this.#pendingLocalChangeEvents += 1;
    }
    const { summary, snapshot } = diffDocSnapshots({
      previous: this.#docSnapshot,
      nextDoc,
      origin,
      revision,
    });
    this.#revision = revision;
    this.#docSnapshot = snapshot;
    this.hooks.change.call(summary);
  };
  #onDocDelete = (_payload: DocHandleDeletePayload<TCanvasDoc>) => {
    const origin = this.#localWriteDepth > 0 ? "local" : "remote";
    if (origin === "local") {
      this.#pendingLocalChangeEvents += 1;
    }
    this.#revision += 1;
    this.#docSnapshot = snapshotDoc(null);
    this.hooks.change.call(createFullReloadChangeSummary({
      origin,
      revision: this.#revision,
    }));
  };
  #onDocEphemeralMessage = (_payload: DocHandleEphemeralMessagePayload<TCanvasDoc>) => {};

  constructor(args: TCrdtServiceArgs) {
    this.docHandle = args.docHandle;
    this.#docSnapshot = snapshotDoc(this.docHandle.doc());
  }

  start(): void | Promise<void> {
    if (this.started) {
      return;
    }

    txMigrateWidgetWindow({
      read: () => this.docHandle.doc(),
      change: (callback) => {
        this.docHandle.change((document) => callback(document));
      },
    }, {});
    this.#docSnapshot = snapshotDoc(this.docHandle.doc());
    this.docHandle.on("change", this.#onDocChange as (payload: DocHandleChangePayload<unknown>) => void);
    this.docHandle.on("delete", this.#onDocDelete as (payload: DocHandleDeletePayload<unknown>) => void);
    this.docHandle.on("ephemeral-message", this.#onDocEphemeralMessage as (payload: DocHandleEphemeralMessagePayload<unknown>) => void);
    this.started = true;
  }

  stop(): void | Promise<void> {
    if (!this.started) {
      return;
    }

    this.docHandle.off("change", this.#onDocChange as (payload: DocHandleChangePayload<unknown>) => void);
    this.docHandle.off("delete", this.#onDocDelete as (payload: DocHandleDeletePayload<unknown>) => void);
    this.docHandle.off("ephemeral-message", this.#onDocEphemeralMessage as (payload: DocHandleEphemeralMessagePayload<unknown>) => void);
    this.started = false;
  }

  /**
   * Returns the current materialized canvas document snapshot.
   */
  doc() {
    return this.docHandle.doc();
  }

  get revision() {
    return this.#revision;
  }

  /**
   * Creates a fluent CRDT builder whose commit/rollback paths are tracked as
   * local writes. This prevents local runtime edits from being mistaken for
   * remote updates by consumers such as the scene hydrator.
   */
  build(): TCrdtBuilder {
    const builder = fxCreateCrdtBuilder({
      docHandle: this.docHandle,
      clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    }, {});

    const wrappedBuilder: TCrdtBuilder = {
      patchElement: ((id: string, keyOrValue: unknown, nestedOrValue?: unknown, maybeValue?: unknown) => {
        if (maybeValue !== undefined) {
          builder.patchElement(id, keyOrValue as never, nestedOrValue as never, maybeValue as never);
          return wrappedBuilder;
        }

        if (nestedOrValue !== undefined) {
          builder.patchElement(id, keyOrValue as never, nestedOrValue as never);
          return wrappedBuilder;
        }

        builder.patchElement(id, keyOrValue as never);
        return wrappedBuilder;
      }) as TCrdtBuilder["patchElement"],
      patchGroup: ((id: string, keyOrValue: unknown, nestedOrValue?: unknown, maybeValue?: unknown) => {
        if (maybeValue !== undefined) {
          builder.patchGroup(id, keyOrValue as never, nestedOrValue as never, maybeValue as never);
          return wrappedBuilder;
        }

        if (nestedOrValue !== undefined) {
          builder.patchGroup(id, keyOrValue as never, nestedOrValue as never);
          return wrappedBuilder;
        }

        builder.patchGroup(id, keyOrValue as never);
        return wrappedBuilder;
      }) as TCrdtBuilder["patchGroup"],
      deleteElement: ((id: string, key?: unknown, nestedKey?: unknown) => {
        if (nestedKey !== undefined) {
          builder.deleteElement(id, key as never, nestedKey as never);
          return wrappedBuilder;
        }

        if (key !== undefined) {
          builder.deleteElement(id, key as never);
          return wrappedBuilder;
        }

        builder.deleteElement(id);
        return wrappedBuilder;
      }) as TCrdtBuilder["deleteElement"],
      deleteGroup: ((id: string, key?: unknown, nestedKey?: unknown) => {
        if (nestedKey !== undefined) {
          builder.deleteGroup(id, key as never, nestedKey as never);
          return wrappedBuilder;
        }

        if (key !== undefined) {
          builder.deleteGroup(id, key as never);
          return wrappedBuilder;
        }

        builder.deleteGroup(id);
        return wrappedBuilder;
      }) as TCrdtBuilder["deleteGroup"],
      commit: () => {
        const commitResult = this.#runLocalChange(() => builder.commit());

        this.hooks.write.call(commitResult.redoOps);

        return {
          undoOps: commitResult.undoOps,
          redoOps: commitResult.redoOps,
          rollback: () => {
            this.#runLocalChange(() => {
              commitResult.rollback();
            });
            this.hooks.write.call(commitResult.undoOps);
          },
        };
      },
    };

    return wrappedBuilder;
  }

  /**
   * Applies previously recorded concrete CRDT ops as one local write batch.
   * Used for redo/rollback and other deterministic replays.
   */
  applyOps(args: { ops: TCrdtRecordedOp[] }) {
    this.#runLocalChange(() => {
      txApplyCrdtOps({
        docHandle: this.docHandle,
        clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
      }, args);
    });
    this.hooks.write.call(args.ops);
  }

  /**
   * Consumes one pending local change marker.
   * Runtime listeners can use this to distinguish local writes from remote ones.
   */
  consumePendingLocalChangeEvent() {
    if (this.#pendingLocalChangeEvents <= 0) {
      return false;
    }

    this.#pendingLocalChangeEvents -= 1;
    return true;
  }

  /**
   * Executes a local write path. Synchronous document events emitted within
   * the callback are labeled local independently from the legacy hydrator
   * marker, so origin remains correct after that skip path is removed.
   */
  #runLocalChange<TResult>(callback: () => TResult) {
    this.#localWriteDepth += 1;

    try {
      return callback();
    } finally {
      this.#localWriteDepth = Math.max(0, this.#localWriteDepth - 1);
    }
  }

}
