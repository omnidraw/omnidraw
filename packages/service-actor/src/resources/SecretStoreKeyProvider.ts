/**
 * @file Legacy actor-resource aliases for neutral secret-store key custody.
 */
export {
  SECRET_STORE_DATABASE_KEY_ALGORITHM,
  SECRET_STORE_DATABASE_KEY_PURPOSE,
  SecretStoreDatabaseKeyProvider,
} from '@vibecanvas/resource-runtime/local';
export type {
  IResourceEncryptionKeyStore as IActorResourceEncryptionKeyStore,
  ISecretStoreKeyProvider,
  TSecretStoreDatabaseKeyProviderConfig,
  TStoredEncryptionKey,
} from '@vibecanvas/resource-runtime/local';
