import { Effect, Stream } from 'effect';
import { fxWidgetCatalog } from '../core/widgets/fx.catalog';
import { fxWidgetEvents } from '../core/widgets/fx.events';
import { txPublishWidget } from '../core/widgets/tx.publish';
import type { WidgetAuthority } from '../core/widgets/service.widgets';

export function runWidgetsConformance(): Effect.Effect<
  Readonly<{
    generation: number;
    replayGeneration: number;
    conflictCode: string;
    terminalCode: string;
  }>,
  unknown,
  WidgetAuthority
> {
  return Effect.gen(function*() {
    const catalog = yield* fxWidgetCatalog();
    const entry = catalog.find((value) => value.widgetKey === 'counter');
    if (entry === undefined || entry.draftManifestDigestSha256 === null) {
      return yield* Effect.die('Widget fixture is missing its publishable draft.');
    }
    const published = yield* txPublishWidget({
      widgetKey: entry.widgetKey,
      expectedGeneration: entry.generation,
      expectedCatalogDigestSha256: entry.catalogDigestSha256,
      expectedManifestDigestSha256: entry.draftManifestDigestSha256,
    });
    const events = yield* fxWidgetEvents({ afterGeneration: entry.generation });
    const replay = yield* Stream.runHead(events);
    const conflict = yield* Effect.flip(txPublishWidget({
      widgetKey: entry.widgetKey,
      expectedGeneration: entry.generation,
      expectedCatalogDigestSha256: entry.catalogDigestSha256,
      expectedManifestDigestSha256: entry.draftManifestDigestSha256,
    }));
    const futureEvents = yield* fxWidgetEvents({ afterGeneration: published.generation + 100 });
    const terminal = yield* Effect.flip(Stream.runHead(futureEvents));
    if (replay._tag !== 'Some') return yield* Effect.die('Widget publication replay is missing.');
    return {
      generation: published.generation,
      replayGeneration: replay.value.generation,
      conflictCode: conflict.code,
      terminalCode: terminal.code,
    };
  });
}
