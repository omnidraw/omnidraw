import type {
  IInfiniteCanvasEngine,
  TSceneJournalEntry,
  TSceneNode,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import type { IEditorHistory } from '@omnidraw/cangine/editor';
import {
  fnMaterializeCanvasValidationSnapshot,
  type TCanvasCommand,
  type TCanvasEvent,
  type TCanvasItemPatch,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasOperation,
  type TCanvasPrecondition,
  type TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import {
  fnApplySceneNodePatches,
  fnAuthoredCanvasNode,
  fnDiffSceneNodeStructure,
  fnDiffSceneNodes,
  fnRuntimeCanvasNode,
} from './fn.scene-node-diff';

const SERVER_SCENE_SOURCE = 'vibecanvas:server';
const SNAPSHOT_SCENE_SOURCE = 'vibecanvas:snapshot';
const UNDO_SCENE_SOURCE = 'vibecanvas:undo';
const REDO_SCENE_SOURCE = 'vibecanvas:redo';
const LOCAL_HISTORY_CAPACITY = 100;

export type TCanvasDocumentTransport = Readonly<{
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot>;
  execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent>;
  subscribe(args: Readonly<{
    canvasId: string;
    afterRevision: number;
  }>): AsyncIterable<TCanvasEvent>;
}>;

export type TCanvasDocumentServiceOptions = Readonly<{
  canvasId: string;
  transport: TCanvasDocumentTransport;
  createCommandId(): string;
  onError?(error: unknown): void;
}>;

type THistoryEntry = Readonly<{
  before: ReadonlyMap<string, TSceneNode | null>;
  after: ReadonlyMap<string, TSceneNode | null>;
  coalesceKey?: string;
}>;

type TCommandPlan = Readonly<{
  operations: readonly TCanvasOperation[];
  preconditions: readonly TCanvasPrecondition[];
}>;

class CanvasDocumentHistory implements IEditorHistory {
  readonly #capacity: number;
  readonly #perform: (entry: THistoryEntry, direction: 'undo' | 'redo') => void;
  readonly #listeners = new Set<() => void>();
  readonly #undo: THistoryEntry[] = [];
  readonly #redo: THistoryEntry[] = [];
  #attached = false;
  #destroyed = false;
  #coalesceKey: string | null = null;

  constructor(
    perform: (entry: THistoryEntry, direction: 'undo' | 'redo') => void,
    capacity = LOCAL_HISTORY_CAPACITY,
  ) {
    this.#perform = perform;
    this.#capacity = capacity;
  }

  get canUndo(): boolean {
    return !this.#destroyed && this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return !this.#destroyed && this.#redo.length > 0;
  }

  get retainedWeight(): number {
    return this.#undo.length + this.#redo.length;
  }

  attach(): void {
    if (this.#destroyed) return;
    this.#attached = true;
  }

  detach(): void {
    this.#attached = false;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  beginCoalescing(key: string): void {
    this.#coalesceKey = key;
  }

  endCoalescing(key?: string): void {
    if (key === undefined || key === this.#coalesceKey) this.#coalesceKey = null;
  }

  undo(): boolean {
    if (!this.#attached || !this.canUndo) return false;
    const entry = this.#undo.pop()!;
    this.#redo.push(entry);
    this.#perform(entry, 'undo');
    this.#notify();
    return true;
  }

  redo(): boolean {
    if (!this.#attached || !this.canRedo) return false;
    const entry = this.#redo.pop()!;
    this.#undo.push(entry);
    this.#perform(entry, 'redo');
    this.#notify();
    return true;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#notify();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#attached = false;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#listeners.clear();
  }

  record(entry: THistoryEntry): void {
    if (this.#destroyed) return;
    const coalesceKey = entry.coalesceKey ?? this.#coalesceKey ?? undefined;
    const previous = this.#undo.at(-1);
    if (coalesceKey !== undefined && previous?.coalesceKey === coalesceKey) {
      const before = new Map(previous.before);
      const after = new Map(previous.after);
      for (const [id, node] of entry.before) {
        if (!before.has(id)) before.set(id, node);
      }
      for (const [id, node] of entry.after) after.set(id, node);
      this.#undo[this.#undo.length - 1] = {
        before,
        after,
        coalesceKey,
      };
    } else {
      this.#undo.push({ ...entry, coalesceKey });
      while (this.#undo.length > this.#capacity) this.#undo.shift();
    }
    this.#redo.length = 0;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/**
 * Browser-side facade over the authoritative service. Cangine remains the
 * optimistic authored-scene model; durable writes are primitive commands.
 */
export class CanvasDocumentService {
  readonly history: IEditorHistory;
  readonly #canvasId: string;
  readonly #transport: TCanvasDocumentTransport;
  readonly #createCommandId: () => string;
  readonly #onError: (error: unknown) => void;
  readonly #items = new Map<string, TCanvasItemSnapshot>();
  #engine: IInfiniteCanvasEngine | null = null;
  #revision = 0;
  #disposed = false;
  #generation = 0;
  #commandTail: Promise<void> = Promise.resolve();
  #eventIterator: AsyncIterator<TCanvasEvent> | null = null;
  #unsubscribeRecorder: (() => void) | null = null;

  constructor(options: TCanvasDocumentServiceOptions) {
    this.#canvasId = options.canvasId;
    this.#transport = options.transport;
    this.#createCommandId = options.createCommandId;
    this.#onError = options.onError ?? (() => undefined);
    this.history = new CanvasDocumentHistory((entry, direction) => {
      this.#performHistory(entry, direction);
    });
  }

  get revision(): number {
    return this.#revision;
  }

  get canvasId(): string {
    return this.#canvasId;
  }

  item(itemId: string): TCanvasItemSnapshot | null {
    return this.#items.get(itemId) ?? null;
  }

  items(): readonly TCanvasItemSnapshot[] {
    return Object.freeze([...this.#items.values()]);
  }

  async start(engine: IInfiniteCanvasEngine): Promise<void> {
    if (this.#disposed) throw new Error('Canvas document service is disposed.');
    if (this.#engine) throw new Error('Canvas document service is already started.');
    this.#engine = engine;
    await this.#reload(true);
    const recorder = engine.recorder;
    if (!recorder) throw new Error('Canvas engine recording is required for persistence.');
    this.#unsubscribeRecorder = recorder.subscribe((entry) => this.#onJournalEntry(entry));
    const generation = ++this.#generation;
    void this.#consumeEvents(generation);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#unsubscribeRecorder?.();
    this.#unsubscribeRecorder = null;
    const iterator = this.#eventIterator;
    this.#eventIterator = null;
    await iterator?.return?.().catch(() => undefined);
    await this.#commandTail.catch(() => undefined);
    this.history.destroy();
    this.#items.clear();
    this.#engine = null;
  }

  #onJournalEntry(entry: TSceneJournalEntry): void {
    const source = entry.meta.source ?? entry.change.source;
    if (
      source === SERVER_SCENE_SOURCE
      || source === SNAPSHOT_SCENE_SOURCE
      || source === UNDO_SCENE_SOURCE
      || source === REDO_SCENE_SOURCE
      || this.#disposed
    ) return;
    const before = new Map<string, TSceneNode | null>();
    const after = new Map<string, TSceneNode | null>();
    const ids = new Set([
      ...entry.change.added,
      ...entry.change.updated,
      ...entry.change.removed,
      ...entry.change.reparented,
      ...entry.change.reordered,
    ]);
    for (const id of ids) {
      if (id === 'vibecanvas:runtime:content') continue;
      const previous = entry.before[id];
      const current = this.#engine?.scene.get(id) ?? null;
      before.set(id, previous ? fnAuthoredCanvasNode(previous) : null);
      after.set(id, current ? fnAuthoredCanvasNode(current as TSceneNode) : null);
    }
    if (before.size === 0) return;
    const historyEntry: THistoryEntry = {
      before,
      after,
      ...(entry.meta.coalesceKey ? { coalesceKey: entry.meta.coalesceKey } : {}),
    };
    (this.history as CanvasDocumentHistory).record(historyEntry);
    this.#enqueue(this.#planFromNodes(before, after));
  }

  #planFromNodes(
    before: ReadonlyMap<string, TSceneNode | null>,
    after: ReadonlyMap<string, TSceneNode | null>,
  ): TCommandPlan {
    const operations: TCanvasOperation[] = [];
    const preconditions: TCanvasPrecondition[] = [];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const previous = before.get(id) ?? null;
      const next = after.get(id) ?? null;
      if (previous === null && next !== null) {
        operations.push({ type: 'insert', item: next });
        preconditions.push({ type: 'item-absent', itemId: id });
        continue;
      }
      if (previous !== null && next === null) {
        operations.push({ type: 'delete', itemId: id });
        continue;
      }
      if (previous === null || next === null) continue;
      if (previous.id !== id || next.id !== id) {
        throw new TypeError(`Canvas journal entry '${id}' contains a mismatched node ID.`);
      }
      const structure = fnDiffSceneNodeStructure(previous, next);
      if (structure.parentChanged) {
        operations.push({
          type: 'reparent',
          itemId: id,
          parentId: next.parentId,
          ...(structure.orderChanged ? { orderKey: next.orderKey } : {}),
        });
      } else if (structure.orderChanged) {
        operations.push({
          type: 'reorder',
          itemId: id,
          orderKey: next.orderKey,
        });
      }
      const diff = fnDiffSceneNodes(previous, next);
      if (diff.patches.length === 0) continue;
      operations.push({ type: 'patch', itemId: id, patches: diff.patches });
      preconditions.push(...diff.preconditions);
    }
    return { operations, preconditions };
  }

  #performHistory(entry: THistoryEntry, direction: 'undo' | 'redo'): void {
    const baseline = direction === 'undo' ? entry.after : entry.before;
    const desired = direction === 'undo' ? entry.before : entry.after;
    const plan = this.#planFromNodes(baseline, desired);
    const sceneCommands: TSerializedSceneCommand[] = [];
    for (const operation of plan.operations) {
      if (operation.type === 'insert') {
        sceneCommands.push({ type: 'upsert', node: fnRuntimeCanvasNode(operation.item) });
        continue;
      }
      if (operation.type === 'delete') {
        sceneCommands.push({ type: 'remove', nodeId: operation.itemId });
        continue;
      }
      if (operation.type === 'patch') {
        const current = this.#engine?.scene.get(operation.itemId);
        if (!current) continue;
        const authored = fnAuthoredCanvasNode(current as TSceneNode);
        sceneCommands.push({
          type: 'upsert',
          node: fnRuntimeCanvasNode(
            fnApplySceneNodePatches(authored, operation.patches),
          ),
        });
      }
    }
    this.#engine?.scene.apply(sceneCommands, {
      source: direction === 'undo' ? UNDO_SCENE_SOURCE : REDO_SCENE_SOURCE,
    });
    this.#enqueue(plan);
  }

  #enqueue(plan: TCommandPlan): void {
    if (plan.operations.length === 0) return;
    const operation = async () => {
      if (this.#disposed) return;
      const preconditions = [...plan.preconditions];
      const revisionGuarded = new Set(
        preconditions
          .filter((entry) => entry.type === 'item-revision')
          .map((entry) => entry.itemId),
      );
      for (const entry of plan.operations) {
        if (
          entry.type !== 'delete'
          && entry.type !== 'replace'
          && entry.type !== 'reparent'
          && entry.type !== 'reorder'
        ) continue;
        const itemId = entry.type === 'replace' ? entry.item.id : entry.itemId;
        if (revisionGuarded.has(itemId)) continue;
        const item = this.#items.get(itemId);
        if (!item) {
          throw new Error(
            `Canvas item '${itemId}' is missing an authoritative revision guard.`,
          );
        }
        preconditions.push({
          type: 'item-revision',
          itemId,
          itemRevision: item.itemRevision,
        });
        revisionGuarded.add(itemId);
      }
      const command: TCanvasCommand = {
        commandId: this.#createCommandId(),
        canvasId: this.#canvasId,
        baseRevision: this.#revision,
        operations: plan.operations,
        preconditions,
      };
      try {
        const event = await this.#transport.execute(command);
        this.#applyEvent(event);
      } catch (error) {
        this.#onError(error);
        await this.#reload(true).catch(this.#onError);
      }
    };
    this.#commandTail = this.#commandTail.then(operation, operation);
  }

  async #reload(clearHistory: boolean): Promise<void> {
    const snapshot = await this.#transport.getSnapshot({ canvasId: this.#canvasId });
    if (this.#disposed) return;
    this.#revision = snapshot.revision;
    this.#items.clear();
    for (const item of snapshot.items) this.#items.set(item.id, item);
    if (clearHistory) this.history.clear();
    if (this.#engine) {
      const runtimeSnapshot = fnMaterializeCanvasValidationSnapshot(
        snapshot.items.map((item) => item.item),
      );
      this.#engine.scene.replace(
        {
          ...runtimeSnapshot,
          nodes: runtimeSnapshot.nodes.map((node) => (
            node.id === 'vibecanvas:runtime:content'
              ? node
              : fnRuntimeCanvasNode(node)
          )),
        },
        { source: SNAPSHOT_SCENE_SOURCE },
      );
    }
  }

  #applyEvent(event: TCanvasItemsChangedEvent): void {
    if (event.revision <= this.#revision) return;
    if (event.revision !== this.#revision + 1) {
      void this.#reload(true).catch(this.#onError);
      return;
    }
    const commands: TSerializedSceneCommand[] = [];
    for (const item of event.changedItems) {
      this.#items.set(item.id, item);
      commands.push({ type: 'upsert', node: fnRuntimeCanvasNode(item.item) });
    }
    for (const itemId of event.deletedItemIds) {
      this.#items.delete(itemId);
      commands.push({ type: 'remove', nodeId: itemId });
    }
    this.#revision = event.revision;
    this.#engine?.scene.apply(commands, { source: SERVER_SCENE_SOURCE });
  }

  async #consumeEvents(generation: number): Promise<void> {
    while (!this.#disposed && generation === this.#generation) {
      try {
        const iterable = this.#transport.subscribe({
          canvasId: this.#canvasId,
          afterRevision: this.#revision,
        });
        const iterator = iterable[Symbol.asyncIterator]();
        this.#eventIterator = iterator;
        while (!this.#disposed && generation === this.#generation) {
          const next = await iterator.next();
          if (next.done) break;
          if (next.value.type === 'resync-required') {
            await this.#reload(true);
          } else {
            this.#applyEvent(next.value);
          }
        }
      } catch (error) {
        if (!this.#disposed && generation === this.#generation) this.#onError(error);
      } finally {
        this.#eventIterator = null;
      }
      if (!this.#disposed && generation === this.#generation) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
  }
}
