import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type * as schema from './schema';

type TCanvasRecord = typeof schema.canvas.$inferSelect;
type TCanvasInsertArgs = typeof schema.canvas.$inferInsert;
type TFileRecord = typeof schema.files.$inferSelect;
type TFileFormat = typeof schema.files.$inferSelect['format'];
type TFilesystemRecord = typeof schema.filesystems.$inferSelect;
type TFilesystemInsertArgs = typeof schema.filesystems.$inferInsert;

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
  canvas: {
    listAll(): TCanvasRecord[];
    findByName(name: string): TCanvasRecord | null;
    create(args: TCanvasInsertArgs): TCanvasRecord;
    renameById(args: { id: string, name: string }): TCanvasRecord;
    deleteById(args: { id: string }): TCanvasRecord[];
  };
  file: {
    listAll(): TFileRecord[];
    create(args: TCreateFileArgs): TFileRecord;
    get(args: TGetFileArgs): TFileRecord | null;
    deleteById(args: { id: string }): void;
  };
  filesystem: {
    listAll(): TFilesystemRecord[];
    findById(id: string): TFilesystemRecord | null;
    findByMachineId(machineId: string): TFilesystemRecord | null;
    create(args: TFilesystemInsertArgs): TFilesystemRecord;
    updateById(args: { id: string; label?: string; kind?: 'local' | 'remote'; home_path?: string | null }): TFilesystemRecord;
  };
  getFullCanvas(id: string): TGetFullCanvasResult | null;
}

export type {
  TCanvasRecord,
  TCreateFileArgs,
  TFileFormat,
  TFileRecord,
  TFilesystemInsertArgs,
  TFilesystemRecord,
  TGetFileArgs,
  TGetFullCanvasResult,
  TUpdateCanvasArgs,
  TCanvasInsertArgs
};
