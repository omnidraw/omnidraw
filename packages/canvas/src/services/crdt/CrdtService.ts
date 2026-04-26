import type { DocHandle, DocHandleChangePayload, DocHandleDeletePayload, DocHandleEphemeralMessagePayload } from "@automerge/automerge-repo";
import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { fxCreateCrdtBuilder, type TCrdtBuilder, type TCrdtRecordedOp } from "./fxBuilder";
import { txApplyCrdtOps } from "./tx.apply-ops";

export type TCrdtServiceArgs = {
  docHandle: DocHandle<TCanvasDoc>;
};

export interface TCrdtServiceHooks {
  change: SyncHook<[]>;
  write: SyncHook<[TCrdtRecordedOp[]]>;
}

export type TCrdtCommitResult = ReturnType<TCrdtBuilder["commit"]>;

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
    change: new SyncHook(),
    write: new SyncHook(),
  };

  started = false;

  #pendingLocalChangeEvents = 0;
  #onDocChange = (_payload: DocHandleChangePayload<TCanvasDoc>) => {
    this.hooks.change.call();
  };
  #onDocDelete = (_payload: DocHandleDeletePayload<TCanvasDoc>) => {
    this.hooks.change.call();
  };
  #onDocEphemeralMessage = (_payload: DocHandleEphemeralMessagePayload<TCanvasDoc>) => {};

  constructor(args: TCrdtServiceArgs) {
    this.docHandle = args.docHandle;
  }

  start(): void | Promise<void> {
    if (this.started) {
      return;
    }

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
