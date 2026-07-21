import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TWidgetSourceFile, TWidgetSourceSnapshot } from '../types';
import {
  WIDGET_SOURCE_MAX_FILES,
  WIDGET_SOURCE_MAX_FILE_BYTES,
  WIDGET_SOURCE_MAX_TOTAL_BYTES,
} from './CONSTANTS';
import {
  fnNormalizeWidgetSourceFiles,
  fnWidgetSourcePathIsSafe,
  fnWidgetSourceSnapshotByteSize,
} from './fn.source-snapshot';

export type TCapturedWidgetSourceFile = TWidgetSourceFile;

export type TCapturedWidgetSourceSnapshot = TWidgetSourceSnapshot & Readonly<{
  byteSize: number;
}>;

export type TWidgetSourceSnapshotCheckpoint = Readonly<{
  phase: 'before_file_open' | 'after_file_open';
  path: string;
  hostPath: string;
}>;

export type TWidgetSourceSnapshotConfig = Readonly<{
  checkpoint?: (checkpoint: TWidgetSourceSnapshotCheckpoint) => void | Promise<void>;
}>;

type TFileStamp = Readonly<{
  path: string;
  hostPath: string;
  device: number;
  inode: number;
  size: number;
  modifiedAtMs: number;
  changedAtMs: number;
}>;

type TDirectoryStamp = Readonly<{
  hostPath: string;
  device: number;
  inode: number;
  modifiedAtMs: number;
  changedAtMs: number;
  entries: string;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stampMatches(
  stamp: TFileStamp,
  value: Readonly<{
    isFile(): boolean;
    dev: number | bigint;
    ino: number | bigint;
    size: number | bigint;
    mtimeMs: number;
    ctimeMs: number;
  }>,
): boolean {
  return value.isFile()
    && Number(value.dev) === stamp.device
    && Number(value.ino) === stamp.inode
    && Number(value.size) === stamp.size
    && value.mtimeMs === stamp.modifiedAtMs
    && value.ctimeMs === stamp.changedAtMs;
}

function directoryStampMatches(
  stamp: Pick<TDirectoryStamp, 'device' | 'inode' | 'modifiedAtMs' | 'changedAtMs'>,
  value: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return value.isDirectory()
    && !value.isSymbolicLink()
    && value.dev === stamp.device
    && value.ino === stamp.inode
    && value.mtimeMs === stamp.modifiedAtMs
    && value.ctimeMs === stamp.changedAtMs;
}

function directoryIdentity(
  value: Awaited<ReturnType<typeof lstat>>,
): Pick<TDirectoryStamp, 'device' | 'inode' | 'modifiedAtMs' | 'changedAtMs'> {
  return {
    device: Number(value.dev),
    inode: Number(value.ino),
    modifiedAtMs: Number(value.mtimeMs),
    changedAtMs: Number(value.ctimeMs),
  };
}

function digestSnapshot(files: readonly TCapturedWidgetSourceFile[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
    hash.update(';');
  }
  return hash.digest('hex');
}

async function directoryEntryStamp(hostPath: string): Promise<string> {
  const entries = await readdir(hostPath, { withFileTypes: true });
  return entries
    .map((entry) => `${entry.name}\0${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'x'}`)
    .sort(compareText)
    .join('\0');
}

async function assertDirectoryUnchanged(stamp: TDirectoryStamp): Promise<void> {
  const beforeEntries = await lstat(stamp.hostPath);
  if (!directoryStampMatches(stamp, beforeEntries)) {
    throw new Error('Widget source directory changed during snapshot capture.');
  }
  const entries = await directoryEntryStamp(stamp.hostPath);
  const afterEntries = await lstat(stamp.hostPath);
  if (!directoryStampMatches(stamp, afterEntries) || entries !== stamp.entries) {
    throw new Error('Widget source directory changed during snapshot capture.');
  }
}

async function readStampedFile(
  stamp: TFileStamp,
  checkpoint: TWidgetSourceSnapshotConfig['checkpoint'],
): Promise<Uint8Array> {
  await checkpoint?.({
    phase: 'before_file_open',
    path: stamp.path,
    hostPath: stamp.hostPath,
  });

  let handle;
  try {
    handle = await open(
      stamp.hostPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new Error(`Widget source changed while '${stamp.path}' was opened.`);
  }

  try {
    await checkpoint?.({
      phase: 'after_file_open',
      path: stamp.path,
      hostPath: stamp.hostPath,
    });
    const beforeRead = await handle.stat();
    if (!stampMatches(stamp, beforeRead)) {
      throw new Error(`Widget source changed before '${stamp.path}' was captured.`);
    }

    const bytes = Buffer.allocUnsafe(stamp.size);
    let offset = 0;
    while (offset < stamp.size) {
      const result = await handle.read(bytes, offset, stamp.size - offset, offset);
      if (result.bytesRead === 0) {
        throw new Error(`Widget source changed while '${stamp.path}' was captured.`);
      }
      offset += result.bytesRead;
    }
    const eofProbe = Buffer.allocUnsafe(1);
    const eof = await handle.read(eofProbe, 0, 1, stamp.size);
    const afterRead = await handle.stat();
    if (eof.bytesRead !== 0 || !stampMatches(stamp, afterRead)) {
      throw new Error(`Widget source changed while '${stamp.path}' was captured.`);
    }

    let pathAfterRead;
    try {
      pathAfterRead = await lstat(stamp.hostPath);
    } catch {
      throw new Error(`Widget source changed after '${stamp.path}' was captured.`);
    }
    if (!stampMatches(stamp, pathAfterRead)) {
      throw new Error(`Widget source changed after '${stamp.path}' was captured.`);
    }
    return new Uint8Array(bytes);
  } finally {
    await handle.close();
  }
}

/** Captures and materializes one bounded immutable source snapshot. */
export class WidgetSourceSnapshot {
  constructor(readonly config: TWidgetSourceSnapshotConfig = {}) {}

  async capture(
    sourceRoot: string,
    args: Readonly<{
      id?: string;
      createdAtMs?: number;
      expectedDigestSha256?: string;
    }> = {},
  ): Promise<TCapturedWidgetSourceSnapshot> {
    const root = await lstat(sourceRoot);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new Error('Widget source root must be a real directory.');
    }

    const files: TFileStamp[] = [];
    const directories: TDirectoryStamp[] = [];
    let discoveredBytes = 0;

    const visit = async (
      hostDirectory: string,
      relativeDirectory: string,
      expectedIdentity: Pick<
        TDirectoryStamp,
        'device' | 'inode' | 'modifiedAtMs' | 'changedAtMs'
      >,
    ): Promise<void> => {
      const beforeRead = await lstat(hostDirectory);
      if (!directoryStampMatches(expectedIdentity, beforeRead)) {
        throw new Error('Widget source directory changed before traversal.');
      }
      const entries = await readdir(hostDirectory, { withFileTypes: true });
      const afterRead = await lstat(hostDirectory);
      if (!directoryStampMatches(expectedIdentity, afterRead)) {
        throw new Error('Widget source directory changed during traversal.');
      }
      const directory: TDirectoryStamp = {
        hostPath: hostDirectory,
        ...expectedIdentity,
        entries: entries
          .map((entry) => `${entry.name}\0${entry.isDirectory() ? 'd' : entry.isFile() ? 'f' : 'x'}`)
          .sort(compareText)
          .join('\0'),
      };
      directories.push(directory);

      for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
        const relativePath = relativeDirectory.length === 0
          ? entry.name
          : `${relativeDirectory}/${entry.name}`;
        if (!fnWidgetSourcePathIsSafe(relativePath)) {
          throw new Error(`Unsafe widget source path '${relativePath}'.`);
        }
        const hostPath = join(hostDirectory, entry.name);
        const value = await lstat(hostPath);
        if (value.isSymbolicLink()) {
          throw new Error(`Widget source symlink '${relativePath}' is not allowed.`);
        }
        if (value.isDirectory()) {
          await visit(hostPath, relativePath, directoryIdentity(value));
          continue;
        }
        if (!value.isFile()) {
          throw new Error(`Widget source entry '${relativePath}' is not a regular file.`);
        }
        if (value.size > WIDGET_SOURCE_MAX_FILE_BYTES) {
          throw new Error(`Widget source file '${relativePath}' exceeds the byte limit.`);
        }
        discoveredBytes += value.size;
        if (discoveredBytes > WIDGET_SOURCE_MAX_TOTAL_BYTES) {
          throw new Error('Widget source snapshot exceeds the total byte limit.');
        }
        files.push({
          path: relativePath,
          hostPath,
          device: value.dev,
          inode: value.ino,
          size: value.size,
          modifiedAtMs: value.mtimeMs,
          changedAtMs: value.ctimeMs,
        });
        if (files.length > WIDGET_SOURCE_MAX_FILES) {
          throw new Error(`Widget source exceeds the ${WIDGET_SOURCE_MAX_FILES}-file limit.`);
        }
      }
      await assertDirectoryUnchanged(directory);
    };

    await visit(sourceRoot, '', directoryIdentity(root));
    const captured: TCapturedWidgetSourceFile[] = [];
    for (const stamp of files) {
      const bytes = await readStampedFile(stamp, this.config.checkpoint);
      captured.push(Object.freeze({ path: stamp.path, bytes: new Uint8Array(bytes) }));
    }

    for (const stamp of files) {
      if (!stampMatches(stamp, await lstat(stamp.hostPath))) {
        throw new Error(`Widget source changed after '${stamp.path}' was captured.`);
      }
    }
    for (const directory of directories) {
      await assertDirectoryUnchanged(directory);
    }

    const ordered = fnNormalizeWidgetSourceFiles(captured);
    const digestSha256 = digestSnapshot(ordered);
    if (args.expectedDigestSha256 !== undefined && args.expectedDigestSha256 !== digestSha256) {
      throw new Error('Widget source changed since the expected snapshot digest was selected.');
    }
    return Object.freeze({
      id: args.id ?? randomUUID(),
      digestSha256,
      byteSize: fnWidgetSourceSnapshotByteSize(ordered),
      files: ordered,
      createdAtMs: args.createdAtMs ?? Date.now(),
    });
  }

  async materialize(snapshot: TWidgetSourceSnapshot, targetRoot: string): Promise<void> {
    const files = fnNormalizeWidgetSourceFiles(snapshot.files);
    if (digestSnapshot(files) !== snapshot.digestSha256) {
      throw new Error('Widget source snapshot digest does not match its files.');
    }
    if (
      'byteSize' in snapshot
      && typeof snapshot.byteSize === 'number'
      && fnWidgetSourceSnapshotByteSize(files) !== snapshot.byteSize
    ) {
      throw new Error('Widget source snapshot byte size does not match its files.');
    }

    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    for (const file of files) {
      const target = join(targetRoot, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 });
    }
  }
}
