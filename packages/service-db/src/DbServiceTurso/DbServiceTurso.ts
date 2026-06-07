import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { Database } from "@tursodatabase/database"
import type { IDbConfig } from "../interface";
import { txRunMigrations } from "./tx.migrations"
import { txDefaultRunPragmas } from "./tx.pragma";
import { fxAccountGetDefaultOwner } from "./fx.account"
import type { TAccount, TCanvas, TCanvasMember, TFile, TFilesystem } from "../model";
import path from "node:path";
import { txAccountEnsureDefaultOwner } from "./tx.account";
import { fxCanvasFindByName, fxCanvasListAll, fxCanvasListMembers } from "./fx.canvas";
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";

type TCanvasCreateArgs = Pick<TCanvas, "automerge_url" | "id" | "name">;
type TFileCreateArgs = Pick<TFile, "id" | "hash" | "mime_type" | "base64">;
type TFilesystemCreateArgs = Pick<TFilesystem, "id" | "name">;


interface IPublicMethods {
  account: {
    getDefaultOwner(): Promise<TAccount | null>;
    ensureDefaultOwner(): Promise<void>;
  };
  canvas: {
    listAll(accountId?: string): Promise<TCanvas[]>;
    findByName(args: { name: string }, accountId?: string): Promise<TCanvas | null>;
    create(args: TCanvasCreateArgs, accountId?: string): Promise<TCanvas>;
    renameById(args: { id: string, name: string}, accountId?: string): Promise<TCanvas | null>;
    deleteById(args: { id: string }, accountId?: string): Promise<TCanvas[]>;
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
    listAll: (accountId?: string) => fxCanvasListAll(this, { accountId }),
    findByName: (args: { name: string }, accountId?: string) => fxCanvasFindByName(this, { ...args, accountId }),
    create: (args: TCanvasCreateArgs, accountId?: string) => txCanvasCreate(this, { ...args, accountId }),
    renameById: (args: { id: string, name: string }, accountId?: string) => txCanvasRenameById(this, { ...args, accountId }),
    deleteById: (args: { id: string }, accountId?: string) => txCanvasDeleteById(this, { ...args, accountId }),
    listMembers: (args: { canvasId: string }) => fxCanvasListMembers(this, args),
  };
}
