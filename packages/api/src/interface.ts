import type {
  TCanvas,
  TMediaFile,
  TToolGroup,
} from '@vibecanvas/service-db/model';
import type { TTenantContext } from '@vibecanvas/tenant-core';

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

export type TToolGroupDatabaseCapability = {
  toolGroup: {
    create(tenant: TTenantContext, args: TToolGroup): Promise<TToolGroup>;
    getByName(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
    listAll(tenant: TTenantContext): Promise<TToolGroup[]>;
    remove(tenant: TTenantContext, args: { name: string }): Promise<TToolGroup | null>;
    update(tenant: TTenantContext, args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
  };
};
