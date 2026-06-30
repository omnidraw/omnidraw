import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { TAccount, TCanvas, TCanvasMember, TFileFormat, TFilesystem, TMediaFile } from './model';

type TAccountRecord = TAccount;
type TCanvasRecord = TCanvas;
type TCanvasInsertArgs = Omit<TCanvas, 'created_at'>;
type TCanvasMemberRecord = TCanvasMember;
type TFileRecord = TMediaFile;
type TFilesystemRecord = TFilesystem;
type TFilesystemInsertArgs = Omit<TFilesystem, 'created_at' | 'updated_at'>;
type TFilesystemMemberRecord = {
  filesystem_id: string;
  account_id: string;
  role: string;
  created_at: string;
  updated_at: string;
};

type TGetFullCanvasResult = {
  canvas: TCanvasRecord;
};

type TUpdateCanvasArgs = {
  id: string;
  name?: string;
};

type TCreateFileArgs = {
  id: string;
  hash: string;
  mime_type: TFileFormat;
  data: Uint8Array | ArrayBuffer;
};

type TGetFileArgs = {
  id: string;
};

/**
 * Abstract database service contract.
 *
 * Important: this interface should not know about Drizzle, SQLite, or any
 * concrete persistence technology. Implementation-specific query surfaces live
 * on concrete classes like `DbServiceBunSqlite`.
 */
export interface IDbService extends IService, IStartableService, IStoppableService {
  account: {
    getDefaultOwner(): Promise<TAccountRecord | null>;
    ensureDefaultOwner(): Promise<TAccountRecord>;
  };
  canvas: {
    listAll(args?: { accountId?: string }): Promise<TCanvasRecord[]>;
    findByName(args: { name: string }, scope?: { accountId?: string }): Promise<TCanvasRecord | null>;
    create(args: TCanvasInsertArgs, scope?: { accountId?: string }): Promise<TCanvasRecord>;
    renameById(args: { id: string, name: string }, scope?: { accountId?: string }): Promise<TCanvasRecord | null>;
    deleteById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvasRecord[]>;
    listMembers(args: { canvasId: string }): Promise<TCanvasMemberRecord[]>;
  };
  file: {
    listAll(): Promise<TFileRecord[]>;
    create(args: TCreateFileArgs): Promise<TFileRecord>;
    getById(args: TGetFileArgs): Promise<TFileRecord | null>;
    deleteById(args: { id: string }): Promise<void>;
  };
  filesystem: {
    listAll(args?: { accountId?: string }): Promise<TFilesystemRecord[]>;
    findById(id: string, args?: { accountId?: string }): Promise<TFilesystemRecord | null>;
    findByMachineId?(machineId: string, args?: { accountId?: string }): Promise<TFilesystemRecord | null>;
    create(args: TFilesystemInsertArgs & { accountId?: string }): Promise<TFilesystemRecord>;
    updateById?(args: { id: string; label?: string; kind?: 'local' | 'remote'; home_path?: string | null; accountId?: string }): Promise<TFilesystemRecord | null>;
    listMembers?(args: { filesystemId: string }): Promise<TFilesystemMemberRecord[]>;
  };
}

export type {
  TAccountRecord,
  TCanvasMemberRecord,
  TCanvasRecord,
  TCreateFileArgs,
  TFileFormat,
  TFileRecord,
  TFilesystemInsertArgs,
  TFilesystemMemberRecord,
  TFilesystemRecord,
  TGetFileArgs,
  TGetFullCanvasResult,
  TUpdateCanvasArgs,
  TCanvasInsertArgs
};
