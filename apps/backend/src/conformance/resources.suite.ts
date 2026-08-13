import { Effect } from 'effect';
import { fxGetResource } from '../core/resources/fx.get';
import { fxListResources } from '../core/resources/fx.list';
import { txCreateResource } from '../core/resources/tx.create';
import type { ResourceAuthority } from '../core/resources/service.resources';

export function runResourcesConformance(): Effect.Effect<
  Readonly<{ resourceId: string; count: number; conflictCode: string }>,
  unknown,
  ResourceAuthority
> {
  return Effect.gen(function*() {
    const created = yield* txCreateResource({ kind: 'kv', name: 'Shared state' });
    const found = yield* fxGetResource({ resourceId: created.id });
    const listed = yield* fxListResources({ kind: 'kv', status: 'ready' });
    const conflict = yield* Effect.flip(txCreateResource({ kind: 'kv', name: 'Shared state' }));
    if (found?.id !== created.id || listed.length !== 1) {
      return yield* Effect.die('Resource authority violated create/get/list semantics.');
    }
    return { resourceId: created.id, count: listed.length, conflictCode: conflict.code };
  });
}
