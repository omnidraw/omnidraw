import { Effect } from 'effect';
import type { TResourceDescriptor } from './types';
import {
  ResourceAuthority,
  type ResourceProgramError,
  type TResourceCatalogFilter,
} from './service.resources';

export function fxListResources(
  args: TResourceCatalogFilter,
): Effect.Effect<readonly TResourceDescriptor[], ResourceProgramError, ResourceAuthority> {
  return Effect.gen(function*() {
    const authority = yield* ResourceAuthority;
    return yield* authority.list(args);
  });
}
