import type {
  TDbCellValue,
  TDbInspection,
  TDbLiveSqlResult,
  TResourceJson,
} from '@vibecanvas/resource-runtime';
import type {
  TResourceCatalogRecord,
  TResourceDataMutationResult,
  TResourceDataPage,
} from '@vibecanvas/resource-runtime/local';

export type TAgentResource = TResourceCatalogRecord;

export type TAgentResourceDataEntry =
  | Readonly<{
    kind: 'kv';
    key: string;
    value: TResourceJson;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>
  | Readonly<{
    kind: 'secretStore';
    name: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }>;

/**
 * Tenant-confined resource capability consumed by AI tools.
 *
 * The host binds tenant identity before injection. Optional members let each
 * tool fail closed when a deployment intentionally omits an operation.
 */
export interface TAgentResourceService {
  listResources?(
    filter?: Readonly<{ kind?: TAgentResource['kind']; status?: TAgentResource['status'] }>,
  ): Promise<readonly TAgentResource[]>;
  getResource?(resourceId: string): Promise<TAgentResource | null>;
  resolveResourceByName?(
    resourceName: string,
    options: Readonly<{ requireReady: boolean; kind?: TAgentResource['kind'] }>,
  ): Promise<TAgentResource>;
  createResource?(request: Readonly<{ kind: TAgentResource['kind']; name: string }>): Promise<TAgentResource>;
  renameResource?(request: Readonly<{ id: string; name: string }>): Promise<TAgentResource>;
  deleteResource?(resourceId: string): Promise<void>;
  listResourceReferences?(resourceId: string): Promise<readonly unknown[]>;
  countResourceData?(request: Readonly<{ resourceId: string; prefix?: string; search?: string }>): Promise<number>;
  listResourceData?(request: Readonly<{
    resourceId: string;
    prefix?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }>): Promise<TResourceDataPage>;
  getResourceDataEntry?(request: Readonly<{
    resourceId: string;
    key: string;
  }>): Promise<TAgentResourceDataEntry | null>;
  setResourceDataEntry?(request: Readonly<{
    resourceId: string;
    key: string;
    expectedRevision: number | null;
    value: TResourceJson;
  }>): Promise<TResourceDataMutationResult>;
  deleteResourceDataEntry?(request: Readonly<{
    resourceId: string;
    key: string;
    expectedRevision: number;
  }>): Promise<Readonly<{ deleted: true }>>;
  inspectDbResource?(request: Readonly<{
    resourceId: string;
    target: 'live';
    draftId?: never;
  }>): Promise<TDbInspection | null>;
  executeDbLiveSql?(request: Readonly<{
    resourceId: string;
    sql: string;
    parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>;
    approved: boolean;
  }>): Promise<TDbLiveSqlResult>;
  createDbDraft?(resourceId: string, name: string): Promise<Readonly<{ draft: Readonly<{ id: string }> }>>;
  executeDbDraftSql?(draftId: string, sql: string, parameters?: readonly TDbCellValue[]): Promise<unknown>;
  discardDbDraft?(draftId: string): Promise<unknown>;
  previewDbApply?(draftId: string): Promise<Readonly<{ warnings: readonly string[] }>>;
  confirmDbApply?(draftId: string): Promise<Readonly<{ id: string; status: string }>>;
}
