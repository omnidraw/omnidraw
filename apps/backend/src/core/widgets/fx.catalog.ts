import { Effect } from 'effect';
import {
  WidgetAuthority,
  type TWidgetCatalogEntry,
  type WidgetProgramError,
} from './service.widgets';

export const fxWidgetCatalog = Effect.fn('fxWidgetCatalog')(function*(): Effect.fn.Return<readonly TWidgetCatalogEntry[], WidgetProgramError, WidgetAuthority> {
  const authority = yield* WidgetAuthority;
  return yield* authority.catalog();
});
