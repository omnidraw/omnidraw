/**
 * @file Public actor-independent resource runtime contract surface.
 */

export type * from './interface';
export type * from './types';
export {
  ResourceError,
  toResourceError,
  toSafeResourceError,
} from './ResourceError';
export {
  fnResourceBindingAllows,
  fnResourceBindingDecision,
  fnResourceEffectAllows,
  fnResourceSecretRevealAllowed,
} from './core/fn.resource-access';
export { fnResourceStatusCanTransition } from './core/fn.resource-lifecycle';
export { fnResourceWriteCapabilityMatches } from './core/fn.write-capability';
