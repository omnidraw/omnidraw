import { Effect } from 'effect';
import type { TResourceDescriptor, TResourceKind } from './types';
import { ResourceAuthority, type ResourceProgramError } from './service.resources';

export type TArgsCreateResource = Readonly<{ kind: TResourceKind; name: string }>;

export function txCreateResource(
  args: TArgsCreateResource,
): Effect.Effect<TResourceDescriptor, ResourceProgramError, ResourceAuthority> {
  return Effect.gen(function*() {
    const authority = yield* ResourceAuthority;
    return yield* authority.create(args);
  });
}
