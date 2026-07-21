import type { Dirent, Stats } from 'fs';
import type { IService, IStoppableService } from '@vibecanvas/runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TFilesystemPathArgs,
  TFilesystemRenameArgs,
  TFilesystemRootRegistrationArgs,
  TFilesystemScopeArgs,
  TFilesystemWatchArgs,
  TFilesystemWatchControlArgs,
  TFilesystemWatchEvent,
  TFilesystemWriteFileArgs,
} from './types';

export interface IFilesystemService extends IService, IStoppableService {
  /** Trusted host-composition hook for binding an opaque tenant filesystem capability. */
  registerRoot(tenant: TTenantContext, args: TFilesystemRootRegistrationArgs): void;
  /** Trusted host-composition hook for revoking a tenant filesystem capability and its watches. */
  unregisterRoot(tenant: TTenantContext, args: TFilesystemScopeArgs): void;
  /** Trusted service-composition hook. Never expose the returned host path through a public API. */
  resolveHostPath(tenant: TTenantContext, args: TFilesystemPathArgs): string | null;
  homeDir(tenant: TTenantContext, args: TFilesystemScopeArgs): string | null;
  exists(tenant: TTenantContext, args: TFilesystemPathArgs): boolean;
  readdir(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<Dirent[]>;
  stat(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<Stats>;
  readFile(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<Buffer>;
  writeFile(tenant: TTenantContext, args: TFilesystemWriteFileArgs): TErrTuple<void>;
  rename(tenant: TTenantContext, args: TFilesystemRenameArgs): TErrTuple<void>;
  watch(tenant: TTenantContext, args: TFilesystemWatchArgs): AsyncIterable<TFilesystemWatchEvent> | null;
  keepalive(tenant: TTenantContext, args: TFilesystemWatchControlArgs): boolean;
  unwatch(tenant: TTenantContext, args: TFilesystemWatchControlArgs): void;
}
