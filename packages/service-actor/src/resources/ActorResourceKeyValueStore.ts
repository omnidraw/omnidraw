/**
 * @file Legacy actor-resource adapter that injects the host Turso database implementation.
 */
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import {
  RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS,
  RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES,
  ResourceKeyValueStore,
  type IResourceKeyValueDatabase,
  type TResourceKeyValueDatabaseOptions,
  type TResourceKeyValueStoreConfig,
  type TSecretStoreConversionCheckpoint,
} from '@vibecanvas/resource-runtime/local';

export const ACTOR_RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES = RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES;
export const ACTOR_RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS = RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS;

export type TActorResourceKeyValueDatabaseFactory = (
  databasePath: string,
  options: ConstructorParameters<typeof Database>[1],
) => Database;

export type TActorResourceKeyValueStoreConfig = Omit<TResourceKeyValueStoreConfig, 'databaseFactory'> & {
  readonly databaseFactory?: TActorResourceKeyValueDatabaseFactory;
};

export { type TSecretStoreConversionCheckpoint };

export class ActorResourceKeyValueStore extends ResourceKeyValueStore {
  constructor(config: TActorResourceKeyValueStoreConfig) {
    const databaseFactory = config.databaseFactory
      ?? ((databasePath: string, options: ConstructorParameters<typeof Database>[1]) => new Database(databasePath, options));
    super({
      ...config,
      databaseFactory: (databasePath: string, options: TResourceKeyValueDatabaseOptions) => (
        databaseFactory(
          databasePath,
          options as unknown as ConstructorParameters<typeof Database>[1],
        ) as unknown as IResourceKeyValueDatabase
      ),
    });
  }
}
