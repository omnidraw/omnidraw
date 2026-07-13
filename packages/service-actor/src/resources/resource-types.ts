import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TDbResourceApplyInstanceResult,
  TDbResourceApplyRun,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TJson,
} from '@vibecanvas/service-db/model';
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

export type TActorResourceDirectBinding = {
  readonly resourceId: string;
  readonly requirement: TActorResourceRequirement;
  readonly scope: TActorResourceScope;
};

export type TActorResolvedResourceCall = {
  readonly resource: TActorResource;
  readonly requirement: TActorResourceRequirement;
  readonly binding: TActorResourceBinding;
  readonly functionClass: TActorResourceFunctionClass;
  readonly slot: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
};

export type TActorResourceProviderCreateArgs = Record<never, never>;

export type TActorResourceReconciliation = {
  readonly status: 'ready' | 'error';
  readonly lastError?: TJson | null;
};

export interface IActorResourceProvider {
  readonly kind: TActorResourceKind;
  readonly reconcileReady?: boolean;
  provision(resource: TActorResource, args: TActorResourceProviderCreateArgs): Promise<void>;
  delete(resource: TActorResource): Promise<void>;
  effect(operation: string, requirement: TActorResourceRequirement, args: unknown): 'read' | 'write' | null;
  dispatch(context: TActorResolvedResourceCall, operation: string, args: unknown): Promise<unknown>;
  reconcile?(resource: TActorResource): Promise<TActorResourceReconciliation>;
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
  readonly blockedCode: string | null;
  readonly blockedMessage: string | null;
};

export type TActorResourceKvDataEntry = {
  readonly key: string;
  readonly valuePreview: string;
  readonly valueTruncated: boolean;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TActorResourceSecretDataEntry = {
  readonly name: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TActorResourceDataPage =
  | {
    readonly kind: 'kv';
    readonly entries: TActorResourceKvDataEntry[];
    readonly nextCursor: string | null;
  }
  | {
    readonly kind: 'secretStore';
    readonly entries: TActorResourceSecretDataEntry[];
    readonly nextCursor: string | null;
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

export type TDbIntegerCellValue = { readonly type: 'integer'; readonly value: string };

export type TDbCellValue =
  | { readonly type: 'null' }
  | TDbIntegerCellValue
  | { readonly type: 'real'; readonly value: number }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'blob'; readonly base64: string };

export type TDbBlobPreviewCellValue = {
  readonly type: 'blobPreview';
  readonly byteLength: number;
  readonly previewBase64: string;
  readonly truncated: boolean;
};

export type TDbPreviewCellValue = Exclude<TDbCellValue, { readonly type: 'blob' }> | TDbBlobPreviewCellValue;

export type TDbRowIdentity =
  | { readonly kind: 'primaryKey'; readonly values: Record<string, TDbCellValue> }
  | { readonly kind: 'rowid'; readonly value: TDbIntegerCellValue };

export type TDbColumn = {
  readonly name: string;
  readonly declaredType: string;
  readonly nullable: boolean;
  readonly defaultSql: string | null;
  readonly primaryKeyOrder: number | null;
  readonly hidden: boolean;
};

export type TDbIndex = {
  readonly name: string;
  readonly unique: boolean;
  readonly origin: string;
  readonly partial: boolean;
  readonly columns: { readonly name: string | null; readonly sequence: number }[];
  readonly createSql: string | null;
};

export type TDbForeignKey = {
  readonly id: number;
  readonly columns: string[];
  readonly referencedTable: string;
  readonly referencedColumns: (string | null)[];
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly match: string;
};

export type TDbTrigger = {
  readonly name: string;
  readonly createSql: string;
};

export type TDbObject = {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: TDbColumn[];
  readonly indexes: TDbIndex[];
  readonly foreignKeys: TDbForeignKey[];
  readonly triggers: TDbTrigger[];
  readonly createSql: string | null;
  readonly identity: { readonly kind: 'primaryKey'; readonly columns: string[] }
    | { readonly kind: 'rowid' }
    | null;
  readonly editable: boolean;
  readonly readOnlyReason: string | null;
};

export type TDbInspection = {
  readonly resourceId: string;
  readonly target: 'live' | 'draft';
  readonly draftId: string | null;
  readonly objects: TDbObject[];
};

export type TDbRow = {
  readonly identity: TDbRowIdentity | null;
  readonly values: Record<string, TDbCellValue>;
};

export type TDbRowPreview = {
  readonly identity: TDbRowIdentity | null;
  readonly values: Record<string, TDbPreviewCellValue>;
};

export type TDbRowsPage = {
  readonly object: TDbObject;
  readonly rows: TDbRowPreview[];
  readonly hasMore: boolean;
  readonly nextCursor: TDbRowIdentity | null;
};

export type TDbLiveSqlResult =
  | {
    readonly kind: 'rows';
    readonly columns: string[];
    readonly rows: Record<string, TDbPreviewCellValue>[];
    readonly rowCount: number;
    readonly rowsAffected: number;
    readonly truncated: boolean;
  }
  | {
    readonly kind: 'execute';
    readonly rowsAffected: number;
    readonly lastInsertRowId: TDbCellValue | null;
  };

export type TDbRowCreate = {
  readonly kind: 'create';
  readonly values: Readonly<Record<string, TDbCellValue>>;
};

export type TDbRowUpdate = {
  readonly kind: 'update';
  readonly identity: TDbRowIdentity;
  readonly values: Readonly<Record<string, TDbCellValue>>;
  readonly expectedOriginal: Readonly<Record<string, TDbCellValue>>;
};

export type TDbRowDelete = {
  readonly kind: 'delete';
  readonly identity: TDbRowIdentity;
  readonly expectedOriginal: Readonly<Record<string, TDbCellValue>>;
};

export type TDbColumnDefinition = {
  readonly name: string;
  readonly declaredType?: string;
  readonly nullable?: boolean;
  readonly defaultSql?: string | null;
  readonly primaryKeyOrder?: number | null;
};

export type TDbDraftOperation =
  | { readonly kind: 'createTable'; readonly table: string; readonly columns: readonly TDbColumnDefinition[]; readonly withoutRowid?: boolean }
  | { readonly kind: 'renameTable'; readonly table: string; readonly newName: string }
  | { readonly kind: 'dropTable'; readonly table: string }
  | { readonly kind: 'addColumn'; readonly table: string; readonly column: TDbColumnDefinition }
  | { readonly kind: 'renameColumn'; readonly table: string; readonly column: string; readonly newName: string }
  | { readonly kind: 'alterColumn'; readonly table: string; readonly column: string; readonly definition: TDbColumnDefinition }
  | { readonly kind: 'dropColumn'; readonly table: string; readonly column: string }
  | { readonly kind: 'createIndex'; readonly table: string; readonly name: string; readonly columns: readonly string[]; readonly unique?: boolean }
  | { readonly kind: 'dropIndex'; readonly name: string }
  | { readonly kind: 'createForeignKey'; readonly table: string; readonly columns: readonly string[]; readonly referencedTable: string; readonly referencedColumns: readonly string[]; readonly onUpdate?: string; readonly onDelete?: string }
  | { readonly kind: 'dropForeignKey'; readonly table: string; readonly id: number };

export type TDbResourceImpact = {
  readonly resource: TActorResource;
  readonly definitions: {
    readonly definitionName: string;
    readonly slots: {
      readonly slot: string;
      readonly scope: TActorResourceScope;
    }[];
  }[];
  readonly instances: {
    readonly instanceId: string;
    readonly definitionName: string;
    readonly status: string;
    readonly running: boolean;
  }[];
};

export type TDbDraftDetails = {
  readonly draft: TDbResourceDraft;
  readonly changes: TDbResourceDraftChange[];
};

export type TDbApplyPreview = TDbDraftDetails & {
  readonly resource: TActorResource;
  readonly impact: TDbResourceImpact;
  readonly warnings: string[];
  readonly compatibilityNotice: string;
};

export type TDbApplyDetails = {
  readonly apply: TDbResourceApplyRun;
  readonly instances: TDbResourceApplyInstanceResult[];
};

export type TDbBackup = {
  readonly resourceId: string;
  readonly applyId: string;
  readonly createdAt: string;
};
