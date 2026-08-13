import { Effect } from 'effect';
import {
  WidgetAuthority,
  type TWidgetCatalogEntry,
  type WidgetProgramError,
} from './service.widgets';

export function fxWidgetCatalog(): Effect.Effect<readonly TWidgetCatalogEntry[], WidgetProgramError, WidgetAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetAuthority;
    return yield* authority.catalog();
  });
}
