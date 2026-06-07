import { Database } from "@tursodatabase/database";
import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import path from "node:path";
import type { IDbConfig } from "../interface";
import type { TActorConnection, TActorDefinition, TActorInstance, TCanvas, TCanvasMember, TFile, TFilesystem } from "../model";
import { fxAccountGetDefaultOwner } from "./fx.account";
import { fxCanvasFindById, fxCanvasFindByName, fxCanvasListAll, fxCanvasListMembers } from "./fx.canvas";
import { fxFileGetById, fxFileListAll } from "./fx.file";
import { fxFilesystemFindById, fxFilesystemListAll } from "./fx.filesystem";
import { txAccountEnsureDefaultOwner } from "./tx.account";
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";
import { txFileCreate, txFileDeleteById } from "./tx.file";
import { txFilesystemCreate } from "./tx.filesystem";
import { txRunMigrations } from "./tx.migrations";
import { txDefaultRunPragmas } from "./tx.pragma";

type TCanvasCreateArgs = Omit<TCanvas, "created_at">;
type TFileCreateArgs = Omit<TFile, "created_at">
type TFilesystemCreateArgs = Omit<TFilesystem, "created_at" | "updated_at">;
type TActorDefinitionCreateArgs = Omit<TActorDefinition, "created_at" | "updated_at">;
type TActorDefinitionUpdateArgs = Omit<TActorDefinition, "id" | "created_at" | "updated_at">;
type TActorInstanceCreateArgs = Omit<TActorInstance, "created_at" | "updated_at">;
type TActorInstanceUpdateStatusArgs = Pick<TActorInstance, "id" | "status">;
type TActorInstanceUpdateMachineArgs = Pick<TActorInstance, "id" | "machine_context" | "machine_state">;
type TActorConnectionCreateArgs = Omit<TActorConnection, "created_at" | "updated_at">;


/**
 * Interface follows same pattern.
 * args, accountId?
 * If no accountId -> no authz check -> auto pass
 */
interface IPublicMethods {
  canvas: {
    listAll(args?: { accountId?: string }): Promise<TCanvas[]>;
    findByName(args: { name: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    findById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    create(args: TCanvasCreateArgs, scope?: { accountId?: string }): Promise<TCanvas>;
    renameById(args: { id: string, name: string}, scope?: { accountId?: string }): Promise<TCanvas | null>;
    deleteById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas[]>;
    listMembers(args: { canvasId: string }, accountId?: string): Promise<TCanvasMember[]>;
  };
  file: {
    listAll(): Promise<TFile[]>;
    create(args: TFileCreateArgs): Promise<TFile>;
    getById(args: { id: string }): Promise<TFile | null>;
    deleteById(args: { id: string }): Promise<void>;
  };
  filesystem: {
    listAll(): Promise<TFilesystem[]>;
    findById(id: string): Promise<TFilesystem | null>;
    create(args: TFilesystemCreateArgs): Promise<TFilesystem>;
  };
  actor: {
    listDefinitions(): Promise<TActorDefinition[]>;
    insertDefinition(def: TActorDefinitionCreateArgs): Promise<TActorDefinition>;
    deleteDefinition(id: string): Promise<void>;
    updateDefinition(def: TActorDefinitionUpdateArgs): Promise<TActorDefinition>;
    reload(): Promise<void>;
    listInstances(filter?: { canvasId?: string }): Promise<TActorInstance[]>;
    insertInstance(instance: TActorInstanceCreateArgs): Promise<TActorInstance>;
    updateInstanceStatus(instance: TActorInstanceUpdateStatusArgs): Promise<TActorInstance>;
    updateInstanceMachine(instance: TActorInstanceUpdateMachineArgs): Promise<TActorInstance>;
    deleteInstance(id: string): Promise<void>;
    listConnections(): Promise<TActorConnection[]>;
    insertConnection(connection: TActorConnectionCreateArgs): Promise<TActorConnection>;
    deleteConnectionById(id: string): Promise<void>;
    deleteConnectionBySource(actorId: string): Promise<void>;
  }
}

export class DbServiceTurso implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'DbServiceTurso'
  db: Database

  constructor(private config: IDbConfig) {
    this.db = new Database(this.config.databasePath, {
      // @ts-expect-error experimental feature list is ahead of package typings
      experimental: ["custom_types", "triggers", "index_method", "multiprocess_wal"],
    })
  }
  async start(): Promise<void> {
    console.log('DbServiceTurso started')
    await this.db.connect()
    await txDefaultRunPragmas({ db: this.db }, {})
    await txRunMigrations({ db: this.db, Bun, path }, {})
  }

  async stop(): Promise<void> {
    console.log('DbServiceTurso stopped')
  }

  account = {
    getDefaultOwner: () => fxAccountGetDefaultOwner(this, {}),
    ensureDefaultOwner: () => txAccountEnsureDefaultOwner(this, {}),
  };

  canvas = {
    listAll: (args?: { accountId?: string }) => fxCanvasListAll(this, { accountId: args?.accountId }),
    findByName: (args: { name: string }, scope?: { accountId?: string }) => fxCanvasFindByName(this, { ...args, accountId: scope?.accountId }),
    findById: (args: { id: string }, scope?: { accountId?: string }) => fxCanvasFindById(this, { ...args, accountId: scope?.accountId }),
    create: (args: TCanvasCreateArgs, scope?: { accountId?: string }) => txCanvasCreate(this, { ...args, accountId: scope?.accountId }),
    renameById: (args: { id: string, name: string }, scope?: { accountId?: string }) => txCanvasRenameById(this, { ...args, accountId: scope?.accountId }),
    deleteById: (args: { id: string }, scope?: { accountId?: string }) => txCanvasDeleteById(this, { ...args, accountId: scope?.accountId }),
    listMembers: (args: { canvasId: string }) => fxCanvasListMembers(this, args),
  };

  file = {
    listAll: () => fxFileListAll(this, {}),
    create: (args: TFileCreateArgs) => txFileCreate(this, args),
    getById: (args: { id: string }) => fxFileGetById(this, args),
    deleteById: (args: { id: string }) => txFileDeleteById(this, args),
  };

  filesystem = {
    listAll: () => fxFilesystemListAll(this, {}),
    findById: (id: string) => fxFilesystemFindById(this, { id }),
    create: (args: TFilesystemCreateArgs) => txFilesystemCreate(this, args),
  };
}
