import { Effect } from 'effect';
import type { TResourceDescriptor, TResourceKind } from './types';
import { ResourceAuthority, type ResourceProgramError } from './service.resources';

export type TArgsCreateResource = Readonly<{ kind: TResourceKind; name: string }>;

export const txCreateResource = Effect.fn('txCreateResource')(function*(
  args: TArgsCreateResource,
): Effect.fn.Return<TResourceDescriptor, ResourceProgramError, ResourceAuthority> {
  const authority = yield* ResourceAuthority;
  return yield* authority.create(args);
});
