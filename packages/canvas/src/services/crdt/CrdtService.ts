import type { DocHandle, DocHandleChangePayload, DocHandleDeletePayload, DocHandleEphemeralMessagePayload } from "@automerge/automerge-repo";
import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { TCanvasDoc, TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { fxCreateCrdtBuilder, type TCrdtBuilder, type TCrdtRecordedOp } from "./fxBuilder";
import { txApplyCrdtOps } from "./tx.apply-ops";

export type TCrdtServiceArgs = {
  docHandle: DocHandle<TCanvasDoc>;
};

export type TCrdtEntityChangeSet = {
  added: string[];
  updated: string[];
  deleted: string[];
};

export type TCrdtChangeSummary = {
  fullReload: boolean;
  elements: TCrdtEntityChangeSet;
  groups: TCrdtEntityChangeSet;
};

export interface TCrdtServiceHooks {
  change: SyncHook<[TCrdtChangeSummary]>;
  write: SyncHook<[TCrdtRecordedOp[]]>;
}

export type TCrdtCommitResult = ReturnType<TCrdtBuilder["commit"]>;

type TEntitySnapshot = {
  hash: string;
};

type TDocSnapshot = {
  elements: Map<string, TEntitySnapshot>;
  groups: Map<string, TEntitySnapshot>;
};

function createEmptyEntityChangeSet(): TCrdtEntityChangeSet {
  return {
    added: [],
    updated: [],
    deleted: [],
  };
}

function createFullReloadChangeSummary(): TCrdtChangeSummary {
  return {
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
    return [id, { hash: hashEntity(entity) } satisfies TEntitySnapshot];
  }));
}

function snapshotDoc(doc: TCanvasDoc | undefined | null): TDocSnapshot {
  return {
    elements: snapshotEntities(doc?.elements ?? {}),
    groups: snapshotEntities(doc?.groups ?? {}),
  };
}

function diffEntitySnapshots<TEntity extends TElement | TGroup>(args: {
  previous: Map<string, TEntitySnapshot>;
  nextEntities: Record<string, TEntity>;
}) {
  const next = snapshotEntities(args.nextEntities);
  const changeSet = createEmptyEntityChangeSet();

  next.forEach((snapshot, id) => {
    const previousSnapshot = args.previous.get(id);
    if (!previousSnapshot) {
      changeSet.added.push(id);
      return;
    }

    if (previousSnapshot.hash !== snapshot.hash) {
      changeSet.updated.push(id);
    }
  });

  args.previous.forEach((_snapshot, id) => {
    if (!next.has(id)) {
      changeSet.deleted.push(id);
    }
  });

  return { changeSet, next };
}

function diffDocSnapshots(args: {
  previous: TDocSnapshot;
  nextDoc: TCanvasDoc | undefined | null;
}): { summary: TCrdtChangeSummary; snapshot: TDocSnapshot } {
  if (!args.nextDoc) {
    return {
      summary: createFullReloadChangeSummary(),
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
  #docSnapshot: TDocSnapshot;
  #onDocChange = (_payload: DocHandleChangePayload<TCanvasDoc>) => {
    const nextDoc = this.docHandle.doc();
    const { summary, snapshot } = diffDocSnapshots({
      previous: this.#docSnapshot,
      nextDoc,
    });
    this.#docSnapshot = snapshot;
    this.hooks.change.call(summary);
  };
  #onDocDelete = (_payload: DocHandleDeletePayload<TCanvasDoc>) => {
    this.#docSnapshot = snapshotDoc(null);
    this.hooks.change.call(createFullReloadChangeSummary());
  };
  #onDocEphemeralMessage = (_payload: DocHandleEphemeralMessagePayload<TCanvasDoc>) => {};

  constructor(args: TCrdtServiceArgs) {
    this.docHandle = args.docHandle;
    this.#docSnapshot = snapshotDoc(this.docHandle.doc());
    // @ts-expect-error keep this line. needed for debugging
    window.docHandle = this.docHandle;
  }

  start(): void | Promise<void> {
    if (this.started) {
      return;
    }

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
   * Executes a local write path and leaves one pending local marker behind on
   * success. The marker is intentionally consumed later by CRDT change
   * listeners. On failure the pending marker is removed immediately.
   */
  #runLocalChange<TResult>(callback: () => TResult) {
    this.#pendingLocalChangeEvents += 1;

    try {
      return callback();
    } catch (error) {
      this.#pendingLocalChangeEvents = Math.max(0, this.#pendingLocalChangeEvents - 1);
      throw error;
    }
  }

}
