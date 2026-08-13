import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { layerWidgetAuthoritySim } from '../sim/layer.domain-authorities.sim';
import { runWidgetsConformance } from './widgets.suite';

describe('widgets simulation conformance', () => {
  test('runs shared catalog/publication/replay semantics against deterministic simulation', async () => {
    const result = await Effect.runPromise(runWidgetsConformance().pipe(Effect.provide(
      layerWidgetAuthoritySim({ entries: [{
        widgetKey: 'counter', generation: 1, available: false,
        catalogDigestSha256: 'sim-catalog-1',
        draftManifestDigestSha256: 'sim-manifest-1',
      }] }),
    )));
    expect(result).toEqual({
      generation: 2,
      replayGeneration: 2,
      conflictCode: 'WIDGET_CATALOG_CHANGED',
      terminalCode: 'WIDGET_CURSOR_INVALID',
    });
  });
});
