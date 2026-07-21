import type {
  TActorDefinition,
  TActorInstance,
  TCanvas,
  TFilesystem,
  TMediaFile,
  TToolGroup,
} from '@vibecanvas/service-db/model';

export type TActorDatabaseCapability = {
  actor: {
    getDefinition(name: string): Promise<TActorDefinition | null>;
    getInstanceByElementId(elementId: string): Promise<TActorInstance | null>;
    getInstanceById(instanceId: string): Promise<TActorInstance | null>;
    listDefinitions(): Promise<TActorDefinition[]>;
  };
};

export type TCanvasDatabaseCapability = {
  canvas: {
    create(args: Omit<TCanvas, 'created_at'>, scope?: { accountId?: string }): Promise<TCanvas>;
    deleteById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas[]>;
    findById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    findByName(args: { name: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    listAll(args?: { accountId?: string }): Promise<TCanvas[]>;
    renameById(args: { id: string; name: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
  };
};

export type TFileDatabaseCapability = {
  file: {
    create(args: Omit<TMediaFile, 'created_at'>): Promise<TMediaFile>;
    deleteById(args: { id: string }): Promise<void>;
    getById(args: { id: string }): Promise<TMediaFile | null>;
  };
};

export type TFilesystemDatabaseCapability = {
  filesystem: {
    listAll(): Promise<TFilesystem[]>;
  };
};

export type TToolGroupDatabaseCapability = {
  toolGroup: {
    create(args: TToolGroup): Promise<TToolGroup>;
    getByName(args: { name: string }): Promise<TToolGroup | null>;
    listAll(): Promise<TToolGroup[]>;
    remove(args: { name: string }): Promise<TToolGroup | null>;
    update(args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
  };
};
