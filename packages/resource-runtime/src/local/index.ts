/**
 * @file Node-local Resource Store implementation boundary.
 *
 * This subpath is intentionally not re-exported from the browser-safe package root.
 */

export {
  DB_RESOURCE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS,
  DB_RESOURCE_DEFAULT_MAX_OPEN_HANDLES,
  DbResource,
} from './DbResource';
export type {
  TDatabaseFactory,
  TDbDraftChangeEvidence,
  TDbResourceConfig,
} from './DbResource';
export { DbResourceCoordinator } from './DbResourceCoordinator';
export type {
  IDbResourceCoordinatorControlStore,
  IDbResourceCoordinatorManager,
  IDbResourceLifecycle,
  TDbApplyDetails,
  TDbApplyPreview,
  TDbBackup,
  TDbCoordinatorApplyInstanceResult,
  TDbCoordinatorApplyRun,
  TDbCoordinatorDraft,
  TDbCoordinatorDraftChange,
  TDbCoordinatorResource,
  TDbDraftDetails,
  TDbResourceCoordinatorConfig,
  TDbResourceStartupReconcileOptions,
  TDbResourceImpact,
} from './DbResourceCoordinator';
export { KvResource } from './KvResource';
export {
  RESOURCE_KEY_VALUE_DEFAULT_IDLE_HANDLE_TIMEOUT_MS,
  RESOURCE_KEY_VALUE_DEFAULT_MAX_OPEN_HANDLES,
  ResourceKeyValueStore,
} from './ResourceKeyValueStore';
export type {
  IResourceKeyValueDatabase,
  IResourceKeyValueStatement,
  TResourceKeyValueDatabaseFactory,
  TResourceKeyValueDatabaseOptions,
  TResourceKeyValueStoreConfig,
  TSecretStoreConversionCheckpoint,
} from './ResourceKeyValueStore';
export type {
  IResourceKeyValuePersistence,
  TResourceKeyValueCommittedOperation,
  TResourceKeyValueCompareAndSetResult,
  TResourceKeyValueDeleteResult,
  TResourceKeyValueEntry,
  TResourceKeyValueEntryMetadata,
  TResourceKeyValueIdentity,
  TResourceKeyValueKind,
  TResourceKeyValuePage,
} from './ResourceKeyValuePersistence';
export { ResourceOwnerLease, claimResourceOwner } from './ResourceOwnerLock';
export type {
  TResourceOwnerLockConfig,
  TResourceOwnerLockPortal,
} from './ResourceOwnerLock';
export {
  SECRET_STORE_DATABASE_KEY_ALGORITHM,
  SECRET_STORE_DATABASE_KEY_PURPOSE,
  SecretStoreDatabaseKeyProvider,
} from './SecretStoreKeyProvider';
export type {
  IResourceEncryptionKeyStore,
  ISecretStoreKeyProvider,
  TSecretStoreDatabaseKeyProviderConfig,
  TStoredEncryptionKey,
} from './SecretStoreKeyProvider';
export { SecretStoreResource } from './SecretStoreResource';
export type { TSecretStoreCompareAndSetResult } from './SecretStoreResource';
export type {
  ILocalResourceProvider,
  TLocalResourceCommittedOperation,
  TLocalResolvedResourceCall,
  TLocalResourceDispatchReceipt,
  TLocalResourceOperationIdentity,
  TLocalResource,
  TLocalResourceReconcileResult,
  TLocalResourceRequirement,
  TResourceIdleSweepScheduler,
} from './ResourceProviderTypes';
export { ResourceGateway, ResourceStoreService } from './ResourceStoreService';
export type {
  ILocalResourceStoreProvider,
  TResourceGatewayConfig,
  TResourceReconciliationAuthority,
  TResourceStoreCreateRequest,
  TResourceStoreServiceConfig,
} from './ResourceStoreService';
export { ResourceManager } from './ResourceManager';
export type {
  IResourceManagerStore,
  TBindResourceArgs,
  TConsumerStartAdmission,
  TCreateResourceArgs,
  TManagedResourceRequirement,
  TReplaceResourceBindingsArgs,
  TResourceBindingRecord,
  TResourceBindingStatus,
  TResourceCatalogRecord,
  TResourceDirectBinding,
  TResourceGatewayAuthorization,
  TResourceManagerCall,
  TResourceManagerConfig,
  TResourceRequirementsResolver,
  TResourceScope,
} from './ResourceManager';
export { ResourceManagerGateway } from './ResourceManagerGateway';
export type {
  TResourceManagerGatewayCallOptions,
  TResourceManagerGatewayConfig,
  TResourceManagerGatewayResourceCall,
} from './ResourceManagerGateway';
export {
  fnResourceKeyValueEntry,
  fnResourceKeyValueEntryMetadata,
  fnResourceKeyValueHostId,
  fnResourceKeyValueListLimit,
  fnResourceKeyValueParse,
  fnResourceKeyValueSerialize,
} from './fn.resource-key-value';
export {
  fnJsonValuePreview,
  fnResourceDataMutationResult,
  fnResourceDataPage,
} from './fn.resource-data';
export type {
  TResourceDataMutationResult,
  TResourceDataPage,
  TResourceKvDataEntry,
  TResourceSecretDataEntry,
} from './fn.resource-data';
