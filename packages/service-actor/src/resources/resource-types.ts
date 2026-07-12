import type { TActorResource, TActorResourceBinding, TActorResourceKind, TDbResourceConfiguration, TJson } from '@vibecanvas/service-db/model';
import type { TActorResourceRequirement, TActorResourceScope, TVibecanvasJson } from '../core/types';

export type TActorResourceFunctionClass = 'fn' | 'fx' | 'tx';

export type TActorResourceCall = {
  readonly actorId: string;
  readonly definitionName: string;
  readonly runId: number;
  readonly functionClass: TActorResourceFunctionClass;
  readonly slot: string;
  readonly kind: TActorResourceKind;
  readonly operation: string;
  readonly args: unknown;
};

export type TActorResourceGateway = (call: TActorResourceCall) => Promise<unknown>;

export type TActorResolvedResourceCall = {
  readonly resource: TActorResource;
  readonly requirement: TActorResourceRequirement;
  readonly binding: TActorResourceBinding;
  readonly functionClass: TActorResourceFunctionClass;
  readonly slot: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
};

export type TActorResourceProviderCreateArgs = {
  readonly db?: { readonly schemaId: string; readonly version: number };
};

export type TActorResourceReconciliation = {
  readonly status: 'ready' | 'error';
  readonly lastError?: TJson | null;
};

export interface IActorResourceProvider {
  readonly kind: TActorResourceKind;
  provision(resource: TActorResource, args: TActorResourceProviderCreateArgs): Promise<void>;
  delete(resource: TActorResource): Promise<void>;
  effect(operation: string, requirement: TActorResourceRequirement, args: unknown): 'read' | 'write' | null;
  dispatch(context: TActorResolvedResourceCall, operation: string, args: unknown): Promise<unknown>;
  reconcile?(resource: TActorResource): Promise<TActorResourceReconciliation>;
  compatibility?(requirement: TActorResourceRequirement, resource: TActorResource): Promise<{
    readonly compatible: boolean;
    readonly code?: string;
    readonly message?: string;
    readonly actualSchemaId?: string | null;
    readonly actualVersion?: number | null;
    readonly targetVersion?: number | null;
  }>;
  close?(): Promise<void>;
}

export type TActorResourceBindingStatus = {
  readonly slot: string;
  readonly requirement: TActorResourceRequirement;
  readonly bound: boolean;
  readonly resource: TActorResource | null;
  readonly requestedScope: TActorResourceScope;
  readonly bindingScope: TActorResourceScope | null;
  readonly scopeValid: boolean;
  readonly kindMatches: boolean;
  readonly ready: boolean;
  readonly compatible: boolean;
  readonly blockedCode: string | null;
  readonly blockedMessage: string | null;
  readonly expectedSchemaId?: string | null;
  readonly expectedVersion?: number | null;
  readonly actualSchemaId?: string | null;
  readonly actualVersion?: number | null;
  readonly targetVersion?: number | null;
  readonly schemaMatches?: boolean;
  readonly versionMatches?: boolean;
};

export type TActorStartAdmission = {
  readonly allowed: boolean;
  readonly hadBlocks: boolean;
  readonly shouldRestart: boolean;
  readonly resolvedBlockResourceIds: readonly string[];
  readonly code: string | null;
  readonly message: string | null;
};

export type TActorManifestResolver = (definitionName: string) => (TVibecanvasJson & { readonly manifest_path?: string }) | null;

export type TDbResourceMigrationPreview = {
  readonly resource: TActorResource;
  readonly configuration: TDbResourceConfiguration;
  readonly targetVersion: number;
  readonly affectedDefinitions: {
    readonly definitionName: string;
    readonly slots: string[];
    readonly expectedSchemaId: string | null;
    readonly expectedVersion: number | null;
    readonly compatibleAfterMigration: boolean;
  }[];
  readonly affectedInstances: {
    readonly instanceId: string;
    readonly definitionName: string;
    readonly status: string;
    readonly running: boolean;
    readonly restartWhenCompatible: boolean;
  }[];
};
