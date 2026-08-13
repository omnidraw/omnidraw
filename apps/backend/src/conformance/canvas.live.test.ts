import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { LiveDatabase } from '../shell/runtime/service.live-mechanics';
import {
  canvasAuthorityConformanceFixture,
  runCanvasAuthorityConformance,
} from './canvas.suite';
import { createLiveMechanicsConformanceRuntime } from './tests/live-mechanics.fixture';

describe('Canvas authority live conformance', () => {
  test('runs shared semantics through production CanvasService, Turso store, SQL, and row codecs', async () => {
    const fixture = await createLiveMechanicsConformanceRuntime('canvas-live');
    const canvas = canvasAuthorityConformanceFixture();
    try {
      const result = await fixture.runtime.runPromise(Effect.gen(function*() {
        const database = yield* LiveDatabase;
        yield* Effect.promise(() => database.canvas.create({
          id: canvas.canvasId,
          name: 'Canvas conformance',
        }));
        return yield* runCanvasAuthorityConformance({ canvasId: canvas.canvasId });
      }));
      expect(result.snapshot.revision).toBe(8);
      expect(result.commandMatrix.map((event) => event.revision)).toEqual([2, 3, 4, 5, 6, 7, 8]);
      expect(result.duplicate).toEqual(result.first);
      expect(result.replayed).toEqual(result.first);
      expect(result.resync).toEqual({
        type: 'resync-required',
        canvasId: canvas.canvasId,
        revision: 8,
      });
    } finally {
      await fixture.dispose();
    }
  });
});
