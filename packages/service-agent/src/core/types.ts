import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TActorResourceCall, TActorResourceDataMutationResult, TActorResourceDataPage, TActorResourceDirectBinding, TDbCellValue, TDbInspection, TDbLiveSqlResult } from '@vibecanvas/service-actor/resources/resource-types';
import type { TActorResource, TActorResourceBinding, TDbResourceApplyRun, TJson } from '@vibecanvas/service-db/model';

export type TValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type TActorServiceReloader = {
  reload(): Promise<void>;
  getVibecanvasJson?(defId: string): (TVibecanvasJson & { manifest_path: string }) | null;
  reloadDefinitionInstances?(definitionName: string): Promise<void>;
  listResources?(filter?: { kind?: TActorResource['kind']; status?: TActorResource['status'] }): Promise<TActorResource[]>;
  getResource?(id: string): Promise<TActorResource | null>;
  resolveResourceByName?(resourceName: string, options: { requireReady: boolean; kind?: TActorResource['kind'] }): Promise<TActorResource>;
  createResource?(args: { kind: TActorResource['kind']; name: string }): Promise<TActorResource>;
  renameResource?(args: { id: string; name: string }): Promise<TActorResource>;
  deleteResource?(id: string): Promise<void>;
  listResourceReferences?(resourceId: string): Promise<unknown[]>;
  countResourceData?(args: { resourceId: string; prefix?: string; search?: string }): Promise<number>;
  listResourceData?(args: { resourceId: string; prefix?: string; search?: string; cursor?: string; limit?: number }): Promise<TActorResourceDataPage>;
  getResourceDataEntry?(args: { resourceId: string; key: string }): Promise<
    | { kind: 'kv'; key: string; value: TJson; revision: number; createdAt: string; updatedAt: string }
    | { kind: 'secretStore'; name: string; revision: number; createdAt: string; updatedAt: string }
    | null
  >;
  setResourceDataEntry?(args: { resourceId: string; key: string; expectedRevision: number | null; value: TJson }): Promise<TActorResourceDataMutationResult>;
  deleteResourceDataEntry?(args: { resourceId: string; key: string; expectedRevision: number }): Promise<{ deleted: true }>;
  inspectDbResource?(args: { resourceId: string; target: 'live'; draftId?: never }): Promise<TDbInspection | null>;
  executeDbLiveSql?(args: { resourceId: string; sql: string; parameters?: readonly TDbCellValue[] | Readonly<Record<string, TDbCellValue>>; approved: boolean }): Promise<TDbLiveSqlResult>;
  listResourceBindingsForDefinition?(definitionName: string): Promise<Pick<TActorResourceBinding, 'slot_name' | 'resource_id'>[]>;
  bindResource?(args: { definitionName: string; slot: string; resourceId: string; scope?: ('read' | 'write')[] }): Promise<unknown>;
  unbindResource?(args: { definitionName: string; slot: string }): Promise<unknown>;
  createDbDraft?(resourceId: string, name: string): Promise<{ draft: { id: string } }>;
  executeDbDraftSql?(draftId: string, sql: string, parameters?: readonly TDbCellValue[]): Promise<unknown>;
  discardDbDraft?(draftId: string): Promise<unknown>;
  previewDbApply?(draftId: string): Promise<{ warnings: string[] }>;
  confirmDbApply?(draftId: string): Promise<TDbResourceApplyRun>;
  callWithDirectResourceBinding?(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown>;
};
