import { describe, expect, test } from 'bun:test'
import type { TCanvasItemSnapshot } from '@omnidraw/canvas-contract'
import {
  createFakeCellCanvasTransport,
  createInMemoryCanvasTransport,
} from './src/transports'

type TCanvasNode = TCanvasItemSnapshot['item']

function rect(id: string, x = 0): TCanvasNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'rect',
    transform: {
      position: { x, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { width: 120, height: 80 },
  }
}

describe('external canvas document transports', () => {
  test('executes, resumes, broadcasts, and promptly cancels in memory', async () => {
    const harness = createInMemoryCanvasTransport({ canvasId: 'canvas-memory' })
    const live = harness.transport.subscribe({
      canvasId: 'canvas-memory',
      afterRevision: 0,
    })[Symbol.asyncIterator]()
    const firstEvent = live.next()
    await harness.transport.execute({
      commandId: 'create-1',
      canvasId: 'canvas-memory',
      baseRevision: 0,
      operations: [{ type: 'insert', item: rect('rect-1') }],
      preconditions: [{ type: 'item-absent', itemId: 'rect-1' }],
    })
    expect(await firstEvent).toMatchObject({
      done: false,
      value: { revision: 1, commandId: 'create-1' },
    })
    await harness.transport.execute({
      commandId: 'edit-1',
      canvasId: 'canvas-memory',
      baseRevision: 1,
      operations: [{
        type: 'patch',
        itemId: 'rect-1',
        patches: [{ type: 'set', path: ['transform', 'position', 'x'], value: 48 }],
      }],
      preconditions: [{ type: 'item-revision', itemId: 'rect-1', itemRevision: 1 }],
    })
    const resumed = harness.transport.subscribe({
      canvasId: 'canvas-memory',
      afterRevision: 1,
    })[Symbol.asyncIterator]()
    expect(await resumed.next()).toMatchObject({
      done: false,
      value: { revision: 2, changedItems: [{ item: { transform: { position: { x: 48 } } } }] },
    })

    const pending = resumed.next()
    await resumed.return?.()
    expect(await pending).toEqual({ done: true, value: undefined })
    await live.return?.()
    expect(harness.stats()).toMatchObject({
      activeSubscriptions: 0,
      cancelledSubscriptions: 2,
      executedCommands: 2,
      revision: 2,
    })
  })

  test('keeps fake Cell request objects behind the same public transport', async () => {
    const harness = createFakeCellCanvasTransport({ canvasId: 'canvas-cell' })
    expect(await harness.transport.getSnapshot({ canvasId: 'canvas-cell' })).toMatchObject({
      canvasId: 'canvas-cell',
      revision: 0,
    })
    const iterator = harness.transport.subscribe({
      canvasId: 'canvas-cell',
      afterRevision: 0,
    })[Symbol.asyncIterator]()
    const observed = iterator.next()
    await harness.transport.execute({
      commandId: 'cell-create-1',
      canvasId: 'canvas-cell',
      baseRevision: 0,
      operations: [{ type: 'insert', item: rect('cell-rect') }],
      preconditions: [],
    })
    expect(await observed).toMatchObject({ done: false, value: { revision: 1 } })
    await iterator.return?.()
    expect(harness.requests()).toEqual([
      'canvas.snapshot',
      'canvas.events',
      'canvas.execute',
    ])
    expect(harness.stats().activeSubscriptions).toBe(0)
  })
})
