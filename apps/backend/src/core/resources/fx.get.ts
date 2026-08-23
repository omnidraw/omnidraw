import { Effect } from 'effect';
import type { TResourceDescriptor, TResourceId } from './types';
import { ResourceAuthority, type ResourceProgramError } from './service.resources';

export type TArgsGetResource = Readonly<{ resourceId: TResourceId }>;

export const fxGetResource = Effect.fn('fxGetResource')(function*(
  args: TArgsGetResource,
): Effect.fn.Return<TResourceDescriptor | null, ResourceProgramError, ResourceAuthority> {
  const authority = yield* ResourceAuthority;
  return yield* authority.get(args);
});
