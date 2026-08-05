import {
  fnAssertValidCanvasItems,
  type TCanvasCommand,
  type TCanvasDocumentTransport,
  type TCanvasEvent,
  type TCanvasItemPatch,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasSnapshot,
} from '@omnidraw/canvas-contract'

type TCanvasNode = TCanvasItemSnapshot['item']

export type TCanvasTransportStats = Readonly<{
  activeSubscriptions: number
  cancelledSubscriptions: number
  executedCommands: number
  observedEvents: number
  revision: number
}>

export type TCanvasTransportHarness = Readonly<{
  transport: TCanvasDocumentTransport
  stats(): TCanvasTransportStats
}>

type TTransportArgs = Readonly<{
  canvasId: string
  initialItems?: readonly TCanvasNode[]
  initialRevision?: number
}>

type TSubscriber = {
  readonly queue: TCanvasEvent[]
  afterRevision: number
  closed: boolean
  pending: ((result: IteratorResult<TCanvasEvent>) => void) | null
}

type TMutableJson = Record<string, unknown> | unknown[]

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isMutableJson(value: unknown): value is TMutableJson {
  return typeof value === 'object' && value !== null
}

function valueAtPath(
  root: unknown,
  path: readonly (string | number)[],
): Readonly<{ found: boolean; value?: unknown }> {
  let current = root
  for (const part of path) {
    if (!isMutableJson(current) || !Object.hasOwn(current, part)) return { found: false }
    current = current[part as keyof typeof current]
  }
  return { found: true, value: current }
}

function applyItemPatches(
  item: TCanvasNode,
  patches: readonly TCanvasItemPatch[],
): TCanvasNode {
  let result: unknown = clone(item)
  for (const patch of patches) {
    if (patch.path.length === 0) {
      if (patch.type === 'remove') throw new Error('A canvas item cannot be removed with a root patch.')
      result = clone(patch.value)
      continue
    }
    let parent: unknown = result
    for (const part of patch.path.slice(0, -1)) {
      if (!isMutableJson(parent) || !Object.hasOwn(parent, part)) {
        throw new Error(`Canvas patch parent does not exist at ${patch.path.join('.')}.`)
      }
      parent = parent[part as keyof typeof parent]
    }
    if (!isMutableJson(parent)) {
      throw new Error(`Canvas patch parent is not an object at ${patch.path.join('.')}.`)
    }
    const key = patch.path.at(-1)!
    if (patch.type === 'remove') {
      if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1)
      else delete parent[key as keyof typeof parent]
    } else {
      parent[key as keyof typeof parent] = clone(patch.value) as never
    }
  }
  return result as TCanvasNode
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertPreconditions(
  command: TCanvasCommand,
  items: ReadonlyMap<string, TCanvasItemSnapshot>,
): void {
  for (const precondition of command.preconditions) {
    const current = items.get(precondition.itemId)
    if (precondition.type === 'item-absent') {
      if (current !== undefined) throw new Error(`Canvas item ${precondition.itemId} already exists.`)
      continue
    }
    if (current === undefined) throw new Error(`Canvas item ${precondition.itemId} does not exist.`)
    if (precondition.type === 'item-revision') {
      if (current.itemRevision !== precondition.itemRevision) {
        throw new Error(`Canvas item ${precondition.itemId} has a stale revision.`)
      }
      continue
    }
    const actual = valueAtPath(current.item, precondition.path)
    if (precondition.type === 'path-absent') {
      if (actual.found) throw new Error(`Canvas path ${precondition.path.join('.')} already exists.`)
      continue
    }
    if (!actual.found || !jsonEqual(actual.value, precondition.value)) {
      throw new Error(`Canvas path ${precondition.path.join('.')} has a stale value.`)
    }
  }
}

/**
 * Reusable protocol-free transport for an external canvas host. It validates
 * authored nodes, assigns monotonic document/item revisions, replays retained
 * events after `afterRevision`, and promptly settles `next()` on cancellation.
 */
export function createInMemoryCanvasTransport(args: TTransportArgs): TCanvasTransportHarness {
  let revision = args.initialRevision ?? (args.initialItems?.length ? 1 : 0)
  let clockSec = 1_000
  let executedCommands = 0
  let cancelledSubscriptions = 0
  let observedEvents = 0
  let items = new Map<string, TCanvasItemSnapshot>(
    (args.initialItems ?? []).map((item) => [
      item.id,
      Object.freeze({
        id: item.id,
        item: clone(item),
        itemRevision: 1,
        createdAtSec: String(clockSec),
        updatedAtSec: String(clockSec),
      }),
    ]),
  )
  const events: TCanvasItemsChangedEvent[] = []
  const subscribers = new Set<TSubscriber>()

  const publish = (event: TCanvasItemsChangedEvent): void => {
    events.push(event)
    for (const subscriber of subscribers) {
      if (subscriber.closed || event.revision <= subscriber.afterRevision) continue
      subscriber.afterRevision = event.revision
      observedEvents += 1
      if (subscriber.pending !== null) {
        const settle = subscriber.pending
        subscriber.pending = null
        settle({ done: false, value: clone(event) })
      } else {
        subscriber.queue.push(clone(event))
      }
    }
  }

  const transport: TCanvasDocumentTransport = Object.freeze({
    async getSnapshot(request): Promise<TCanvasSnapshot> {
      if (request.canvasId !== args.canvasId) throw new Error('Unknown canvas.')
      return Object.freeze({
        canvasId: args.canvasId,
        revision,
        items: [...items.values()].map(clone),
      })
    },

    async execute(command): Promise<TCanvasItemsChangedEvent> {
      if (command.canvasId !== args.canvasId) throw new Error('Unknown canvas.')
      if (command.baseRevision !== revision) {
        throw new Error(`Stale canvas revision ${command.baseRevision}; expected ${revision}.`)
      }
      assertPreconditions(command, items)

      const nextNodes = new Map<string, TCanvasNode>(
        [...items].map(([id, snapshot]) => [id, clone(snapshot.item)]),
      )
      const changedIds = new Set<string>()
      const deletedIds = new Set<string>()
      for (const operation of command.operations) {
        if (operation.type === 'insert') {
          if (nextNodes.has(operation.item.id)) throw new Error(`Canvas item ${operation.item.id} exists.`)
          nextNodes.set(operation.item.id, clone(operation.item))
          changedIds.add(operation.item.id)
          deletedIds.delete(operation.item.id)
          continue
        }
        if (operation.type === 'delete') {
          if (!nextNodes.delete(operation.itemId)) throw new Error(`Canvas item ${operation.itemId} is missing.`)
          changedIds.delete(operation.itemId)
          deletedIds.add(operation.itemId)
          continue
        }
        if (operation.type === 'replace') {
          if (!nextNodes.has(operation.item.id)) throw new Error(`Canvas item ${operation.item.id} is missing.`)
          nextNodes.set(operation.item.id, clone(operation.item))
          changedIds.add(operation.item.id)
          deletedIds.delete(operation.item.id)
          continue
        }
        const current = nextNodes.get(operation.itemId)
        if (current === undefined) throw new Error(`Canvas item ${operation.itemId} is missing.`)
        if (operation.type === 'patch') {
          const patched = applyItemPatches(current, operation.patches)
          if (patched.id !== operation.itemId) throw new Error('A patch cannot change a canvas item ID.')
          nextNodes.set(operation.itemId, patched)
        } else if (operation.type === 'reparent') {
          nextNodes.set(operation.itemId, {
            ...current,
            parentId: operation.parentId,
            orderKey: operation.orderKey ?? current.orderKey,
          })
        } else {
          nextNodes.set(operation.itemId, { ...current, orderKey: operation.orderKey })
        }
        changedIds.add(operation.itemId)
        deletedIds.delete(operation.itemId)
      }

      fnAssertValidCanvasItems([...nextNodes.values()])
      revision += 1
      clockSec += 1
      const nextItems = new Map(items)
      for (const deletedId of deletedIds) nextItems.delete(deletedId)
      const changedItems: TCanvasItemSnapshot[] = []
      for (const changedId of changedIds) {
        const item = nextNodes.get(changedId)!
        const previous = items.get(changedId)
        const snapshot = Object.freeze({
          id: changedId,
          item: clone(item),
          itemRevision: (previous?.itemRevision ?? 0) + 1,
          createdAtSec: previous?.createdAtSec ?? String(clockSec),
          updatedAtSec: String(clockSec),
        }) satisfies TCanvasItemSnapshot
        nextItems.set(changedId, snapshot)
        changedItems.push(clone(snapshot))
      }
      items = nextItems
      executedCommands += 1
      const event = Object.freeze({
        type: 'items-changed',
        canvasId: args.canvasId,
        commandId: command.commandId,
        revision,
        changedItems,
        deletedItemIds: [...deletedIds],
      }) satisfies TCanvasItemsChangedEvent
      publish(event)
      return clone(event)
    },

    subscribe(request): AsyncIterable<TCanvasEvent> {
      if (request.canvasId !== args.canvasId) throw new Error('Unknown canvas.')
      const subscriber: TSubscriber = {
        queue: events.filter((event) => event.revision > request.afterRevision).map(clone),
        afterRevision: request.afterRevision,
        closed: false,
        pending: null,
      }
      subscribers.add(subscriber)
      const iterator: AsyncIterableIterator<TCanvasEvent> = {
        [Symbol.asyncIterator]() {
          return iterator
        },
        next() {
          if (subscriber.closed) return Promise.resolve({ done: true, value: undefined })
          const value = subscriber.queue.shift()
          if (value !== undefined) {
            subscriber.afterRevision = Math.max(subscriber.afterRevision, value.revision)
            observedEvents += 1
            return Promise.resolve({ done: false, value })
          }
          if (subscriber.pending !== null) throw new Error('Concurrent subscription reads are unsupported.')
          return new Promise<IteratorResult<TCanvasEvent>>((resolveNext) => {
            subscriber.pending = resolveNext
          })
        },
        return() {
          if (!subscriber.closed) {
            subscriber.closed = true
            subscribers.delete(subscriber)
            cancelledSubscriptions += 1
            subscriber.pending?.({ done: true, value: undefined })
            subscriber.pending = null
          }
          return Promise.resolve({ done: true, value: undefined })
        },
      }
      return iterator
    },
  })

  return Object.freeze({
    transport,
    stats: () => Object.freeze({
      activeSubscriptions: subscribers.size,
      cancelledSubscriptions,
      executedCommands,
      observedEvents,
      revision,
    }),
  })
}

type TFakeCellRequest =
  | Readonly<{ method: 'canvas.snapshot'; canvasId: string }>
  | Readonly<{ method: 'canvas.execute'; command: TCanvasCommand }>

type TFakeCellStreamRequest = Readonly<{
  method: 'canvas.events'
  canvasId: string
  afterRevision: number
}>

type TFakeCellClient = Readonly<{
  request(request: TFakeCellRequest): Promise<TCanvasSnapshot | TCanvasItemsChangedEvent>
  stream(request: TFakeCellStreamRequest): AsyncIterable<TCanvasEvent>
}>

/** A managed-style adapter whose Cell request objects stay behind the public transport. */
export function createFakeCellCanvasTransport(
  args: TTransportArgs,
): TCanvasTransportHarness & Readonly<{ requests(): readonly string[] }> {
  const memory = createInMemoryCanvasTransport(args)
  const requestMethods: string[] = []
  const client: TFakeCellClient = Object.freeze({
    async request(request) {
      requestMethods.push(request.method)
      const wireRequest = clone(request)
      if (wireRequest.method === 'canvas.snapshot') {
        return memory.transport.getSnapshot({ canvasId: wireRequest.canvasId })
      }
      return memory.transport.execute(wireRequest.command)
    },
    stream(request) {
      requestMethods.push(request.method)
      const wireRequest = clone(request)
      return memory.transport.subscribe({
        canvasId: wireRequest.canvasId,
        afterRevision: wireRequest.afterRevision,
      })
    },
  })
  const transport: TCanvasDocumentTransport = Object.freeze({
    async getSnapshot(request) {
      return await client.request({
        method: 'canvas.snapshot',
        canvasId: request.canvasId,
      }) as TCanvasSnapshot
    },
    async execute(command) {
      return await client.request({
        method: 'canvas.execute',
        command,
      }) as TCanvasItemsChangedEvent
    },
    subscribe(request) {
      return client.stream({
        method: 'canvas.events',
        canvasId: request.canvasId,
        afterRevision: request.afterRevision,
      })
    },
  })
  return Object.freeze({
    transport,
    stats: memory.stats,
    requests: () => Object.freeze([...requestMethods]),
  })
}
