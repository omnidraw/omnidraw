import type { FSWatcher } from 'fs';

export type TFilesystemWatchEvent = {
  eventType: 'rename' | 'change';
  fileName: string;
};

export type TFilesystemScopeArgs = {
  filesystemId: string;
};

export type TFilesystemRootRegistrationArgs = TFilesystemScopeArgs & {
  rootPath: string;
};

export type TFilesystemPathArgs = TFilesystemScopeArgs & {
  path: string;
};

export type TFilesystemWriteFileArgs = TFilesystemPathArgs & {
  content: string;
};

export type TFilesystemRenameArgs = TFilesystemScopeArgs & {
  sourcePath: string;
  targetPath: string;
};

export type TFilesystemWatchArgs = TFilesystemPathArgs & {
  watchId: string;
};

export type TFilesystemWatchControlArgs = TFilesystemScopeArgs & {
  watchId: string;
};

export type TFilesystemServiceOptions = {
  nativeWatch?: TFilesystemNativeWatch;
  watchPollIntervalMs?: number;
  watchTtlMs?: number;
};

export type TFilesystemNativeWatch = (
  path: string,
  options: Readonly<{ signal: AbortSignal }>,
) => FSWatcher;

export type TFilesystemListArgs = {
  path: string;
  omitFiles?: boolean;
};

export type TFilesystemDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

export type TFilesystemListResult = {
  current: string;
  parent: string | null;
  children: TFilesystemDirEntry[];
};

export type TFilesystemFilesArgs = {
  path: string;
  max_depth?: number;
};

export type TFilesystemUnreadableReason = 'permission_denied';

export type TFilesystemDirNode = {
  name: string;
  path: string;
  is_dir: boolean;
  is_unreadable?: boolean;
  unreadable_reason?: TFilesystemUnreadableReason;
  children: TFilesystemDirNode[];
};

export type TFilesystemFilesResult = {
  root: string;
  children: TFilesystemDirNode[];
};

export type TFilesystemMoveArgs = {
  source_path: string;
  destination_dir_path: string;
};

export type TFilesystemMoveResult = {
  source_path: string;
  destination_dir_path: string;
  target_path: string;
  moved: boolean;
};

export type TFilesystemInspectArgs = {
  path: string;
};

export type TFilesystemFileKind = 'pdf' | 'text' | 'image' | 'binary' | 'video';

export type TFilesystemInspectResult = {
  name: string;
  path: string;
  mime: string | null;
  kind: TFilesystemFileKind;
  size: number;
  lastModified: number;
  permissions: string;
};

export type TFilesystemReadArgs = {
  path: string;
  maxBytes?: number;
  content?: 'text' | 'base64' | 'binary' | 'none';
};

export type TFilesystemReadResult =
  | {
    kind: 'text';
    content: string;
    truncated: boolean;
  }
  | {
    kind: 'binary';
    content: string | null;
    size: number;
    mime?: string;
    encoding?: 'base64' | 'hex';
  }
  | {
    kind: 'none';
    size: number;
  };

export type TFilesystemWriteArgs = {
  path: string;
  content: string;
};

export type TFilesystemWriteResult = {
  success: true;
};
