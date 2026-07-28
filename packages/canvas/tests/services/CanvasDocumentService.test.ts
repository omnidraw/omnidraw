import type {
  TGroupNode,
  IInfiniteCanvasEngine,
  TImageNode,
  TRectNode,
  TSceneNode,
  TSceneSnapshot,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import type {
  TEditorSceneMutationRequest,
  TPreparedImageImportRequest,
} from '@omnidraw/cangine/editor';
import {
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  type TCanvasCommand,
  type TCanvasEvent,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import { describe, expect, test, vi } from 'vitest';
import {
  CanvasDocumentService,
  type TCanvasDocumentTransport,
} from '../../src/services/CanvasDocumentService';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(id = 'rect-a', x = 0): TRectNode {
  return {
    id,
    parentId: null,
    orderKey: 'A',
    kind: 'rect',
    transform: {
      ...transform,
      position: { x, y: 0 },
    },
    size: { width: 100, height: 60 },
  };
}

function group(id = 'group-a'): TGroupNode {
  return {
    id,
    parentId: null,
    orderKey: 'A',
    kind: 'group',
    transform,
    layout: { type: 'free' },
  };
}

function runtimeNode<T extends TSceneNode>(node: T): T {
  return {
    ...node,
    parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  };
}

function item(
  node: TSceneNode,
  itemRevision = 1,
): TCanvasItemSnapshot {
  return {
    id: node.id,
    item: node,
    itemRevision,
    createdAtMs: 1,
    updatedAtMs: itemRevision,
  };
}

function snapshot(
  items: readonly TCanvasItemSnapshot[],
  revision = 0,
): TCanvasSnapshot {
  return {
    canvasId: 'canvas-a',
    revision,
    items,
  };
}

function event(
  commandId: string,
  revision: number,
  changedItems: readonly TCanvasItemSnapshot[],
  deletedItemIds: readonly string[] = [],
): TCanvasItemsChangedEvent {
  return {
    type: 'items-changed',
    canvasId: 'canvas-a',
    commandId,
    revision,
    changedItems,
    deletedItemIds,
  };
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function eventQueue(): Readonly<{
  iterable: AsyncIterable<TCanvasEvent>;
  push(event: TCanvasEvent): void;
}> {
  const values: TCanvasEvent[] = [];
  const waiters: Array<(result: IteratorResult<TCanvasEvent>) => void> = [];
  let closed = false;
  const iterator: AsyncIterator<TCanvasEvent> = {
    next: () => {
      const value = values.shift();
      if (value !== undefined) {
        return Promise.resolve({ done: false, value });
      }
      if (closed) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => waiters.push(resolve));
    },
    return: async () => {
      closed = true;
      for (const resolve of waiters.splice(0)) {
        resolve({ done: true, value: undefined });
      }
      return { done: true, value: undefined };
    },
  };
  return {
    iterable: { [Symbol.asyncIterator]: () => iterator },
    push(value) {
      const resolve = waiters.shift();
      if (resolve === undefined) values.push(value);
      else resolve({ done: false, value });
    },
  };
}

function applyCommands(
  nodes: Map<string, TSceneNode>,
  commands: readonly TSerializedSceneCommand[],
): void {
  const childrenOf = (parentId: string): string[] => (
    [...nodes.values()]
      .filter((node) => node.parentId === parentId)
      .map((node) => node.id)
  );
  for (const command of commands) {
    if (command.type === 'upsert') {
      nodes.set(command.node.id, structuredClone(command.node));
      continue;
    }
    if (command.type === 'remove') {
      const node = nodes.get(command.nodeId);
      if (node === undefined) continue;
      if (command.descendants === 'reparent') {
        for (const childId of childrenOf(node.id)) {
          const child = nodes.get(childId)!;
          nodes.set(childId, { ...child, parentId: node.parentId });
        }
        nodes.delete(node.id);
        continue;
      }
      const work = [node.id];
      while (work.length > 0) {
        const nodeId = work.pop()!;
        work.push(...childrenOf(nodeId));
        nodes.delete(nodeId);
      }
      continue;
    }
    if (command.type === 'reparent') {
      const node = nodes.get(command.nodeId);
      if (node === undefined) throw new Error('missing test node');
      nodes.set(node.id, {
        ...node,
        parentId: command.parentId,
        orderKey: command.orderKey ?? node.orderKey,
      });
      continue;
    }
    if (command.type === 'reorder') {
      const node = nodes.get(command.nodeId);
      if (node === undefined) throw new Error('missing test node');
      nodes.set(node.id, { ...node, orderKey: command.orderKey });
      continue;
    }
    nodes.clear();
    for (const node of command.snapshot.nodes) {
      nodes.set(node.id, structuredClone(node));
    }
  }
}

function fakeEngine(): Readonly<{
  engine: IInfiniteCanvasEngine;
  apply: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  retain: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  replaceRegistrations: ReturnType<typeof vi.fn>;
  destroyRegistrations: ReturnType<typeof vi.fn>;
  seedResource(resourceId: string): void;
  rejectNextApply(): void;
  rejectNextRegistrationReplace(): void;
  setNextApplyRevisionDelta(delta: number): void;
  setApplyHook(hook: (() => void) | null): void;
}> {
  const nodes = new Map<string, TSceneNode>();
  const resourceIds = new Set<string>();
  let revision = 0;
  let rejectApply = false;
  let rejectRegistrationReplace = false;
  let nextApplyRevisionDelta = 1;
  let applyHook: (() => void) | null = null;
  const apply = vi.fn((commands: TSerializedSceneCommand[]) => {
    applyHook?.();
    if (rejectApply) {
      rejectApply = false;
      throw new Error('projection rejected');
    }
    applyCommands(nodes, commands);
    revision += nextApplyRevisionDelta;
    nextApplyRevisionDelta = 1;
  });
  const replace = vi.fn((next: TSceneSnapshot) => {
    nodes.clear();
    for (const node of next.nodes) nodes.set(node.id, structuredClone(node));
    revision += 1;
  });
  const retain = vi.fn((resourceId: string) => {
    if (!resourceIds.has(resourceId)) throw new Error('resource is not registered');
  });
  const release = vi.fn();
  const replaceRegistrations = vi.fn(() => {
    if (!rejectRegistrationReplace) return;
    rejectRegistrationReplace = false;
    throw new Error('registration replacement failed');
  });
  const destroyRegistrations = vi.fn();
  const engine = {
    scene: {
      get revision() {
        return revision;
      },
      get: (nodeId: string) => nodes.get(nodeId) ?? null,
      has: (nodeId: string) => nodes.has(nodeId),
      childrenOf: (parentId: string | null) => (
        [...nodes.values()].filter((node) => node.parentId === parentId)
      ),
      query: (predicate: (node: TSceneNode) => boolean) => (
        [...nodes.values()].filter(predicate)
      ),
      snapshot: () => ({
        schemaVersion: '1.0.0' as const,
        rootLayerIds: [CANVAS_SYNTHETIC_CONTENT_LAYER_ID],
        nodes: [...nodes.values()],
      }),
      apply,
      replace,
    },
    resources: {
      createRegistrationOwner: () => ({
        id: 'test-owner',
        replace: replaceRegistrations,
        clear: vi.fn(),
        preload: vi.fn(async () => undefined),
        destroy: destroyRegistrations,
      }),
      state: (resourceId: string) => (
        resourceIds.has(resourceId) ? { status: 'ready' } : null
      ),
      retain,
      release,
    },
  } as unknown as IInfiniteCanvasEngine;
  return {
    engine,
    apply,
    replace,
    retain,
    release,
    replaceRegistrations,
    destroyRegistrations,
    seedResource: (resourceId) => resourceIds.add(resourceId),
    rejectNextApply: () => {
      rejectApply = true;
    },
    rejectNextRegistrationReplace: () => {
      rejectRegistrationReplace = true;
    },
    setNextApplyRevisionDelta: (delta) => {
      nextApplyRevisionDelta = delta;
    },
    setApplyHook: (hook) => {
      applyHook = hook;
    },
  };
}

function transportWith(
  initialSnapshot: TCanvasSnapshot,
  execute: TCanvasDocumentTransport['execute'],
  queue = eventQueue(),
): Readonly<{
  transport: TCanvasDocumentTransport;
  getSnapshot: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  queue: ReturnType<typeof eventQueue>;
}> {
  const getSnapshot = vi.fn(async () => initialSnapshot);
  const executeSpy = vi.fn(execute);
  return {
    transport: {
      getSnapshot,
      execute: executeSpy,
      subscribe: vi.fn(() => queue.iterable),
    },
    getSnapshot,
    execute: executeSpy,
    queue,
  };
}

function mutation(
  engine: IInfiniteCanvasEngine,
  transactionId: string,
  commands: readonly TSerializedSceneCommand[],
  affectedNodeIds: readonly string[],
  source = 'test',
): TEditorSceneMutationRequest {
  return {
    transactionId,
    basisSceneRevision: engine.scene.revision,
    source,
    commands,
    affectedNodeIds,
  };
}

describe('CanvasDocumentService', () => {
  test('updates the local document and scene before awaiting one server command', async () => {
    const before = rect();
    const after = rect('rect-a', 25);
    const acknowledgement = deferred<TCanvasItemsChangedEvent>();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => acknowledgement.promise,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.apply.mockClear();
    fake.replaceRegistrations.mockClear();

    const receipt = service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(after) }],
      [after.id],
    ));

    expect(receipt.projectedSceneRevision).toBe(2);
    expect(service.node(after.id)?.transform.position.x).toBe(25);
    expect(fake.engine.scene.get(after.id)?.transform.position.x).toBe(25);
    expect(fake.apply).toHaveBeenCalledTimes(1);
    expect(fake.replaceRegistrations).not.toHaveBeenCalled();
    expect(service.pendingTransactionCount).toBe(1);
    expect(service.revision).toBe(0);

    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    expect(transport.execute.mock.calls[0]?.[0]).toMatchObject({
      commandId: 'command-a',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'patch',
        itemId: before.id,
        patches: [{
          type: 'set',
          path: ['transform', 'position', 'x'],
          value: 25,
        }],
      }],
    });

    acknowledgement.resolve(event(
      'command-a',
      1,
      [item(after, 2)],
    ));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.revision).toBe(1);
    expect(service.item(after.id)?.item).toEqual(after);
    expect(fake.apply).toHaveBeenCalledTimes(1);

    await service.dispose();
  });

  test('projects one canonical server difference after an own acknowledgement', async () => {
    const before = rect();
    const acknowledgement = deferred<TCanvasItemsChangedEvent>();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => acknowledgement.promise,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.apply.mockClear();

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    acknowledgement.resolve(event(
      'command-a',
      1,
      [item(rect('rect-a', 30), 2)],
    ));

    await vi.waitFor(() => (
      expect(service.node('rect-a')?.transform.position.x).toBe(30)
    ));
    expect(fake.apply).toHaveBeenCalledTimes(2);
    expect(service.pendingTransactionCount).toBe(0);

    await service.dispose();
  });

  test('rejects stale, duplicate, reentrant, and atomically rejected projections', async () => {
    const before = rect();
    const acknowledgement = deferred<TCanvasItemsChangedEvent>();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => acknowledgement.promise,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    expect(() => service.commit({
      transactionId: 'stale',
      basisSceneRevision: 0,
      source: 'test',
      commands: [{ type: 'upsert', node: runtimeNode(rect('rect-a', 5)) }],
      affectedNodeIds: ['rect-a'],
    })).toThrow('Stale editor transaction basis');

    fake.rejectNextApply();
    expect(() => service.commit(mutation(
      fake.engine,
      'rejected',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 10)) }],
      ['rect-a'],
    ))).toThrow('projection rejected');
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(service.pendingTransactionCount).toBe(0);

    const request = mutation(
      fake.engine,
      'accepted',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 20)) }],
      ['rect-a'],
    );
    let reentrantError: unknown;
    fake.setApplyHook(() => {
      try {
        service.commit({
          ...request,
          transactionId: 'nested',
        });
      } catch (error) {
        reentrantError = error;
      }
    });
    service.commit(request);
    fake.setApplyHook(null);
    expect(reentrantError).toMatchObject({
      message: 'Canvas document mutation is not reentrant.',
    });
    expect(() => service.commit(request)).toThrow('Duplicate editor transaction ID');

    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    acknowledgement.resolve(event(
      'command-a',
      1,
      [item(rect('rect-a', 20), 2)],
    ));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    await service.dispose();
  });

  test('routes undo through the same local-first projection and outbox', async () => {
    const before = rect();
    const transport = transportWith(
      snapshot([item(before)]),
      async (command: TCanvasCommand) => {
        const x = command.operations.some((operation) => (
          operation.type === 'patch'
          && operation.patches.some((patch) => (
            patch.type === 'set'
            && patch.path.join('.') === 'transform.position.x'
            && patch.value === 25
          ))
        )) ? 25 : 0;
        const revision = command.commandId === 'command-1' ? 1 : 2;
        return event(
          command.commandId,
          revision,
          [item(rect('rect-a', x), revision + 1)],
        );
      },
    );
    const fake = fakeEngine();
    let commandSequence = 0;
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => `command-${++commandSequence}`,
    });
    await service.start(fake.engine);
    service.history.attach();
    fake.apply.mockClear();

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    expect(service.history.canUndo).toBe(true);
    expect(service.history.undo()).toBe(true);
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(fake.apply).toHaveBeenCalledTimes(2);

    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.revision).toBe(2);
    expect(service.history.canRedo).toBe(true);
    await service.dispose();
  });

  test('clears history when a remote descendant attaches to an undoable parent', async () => {
    const parent = group();
    const queue = eventQueue();
    const transport = transportWith(
      snapshot([]),
      async (command) => event(command.commandId, 1, [item(parent)]),
      queue,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    service.history.attach();

    service.commit(mutation(
      fake.engine,
      'insert-parent',
      [{ type: 'upsert', node: runtimeNode(parent) }],
      [parent.id],
    ));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.history.canUndo).toBe(true);

    const remoteChild: TRectNode = {
      ...rect('remote-child'),
      parentId: parent.id,
      orderKey: 'B',
    };
    queue.push(event('remote-child', 2, [item(remoteChild)]));
    await vi.waitFor(() => expect(service.revision).toBe(2));

    expect(service.node(remoteChild.id)?.parentId).toBe(parent.id);
    expect(service.history.canUndo).toBe(false);
    expect(service.history.undo()).toBe(false);
    await service.dispose();
  });

  test('drops a coalesced undo step when an edit returns to its original value', async () => {
    let acceptedRevision = 0;
    const transport = transportWith(
      snapshot([item(rect())]),
      async (command) => {
        acceptedRevision += 1;
        const patchOperation = command.operations.find(
          (operation) => operation.type === 'patch',
        );
        const xPatch = patchOperation?.type === 'patch'
          ? patchOperation.patches.find((patch) => (
            patch.type === 'set'
            && patch.path.join('.') === 'transform.position.x'
          ))
          : undefined;
        return event(
          command.commandId,
          acceptedRevision,
          [item(rect('rect-a', Number(xPatch?.value ?? 0)), acceptedRevision + 1)],
        );
      },
    );
    const fake = fakeEngine();
    let commandSequence = 0;
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => `command-${++commandSequence}`,
    });
    await service.start(fake.engine);
    service.history.attach();

    service.commit({
      ...mutation(
        fake.engine,
        'transaction-forward',
        [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
        ['rect-a'],
      ),
      coalesceKey: 'drag-a',
    });
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.history.canUndo).toBe(true);

    service.commit({
      ...mutation(
        fake.engine,
        'transaction-return',
        [{ type: 'upsert', node: runtimeNode(rect('rect-a', 0)) }],
        ['rect-a'],
      ),
      coalesceKey: 'drag-a',
    });
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(service.history.canUndo).toBe(false);
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(transport.execute).toHaveBeenCalledTimes(2);
    await service.dispose();
  });

  test('projects a disjoint remote event and reloads on a revision gap', async () => {
    let currentSnapshot = snapshot([]);
    const queue = eventQueue();
    const getSnapshot = vi.fn(async () => currentSnapshot);
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => {
        throw new Error('unexpected execute');
      }),
      subscribe: vi.fn(() => queue.iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.apply.mockClear();

    const remote = rect('rect-remote', 40);
    queue.push(event('remote-1', 1, [item(remote)]));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node(remote.id)?.transform.position.x).toBe(40);
    expect(fake.apply).toHaveBeenCalledTimes(1);

    const authoritative = rect('rect-authoritative', 80);
    currentSnapshot = snapshot([item(authoritative)], 3);
    queue.push(event('remote-gap', 3, [item(authoritative)]));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(service.revision).toBe(3);
    expect(service.node(authoritative.id)).not.toBeNull();
    expect(service.node(remote.id)).toBeNull();

    await service.dispose();
  });

  test('reconciles a disjoint remote event while a local command is in flight', async () => {
    const before = rect();
    const after = rect('rect-a', 25);
    const acknowledgement = deferred<TCanvasItemsChangedEvent>();
    const queue = eventQueue();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => acknowledgement.promise,
      queue,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.apply.mockClear();

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(after) }],
      [after.id],
    ));
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));

    const remote = rect('rect-remote', 40);
    queue.push(event('remote-1', 1, [item(remote)]));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node(after.id)?.transform.position.x).toBe(25);
    expect(service.node(remote.id)?.transform.position.x).toBe(40);
    expect(service.pendingTransactionCount).toBe(1);
    expect(fake.apply).toHaveBeenCalledTimes(2);

    acknowledgement.resolve(event('command-a', 2, [item(after, 2)]));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.revision).toBe(2);
    expect(fake.apply).toHaveBeenCalledTimes(2);

    await service.dispose();
  });

  test('reloads authoritative state and clears history after server rejection', async () => {
    const before = rect();
    const errors: unknown[] = [];
    const transport = transportWith(
      snapshot([item(before)]),
      async () => {
        throw new Error('server rejected');
      },
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      onError: (error) => errors.push(error),
    });
    await service.start(fake.engine);
    service.history.attach();

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(transport.getSnapshot).toHaveBeenCalledTimes(2));
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(service.pendingTransactionCount).toBe(0);
    expect(service.history.canUndo).toBe(false);
    expect(errors).toHaveLength(1);

    await service.dispose();
  });

  test('isolates throwing history and error listeners without stranding a commit', async () => {
    const before = rect();
    const after = rect('rect-a', 25);
    const transport = transportWith(
      snapshot([item(before)]),
      async (command) => event(command.commandId, 1, [item(after, 2)]),
    );
    const fake = fakeEngine();
    const onError = vi.fn(() => {
      throw new Error('host error listener failed');
    });
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      onError,
    });
    await service.start(fake.engine);
    service.history.subscribe(() => {
      throw new Error('history listener failed');
    });

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(after) }],
      [after.id],
    ))).not.toThrow();

    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'history listener failed' }),
    );
    expect(service.node(after.id)?.transform.position.x).toBe(25);
    await service.dispose();
  });

  test('rejects commits while an authoritative recovery snapshot is deferred', async () => {
    const before = rect();
    const recoverySnapshot = deferred<TCanvasSnapshot>();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot([item(before)]))
      .mockImplementationOnce(async () => recoverySnapshot.promise);
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => {
        throw new Error('server rejected');
      }),
      subscribe: vi.fn(() => eventQueue().iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-during-recovery',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 50)) }],
      ['rect-a'],
    ))).toThrow('Canvas document reconciliation is in progress.');

    recoverySnapshot.resolve(snapshot([item(before)], 1));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(service.pendingTransactionCount).toBe(0);
    await service.dispose();
  });

  test('schedules reconciliation after a projection revision mismatch and blocks commits', async () => {
    const recoverySnapshot = deferred<TCanvasSnapshot>();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot([item(rect())]))
      .mockImplementationOnce(async () => recoverySnapshot.promise);
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => {
        throw new Error('mismatched projection must not execute');
      }),
      subscribe: vi.fn(() => eventQueue().iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.setNextApplyRevisionDelta(2);

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-mismatch',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ))).toThrow(
      'Canvas scene projection did not produce exactly one successor revision.',
    );
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-blocked',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 50)) }],
      ['rect-a'],
    ))).toThrow('Canvas document reconciliation is in progress.');
    expect(transport.execute).not.toHaveBeenCalled();

    recoverySnapshot.resolve(snapshot([item(rect())], 1));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    await service.dispose();
  });

  test('keeps commits blocked after one failed recovery snapshot and retries to success', async () => {
    const retrySnapshot = deferred<TCanvasSnapshot>();
    let snapshotRequest = 0;
    const getSnapshot = vi.fn(async () => {
      snapshotRequest += 1;
      if (snapshotRequest === 1) return snapshot([item(rect())]);
      if (snapshotRequest === 2) throw new Error('temporary snapshot failure');
      return retrySnapshot.promise;
    });
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => {
        throw new Error('server rejected');
      }),
      subscribe: vi.fn(() => eventQueue().iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(
      () => expect(getSnapshot).toHaveBeenCalledTimes(3),
      { timeout: 1_500 },
    );

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-during-retry',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 50)) }],
      ['rect-a'],
    ))).toThrow('Canvas document reconciliation is in progress.');

    retrySnapshot.resolve(snapshot([item(rect())], 1));
    await vi.waitFor(() => (
      expect(service.node('rect-a')?.transform.position.x).toBe(0)
    ));
    expect(service.revision).toBe(1);
    expect(service.pendingTransactionCount).toBe(0);
    await service.dispose();
  });

  test('retries recovery while durable registration replacement fails', async () => {
    const durableImage: TImageNode = {
      id: 'image-durable',
      kind: 'image',
      parentId: null,
      orderKey: 'A',
      transform,
      resourceId: 'resource-durable',
      size: { width: 80, height: 60 },
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: 'https://media.test/durable.png',
          mimeType: 'image/png',
        },
      },
    };
    const successfulRetry = deferred<TCanvasSnapshot>();
    let snapshotRequest = 0;
    const getSnapshot = vi.fn(async () => {
      snapshotRequest += 1;
      if (snapshotRequest === 1) return snapshot([]);
      if (snapshotRequest === 2) return snapshot([item(durableImage)], 1);
      return successfulRetry.promise;
    });
    const queue = eventQueue();
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => {
        throw new Error('unexpected execute');
      }),
      subscribe: vi.fn(() => queue.iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    fake.rejectNextRegistrationReplace();

    queue.push({
      type: 'resync-required',
      canvasId: 'canvas-a',
      revision: 1,
    });
    await vi.waitFor(
      () => expect(getSnapshot).toHaveBeenCalledTimes(3),
      { timeout: 1_500 },
    );

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-during-registration-retry',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a')) }],
      ['rect-a'],
    ))).toThrow('Canvas document reconciliation is in progress.');

    successfulRetry.resolve(snapshot([item(durableImage)], 1));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(fake.replaceRegistrations).toHaveBeenLastCalledWith([{
      descriptor: {
        id: 'resource-durable',
        type: 'image',
        url: 'https://media.test/durable.png',
        mimeType: 'image/png',
      },
    }]);
    expect(service.node(durableImage.id)).not.toBeNull();
    await service.dispose();
  });

  test('resync reloads around a never-settling execute and dispose stays bounded', async () => {
    const neverSettles = deferred<TCanvasItemsChangedEvent>();
    const queue = eventQueue();
    let authoritative = snapshot([item(rect())]);
    const getSnapshot = vi.fn(async () => authoritative);
    const transport: TCanvasDocumentTransport = {
      getSnapshot,
      execute: vi.fn(async () => neverSettles.promise),
      subscribe: vi.fn(() => queue.iterable),
    };
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));

    authoritative = snapshot([item(rect('rect-a', 5), 2)], 1);
    queue.push({
      type: 'resync-required',
      canvasId: 'canvas-a',
      revision: 1,
    });
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node('rect-a')?.transform.position.x).toBe(5);
    expect(service.pendingTransactionCount).toBe(0);

    const outcome = await Promise.race([
      service.dispose().then(() => 'disposed' as const),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 100);
      }),
    ]);
    expect(outcome).toBe('disposed');
  });

  test('reloads when a remote parent deletion omits an attached child', async () => {
    const parent = rect('parent');
    const child: TRectNode = {
      ...rect('child'),
      parentId: parent.id,
    };
    const queue = eventQueue();
    let authoritative = snapshot([item(parent), item(child)]);
    const transport = transportWith(
      authoritative,
      async () => {
        throw new Error('unexpected execute');
      },
      queue,
    );
    transport.getSnapshot.mockImplementation(async () => authoritative);
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    authoritative = snapshot([], 1);
    queue.push(event('remote-delete', 1, [], [parent.id]));
    await vi.waitFor(() => expect(transport.getSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.revision).toBe(1));

    expect(service.item(parent.id)).toBeNull();
    expect(service.item(child.id)).toBeNull();
    expect(service.node(parent.id)).toBeNull();
    expect(service.node(child.id)).toBeNull();
    expect(fake.engine.scene.get(parent.id)).toBeNull();
    expect(fake.engine.scene.get(child.id)).toBeNull();
    await service.dispose();
  });

  test('remote child reparent plus parent deletion retains the child', async () => {
    const parent = rect('parent');
    const child: TRectNode = {
      ...rect('child'),
      parentId: parent.id,
    };
    const reparentedChild: TRectNode = {
      ...child,
      parentId: null,
    };
    const queue = eventQueue();
    const transport = transportWith(
      snapshot([item(parent), item(child)]),
      async () => {
        throw new Error('unexpected execute');
      },
      queue,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    queue.push(event(
      'remote-reparent-delete',
      1,
      [item(reparentedChild, 2)],
      [parent.id],
    ));
    await vi.waitFor(() => expect(service.revision).toBe(1));

    expect(service.item(parent.id)).toBeNull();
    expect(service.item(child.id)?.item.parentId).toBeNull();
    expect(service.node(parent.id)).toBeNull();
    expect(service.node(child.id)?.parentId).toBe(
      CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    );
    expect(fake.engine.scene.get(parent.id)).toBeNull();
    expect(fake.engine.scene.get(child.id)?.parentId).toBe(
      CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    );
    await service.dispose();
  });

  test.each([
    {
      label: 'wrong',
      acknowledgement: event(
        'command-a',
        1,
        [item(rect('rect-unexpected', 25), 2)],
      ),
    },
    {
      label: 'missing',
      acknowledgement: event('command-a', 1, []),
    },
  ])('recovers when an acknowledgement has $label targets', async ({
    acknowledgement,
  }) => {
    const before = rect();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => acknowledgement,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));

    await vi.waitFor(() => expect(transport.getSnapshot).toHaveBeenCalledTimes(2));
    expect(service.pendingTransactionCount).toBe(0);
    expect(service.node('rect-a')?.transform.position.x).toBe(0);
    expect(service.node('rect-unexpected')).toBeNull();
    await service.dispose();
  });

  test('clears overlapping local history when a remote event wins', async () => {
    const before = rect();
    const after = rect('rect-a', 25);
    const queue = eventQueue();
    const transport = transportWith(
      snapshot([item(before)]),
      async (command) => event(command.commandId, 1, [item(after, 2)]),
      queue,
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    service.history.attach();

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(after) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(service.history.canUndo).toBe(true);

    queue.push(event('remote-overlap', 2, [item(rect('rect-a', 50), 3)]));
    await vi.waitFor(() => (
      expect(service.node('rect-a')?.transform.position.x).toBe(50)
    ));
    expect(service.history.canUndo).toBe(false);
    await service.dispose();
  });

  test('rejects a generic source-less image mutation', async () => {
    const transport = transportWith(
      snapshot([]),
      async () => {
        throw new Error('source-less image must not execute');
      },
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });
    await service.start(fake.engine);
    const node: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };

    expect(() => service.commit(mutation(
      fake.engine,
      'source-less-image',
      [{ type: 'upsert', node }],
      [node.id],
    ))).toThrow("Image node 'image-a' has no durable Vibecanvas image descriptor.");
    expect(fake.apply).toHaveBeenCalledTimes(0);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(service.pendingTransactionCount).toBe(0);
    await service.dispose();
  });

  test('rejects a prepared import with an unmatched extra image upsert', async () => {
    const imagePort = {
      uploadImage: vi.fn(async () => ({ url: 'https://media.test/image.png' })),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const transport = transportWith(
      snapshot([]),
      async () => {
        throw new Error('invalid prepared image must not execute');
      },
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: imagePort,
    });
    await service.start(fake.engine);
    const imageA: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };
    const imageB: TImageNode = {
      ...imageA,
      id: 'image-b',
      resourceId: 'resource-b',
      orderKey: 'B',
    };

    expect(() => service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [
          { type: 'upsert', node: imageA },
          { type: 'upsert', node: imageB },
        ],
        [imageA.id, imageB.id],
      ),
      images: [{
        node: imageA,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    })).toThrow(
      'Prepared image entries and image upserts must correspond one-to-one.',
    );
    expect(fake.retain).not.toHaveBeenCalled();
    expect(fake.apply).toHaveBeenCalledTimes(0);
    expect(transport.execute).not.toHaveBeenCalled();
    await service.dispose();
  });

  test('rejects non-import commands in a prepared image mutation', async () => {
    const before = rect();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => {
        throw new Error('invalid prepared image must not execute');
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: {
        uploadImage: vi.fn(async () => ({ url: 'https://media.test/image.png' })),
        cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
        deleteImage: vi.fn(async () => ({ ok: true as const })),
      },
    });
    await service.start(fake.engine);
    fake.apply.mockClear();
    const imageNode: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'B',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };

    expect(() => service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [
          { type: 'remove', nodeId: before.id },
          { type: 'upsert', node: imageNode },
        ],
        [before.id, imageNode.id],
      ),
      images: [{
        node: imageNode,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    })).toThrow(
      'Prepared image mutations may contain only image upserts and sibling reorders.',
    );
    expect(fake.retain).not.toHaveBeenCalled();
    expect(fake.apply).not.toHaveBeenCalled();
    expect(transport.execute).not.toHaveBeenCalled();
    await service.dispose();
  });

  test('rejects a prepared image resource identity already used by the document', async () => {
    const existingImage: TImageNode = {
      id: 'image-existing',
      kind: 'image',
      parentId: null,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: 'https://media.test/existing.png',
          mimeType: 'image/png',
        },
      },
    };
    const transport = transportWith(
      snapshot([item(existingImage)]),
      async () => {
        throw new Error('duplicate resource must not execute');
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: {
        uploadImage: vi.fn(async () => ({ url: 'https://media.test/image.png' })),
        cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
        deleteImage: vi.fn(async () => ({ ok: true as const })),
      },
    });
    await service.start(fake.engine);
    const imageNode: TImageNode = {
      ...existingImage,
      id: 'image-new',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'B',
      extensions: undefined,
    };

    expect(() => service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node: imageNode }],
        [imageNode.id],
      ),
      images: [{
        node: imageNode,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    })).toThrow("Duplicate prepared image resource ID 'resource-a'.");
    expect(fake.retain).not.toHaveBeenCalled();
    expect(transport.execute).not.toHaveBeenCalled();
    await service.dispose();
  });

  test('accepts Cangine sibling reorders alongside prepared image upserts', async () => {
    const before = rect();
    const upload = deferred<Readonly<{ url: string }>>();
    const transport = transportWith(
      snapshot([item(before)]),
      async () => {
        throw new Error('media-gated import must not execute yet');
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: {
        uploadImage: vi.fn(async () => upload.promise),
        cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
        deleteImage: vi.fn(async () => ({ ok: true as const })),
      },
    });
    await service.start(fake.engine);
    fake.apply.mockClear();
    const imageNode: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'B',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };

    expect(service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [
          { type: 'reorder', nodeId: before.id, orderKey: 'AA' },
          { type: 'upsert', node: imageNode },
        ],
        [imageNode.id, before.id],
      ),
      images: [{
        node: imageNode,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    })).toEqual({ projectedSceneRevision: 2 });
    expect(service.node(before.id)?.orderKey).toBe('AA');
    expect(service.node(imageNode.id)).not.toBeNull();
    expect(fake.apply).toHaveBeenCalledTimes(1);
    expect(transport.execute).not.toHaveBeenCalled();
    await service.dispose();
  });

  test('adopts a prepared Blob synchronously and media-gates persistence', async () => {
    const upload = deferred<Readonly<{ url: string }>>();
    const imagePort = {
      uploadImage: vi.fn(async () => upload.promise),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const transport = transportWith(
      snapshot([]),
      async (command: TCanvasCommand) => {
        const insertion = command.operations.find(
          (operation) => operation.type === 'insert',
        );
        if (insertion?.type !== 'insert') throw new Error('missing image insert');
        return event(command.commandId, 1, [item(insertion.item)]);
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: imagePort,
    });
    await service.start(fake.engine);
    fake.apply.mockClear();
    const node: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };
    const request: TPreparedImageImportRequest = {
      importId: 'import-a',
      source: 'clipboard',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node }],
        [node.id],
        'cangine-editor:clipboard-image-paste',
      ),
      images: [{
        node,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    };

    const receipt = service.commitPrepared(request);

    expect(receipt.projectedSceneRevision).toBe(2);
    expect(fake.retain).toHaveBeenCalledWith(
      'resource-a',
      'vibecanvas:document-images',
    );
    expect(service.node(node.id)).not.toBeNull();
    expect(fake.apply).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(imagePort.uploadImage).toHaveBeenCalledTimes(1));
    expect(transport.execute).not.toHaveBeenCalled();

    upload.resolve({ url: 'https://media.test/image-a.png' });
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    const command = transport.execute.mock.calls[0]?.[0] as TCanvasCommand;
    const insertion = command.operations.find(
      (operation) => operation.type === 'insert',
    );
    expect(insertion).toMatchObject({
      type: 'insert',
      item: {
        id: 'image-a',
        parentId: null,
        extensions: {
          [CANVAS_IMAGE_EXTENSION_KEY]: {
            schemaVersion: 1,
            url: 'https://media.test/image-a.png',
            mimeType: 'image/png',
          },
        },
      },
    });
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));
    expect(fake.apply).toHaveBeenCalledTimes(2);
    expect(imagePort.deleteImage).not.toHaveBeenCalled();

    await service.dispose();
    expect(fake.release).toHaveBeenCalledWith(
      'resource-a',
      'vibecanvas:document-images',
    );
  });

  test('rolls back a failed prepared upload without persisting a source-less row', async () => {
    const errors: unknown[] = [];
    const imagePort = {
      uploadImage: vi.fn(async () => {
        throw new Error('upload failed');
      }),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const transport = transportWith(
      snapshot([]),
      async () => {
        throw new Error('source-less image must not execute');
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: imagePort,
      onError: (error) => errors.push(error),
    });
    await service.start(fake.engine);
    const node: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };

    service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node }],
        [node.id],
      ),
      images: [{
        node,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    });

    await vi.waitFor(() => expect(transport.getSnapshot).toHaveBeenCalledTimes(2));
    expect(transport.execute).not.toHaveBeenCalled();
    expect(service.node(node.id)).toBeNull();
    expect(service.pendingTransactionCount).toBe(0);
    expect(fake.release).toHaveBeenCalledWith(
      'resource-a',
      'vibecanvas:document-images',
    );
    expect(errors).toHaveLength(1);

    await service.dispose();
  });

  test('reloads after a later multi-image upload fails even when uploaded-media deletion never settles', async () => {
    const neverDeleted = deferred<Readonly<{ ok: true }>>();
    const imagePort = {
      uploadImage: vi.fn()
        .mockResolvedValueOnce({ url: 'https://media.test/image-a.png' })
        .mockRejectedValueOnce(new Error('second upload failed')),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => neverDeleted.promise),
    };
    const transport = transportWith(
      snapshot([]),
      async () => {
        throw new Error('failed multi-image import must not execute');
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    fake.seedResource('resource-b');
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
      image: imagePort,
    });
    await service.start(fake.engine);
    const imageA: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };
    const imageB: TImageNode = {
      ...imageA,
      id: 'image-b',
      resourceId: 'resource-b',
      orderKey: 'B',
    };

    service.commitPrepared({
      importId: 'import-a',
      source: 'drop',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [
          { type: 'upsert', node: imageA },
          { type: 'upsert', node: imageB },
        ],
        [imageA.id, imageB.id],
      ),
      images: [
        {
          node: imageA,
          blob: new Blob(['image-a'], { type: 'image/png' }),
          mimeType: 'image/png',
          intrinsicSize: { width: 80, height: 60 },
        },
        {
          node: imageB,
          blob: new Blob(['image-b'], { type: 'image/png' }),
          mimeType: 'image/png',
          intrinsicSize: { width: 80, height: 60 },
        },
      ],
    });

    await vi.waitFor(() => expect(imagePort.uploadImage).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(imagePort.deleteImage).toHaveBeenCalledWith({
      url: 'https://media.test/image-a.png',
    }));
    await vi.waitFor(() => (
      expect(transport.getSnapshot).toHaveBeenCalledTimes(2)
    ));
    expect(transport.execute).not.toHaveBeenCalled();
    expect(service.pendingTransactionCount).toBe(0);
    expect(service.node(imageA.id)).toBeNull();
    expect(service.node(imageB.id)).toBeNull();
    await service.dispose();
  });

  test('retains promoted media across resync while its persistence outcome is unknown', async () => {
    const acknowledgement = deferred<TCanvasItemsChangedEvent>();
    const imagePort = {
      uploadImage: vi.fn(async () => ({
        url: 'https://media.test/image-a.png',
      })),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const queue = eventQueue();
    const transport = transportWith(
      snapshot([]),
      async () => acknowledgement.promise,
      queue,
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    let idSequence = 0;
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => `command-${++idSequence}`,
      image: imagePort,
    });
    await service.start(fake.engine);
    const imageNode: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };

    service.commitPrepared({
      importId: 'import-a',
      source: 'clipboard',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node: imageNode }],
        [imageNode.id],
      ),
      images: [{
        node: imageNode,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    });

    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(1));
    const command = transport.execute.mock.calls[0]![0];
    const insertion = command.operations.find(
      (operation) => operation.type === 'insert',
    );
    if (insertion?.type !== 'insert') throw new Error('missing image insert');
    expect(insertion.item.extensions).toMatchObject({
      [CANVAS_IMAGE_EXTENSION_KEY]: {
        url: 'https://media.test/image-a.png',
      },
    });

    queue.push({
      type: 'resync-required',
      canvasId: 'canvas-a',
      revision: 0,
    });
    await vi.waitFor(() => expect(transport.getSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(fake.replace).toHaveBeenCalledTimes(2));
    expect(imagePort.deleteImage).not.toHaveBeenCalled();

    acknowledgement.resolve(event(
      command.commandId,
      1,
      [item(insertion.item, 1)],
    ));
    await vi.waitFor(() => expect(service.revision).toBe(1));
    expect(service.node(imageNode.id)).toMatchObject({
      id: imageNode.id,
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: 'https://media.test/image-a.png',
          mimeType: 'image/png',
        },
      },
    });
    expect(fake.engine.scene.get(imageNode.id)).toMatchObject({
      id: imageNode.id,
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          url: 'https://media.test/image-a.png',
        },
      },
    });
    expect(imagePort.deleteImage).not.toHaveBeenCalled();
    await service.dispose();
    expect(imagePort.deleteImage).not.toHaveBeenCalled();
  });

  test('keeps pending image edits behind the promoted durable insertion', async () => {
    const upload = deferred<Readonly<{ url: string }>>();
    const imagePort = {
      uploadImage: vi.fn(async () => upload.promise),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const executed: TCanvasCommand[] = [];
    let acceptedImage: TImageNode | null = null;
    const queue = eventQueue();
    const transport: TCanvasDocumentTransport = {
      getSnapshot: vi.fn(async () => snapshot([])),
      execute: vi.fn(async (command) => {
        executed.push(command);
        const insertion = command.operations.find(
          (operation) => operation.type === 'insert',
        );
        if (insertion?.type === 'insert') {
          acceptedImage = insertion.item as TImageNode;
        } else {
          acceptedImage = {
            ...acceptedImage!,
            transform: {
              ...acceptedImage!.transform,
              position: { x: 25, y: 0 },
            },
          };
        }
        return event(
          command.commandId,
          executed.length,
          [item(acceptedImage!, executed.length + 1)],
        );
      }),
      subscribe: vi.fn(() => queue.iterable),
    };
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    let idSequence = 0;
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport,
      createCommandId: () => `command-${++idSequence}`,
      image: imagePort,
    });
    await service.start(fake.engine);
    const node: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };
    service.commitPrepared({
      importId: 'import-a',
      source: 'clipboard',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node }],
        [node.id],
      ),
      images: [{
        node,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    });
    const moved: TImageNode = {
      ...node,
      transform: {
        ...node.transform,
        position: { x: 25, y: 0 },
      },
    };
    service.commit(mutation(
      fake.engine,
      'image-move-a',
      [{ type: 'upsert', node: moved }],
      [node.id],
    ));
    expect(service.node(node.id)?.transform.position.x).toBe(25);
    expect(transport.execute).not.toHaveBeenCalled();

    upload.resolve({ url: 'https://media.test/image-a.png' });
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(2));

    expect(executed[0]?.operations).toEqual([
      expect.objectContaining({
        type: 'insert',
        item: expect.objectContaining({
          transform: expect.objectContaining({
            position: { x: 0, y: 0 },
          }),
          extensions: {
            [CANVAS_IMAGE_EXTENSION_KEY]: {
              schemaVersion: 1,
              url: 'https://media.test/image-a.png',
              mimeType: 'image/png',
            },
          },
        }),
      }),
    ]);
    expect(executed[1]?.operations).toEqual([
      expect.objectContaining({
        type: 'patch',
        patches: expect.arrayContaining([
          {
            type: 'set',
            path: ['transform', 'position', 'x'],
            value: 25,
          },
        ]),
      }),
    ]);
    expect(service.node(node.id)?.transform.position.x).toBe(25);
    expect(service.pendingTransactionCount).toBe(0);

    await service.dispose();
  });

  test('promotes a pending image clone sharing its resource and persists descriptors on every insert', async () => {
    const upload = deferred<Readonly<{ url: string }>>();
    const imagePort = {
      uploadImage: vi.fn(async () => upload.promise),
      cloneImage: vi.fn(async ({ url }: { url: string }) => ({ url })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
    };
    const executed: TCanvasCommand[] = [];
    let revision = 0;
    const transport = transportWith(
      snapshot([]),
      async (command) => {
        executed.push(command);
        revision += 1;
        const inserted = command.operations.find(
          (operation) => operation.type === 'insert',
        );
        if (inserted?.type !== 'insert') throw new Error('missing image insert');
        return event(command.commandId, revision, [
          item(inserted.item, revision + 1),
        ]);
      },
    );
    const fake = fakeEngine();
    fake.seedResource('resource-a');
    let idSequence = 0;
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => `command-${++idSequence}`,
      image: imagePort,
    });
    await service.start(fake.engine);
    const original: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
    };
    const clone: TImageNode = {
      ...original,
      id: 'image-b',
      orderKey: 'B',
      transform: {
        ...transform,
        position: { x: 100, y: 0 },
      },
    };

    service.commitPrepared({
      importId: 'import-a',
      source: 'clipboard',
      mutation: mutation(
        fake.engine,
        'image-transaction-a',
        [{ type: 'upsert', node: original }],
        [original.id],
      ),
      images: [{
        node: original,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        intrinsicSize: { width: 80, height: 60 },
      }],
    });
    service.commit(mutation(
      fake.engine,
      'clone-transaction-a',
      [{ type: 'upsert', node: clone }],
      [clone.id],
    ));
    expect(transport.execute).not.toHaveBeenCalled();

    upload.resolve({ url: 'https://media.test/image-a.png' });
    await vi.waitFor(() => expect(transport.execute).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));

    expect(executed).toHaveLength(2);
    for (const command of executed) {
      const inserted = command.operations.find(
        (operation) => operation.type === 'insert',
      );
      expect(inserted).toMatchObject({
        type: 'insert',
        item: {
          kind: 'image',
          resourceId: 'resource-a',
          extensions: {
            [CANVAS_IMAGE_EXTENSION_KEY]: {
              schemaVersion: 1,
              url: 'https://media.test/image-a.png',
              mimeType: 'image/png',
            },
          },
        },
      });
    }
    expect(service.node(original.id)?.extensions).toMatchObject({
      [CANVAS_IMAGE_EXTENSION_KEY]: {
        url: 'https://media.test/image-a.png',
      },
    });
    expect(service.node(clone.id)?.extensions).toMatchObject({
      [CANVAS_IMAGE_EXTENSION_KEY]: {
        url: 'https://media.test/image-a.png',
      },
    });
    await service.dispose();
  });

  test('rejects reuse of a command ID after its acknowledgement is accepted', async () => {
    const transport = transportWith(
      snapshot([item(rect())]),
      async (command) => {
        const operation = command.operations.find(
          (entry) => entry.type === 'patch',
        );
        const xPatch = operation?.type === 'patch'
          ? operation.patches.find((patch) => (
            patch.type === 'set'
            && patch.path.join('.') === 'transform.position.x'
          ))
          : undefined;
        return event(
          command.commandId,
          1,
          [item(rect('rect-a', Number(xPatch?.value ?? 0)), 2)],
        );
      },
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'reused-command',
    });
    await service.start(fake.engine);

    service.commit(mutation(
      fake.engine,
      'transaction-a',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 25)) }],
      ['rect-a'],
    ));
    await vi.waitFor(() => expect(service.pendingTransactionCount).toBe(0));

    expect(() => service.commit(mutation(
      fake.engine,
      'transaction-b',
      [{ type: 'upsert', node: runtimeNode(rect('rect-a', 50)) }],
      ['rect-a'],
    ))).toThrow("Duplicate canvas command ID 'reused-command'.");
    expect(transport.execute).toHaveBeenCalledTimes(1);
    expect(service.node('rect-a')?.transform.position.x).toBe(25);
    await service.dispose();
  });

  test('registers durable image URL descriptors when loading a snapshot', async () => {
    const imageNode: TImageNode = {
      id: 'image-a',
      kind: 'image',
      parentId: null,
      orderKey: 'A',
      transform,
      resourceId: 'resource-a',
      size: { width: 80, height: 60 },
      extensions: {
        [CANVAS_IMAGE_EXTENSION_KEY]: {
          schemaVersion: 1,
          url: 'https://media.test/image-a.png',
          mimeType: 'image/png',
        },
      },
    };
    const transport = transportWith(
      snapshot([item(imageNode)]),
      async () => {
        throw new Error('unexpected execute');
      },
    );
    const fake = fakeEngine();
    const service = new CanvasDocumentService({
      canvasId: 'canvas-a',
      transport: transport.transport,
      createCommandId: () => 'command-a',
    });

    await service.start(fake.engine);

    expect(fake.replaceRegistrations).toHaveBeenCalledWith([{
      descriptor: {
        id: 'resource-a',
        type: 'image',
        url: 'https://media.test/image-a.png',
        mimeType: 'image/png',
      },
    }]);
    await service.dispose();
    expect(fake.destroyRegistrations).toHaveBeenCalledTimes(1);
  });
});
