/**
 * @file Legacy actor-resource error aliases. New code imports the neutral resource runtime.
 */
export {
  ResourceError as ActorResourceError,
  toResourceError as toActorResourceError,
  toSafeResourceError as toSafeActorResourceError,
} from '@vibecanvas/resource-runtime';
export type { TResourceErrorCode as TActorResourceErrorCode } from '@vibecanvas/resource-runtime';
