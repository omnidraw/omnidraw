import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TActorResourceCall, TActorResourceDirectBinding, TDbInspection, TDbLiveSqlResult } from '@vibecanvas/service-actor/resources/resource-types';
import type { TActorResource, TActorResourceBinding, TDbResourceApplyRun } from '@vibecanvas/service-db/model';

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
  inspectDbResource?(args: { resourceId: string; target: 'live'; draftId?: never }): Promise<TDbInspection | null>;
  executeDbLiveSql?(args: { resourceId: string; sql: string; approved: false }): Promise<TDbLiveSqlResult>;
  listResourceBindingsForDefinition?(definitionName: string): Promise<Pick<TActorResourceBinding, 'slot_name' | 'resource_id'>[]>;
  bindResource?(args: { definitionName: string; slot: string; resourceId: string; scope?: ('read' | 'write')[] }): Promise<unknown>;
  unbindResource?(args: { definitionName: string; slot: string }): Promise<unknown>;
  createDbDraft?(resourceId: string, name: string): Promise<{ draft: { id: string } }>;
  executeDbDraftSql?(draftId: string, sql: string): Promise<unknown>;
  discardDbDraft?(draftId: string): Promise<unknown>;
  previewDbApply?(draftId: string): Promise<{ warnings: string[] }>;
  confirmDbApply?(draftId: string): Promise<TDbResourceApplyRun>;
  callWithDirectResourceBinding?(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown>;
};
