import { Effect } from 'effect';
import type { TResourceDescriptor, TResourceId } from './types';
import { ResourceAuthority, type ResourceProgramError } from './service.resources';

export function fxGetResource(
  args: Readonly<{ resourceId: TResourceId }>,
): Effect.Effect<TResourceDescriptor | null, ResourceProgramError, ResourceAuthority> {
  return Effect.gen(function*() {
    const authority = yield* ResourceAuthority;
    return yield* authority.get(args);
  });
}
