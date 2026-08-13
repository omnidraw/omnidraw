import { Effect } from 'effect';
import type { TResourceDescriptor } from './types';
import {
  ResourceAuthority,
  type ResourceProgramError,
  type TResourceCatalogFilter,
} from './service.resources';

export const fxListResources = Effect.fn('fxListResources')(function*(
  args: TResourceCatalogFilter,
): Effect.fn.Return<readonly TResourceDescriptor[], ResourceProgramError, ResourceAuthority> {
  const authority = yield* ResourceAuthority;
  return yield* authority.list(args);
});
