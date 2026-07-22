import { describe, expect, test } from 'bun:test';
import { isValidAutomergeUrl } from '@automerge/automerge-repo';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  WidgetInstanceMetadataProjector,
  fnWidgetInstanceProjectionSnapshot,
  type IWidgetInstanceMetadataProjectionStore,
  type TWidgetInstanceProjectionBatchRequest,
  type TWidgetInstanceProjectionSource,
} from '../src/projection';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const CANVAS_ID = uuid(1);
const DEFINITION_ID = uuid(2);
const REVISION_ID = uuid(3);
const STATE_DOCUMENT_URL = 'automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf';

const TENANT: TTenantContext = Object.freeze({
  orgId: uuid(10),
  accountId: uuid(11),
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['canvas:write']),
  requestId: 'projection-test',
});

function source(instanceValues: readonly number[], sourceSequence = 1): TWidgetInstanceProjectionSource {
  return {
    canvasId: CANVAS_ID,
    sourceSequence,
    elements: Object.fromEntries(instanceValues.map((value) => {
      const elementId = `element-${value}`;
      return [elementId, {
        id: elementId,
        data: {
          type: 'widget-instance',
          definitionId: DEFINITION_ID,
          revisionId: REVISION_ID,
          instanceId: uuid(100 + value),
        },
      }];
    })),
  };
}

describe('WidgetInstanceMetadataProjector', () => {
  test('normalizes exact pinned identities and rejects ambiguous canvas identity', () => {
    const snapshot = fnWidgetInstanceProjectionSnapshot({
      canvasId: CANVAS_ID,
      sourceSequence: 1,
      elements: {
        shape: { id: 'shape', data: { type: 'rect' } },
        'element-2': {
          id: 'element-2',
          data: {
            type: 'widget-instance',
            definitionId: DEFINITION_ID,
            revisionId: REVISION_ID,
            instanceId: uuid(102),
          },
        },
        'element-1': {
          id: 'element-1',
          data: {
            type: 'widget-instance',
            definitionId: DEFINITION_ID,
            revisionId: REVISION_ID,
            instanceId: uuid(101),
          },
        },
      },
    }, 100, isValidAutomergeUrl);
    expect(snapshot.instances).toEqual([
      {
        elementId: 'element-1',
        instanceId: uuid(101),
        definitionId: DEFINITION_ID,
        revisionId: REVISION_ID,
        stateDocumentId: null,
      },
      {
        elementId: 'element-2',
        instanceId: uuid(102),
        definitionId: DEFINITION_ID,
        revisionId: REVISION_ID,
        stateDocumentId: null,
      },
    ]);
    expect(() => fnWidgetInstanceProjectionSnapshot({
      canvasId: CANVAS_ID,
      sourceSequence: 2,
      elements: {
        wrong: {
          id: 'different',
          data: {
            type: 'widget-instance',
            definitionId: DEFINITION_ID,
            revisionId: REVISION_ID,
            instanceId: uuid(101),
          },
        },
      },
    }, 101, isValidAutomergeUrl)).toThrow('element key');
  });

  test('accepts exactly the schema-canonical UUIDs and unpinned Automerge state URL', () => {
    const valid = source([1]);
    const element = valid.elements['element-1']!;
    expect(fnWidgetInstanceProjectionSnapshot({
      ...valid,
      elements: {
        'element-1': {
          ...element,
          data: { ...element.data, stateDocumentId: STATE_DOCUMENT_URL },
        },
      },
    }, 100, isValidAutomergeUrl).instances[0]).toMatchObject({
      stateDocumentId: STATE_DOCUMENT_URL,
    });

    for (const data of [
      { ...element.data, definitionId: '00000000-0000-4000-8000-00000000000A' },
      { ...element.data, stateDocumentId: 'automerge:not-valid' },
      { ...element.data, stateDocumentId: `${STATE_DOCUMENT_URL}#4P9w8qKtNvbzkexUwmBRETTKQgLf` },
    ]) {
      expect(() => fnWidgetInstanceProjectionSnapshot({
        ...valid,
        elements: { 'element-1': { ...element, data } },
      }, 100, isValidAutomergeUrl)).toThrow();
    }
  });

  test('returns before metadata I/O and coalesces synchronous snapshots per tenant canvas', async () => {
    const requests: TWidgetInstanceProjectionBatchRequest[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        requests.push(request);
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 50 });
    const firstVersion = projector.enqueue(TENANT, source([1], 1));
    const secondVersion = projector.enqueue(TENANT, source([1, 2], 2));
    expect(requests).toHaveLength(0);
    expect(firstVersion).toMatchObject({ status: 'queued', sourceSequence: 1 });
    expect(secondVersion).toMatchObject({ status: 'queued', sourceSequence: 2 });

    await projector.drain();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.snapshots).toHaveLength(1);
    expect(requests[0]?.snapshots[0]?.instances).toHaveLength(2);
    expect(projector.diagnostics()).toMatchObject({
      pendingCanvasCount: 0,
      inFlightSnapshotCount: 0,
      appliedSnapshotCount: 1,
      replayedSnapshotCount: 0,
      staleSnapshotCount: 0,
      coalescedSnapshotCount: 1,
      batchCount: 1,
      lastFailure: null,
    });
  });

  test('retains the highest source sequence when delayed snapshots arrive in reverse order', async () => {
    const requests: TWidgetInstanceProjectionBatchRequest[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        requests.push(request);
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 60 });

    expect(projector.enqueue(TENANT, source([2], 2)))
      .toMatchObject({ status: 'queued', sourceSequence: 2 });
    expect(projector.enqueue(TENANT, source([1], 1)))
      .toMatchObject({ status: 'queued', sourceSequence: 2 });
    await projector.drain();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.snapshots).toEqual([
      expect.objectContaining({
        sourceSequence: 2,
        instances: [expect.objectContaining({ elementId: 'element-2' })],
      }),
    ]);
    expect(projector.diagnostics()).toMatchObject({
      appliedSnapshotCount: 1,
      coalescedSnapshotCount: 1,
      rejectedSnapshotCount: 0,
    });
  });

  test('coalesces identical equal-sequence content and rejects conflicting content', async () => {
    const requests: TWidgetInstanceProjectionBatchRequest[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        requests.push(request);
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    let nowMs = 70;
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => nowMs });

    expect(projector.enqueue(TENANT, source([2, 1], 7)))
      .toMatchObject({ status: 'queued', sourceSequence: 7 });
    nowMs = 71;
    expect(projector.enqueue(TENANT, source([1, 2], 7)))
      .toMatchObject({ status: 'queued', sourceSequence: 7 });
    const conflict = projector.enqueue(TENANT, source([3], 7));
    expect(conflict).toMatchObject({
      status: 'quarantined',
      sourceSequence: 7,
      reason: expect.stringContaining('source sequence'),
    });
    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });
    expect(requests).toHaveLength(0);
    expect(projector.enqueue(TENANT, source([1, 2], 8)))
      .toMatchObject({ status: 'queued', sourceSequence: 8 });
    await projector.drain();
    expect(requests).toHaveLength(1);
    expect(projector.diagnostics()).toMatchObject({
      coalescedSnapshotCount: 1,
      rejectedSnapshotCount: 1,
      lastRejection: expect.stringContaining('source sequence'),
      quarantinedCanvasCount: 0,
      lastFailure: null,
    });
  });

  test('serializes an older in-flight snapshot before a newer snapshot', async () => {
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    const applied: TWidgetInstanceProjectionBatchRequest[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        if (applied.length === 0) {
          markFirstEntered();
          await firstGate;
        }
        applied.push(request);
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    let nowMs = 100;
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => nowMs });
    const olderVersion = projector.enqueue(TENANT, source([1], 10));
    await firstEntered;
    nowMs = 200;
    const newerVersion = projector.enqueue(TENANT, source([2], 11));
    releaseFirst();
    await projector.drain();

    expect(applied).toHaveLength(2);
    expect(applied[0]?.snapshots[0]?.sourceSequence).toBe(olderVersion.sourceSequence);
    expect(applied[1]?.snapshots[0]?.sourceSequence).toBe(newerVersion.sourceSequence);
    expect(applied[1]?.snapshots[0]?.instances[0]?.elementId).toBe('element-2');
  });

  test('stop drains in-flight metadata and rejects subsequent snapshots', async () => {
    let release!: () => void;
    let markEntered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        markEntered();
        await gate;
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 100 });
    projector.enqueue(TENANT, source([1]));
    await entered;
    let stopped = false;
    const stop = projector.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(() => projector.enqueue(TENANT, source([2]))).toThrow('stopping');
    release();
    await stop;
    expect(projector.diagnostics()).toMatchObject({ accepting: false, pendingCanvasCount: 0 });
  });

  test('retains a failed batch for a loss-visible stop failure', async () => {
    const failure = new Error('metadata unavailable');
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async () => { throw failure; },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 100 });
    projector.enqueue(TENANT, source([1]));
    await expect(projector.stop()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });
    expect(projector.diagnostics()).toMatchObject({
      accepting: false,
      pendingCanvasCount: 0,
      quarantinedCanvasCount: 1,
      lastRejection: 'metadata unavailable',
      lastFailure: null,
    });
  });

  test('retries the same exact source sequence after an external store policy is repaired', async () => {
    let admitted = false;
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        if (!admitted) throw new Error('state document is not admitted yet');
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 100 });
    projector.enqueue(TENANT, source([1], 4));
    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });

    admitted = true;
    expect(projector.enqueue(TENANT, source([1], 4)))
      .toMatchObject({ status: 'queued', sourceSequence: 4 });
    await projector.drain();
    expect(projector.diagnostics()).toMatchObject({ quarantinedCanvasCount: 0 });
  });

  test('rejects one malformed canvas without poisoning valid canvases or corrected snapshots', async () => {
    const applied: TWidgetInstanceProjectionBatchRequest[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        applied.push(request);
        return request.snapshots.map((snapshot) => ({
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied' as const,
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }));
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 100 });
    const malformed = source([1], 1);
    const malformedElement = malformed.elements['element-1']!;
    const rejected = projector.enqueue(TENANT, {
      ...malformed,
      elements: {
        ...malformed.elements,
        'element-1': {
          ...malformedElement,
          data: { ...malformedElement.data, instanceId: 'peer-controlled-invalid-id' },
        },
      },
    });
    const validOtherCanvas = projector.enqueue(TENANT, {
      ...source([2], 1),
      canvasId: uuid(20),
    });
    expect(rejected).toMatchObject({ status: 'quarantined', sourceSequence: 1 });
    expect(validOtherCanvas).toMatchObject({ status: 'queued', canvasId: uuid(20) });
    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });
    expect(applied.flatMap((request) => request.snapshots)).toHaveLength(1);
    expect(applied[0]?.snapshots[0]?.canvasId).toBe(uuid(20));

    const corrected = projector.enqueue(TENANT, source([1], 2));
    expect(corrected).toMatchObject({ status: 'queued', canvasId: CANVAS_ID, sourceSequence: 2 });
    await projector.drain();
    expect(applied.flatMap((request) => request.snapshots).map((snapshot) => snapshot.canvasId))
      .toEqual([uuid(20), CANVAS_ID]);
    expect(projector.diagnostics()).toMatchObject({
      rejectedSnapshotCount: 1,
      quarantinedCanvasCount: 0,
      pendingCanvasCount: 0,
      lastFailure: null,
    });
  });

  test('isolates a conflicting store canvas, projects its neighbors, and recovers on a newer snapshot', async () => {
    const appliedScopeKeys: string[] = [];
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (tenant, request) => {
        if (request.snapshots.length > 1) throw new Error('atomic batch conflict');
        const snapshot = request.snapshots[0]!;
        if (
          tenant.orgId === TENANT.orgId
          && snapshot.canvasId === CANVAS_ID
          && snapshot.sourceSequence === 1
        ) {
          throw new Error('state ownership conflict');
        }
        appliedScopeKeys.push(`${tenant.orgId}:${snapshot.canvasId}`);
        return [{
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied',
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }];
      },
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 100 });
    projector.enqueue(TENANT, source([1], 1));
    projector.enqueue(TENANT, { ...source([2], 1), canvasId: uuid(20) });
    projector.enqueue({ ...TENANT, orgId: uuid(30) }, source([3], 1));

    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
      quarantines: [expect.objectContaining({
        orgId: TENANT.orgId,
        canvasId: CANVAS_ID,
        sourceSequence: 1,
      })],
    });
    expect(appliedScopeKeys).toEqual([
      `${TENANT.orgId}:${uuid(20)}`,
      `${uuid(30)}:${CANVAS_ID}`,
    ]);
    expect(projector.diagnostics()).toMatchObject({ quarantinedCanvasCount: 1 });

    projector.enqueue(TENANT, source([1], 2));
    await projector.drain();
    expect(appliedScopeKeys).toEqual([
      `${TENANT.orgId}:${uuid(20)}`,
      `${uuid(30)}:${CANVAS_ID}`,
      `${TENANT.orgId}:${CANVAS_ID}`,
    ]);
    expect(projector.diagnostics()).toMatchObject({ quarantinedCanvasCount: 0 });
  });

  test('records a durable stale result without counting it as applied', async () => {
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => request.snapshots.map((snapshot) => ({
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        projectedAtMs: 900,
        status: 'stale' as const,
        activeCount: 4,
        archivedCount: 0,
      })),
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 1 });
    projector.enqueue(TENANT, source([1], 3));
    await projector.drain();
    expect(projector.diagnostics()).toMatchObject({
      appliedSnapshotCount: 0,
      replayedSnapshotCount: 0,
      staleSnapshotCount: 1,
      lastFailure: null,
    });
  });

  test('bounds settled bookkeeping without evicting a retained quarantine', async () => {
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => request.snapshots.map((snapshot) => ({
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        projectedAtMs: snapshot.projectedAtMs,
        status: 'applied' as const,
        activeCount: snapshot.instances.length,
        archivedCount: 0,
      })),
    };
    const projector = new WidgetInstanceMetadataProjector(
      { store, nowMs: () => 1 },
      { maxRetainedCanvases: 2 },
    );

    for (let index = 1; index <= 5; index += 1) {
      projector.enqueue(TENANT, {
        ...source([index], index),
        canvasId: uuid(1000 + index),
      });
      await projector.drain();
    }
    const malformed = source([6], 6);
    const element = malformed.elements['element-6']!;
    projector.enqueue(TENANT, {
      ...malformed,
      canvasId: uuid(1006),
      elements: {
        ...malformed.elements,
        'element-6': {
          ...element,
          data: { ...element.data, instanceId: 'invalid' },
        },
      },
    });
    projector.enqueue(TENANT, { ...source([7], 7), canvasId: uuid(1007) });
    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });

    expect(projector.diagnostics()).toMatchObject({
      retainedCanvasCount: 2,
      retainedCanvasCapacity: 2,
      quarantinedCanvasCount: 1,
      quarantinedCanvases: [expect.objectContaining({ canvasId: uuid(1006) })],
    });
  });

  test('refuses to forget an evicted canvas quarantine or erase its shutdown loss signal', async () => {
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async () => [],
    };
    const projector = new WidgetInstanceMetadataProjector({ store, nowMs: () => 1 });
    const malformed = source([1], 1);
    const element = malformed.elements['element-1']!;
    projector.enqueue(TENANT, {
      ...malformed,
      elements: {
        'element-1': {
          ...element,
          data: { ...element.data, instanceId: 'invalid' },
        },
      },
    });
    await expect(projector.drain()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });

    await expect(projector.release(TENANT, CANVAS_ID)).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });
    await expect(projector.stop()).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
    });
    expect(projector.diagnostics()).toMatchObject({
      retainedCanvasCount: 1,
      quarantinedCanvasCount: 1,
    });
  });

  test('releases one settled canvas without waiting for unrelated projection traffic', async () => {
    const OTHER_CANVAS_ID = uuid(2000);
    let releaseFirst!: () => void;
    let releaseOther!: () => void;
    let markFirstEntered!: () => void;
    let markOtherEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const otherGate = new Promise<void>((resolve) => { releaseOther = resolve; });
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    const otherEntered = new Promise<void>((resolve) => { markOtherEntered = resolve; });
    const store: IWidgetInstanceMetadataProjectionStore = {
      applyProjectionBatch: async (_tenant, request) => {
        const snapshot = request.snapshots[0]!;
        if (snapshot.canvasId === CANVAS_ID) {
          markFirstEntered();
          await firstGate;
        } else {
          markOtherEntered();
          await otherGate;
        }
        return [{
          canvasId: snapshot.canvasId,
          sourceSequence: snapshot.sourceSequence,
          projectedAtMs: snapshot.projectedAtMs,
          status: 'applied',
          activeCount: snapshot.instances.length,
          archivedCount: 0,
        }];
      },
    };
    const projector = new WidgetInstanceMetadataProjector(
      { store, nowMs: () => 1 },
      { batchSize: 1 },
    );
    projector.enqueue(TENANT, source([1], 1));
    await firstEntered;
    const released = projector.release(TENANT, CANVAS_ID);
    projector.enqueue(TENANT, { ...source([2], 1), canvasId: OTHER_CANVAS_ID });
    releaseFirst();
    await otherEntered;

    await expect(Promise.race([
      released.then(() => 'released'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ])).resolves.toBe('released');
    expect(projector.diagnostics()).toMatchObject({
      inFlightSnapshotCount: 1,
      retainedCanvasCount: 0,
    });

    releaseOther();
    await projector.drain();
  });
});
