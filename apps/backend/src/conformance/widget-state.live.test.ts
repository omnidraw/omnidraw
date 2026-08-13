import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { LiveCanvas, LiveDatabase } from '../shell/runtime/service.live-mechanics';
import {
  WIDGET_STATE_CONFORMANCE_IDENTITY,
  runWidgetStateConformance,
} from './widget-state.suite';
import { createLiveMechanicsConformanceRuntime } from './tests/live-mechanics.fixture';

describe('widget-state live conformance', () => {
  test('runs shared CAS/replay semantics through production Turso authorization and state store', async () => {
    const fixture = await createLiveMechanicsConformanceRuntime('widget-state-live');
    try {
      const result = await fixture.runtime.runPromise(Effect.gen(function*() {
        const database = yield* LiveDatabase;
        const canvas = yield* LiveCanvas;
        yield* Effect.promise(() => database.canvas.create({
          id: WIDGET_STATE_CONFORMANCE_IDENTITY.canvasId,
          name: 'Widget-state conformance',
        }));
        yield* Effect.promise(() => canvas.execute({
          commandId: 'place-widget-state-fixture',
          canvasId: WIDGET_STATE_CONFORMANCE_IDENTITY.canvasId,
          baseRevision: 0,
          preconditions: [{
            type: 'item-absent',
            itemId: WIDGET_STATE_CONFORMANCE_IDENTITY.elementId,
          }],
          operations: [{
            type: 'insert',
            item: {
              id: WIDGET_STATE_CONFORMANCE_IDENTITY.elementId,
              kind: 'widget-frame',
              parentId: null,
              orderKey: 'a',
              transform: {
                position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
                skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
              },
              size: { width: 320, height: 240 },
              extensions: { 'omnidraw:widget': {
                schemaVersion: 1,
                type: 'widget-instance',
                instanceId: WIDGET_STATE_CONFORMANCE_IDENTITY.widgetInstanceId,
                widgetKey: 'counter',
              } },
            },
          }],
        }));
        return yield* runWidgetStateConformance();
      }));
      expect(result).toEqual({
        version: 2,
        conflictVersion: 2,
        replayVersion: 2,
        futureResyncVersion: 2,
      });
    } finally {
      await fixture.dispose();
    }
  });
});
