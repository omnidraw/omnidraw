import type {
  TActorDefinition,
  TActorInstance,
  TCanvas,
  TFilesystem,
  TMediaFile,
  TToolGroup,
} from '@vibecanvas/service-db/model';
import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TActorDatabaseCapability = {
  actor: {
    getDefinition(tenant: TTenantContext, name: string): Promise<TActorDefinition | null>;
    getInstanceByElementId(tenant: TTenantContext, elementId: string): Promise<TActorInstance | null>;
    getInstanceById(tenant: TTenantContext, instanceId: string): Promise<TActorInstance | null>;
    listDefinitions(tenant: TTenantContext): Promise<TActorDefinition[]>;
  };
};

export type TCanvasDatabaseCapability = {
  canvas: {
    create(tenant: TTenantContext, args: Omit<TCanvas, 'created_at'>): Promise<TCanvas>;
    deleteById(tenant: TTenantContext, args: { id: string }): Promise<TCanvas[]>;
    findById(tenant: TTenantContext, args: { id: string }): Promise<TCanvas | null>;
    findByName(tenant: TTenantContext, args: { name: string }): Promise<TCanvas | null>;
    listAll(tenant: TTenantContext): Promise<TCanvas[]>;
    renameById(tenant: TTenantContext, args: { id: string; name: string }): Promise<TCanvas | null>;
  };
};

export type TFileDatabaseCapability = {
  file: {
    create(tenant: TTenantContext, args: Omit<TMediaFile, 'created_at'>): Promise<TMediaFile>;
    deleteById(tenant: TTenantContext, args: { id: string }): Promise<void>;
    getById(tenant: TTenantContext, args: { id: string }): Promise<TMediaFile | null>;
  };
};

export type TFilesystemDatabaseCapability = {
  filesystem: {
    listAll(tenant: TTenantContext): Promise<TFilesystem[]>;
  };
};

export type TToolGroupDatabaseCapability = {
  toolGroup: {
    create(tenant: TTenantContext, args: TToolGroup): Promise<TToolGroup>;
    getByName(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
    listAll(tenant: TTenantContext): Promise<TToolGroup[]>;
    remove(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
    update(tenant: TTenantContext, args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
  };
};
