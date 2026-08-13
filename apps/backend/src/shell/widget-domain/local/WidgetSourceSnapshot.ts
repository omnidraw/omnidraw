import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  TWidgetSourceArtifact,
  TWidgetSourceFile,
  TWidgetSourceSnapshot,
} from '#backend/core/widget-domain/types';
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
  nowMs: () => number;
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

type TWidgetSourceArtifactEnvelope = Readonly<{
  format: 'omnidraw.widget-source.v1';
  snapshotId: string;
  sourceDigestSha256: string;
  builderIdentity: string;
  createdAtMs: number;
  byteSize: number;
  files: readonly Readonly<{ path: string; bytesBase64: string }>[];
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceArtifactError(message: string): Error {
  return Object.assign(new Error(message), { code: 'WIDGET_SOURCE_ARTIFACT_INVALID' });
}

function boundedContext(value: string, label: string): string {
  if (value.length < 1 || value.length > 256 || value.trim() !== value || value.includes('\0')) {
    throw sourceArtifactError(`Widget source artifact ${label} is invalid.`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareText);
  const orderedExpected = [...expected].sort(compareText);
  return keys.length === orderedExpected.length
    && keys.every((key, index) => key === orderedExpected[index]);
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw sourceArtifactError('Widget source artifact file bytes are invalid.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw sourceArtifactError('Widget source artifact file bytes are not canonical.');
  }
  return new Uint8Array(bytes);
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
  constructor(readonly config: TWidgetSourceSnapshotConfig) {}

  async capture(
    sourceRoot: string,
    args: Readonly<{
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
      id: digestSha256,
      digestSha256,
      byteSize: fnWidgetSourceSnapshotByteSize(ordered),
      files: ordered,
      createdAtMs: args.createdAtMs ?? this.config.nowMs(),
    });
  }

  /** Encodes one snapshot into deterministic artifact bytes for durable provenance. */
  encodeArtifact(
    snapshot: TWidgetSourceSnapshot,
    args: Readonly<{ builderIdentity: string }>,
  ): TWidgetSourceArtifact {
    const builderIdentity = boundedContext(args.builderIdentity, 'builder identity');
    const snapshotId = boundedContext(snapshot.id, 'snapshot ID');
    if (!Number.isSafeInteger(snapshot.createdAtMs) || snapshot.createdAtMs < 0) {
      throw sourceArtifactError('Widget source artifact creation timestamp is invalid.');
    }
    const files = fnNormalizeWidgetSourceFiles(snapshot.files);
    const sourceDigestSha256 = digestSnapshot(files);
    if (
      sourceDigestSha256 !== snapshot.digestSha256
      || snapshot.id !== snapshot.digestSha256
    ) {
      throw sourceArtifactError('Widget source artifact digest does not match its files.');
    }
    const byteSize = fnWidgetSourceSnapshotByteSize(files);
    const envelope: TWidgetSourceArtifactEnvelope = Object.freeze({
      format: 'omnidraw.widget-source.v1',
      snapshotId,
      sourceDigestSha256,
      builderIdentity,
      createdAtMs: snapshot.createdAtMs,
      byteSize,
      files: Object.freeze(files.map((file) => Object.freeze({
        path: file.path,
        bytesBase64: Buffer.from(file.bytes).toString('base64'),
      }))),
    });
    const bytes = new Uint8Array(Buffer.from(JSON.stringify(envelope), 'utf8'));
    return Object.freeze({ kind: 'source', digestSha256: sha256(bytes), bytes });
  }

  /** Decodes and verifies source artifact bytes before they are materialized or edited. */
  decodeArtifact(
    artifact: TWidgetSourceArtifact,
    args: Readonly<{
      expectedSnapshotId?: string;
      expectedSourceDigestSha256?: string;
      expectedBuilderIdentity?: string;
    }> = {},
  ): TCapturedWidgetSourceSnapshot {
    if (artifact.kind !== 'source' || sha256(artifact.bytes) !== artifact.digestSha256) {
      throw sourceArtifactError('Widget source artifact bytes do not match their digest.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(artifact.bytes).toString('utf8'));
    } catch {
      throw sourceArtifactError('Widget source artifact envelope is malformed.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw sourceArtifactError('Widget source artifact envelope is malformed.');
    }
    const envelope = parsed as Record<string, unknown>;
    if (!exactKeys(envelope, [
      'format',
      'snapshotId',
      'sourceDigestSha256',
      'builderIdentity',
      'createdAtMs',
      'byteSize',
      'files',
    ])) throw sourceArtifactError('Widget source artifact envelope is malformed.');
    if (
      envelope.format !== 'omnidraw.widget-source.v1'
      || typeof envelope.snapshotId !== 'string'
      || typeof envelope.sourceDigestSha256 !== 'string'
      || typeof envelope.builderIdentity !== 'string'
      || !Number.isSafeInteger(envelope.createdAtMs)
      || Number(envelope.createdAtMs) < 0
      || !Number.isSafeInteger(envelope.byteSize)
      || Number(envelope.byteSize) < 0
      || !Array.isArray(envelope.files)
    ) throw sourceArtifactError('Widget source artifact envelope is malformed.');
    const snapshotId = boundedContext(envelope.snapshotId, 'snapshot ID');
    const builderIdentity = boundedContext(envelope.builderIdentity, 'builder identity');
    if (
      args.expectedSnapshotId !== undefined
      && snapshotId !== args.expectedSnapshotId
    ) throw sourceArtifactError('Widget source artifact snapshot ID is unexpected.');
    if (
      args.expectedBuilderIdentity !== undefined
      && builderIdentity !== args.expectedBuilderIdentity
    ) throw sourceArtifactError('Widget source artifact builder identity is unexpected.');

    const decoded: TCapturedWidgetSourceFile[] = envelope.files.map((value) => {
      if (
        typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || !exactKeys(value as Record<string, unknown>, ['path', 'bytesBase64'])
        || typeof (value as Record<string, unknown>).path !== 'string'
        || typeof (value as Record<string, unknown>).bytesBase64 !== 'string'
      ) throw sourceArtifactError('Widget source artifact file entry is malformed.');
      return Object.freeze({
        path: (value as { path: string }).path,
        bytes: decodeBase64((value as { bytesBase64: string }).bytesBase64),
      });
    });
    const files = fnNormalizeWidgetSourceFiles(decoded);
    const sourceDigestSha256 = digestSnapshot(files);
    if (
      sourceDigestSha256 !== envelope.sourceDigestSha256
      || snapshotId !== sourceDigestSha256
      || (
        args.expectedSourceDigestSha256 !== undefined
        && sourceDigestSha256 !== args.expectedSourceDigestSha256
      )
      || fnWidgetSourceSnapshotByteSize(files) !== envelope.byteSize
    ) throw sourceArtifactError('Widget source artifact snapshot integrity check failed.');

    return Object.freeze({
      id: snapshotId,
      digestSha256: sourceDigestSha256,
      byteSize: Number(envelope.byteSize),
      files,
      createdAtMs: Number(envelope.createdAtMs),
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
