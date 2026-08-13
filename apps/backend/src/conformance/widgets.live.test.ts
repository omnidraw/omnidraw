import { describe, expect, test } from 'bun:test';
import { Effect, Stream } from 'effect';
import { WidgetAuthority } from '../core/widgets/service.widgets';
import { widgetAuthorityFromLive } from '../shell/runtime/layer.semantic-authorities';
import { runWidgetsConformance } from './widgets.suite';

function liveCatalog() {
  let generation = 1;
  let published = false;
  const listeners = new Set<(event: Readonly<{
    previousGeneration: number | null;
    generation: number;
    changedWidgetKeys: readonly string[];
    previewWidgetKeys: readonly string[];
  }>) => void>();
  const snapshot = () => ({
    format: 'omnidraw.widget-catalog.v1',
    generation,
    digestSha256: `catalog-${generation}`,
    rootIdentity: 'conformance-root',
    healthy: true,
    issues: [],
    entries: { counter: {
      slug: 'counter',
      health: 'healthy',
      placeable: published,
      draft: { manifestDigestSha256: 'manifest-1' },
      published: published ? { health: 'healthy' } : null,
    } },
  });
  return {
    current: snapshot,
    async buildAndPublish(request: Readonly<{
      expectedCatalogDigestSha256: string;
      expectedManifestDigestSha256: string;
    }>) {
      if (
        request.expectedCatalogDigestSha256 !== `catalog-${generation}`
        || request.expectedManifestDigestSha256 !== 'manifest-1'
      ) throw Object.assign(new Error('Catalog changed.'), { code: 'WIDGET_CATALOG_CHANGED' });
      const previousGeneration = generation;
      generation += 1;
      published = true;
      const next = snapshot();
      for (const listener of listeners) listener({
        previousGeneration,
        generation,
        changedWidgetKeys: ['counter'],
        previewWidgetKeys: [],
      });
      return { widgetKey: 'counter', generation, catalogDigestSha256: next.digestSha256, snapshot: next };
    },
    subscribe(listener: (event: Readonly<{
      previousGeneration: number | null;
      generation: number;
      changedWidgetKeys: readonly string[];
      previewWidgetKeys: readonly string[];
    }>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe('widgets live conformance', () => {
  test('runs shared publication/replay semantics through the production catalog adapter', async () => {
    const authority = widgetAuthorityFromLive(liveCatalog() as never);
    try {
      const result = await Effect.runPromise(runWidgetsConformance().pipe(
        Effect.provideService(WidgetAuthority, authority),
      ));
      expect(result).toEqual({
        generation: 2,
        replayGeneration: 2,
        conflictCode: 'WIDGET_CATALOG_CHANGED',
        terminalCode: 'WIDGET_CURSOR_INVALID',
      });
    } finally {
      authority.close();
    }
  });

  test('terminates a pre-restart publication cursor when volatile history is gone', async () => {
    const catalog = liveCatalog();
    const beforeRestart = widgetAuthorityFromLive(catalog as never);
    const entry = (await Effect.runPromise(beforeRestart.catalog()))[0]!;
    const published = await Effect.runPromise(beforeRestart.publish({
      widgetKey: entry.widgetKey,
      expectedGeneration: entry.generation,
      expectedCatalogDigestSha256: entry.catalogDigestSha256,
      expectedManifestDigestSha256: entry.draftManifestDigestSha256!,
    }));
    beforeRestart.close();

    const restarted = widgetAuthorityFromLive(catalog as never);
    try {
      const stream = await Effect.runPromise(restarted.events({
        afterGeneration: published.generation,
      }));
      const failure = await Effect.runPromise(Stream.runHead(stream).pipe(Effect.flip));
      expect(failure.code).toBe('WIDGET_CURSOR_INVALID');
    } finally {
      restarted.close();
    }
  });
});
