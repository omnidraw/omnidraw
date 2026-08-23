import { describe, expect, test } from 'bun:test';
import { CanvasDeletionError } from '#backend/core/canvas/service.canvas-deletion';
import {
  assertOperationIdempotency,
  privateOperationContract,
} from '#backend/shell/transport/operation-contract';
import { privateRpcError } from '#backend/shell/transport/private-rpc-error';

const plan = {
  canvas: {
    id: 'canvas-a',
    name: 'Canvas A',
    revision: 7,
    createdAtSec: '2026-08-14 10:00:00',
    updatedAtSec: '2026-08-14 10:01:00',
  },
  itemCount: 4,
  mediaCount: 2,
  retainedChatCount: 1,
} as const;

describe('Canvas deletion private API contract', () => {
  test('exposes semantic planning and idempotent deletion adapters with exact consequences', () => {
    const planning = privateOperationContract('canvas.deletionPlan');
    const deletion = privateOperationContract('canvas.remove');
    expect(planning).toMatchObject({ mode: 'request', adapter: { kind: 'core' } });
    expect(deletion).toMatchObject({
      mode: 'request',
      adapter: { kind: 'core' },
      idempotency: { inputKey: 'deletionId', frontendReplay: true },
    });
    expect(planning?.decodeInput({ canvasId: 'canvas-a' })).toEqual({ canvasId: 'canvas-a' });
    expect(deletion?.decodeOutput({ canvas: plan.canvas, cleanup: {
      itemCount: 4,
      mediaCount: 2,
      retainedChatCount: 1,
    } })).toMatchObject({ canvas: { id: 'canvas-a', revision: 7 } });
    expect(() => assertOperationIdempotency(
      deletion!,
      { deletionId: 'delete-a', plan },
      'different-id',
    )).toThrow('deletionId');
  });

  test.each([
    ['CANVAS_DELETE_NOT_FOUND', 404],
    ['CANVAS_DELETE_STALE', 409],
    ['CANVAS_DELETE_BUSY', 409],
    ['CANVAS_DELETE_COORDINATION_FAILED', 503],
  ] as const)('maps %s to a bounded typed transport failure', (code, status) => {
    expect(privateRpcError(new CanvasDeletionError(code, 'safe failure', { canvasId: 'canvas-a' })))
      .toMatchObject({ code, status, message: 'safe failure', details: { canvasId: 'canvas-a' } });
  });
});
