import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type * as schema from './schema';

type TAccountRecord = typeof schema.accounts.$inferSelect;
type TCanvasRecord = typeof schema.canvas.$inferSelect;
type TCanvasInsertArgs = typeof schema.canvas.$inferInsert;
type TCanvasMemberRecord = typeof schema.canvas_members.$inferSelect;
type TFileRecord = typeof schema.files.$inferSelect;
type TFileFormat = typeof schema.files.$inferSelect['format'];
type TFilesystemRecord = typeof schema.filesystems.$inferSelect;
type TFilesystemInsertArgs = typeof schema.filesystems.$inferInsert;
type TFilesystemMemberRecord = typeof schema.filesystem_members.$inferSelect;

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
  format: TFileFormat;
  base64: string;
};

type TGetFileArgs = {
  id: string;
  format: TFileFormat;
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
    getDefaultOwner(): TAccountRecord | null;
    ensureDefaultOwner(): TAccountRecord;
  };
  canvas: {
    listAll(args?: { accountId?: string }): TCanvasRecord[];
    findByName(name: string, args?: { accountId?: string }): TCanvasRecord | null;
    create(args: TCanvasInsertArgs & { accountId?: string }): TCanvasRecord;
    renameById(args: { id: string, name: string, accountId?: string }): TCanvasRecord | null;
    deleteById(args: { id: string, accountId?: string }): TCanvasRecord[];
    listMembers(args: { canvasId: string }): TCanvasMemberRecord[];
  };
  file: {
    listAll(): TFileRecord[];
    create(args: TCreateFileArgs): TFileRecord;
    get(args: TGetFileArgs): TFileRecord | null;
    deleteById(args: { id: string }): void;
  };
  filesystem: {
    listAll(args?: { accountId?: string }): TFilesystemRecord[];
    findById(id: string, args?: { accountId?: string }): TFilesystemRecord | null;
    findByMachineId(machineId: string, args?: { accountId?: string }): TFilesystemRecord | null;
    create(args: TFilesystemInsertArgs & { accountId?: string }): TFilesystemRecord;
    updateById(args: { id: string; label?: string; kind?: 'local' | 'remote'; home_path?: string | null; accountId?: string }): TFilesystemRecord | null;
    listMembers(args: { filesystemId: string }): TFilesystemMemberRecord[];
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
