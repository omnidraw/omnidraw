import {
  CANVAS_COMMAND_MAX_OPERATIONS,
  CANVAS_QUERY_MAX_LIMIT,
  fnReadCanvasImageExtension,
  fnReadCanvasWidgetExtension,
  fnValidateCanvasItems,
} from '@omnidraw/canvas-contract';
import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemId,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemQueryCursor,
  TCanvasItemSnapshot,
  TCanvasItemsChangedEvent,
  TCanvasPrecondition,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import type {
  ICanvasService,
  ICanvasStore,
  TCanvasServiceDependencies,
  TCanvasServiceMetrics,
  TCanvasServiceOptions,
  TCanvasStoreMutation,
  TCanvasSubscribeArgs,
} from './ICanvasService';
import {
  fnApplyCanvasItemPatches,
  fnCloneCanvasItem,
  fnCollectCommandItemIds,
  fnJsonEqual,
  fnReadJsonPath,
  fnValidateCommand,
  fnValidateJsonBounds,
} from './fn.command';
import type { TCommandLimits } from './fn.command';

type TSceneNode = TCanvasItemSnapshot['item'];

export type TCanvasServiceErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_COMMAND'
  | 'LIMIT_EXCEEDED'
  | 'CONFLICT'
  | 'STORE_CONFLICT'
  | 'POST_COMMIT_FAILURE';

export class CanvasServiceError extends Error {
  readonly code: TCanvasServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TCanvasServiceErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CanvasServiceError';
    this.code = code;
    this.details = details;
  }
}

type TResolvedOptions = Required<TCanvasServiceOptions>;

type TSubscriber = {
  closed: boolean;
  pending: ((result: IteratorResult<TCanvasEvent>) => void) | null;
  queue: TCanvasEvent[];
};

type TCanvasState = {
  readonly key: string;
  readonly canvasId: string;
  readonly items: Map<TCanvasItemId, TCanvasItemSnapshot | null>;
  readonly events: TCanvasItemsChangedEvent[];
  readonly subscribers: Set<TSubscriber>;
  tail: Promise<void>;
  revision: number | null;
  pendingCommands: number;
  releasing: boolean;
  released: boolean;
};

type TAttemptContext = {
  readonly command: TCanvasCommand;
  readonly state: TCanvasState;
  readonly canvasRevision: number;
  readonly original: Map<TCanvasItemId, TCanvasItemSnapshot | null>;
  readonly finalItems: Map<TCanvasItemId, TSceneNode | null>;
  readonly changedIds: Set<TCanvasItemId>;
  readonly authorityIds: Set<TCanvasItemId>;
};

const DEFAULT_OPTIONS: TResolvedOptions = Object.freeze({
  maxOperations: CANVAS_COMMAND_MAX_OPERATIONS,
  maxPreconditions: 2_000,
  maxPatchesPerOperation: 256,
  maxTouchedItems: 2_048,
  maxCommandBytes: 1_048_576,
  maxItemBytes: 1_048_576,
  maxJsonDepth: 128,
  maxJsonEntries: 200_000,
  maxPathDepth: 64,
  maxHierarchyDepth: 128,
  maxReplayEvents: 256,
  maxCommitAttempts: 8,
  queryPageSize: 500,
});

function positiveInteger(
  name: keyof TCanvasServiceOptions,
  value: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function resolveOptions(options: TCanvasServiceOptions = {}): TResolvedOptions {
  const resolved = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  for (const [name, value] of Object.entries(resolved)) {
    positiveInteger(name as keyof TCanvasServiceOptions, value);
  }
  resolved.maxOperations = Math.min(
    resolved.maxOperations,
    CANVAS_COMMAND_MAX_OPERATIONS,
  );
  resolved.queryPageSize = Math.min(
    resolved.queryPageSize,
    CANVAS_QUERY_MAX_LIMIT,
  );
  return resolved;
}

function isStoreNotFound(error: unknown): boolean {
  return (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as Readonly<{ code?: unknown }>).code === 'CANVAS_NOT_FOUND'
  );
}

function operationTargetId(
  operation: TCanvasCommand['operations'][number],
): TCanvasItemId {
  return operation.type === 'insert' || operation.type === 'replace'
    ? operation.item.id
    : operation.itemId;
}

function clipNodeId(item: TSceneNode): TCanvasItemId | null {
  const clip = item.clip;
  return clip?.type === 'node' ? clip.nodeId : null;
}

export class CanvasService implements ICanvasService {
  readonly name = 'canvas';

  readonly #store: ICanvasStore;
  readonly #options: TResolvedOptions;
  readonly #states = new Map<string, TCanvasState>();

  constructor(dependencies: TCanvasServiceDependencies) {
    this.#store = dependencies.store;
    this.#options = resolveOptions(dependencies.options);
  }

  async stop(): Promise<void> {
    const states = [...this.#states.values()];
    for (const state of states) state.releasing = true;
    await Promise.all(states.map((state) => this.#enqueue(state, async () => {
      for (const subscriber of state.subscribers) {
        this.#closeSubscriber(state, subscriber);
      }
      state.items.clear();
      state.events.length = 0;
      state.revision = null;
      state.released = true;
      if (this.#states.get(state.key) === state) {
        this.#states.delete(state.key);
      }
    })));
  }

  async getSnapshot(
    args: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot> {
    const state = this.#state(args.canvasId);
    return this.#enqueue(state, async () => {
      this.#assertUsable(state);
      let snapshot: TCanvasSnapshot | null;
      try {
        snapshot = await this.#store.getSnapshot(args);
      } catch (error) {
        if (isStoreNotFound(error)) throw this.#notFound(args.canvasId, error);
        throw error;
      }
      if (snapshot === null) throw this.#notFound(args.canvasId);
      if (snapshot.canvasId !== args.canvasId) {
        throw new CanvasServiceError(
          'STORE_CONFLICT',
          'The canvas store returned a snapshot for a different canvas.',
        );
      }
      this.#synchronizeRevision(state, snapshot.revision);
      return snapshot;
    });
  }

  async queryItems(query: TCanvasItemQuery): Promise<TCanvasItemPage> {
    if (
      query.limit !== undefined
      && (
        !Number.isSafeInteger(query.limit)
        || query.limit < 1
        || query.limit > CANVAS_QUERY_MAX_LIMIT
      )
    ) {
      throw new CanvasServiceError(
        'LIMIT_EXCEEDED',
        `Canvas item queries must request between 1 and ${CANVAS_QUERY_MAX_LIMIT} items.`,
      );
    }
    for (let attempt = 0; attempt < this.#options.maxCommitAttempts; attempt += 1) {
      const revisionBefore = await this.#revision(query.canvasId);
      const page = await this.#store.queryItems(query);
      const revisionAfter = await this.#revision(query.canvasId);
      if (revisionBefore === revisionAfter) return page;
    }
    throw new CanvasServiceError(
      'STORE_CONFLICT',
      'The canvas changed repeatedly while reading the requested page.',
      { canvasId: query.canvasId },
    );
  }

  async execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent> {
    const commandLimits: TCommandLimits = this.#options;
    const issues = fnValidateCommand(command, commandLimits);
    if (issues.length > 0) {
      const limitIssue = issues.find((issue) => issue.code.endsWith('_LIMIT'));
      throw new CanvasServiceError(
        limitIssue === undefined ? 'INVALID_COMMAND' : 'LIMIT_EXCEEDED',
        issues.map((issue) => issue.message).join(' '),
        { issues },
      );
    }
    const state = this.#state(command.canvasId);
    return this.#enqueue(
      state,
      () => this.#executeSerialized(command, state),
      true,
    );
  }

  subscribe(args: TCanvasSubscribeArgs): AsyncIterable<TCanvasEvent> {
    if (!Number.isSafeInteger(args.afterRevision) || args.afterRevision < 0) {
      throw new CanvasServiceError(
        'INVALID_COMMAND',
        'afterRevision must be a non-negative safe integer.',
      );
    }
    return {
      [Symbol.asyncIterator]: () => this.#createSubscriberIterator(args),
    };
  }

  async release(args: Readonly<{ canvasId: string }>): Promise<void> {
    const key = this.#stateKey(args.canvasId);
    const state = this.#states.get(key);
    if (state === undefined) return;
    state.releasing = true;
    await this.#enqueue(state, async () => {
      for (const subscriber of state.subscribers) {
        this.#closeSubscriber(state, subscriber);
      }
      state.items.clear();
      state.events.length = 0;
      state.revision = null;
      state.released = true;
      if (this.#states.get(key) === state) this.#states.delete(key);
    });
  }

  getMetrics(): TCanvasServiceMetrics {
    let activeCanvases = 0;
    let cachedItems = 0;
    let replayEvents = 0;
    let subscribers = 0;
    let pendingCommands = 0;
    for (const state of this.#states.values()) {
      activeCanvases += 1;
      cachedItems += state.items.size;
      replayEvents += state.events.length;
      subscribers += state.subscribers.size;
      pendingCommands += state.pendingCommands;
    }
    return {
      activeCanvases,
      cachedItems,
      replayEvents,
      subscribers,
      pendingCommands,
    };
  }

  async #executeSerialized(
    command: TCanvasCommand,
    state: TCanvasState,
  ): Promise<TCanvasItemsChangedEvent> {
    this.#assertUsable(state);

    for (let attempt = 0; attempt < this.#options.maxCommitAttempts; attempt += 1) {
      const revisionBefore = await this.#revision(command.canvasId);
      this.#synchronizeRevision(state, revisionBefore);
      if (command.baseRevision > revisionBefore) {
        throw new CanvasServiceError(
          'CONFLICT',
          'The command base revision is ahead of the authoritative canvas.',
          {
            baseRevision: command.baseRevision,
            currentRevision: revisionBefore,
          },
        );
      }

      const authorityIds = new Set(fnCollectCommandItemIds(command));
      await this.#assertAuthorityBudget(authorityIds);
      await this.#loadIds(command.canvasId, state, authorityIds);
      const revisionAfterInitialRead = await this.#revision(
        command.canvasId,
      );
      if (revisionAfterInitialRead !== revisionBefore) {
        this.#synchronizeRevision(state, revisionAfterInitialRead);
        continue;
      }

      const original = new Map<TCanvasItemId, TCanvasItemSnapshot | null>();
      for (const id of authorityIds) original.set(id, state.items.get(id) ?? null);
      this.#assertPreconditions(command.preconditions, original);
      const attemptContext = this.#applyOperations({
        command,
        state,
        canvasRevision: revisionBefore,
        original,
        finalItems: new Map(),
        changedIds: new Set(),
        authorityIds,
      });
      await this.#validateAttempt(attemptContext);

      const revisionAfterValidation = await this.#revision(
        command.canvasId,
      );
      if (revisionAfterValidation !== revisionBefore) {
        this.#synchronizeRevision(state, revisionAfterValidation);
        continue;
      }

      const mutations = this.#buildMutations(attemptContext);
      if (mutations.length === 0) {
        throw new CanvasServiceError(
          'INVALID_COMMAND',
          'The command does not change any canvas item.',
          { commandId: command.commandId },
        );
      }

      let result;
      try {
        result = await this.#store.applyMutations({
          canvasId: command.canvasId,
          expectedCanvasRevision: revisionBefore,
          mutations,
        });
      } catch (error) {
        let currentRevision: number | null = null;
        try {
          currentRevision = await this.#store.getRevision({
            canvasId: command.canvasId,
          });
        } catch {
          // The failed commit already forces the caller to resync.
        }
        this.#forceResync(state, currentRevision);
        if (isStoreNotFound(error)) throw this.#notFound(command.canvasId, error);
        throw new CanvasServiceError(
          'STORE_CONFLICT',
          'The canvas store did not confirm whether the command committed; resync before retrying.',
          { canvasId: command.canvasId, commandId: command.commandId },
          { cause: error },
        );
      }
      if (result.status === 'revision-conflict') {
        this.#synchronizeRevision(state, result.revision);
        if (result.revision === null) throw this.#notFound(command.canvasId);
        continue;
      }

      const event: TCanvasItemsChangedEvent = {
        type: 'items-changed',
        canvasId: command.canvasId,
        commandId: command.commandId,
        revision: result.revision,
        changedItems: result.changedItems,
        deletedItemIds: result.deletedItemIds,
      };
      try {
        this.#acceptCommittedResult(
          state,
          revisionBefore,
          mutations,
          event,
        );
      } catch (error) {
        this.#forceResync(state, event.revision);
        throw new CanvasServiceError(
          'POST_COMMIT_FAILURE',
          'The command committed, but its result could not be published safely; resync before retrying.',
          { canvasId: command.canvasId, commandId: command.commandId },
          { cause: error },
        );
      }
      return event;
    }

    throw new CanvasServiceError(
      'STORE_CONFLICT',
      'The canvas remained busy after the bounded commit retry budget.',
      { canvasId: command.canvasId, commandId: command.commandId },
    );
  }

  #applyOperations(context: TAttemptContext): TAttemptContext {
    const working = new Map<TCanvasItemId, TSceneNode | null>();
    for (const [id, snapshot] of context.original) {
      working.set(id, snapshot === null ? null : snapshot.item);
    }

    for (const operation of context.command.operations) {
      const itemId = operationTargetId(operation);
      const current = working.get(itemId) ?? null;
      if (operation.type === 'insert') {
        if (current !== null) this.#conflict(`Item '${itemId}' already exists.`);
        working.set(itemId, fnCloneCanvasItem(operation.item));
      } else if (operation.type === 'replace') {
        if (current === null) this.#conflict(`Item '${itemId}' no longer exists.`);
        working.set(itemId, fnCloneCanvasItem(operation.item));
      } else if (operation.type === 'patch') {
        if (current === null) this.#conflict(`Item '${itemId}' no longer exists.`);
        const patched = fnApplyCanvasItemPatches(current, operation.patches);
        if (!patched.ok) {
          throw new CanvasServiceError(
            'INVALID_COMMAND',
            `Patch '${itemId}' is invalid: ${patched.message}`,
          );
        }
        working.set(itemId, patched.item);
      } else if (operation.type === 'delete') {
        if (current === null) this.#conflict(`Item '${itemId}' no longer exists.`);
        working.set(itemId, null);
      } else if (operation.type === 'reparent') {
        if (current === null) this.#conflict(`Item '${itemId}' no longer exists.`);
        working.set(itemId, {
          ...fnCloneCanvasItem(current),
          parentId: operation.parentId,
          ...(operation.orderKey === undefined
            ? {}
            : { orderKey: operation.orderKey }),
        } as TSceneNode);
      } else {
        if (current === null) this.#conflict(`Item '${itemId}' no longer exists.`);
        working.set(itemId, {
          ...fnCloneCanvasItem(current),
          orderKey: operation.orderKey,
        } as TSceneNode);
      }
      context.changedIds.add(itemId);
    }

    for (const id of context.changedIds) {
      context.finalItems.set(id, working.get(id) ?? null);
    }
    return context;
  }

  #assertPreconditions(
    preconditions: readonly TCanvasPrecondition[],
    original: ReadonlyMap<TCanvasItemId, TCanvasItemSnapshot | null>,
  ): void {
    for (const precondition of preconditions) {
      const snapshot = original.get(precondition.itemId) ?? null;
      if (precondition.type === 'item-absent') {
        if (snapshot !== null) {
          this.#conflict(`Item '${precondition.itemId}' is no longer absent.`);
        }
        continue;
      }
      if (snapshot === null) {
        this.#conflict(`Item '${precondition.itemId}' no longer exists.`);
      }
      if (precondition.type === 'item-revision') {
        if (snapshot.itemRevision !== precondition.itemRevision) {
          this.#conflict(
            `Item '${precondition.itemId}' changed from revision ${precondition.itemRevision} to ${snapshot.itemRevision}.`,
          );
        }
        continue;
      }
      const current = fnReadJsonPath(snapshot.item, precondition.path);
      if (precondition.type === 'path-absent') {
        if (current.exists) {
          this.#conflict(`A guarded path on '${precondition.itemId}' now exists.`);
        }
      } else if (!current.exists || !fnJsonEqual(current.value, precondition.value)) {
        this.#conflict(`A guarded path on '${precondition.itemId}' changed.`);
      }
    }
  }

  async #validateAttempt(context: TAttemptContext): Promise<void> {
    const validationSeeds = new Map<TCanvasItemId, TSceneNode>();

    for (const id of context.changedIds) {
      const finalItem = context.finalItems.get(id) ?? null;
      if (finalItem !== null) {
        if (finalItem.id !== id) {
          throw new CanvasServiceError(
            'INVALID_COMMAND',
            `Item map identity '${id}' does not match node ID '${finalItem.id}'.`,
          );
        }
        const boundsIssues = fnValidateJsonBounds(finalItem, {
          maxBytes: this.#options.maxItemBytes,
          maxDepth: this.#options.maxJsonDepth,
          maxEntries: this.#options.maxJsonEntries,
        });
        if (boundsIssues.length > 0) {
          const isLimit = boundsIssues.some((issue) => issue.code.endsWith('_LIMIT'));
          throw new CanvasServiceError(
            isLimit ? 'LIMIT_EXCEEDED' : 'INVALID_COMMAND',
            `Canvas item '${id}' exceeds the authored item bounds.`,
            { issues: boundsIssues },
          );
        }
        validationSeeds.set(id, finalItem);
      }
      const original = context.original.get(id) ?? null;
      if (finalItem === null) {
        const children = await this.#childrenOf(context, id);
        for (const child of children) {
          const finalChild = this.#finalItem(context, child.id, child.item);
          if (finalChild !== null && finalChild.parentId === id) {
            this.#conflict(
              `Item '${id}' cannot be deleted while child '${child.id}' remains attached.`,
            );
          }
        }
      } else if (original !== null && original.item.kind !== finalItem.kind) {
        const children = await this.#childrenOf(context, id);
        for (const child of children) {
          const finalChild = this.#finalItem(context, child.id, child.item);
          if (finalChild !== null) validationSeeds.set(child.id, finalChild);
        }
      }
    }

    await this.#expandValidationClosure(context, validationSeeds);
    const validation = fnValidateCanvasItems([...validationSeeds.values()]);
    if (!validation.valid) {
      throw new CanvasServiceError(
        'INVALID_COMMAND',
        'The command would produce an invalid Cangine canvas.',
        { issues: validation.issues },
      );
    }
    await this.#validateWidgetIdentities(context);
    await this.#validateImageResourceClaims(context);
  }

  async #validateImageResourceClaims(
    context: TAttemptContext,
  ): Promise<void> {
    const resourceIds = new Set<string>();
    for (const id of context.changedIds) {
      const original = context.original.get(id)?.item;
      const finalItem = context.finalItems.get(id) ?? null;
      if (original?.kind === 'image') resourceIds.add(original.resourceId);
      if (finalItem?.kind === 'image') resourceIds.add(finalItem.resourceId);
    }
    if (resourceIds.size === 0) return;

    const claimLimit = this.#options.maxTouchedItems + 1;
    const storedClaims = await this.#store.queryImageResourceClaims(
      {
        canvasId: context.command.canvasId,
        resourceIds: [...resourceIds],
        excludeItemIds: [...context.changedIds],
        limit: claimLimit,
      },
    );
    if (storedClaims.length >= claimLimit) {
      throw new CanvasServiceError(
        'LIMIT_EXCEEDED',
        'Durable image resource validation exceeded its bounded claim budget.',
      );
    }

    const claims = new Map<string, Readonly<{ url: string; mimeType: string }>>();
    const addClaim = (
      resourceId: string,
      descriptor: Readonly<{ url: string; mimeType: string }>,
    ): void => {
      if (!resourceIds.has(resourceId)) {
        throw new CanvasServiceError(
          'STORE_CONFLICT',
          'The canvas store returned an unexpected image resource claim.',
        );
      }
      const existing = claims.get(resourceId);
      if (
        existing !== undefined
        && (
          existing.url !== descriptor.url
          || existing.mimeType !== descriptor.mimeType
        )
      ) {
        throw new CanvasServiceError(
          'INVALID_COMMAND',
          `Image resource '${resourceId}' has conflicting durable descriptors.`,
        );
      }
      claims.set(resourceId, descriptor);
    };
    for (const claim of storedClaims) {
      if (
        typeof claim.resourceId !== 'string'
        || claim.resourceId.length === 0
        || typeof claim.url !== 'string'
        || claim.url.trim().length === 0
        || typeof claim.mimeType !== 'string'
        || claim.mimeType.length === 0
      ) {
        throw new CanvasServiceError(
          'STORE_CONFLICT',
          'The canvas store returned an invalid image resource claim.',
        );
      }
      addClaim(claim.resourceId, claim);
    }
    for (const id of context.changedIds) {
      const finalItem = context.finalItems.get(id) ?? null;
      if (finalItem?.kind !== 'image') continue;
      const descriptor = fnReadCanvasImageExtension(finalItem);
      if (descriptor === null) continue;
      addClaim(finalItem.resourceId, descriptor);
    }
  }

  async #expandValidationClosure(
    context: TAttemptContext,
    closure: Map<TCanvasItemId, TSceneNode>,
  ): Promise<void> {
    for (let depth = 0; depth <= this.#options.maxHierarchyDepth; depth += 1) {
      const required = new Set<TCanvasItemId>();
      for (const item of closure.values()) {
        if (item.parentId !== null && !closure.has(item.parentId)) {
          required.add(item.parentId);
        }
        const clipId = clipNodeId(item);
        if (clipId !== null && !closure.has(clipId)) required.add(clipId);
      }
      if (required.size === 0) break;
      for (const id of required) context.authorityIds.add(id);
      await this.#assertAuthorityBudget(context.authorityIds);
      await this.#loadIds(
        context.command.canvasId,
        context.state,
        required,
      );
      let added = 0;
      for (const id of required) {
        const item = this.#finalItem(
          context,
          id,
          context.state.items.get(id)?.item ?? null,
        );
        if (item === null) {
          throw new CanvasServiceError(
            'INVALID_COMMAND',
            `Canvas item '${id}' is referenced but does not exist.`,
          );
        }
        closure.set(id, item);
        added += 1;
      }
      if (added === 0) break;
      if (depth === this.#options.maxHierarchyDepth) {
        throw new CanvasServiceError(
          'LIMIT_EXCEEDED',
          `The command exceeds hierarchy depth ${this.#options.maxHierarchyDepth}.`,
        );
      }
    }

    for (const start of closure.values()) {
      const seen = new Set<TCanvasItemId>([start.id]);
      let current = start;
      let depth = 0;
      while (current.parentId !== null) {
        depth += 1;
        if (depth > this.#options.maxHierarchyDepth) {
          throw new CanvasServiceError(
            'LIMIT_EXCEEDED',
            `The command exceeds hierarchy depth ${this.#options.maxHierarchyDepth}.`,
          );
        }
        if (seen.has(current.parentId)) {
          throw new CanvasServiceError(
            'INVALID_COMMAND',
            `The command creates a hierarchy cycle through '${current.parentId}'.`,
          );
        }
        seen.add(current.parentId);
        const parent = closure.get(current.parentId);
        if (parent === undefined) {
          throw new CanvasServiceError(
            'INVALID_COMMAND',
            `Parent '${current.parentId}' does not exist.`,
          );
        }
        current = parent;
      }
    }
  }

  async #validateWidgetIdentities(context: TAttemptContext): Promise<void> {
    const identities = new Map<string, TCanvasItemId>();
    for (const id of context.changedIds) {
      const item = context.finalItems.get(id);
      if (item === undefined || item === null) continue;
      const extension = fnReadCanvasWidgetExtension(item);
      const original = context.original.get(id);
      const originalExtension = original === undefined || original === null
        ? null
        : fnReadCanvasWidgetExtension(original.item);
      if (
        originalExtension?.type === 'widget-instance'
        && (
          extension?.type !== 'widget-instance'
          || extension.instanceId !== originalExtension.instanceId
          || extension.widgetKey !== originalExtension.widgetKey
        )
      ) {
        this.#conflict(
          `Widget identity on '${id}' is stable for the lifetime of the canvas item; delete and insert a new item to replace it.`,
        );
      }
      if (extension?.type !== 'widget-instance') continue;
      const existing = identities.get(extension.instanceId);
      if (existing !== undefined && existing !== id) {
        this.#conflict(
          `Widget instance '${extension.instanceId}' is assigned to both '${existing}' and '${id}'.`,
        );
      }
      identities.set(extension.instanceId, id);
    }

    for (const [instanceId, placedItemId] of identities) {
      const matches = await this.#queryAll(
        {
          canvasId: context.command.canvasId,
          filter: { type: 'widget-instance', instanceId },
        },
        this.#options.maxTouchedItems + 1,
      );
      for (const match of matches) {
        context.authorityIds.add(match.id);
        await this.#assertAuthorityBudget(context.authorityIds);
        context.state.items.set(match.id, match);
        this.#pruneCache(context.state, context.authorityIds);
        const finalMatch = this.#finalItem(context, match.id, match.item);
        if (finalMatch === null) continue;
        const extension = fnReadCanvasWidgetExtension(finalMatch);
        if (
          extension?.type === 'widget-instance'
          && extension.instanceId === instanceId
          && match.id !== placedItemId
        ) {
          this.#conflict(
            `Widget instance '${instanceId}' already belongs to '${match.id}'.`,
          );
        }
      }
    }
  }

  #buildMutations(context: TAttemptContext): readonly TCanvasStoreMutation[] {
    const mutations: TCanvasStoreMutation[] = [];
    for (const id of context.changedIds) {
      const original = context.original.get(id) ?? null;
      const finalItem = context.finalItems.get(id) ?? null;
      if (original === null && finalItem === null) continue;
      if (original === null) {
        mutations.push({ type: 'insert', item: finalItem! });
      } else if (finalItem === null) {
        mutations.push({
          type: 'delete',
          itemId: id,
          expectedItemRevision: original.itemRevision,
        });
      } else if (!fnJsonEqual(original.item, finalItem)) {
        mutations.push({
          type: 'replace',
          item: finalItem,
          expectedItemRevision: original.itemRevision,
        });
      }
    }
    return mutations;
  }

  #acceptCommittedResult(
    state: TCanvasState,
    previousRevision: number,
    mutations: readonly TCanvasStoreMutation[],
    event: TCanvasItemsChangedEvent,
  ): void {
    if (
      !Number.isSafeInteger(event.revision)
      || event.revision !== previousRevision + 1
    ) {
      throw new TypeError('The store returned a non-contiguous canvas revision.');
    }
    const expectedChanged = new Set(
      mutations
        .filter((mutation) => mutation.type !== 'delete')
        .map((mutation) => mutation.item.id),
    );
    const expectedDeleted = new Set(
      mutations
        .filter((mutation) => mutation.type === 'delete')
        .map((mutation) => mutation.itemId),
    );
    if (
      event.changedItems.length !== expectedChanged.size
      || event.deletedItemIds.length !== expectedDeleted.size
    ) {
      throw new TypeError('The store returned an incomplete mutation result.');
    }
    for (const snapshot of event.changedItems) {
      if (
        snapshot.id !== snapshot.item.id
        || !expectedChanged.delete(snapshot.id)
      ) {
        throw new TypeError('The store returned an unexpected changed item.');
      }
    }
    for (const id of event.deletedItemIds) {
      if (!expectedDeleted.delete(id)) {
        throw new TypeError('The store returned an unexpected deleted item.');
      }
    }
    if (expectedChanged.size > 0 || expectedDeleted.size > 0) {
      throw new TypeError('The store omitted a committed canvas mutation.');
    }

    state.revision = event.revision;
    for (const snapshot of event.changedItems) {
      state.items.set(snapshot.id, snapshot);
    }
    for (const id of event.deletedItemIds) state.items.set(id, null);
    this.#pruneCache(state, new Set([
      ...event.changedItems.map((snapshot) => snapshot.id),
      ...event.deletedItemIds,
    ]));
    state.events.push(event);
    if (state.events.length > this.#options.maxReplayEvents) {
      state.events.splice(0, state.events.length - this.#options.maxReplayEvents);
    }
    for (const subscriber of state.subscribers) {
      this.#pushSubscriber(subscriber, event);
    }
  }

  async #childrenOf(
    context: TAttemptContext,
    parentId: TCanvasItemId,
  ): Promise<readonly TCanvasItemSnapshot[]> {
    const children = await this.#queryAll(
      {
        canvasId: context.command.canvasId,
        filter: { type: 'parent', parentId },
      },
      this.#options.maxTouchedItems + 1,
    );
    for (const child of children) {
      context.authorityIds.add(child.id);
      context.state.items.set(child.id, child);
    }
    await this.#assertAuthorityBudget(context.authorityIds);
    this.#pruneCache(context.state, context.authorityIds);
    return children;
  }

  #finalItem(
    context: TAttemptContext,
    id: TCanvasItemId,
    fallback: TSceneNode | null,
  ): TSceneNode | null {
    return context.finalItems.has(id)
      ? context.finalItems.get(id) ?? null
      : fallback;
  }

  async #loadIds(
    canvasId: string,
    state: TCanvasState,
    ids: ReadonlySet<TCanvasItemId>,
  ): Promise<void> {
    const missing = [...ids].filter((id) => !state.items.has(id));
    for (
      let offset = 0;
      offset < missing.length;
      offset += this.#options.queryPageSize
    ) {
      const batch = missing.slice(offset, offset + this.#options.queryPageSize);
      const snapshots = await this.#queryAll(
        {
          canvasId,
          filter: { type: 'ids', ids: batch },
        },
        batch.length,
      );
      const requested = new Set(batch);
      for (const snapshot of snapshots) {
        if (
          snapshot.id !== snapshot.item.id
          || !requested.has(snapshot.id)
          || state.items.has(snapshot.id)
        ) {
          throw new CanvasServiceError(
            'STORE_CONFLICT',
            'The canvas store returned an invalid item identity result.',
          );
        }
        state.items.set(snapshot.id, snapshot);
      }
      for (const id of batch) {
        if (!state.items.has(id)) state.items.set(id, null);
      }
      this.#pruneCache(state, ids);
    }
  }

  async #queryAll(
    query: Omit<TCanvasItemQuery, 'limit' | 'cursor'>,
    maxResults: number,
  ): Promise<readonly TCanvasItemSnapshot[]> {
    const items: TCanvasItemSnapshot[] = [];
    let cursor: TCanvasItemQueryCursor | undefined;
    const seenCursors = new Set<string>();
    while (true) {
      const page = await this.#store.queryItems({
        ...query,
        limit: Math.min(this.#options.queryPageSize, maxResults),
        ...(cursor === undefined ? {} : { cursor }),
      });
      items.push(...page.items);
      if (items.length > maxResults) {
        throw new CanvasServiceError(
          'LIMIT_EXCEEDED',
          `A bounded canvas authority read exceeded ${maxResults} items.`,
        );
      }
      if (page.nextCursor === null) return items;
      const key = JSON.stringify(page.nextCursor);
      if (seenCursors.has(key)) {
        throw new CanvasServiceError(
          'STORE_CONFLICT',
          'The canvas store returned a repeated pagination cursor.',
        );
      }
      seenCursors.add(key);
      cursor = page.nextCursor;
    }
  }

  async #revision(canvasId: string): Promise<number> {
    let revision: number | null;
    try {
      revision = await this.#store.getRevision({ canvasId });
    } catch (error) {
      if (isStoreNotFound(error)) throw this.#notFound(canvasId, error);
      throw error;
    }
    if (revision === null) throw this.#notFound(canvasId);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new CanvasServiceError(
        'STORE_CONFLICT',
        'The canvas store returned an invalid revision.',
        { canvasId, revision },
      );
    }
    return revision;
  }

  #createSubscriberIterator(
    args: TCanvasSubscribeArgs,
  ): AsyncIterator<TCanvasEvent> {
    let state: TCanvasState | null = null;
    let subscriber: TSubscriber | null = null;
    let initialization: Promise<void> | null = null;

    const initialize = (): Promise<void> => {
      if (initialization !== null) return initialization;
      initialization = (async () => {
        state = this.#state(args.canvasId);
        await this.#enqueue(state, async () => {
          this.#assertUsable(state!);
          const revision = await this.#revision(args.canvasId);
          this.#synchronizeRevision(state!, revision);
          const replay = this.#replayAfter(state!, args.afterRevision);
          subscriber = {
            closed: false,
            pending: null,
            queue: replay,
          };
          state!.subscribers.add(subscriber);
        });
      })();
      return initialization;
    };

    return {
      next: async () => {
        await initialize();
        if (subscriber === null) return { done: true, value: undefined };
        const queued = subscriber.queue.shift();
        if (queued !== undefined) return { done: false, value: queued };
        if (subscriber.closed) return { done: true, value: undefined };
        return new Promise<IteratorResult<TCanvasEvent>>((resolve, reject) => {
          if (subscriber!.pending !== null) {
            reject(new TypeError('Concurrent subscription reads are not supported.'));
            return;
          }
          subscriber!.pending = resolve;
        });
      },
      return: async () => {
        try {
          await initialize();
        } finally {
          if (state !== null && subscriber !== null) {
            this.#closeSubscriber(state, subscriber);
          }
        }
        return { done: true, value: undefined };
      },
    };
  }

  #replayAfter(
    state: TCanvasState,
    afterRevision: number,
  ): TCanvasEvent[] {
    const currentRevision = state.revision ?? 0;
    if (afterRevision === currentRevision) return [];
    const events = state.events.filter((event) => event.revision > afterRevision);
    const expectedCount = currentRevision - afterRevision;
    const contiguous = expectedCount > 0
      && events.length === expectedCount
      && events.every((event, index) => (
        event.revision === afterRevision + index + 1
      ));
    if (contiguous) return [...events];
    return [{
      type: 'resync-required',
      canvasId: state.canvasId,
      revision: currentRevision,
    }];
  }

  #pushSubscriber(subscriber: TSubscriber, event: TCanvasEvent): void {
    if (subscriber.closed) return;
    if (subscriber.pending !== null) {
      const pending = subscriber.pending;
      subscriber.pending = null;
      pending({ done: false, value: event });
      return;
    }
    if (subscriber.queue.length >= this.#options.maxReplayEvents) {
      subscriber.queue = [{
        type: 'resync-required',
        canvasId: event.canvasId,
        revision: event.revision,
      }];
      return;
    }
    subscriber.queue.push(event);
  }

  #closeSubscriber(state: TCanvasState, subscriber: TSubscriber): void {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.queue.length = 0;
    if (subscriber.pending !== null) {
      subscriber.pending({ done: true, value: undefined });
      subscriber.pending = null;
    }
    state.subscribers.delete(subscriber);
  }

  #synchronizeRevision(
    state: TCanvasState,
    revision: number | null,
  ): void {
    if (revision === null) {
      this.#invalidateState(state);
      return;
    }
    if (state.revision === revision) return;
    const shouldNotify = state.revision !== null;
    state.items.clear();
    state.events.length = 0;
    state.revision = revision;
    if (shouldNotify) {
      const event: TCanvasEvent = {
        type: 'resync-required',
        canvasId: state.canvasId,
        revision,
      };
      for (const subscriber of state.subscribers) {
        this.#pushSubscriber(subscriber, event);
      }
    }
  }

  #invalidateState(state: TCanvasState): void {
    state.items.clear();
    state.events.length = 0;
    state.revision = null;
  }

  #forceResync(state: TCanvasState, revision: number | null): void {
    state.items.clear();
    state.events.length = 0;
    state.revision = revision;
    if (revision === null) {
      for (const subscriber of [...state.subscribers]) {
        this.#closeSubscriber(state, subscriber);
      }
      return;
    }
    const event: TCanvasEvent = {
      type: 'resync-required',
      canvasId: state.canvasId,
      revision,
    };
    for (const subscriber of state.subscribers) {
      this.#pushSubscriber(subscriber, event);
    }
  }

  #pruneCache(
    state: TCanvasState,
    protectedIds: ReadonlySet<TCanvasItemId>,
  ): void {
    if (state.items.size <= this.#options.maxTouchedItems) return;
    for (const id of state.items.keys()) {
      if (protectedIds.has(id)) continue;
      state.items.delete(id);
      if (state.items.size <= this.#options.maxTouchedItems) return;
    }
  }

  #state(canvasId: string): TCanvasState {
    const key = this.#stateKey(canvasId);
    const existing = this.#states.get(key);
    if (existing !== undefined) return existing;
    const created: TCanvasState = {
      key,
      canvasId,
      items: new Map(),
      events: [],
      subscribers: new Set(),
      tail: Promise.resolve(),
      revision: null,
      pendingCommands: 0,
      releasing: false,
      released: false,
    };
    this.#states.set(key, created);
    return created;
  }

  #stateKey(canvasId: string): string {
    return canvasId;
  }

  #enqueue<T>(
    state: TCanvasState,
    operation: () => Promise<T>,
    countCommand = false,
  ): Promise<T> {
    if (countCommand) state.pendingCommands += 1;
    const result = state.tail.then(operation);
    state.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      if (countCommand) state.pendingCommands -= 1;
    });
  }

  #assertUsable(state: TCanvasState): void {
    if (state.releasing || state.released) {
      throw new CanvasServiceError(
        'STORE_CONFLICT',
        'The canvas service state is being released; retry the operation.',
      );
    }
  }

  async #assertAuthorityBudget(ids: ReadonlySet<TCanvasItemId>): Promise<void> {
    if (ids.size > this.#options.maxTouchedItems) {
      throw new CanvasServiceError(
        'LIMIT_EXCEEDED',
        `Canvas authority validation exceeds ${this.#options.maxTouchedItems} rows.`,
      );
    }
  }

  #conflict(message: string): never {
    throw new CanvasServiceError('CONFLICT', message);
  }

  #notFound(canvasId: string, cause?: unknown): CanvasServiceError {
    return new CanvasServiceError(
      'NOT_FOUND',
      `Canvas '${canvasId}' was not found.`,
      { canvasId },
      cause === undefined ? undefined : { cause },
    );
  }
}
