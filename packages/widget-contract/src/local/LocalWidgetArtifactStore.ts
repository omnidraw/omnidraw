import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  TWidgetArtifactDescriptor,
  TWidgetArtifactKind,
} from '../types';
import { WIDGET_ARTIFACT_MAX_BYTES } from './CONSTANTS';
import {
  fnArtifactBlobPath,
  fnArtifactTempPath,
  fnValidateArtifactDigest,
} from './fn.artifact-path';
import { PinnedLocalDirectory } from './PinnedLocalDirectory';
import type { TPinnedLocalDirectory } from './PinnedLocalDirectory';

export type TStoredWidgetArtifactBlob = Readonly<{
  kind: TWidgetArtifactKind;
  digestSha256: string;
  byteSize: number;
}>;

type TLocalWidgetArtifactBlobCandidateBase = Readonly<{
  digestSha256: string;
  modifiedAtMs: number;
  device: number;
  inode: number;
}>;

type TFileIdentity = Readonly<{
  device: number;
  inode: number;
}>;

export type TLocalWidgetArtifactBlobCandidate =
  | (TLocalWidgetArtifactBlobCandidateBase & Readonly<{ form: 'final' }>)
  | (TLocalWidgetArtifactBlobCandidateBase & Readonly<{
      form: 'temp';
      nonce: string;
    }>);

export type TLocalWidgetArtifactStoreConfig = Readonly<{
  orgId: string;
  artifactsRoot: string;
  createNonce?: () => string;
  syncDirectory?: (path: string) => Promise<void>;
  renameArtifact?: (source: string, target: string) => Promise<void>;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactIntegrityError(message: string): Error {
  return Object.assign(new Error(message), { code: 'WIDGET_ARTIFACT_INTEGRITY_FAILED' });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateSortKey(candidate: TLocalWidgetArtifactBlobCandidate): string {
  return `${candidate.digestSha256}\0${candidate.form}\0${candidate.form === 'temp' ? candidate.nonce : ''}`;
}

function fileIdentityMatches(
  expected: TFileIdentity,
  value: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return value.isFile()
    && !value.isSymbolicLink()
    && Number(value.dev) === expected.device
    && Number(value.ino) === expected.inode;
}

async function unlinkIfIdentity(path: string, expected: TFileIdentity): Promise<boolean> {
  let value;
  try {
    value = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!fileIdentityMatches(expected, value)) return false;
  await unlink(path);
  return true;
}

async function readPinnedFile(
  roots: PinnedLocalDirectory,
  directory: TPinnedLocalDirectory,
  path: string,
): Promise<Uint8Array> {
  await roots.assertDirectory(directory);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const beforeRead = await handle.stat();
    if (!beforeRead.isFile() || Number(beforeRead.size) > WIDGET_ARTIFACT_MAX_BYTES) {
      throw artifactIntegrityError('Widget artifact path is not a bounded regular file.');
    }
    const size = Number(beforeRead.size);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const result = await handle.read(bytes, offset, size - offset, offset);
      if (result.bytesRead === 0) {
        throw artifactIntegrityError('Widget artifact changed while it was read.');
      }
      offset += result.bytesRead;
    }
    const eof = await handle.read(Buffer.allocUnsafe(1), 0, 1, size);
    const afterRead = await handle.stat();
    if (
      eof.bytesRead !== 0
      || !afterRead.isFile()
      || Number(afterRead.dev) !== Number(beforeRead.dev)
      || Number(afterRead.ino) !== Number(beforeRead.ino)
      || Number(afterRead.size) !== size
      || afterRead.mtimeMs !== beforeRead.mtimeMs
      || afterRead.ctimeMs !== beforeRead.ctimeMs
    ) {
      throw artifactIntegrityError('Widget artifact changed while it was read.');
    }
    const pathAfterRead = await lstat(path);
    if (
      !pathAfterRead.isFile()
      || pathAfterRead.isSymbolicLink()
      || Number(pathAfterRead.dev) !== Number(beforeRead.dev)
      || Number(pathAfterRead.ino) !== Number(beforeRead.ino)
    ) {
      throw artifactIntegrityError('Widget artifact path changed while it was read.');
    }
    await roots.assertDirectory(directory);
    return new Uint8Array(bytes);
  } finally {
    await handle.close();
  }
}

/** Organization-local immutable content-addressed blob storage. */
export class LocalWidgetArtifactStore {
  readonly #createNonce: () => string;
  readonly #roots: PinnedLocalDirectory;
  readonly #syncDirectory: ((path: string) => Promise<void>) | null;
  readonly #renameArtifact: (source: string, target: string) => Promise<void>;

  constructor(readonly config: TLocalWidgetArtifactStoreConfig) {
    this.#createNonce = config.createNonce ?? randomUUID;
    this.#roots = new PinnedLocalDirectory(config.artifactsRoot);
    this.#syncDirectory = config.syncDirectory ?? null;
    this.#renameArtifact = config.renameArtifact ?? rename;
  }

  async writeArtifact(args: Readonly<{
    kind: TWidgetArtifactKind;
    bytes: Uint8Array;
    expectedDigestSha256?: string;
  }>): Promise<TStoredWidgetArtifactBlob> {
    if (args.bytes.byteLength > WIDGET_ARTIFACT_MAX_BYTES) {
      throw new Error('Widget artifact exceeds the byte limit.');
    }
    const digestSha256 = sha256(args.bytes);
    if (
      args.expectedDigestSha256 !== undefined
      && fnValidateArtifactDigest(args.expectedDigestSha256) !== digestSha256
    ) {
      throw artifactIntegrityError('Widget artifact bytes do not match the expected digest.');
    }

    const root = await this.#roots.ensureRoot();
    const parent = await this.#roots.ensureDirectory([
      'blobs',
      'sha256',
      digestSha256.slice(0, 2),
    ]);
    const target = fnArtifactBlobPath(join, {
      artifactsRoot: root.path,
      digestSha256,
    });

    let existing: Uint8Array | null = null;
    try {
      existing = await readPinnedFile(this.#roots, parent, target);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (existing !== null) {
      this.#assertBytes(existing, digestSha256, args.bytes.byteLength);
      await this.#syncPinnedHierarchy(parent);
      return Object.freeze({ kind: args.kind, digestSha256, byteSize: args.bytes.byteLength });
    }

    const temp = fnArtifactTempPath(join, {
      artifactsRoot: root.path,
      digestSha256,
      nonce: this.#createNonce(),
    });
    await this.#roots.assertDirectory(parent);
    const handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const openedTemp = await handle.stat();
    if (!openedTemp.isFile()) {
      await handle.close();
      throw artifactIntegrityError('Widget artifact temp path is not a regular file.');
    }
    const tempIdentity = Object.freeze({
      device: Number(openedTemp.dev),
      inode: Number(openedTemp.ino),
    });
    try {
      await handle.writeFile(args.bytes);
      await handle.sync();
      const writtenTemp = await handle.stat();
      if (
        !writtenTemp.isFile()
        || Number(writtenTemp.dev) !== tempIdentity.device
        || Number(writtenTemp.ino) !== tempIdentity.inode
        || Number(writtenTemp.size) !== args.bytes.byteLength
      ) {
        throw artifactIntegrityError('Widget artifact temp file changed while it was written.');
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlinkIfIdentity(temp, tempIdentity).catch(() => undefined);
      throw error;
    }
    await handle.close();

    let renameSucceeded = false;
    try {
      await this.#roots.assertDirectory(parent);
      const beforeRename = await lstat(temp);
      if (!fileIdentityMatches(tempIdentity, beforeRename)) {
        throw artifactIntegrityError('Widget artifact temp path changed before rename.');
      }
      await this.#renameArtifact(temp, target);
      renameSucceeded = true;
    } catch (error) {
      await unlinkIfIdentity(temp, tempIdentity).catch(() => undefined);
      try {
        const existing = await readPinnedFile(this.#roots, parent, target);
        this.#assertBytes(existing, digestSha256, args.bytes.byteLength);
      } catch (existingError) {
        if (!isMissing(existingError)) throw existingError;
        throw error;
      }
    }
    if (renameSucceeded) {
      const renamed = await lstat(target);
      if (!fileIdentityMatches(tempIdentity, renamed)) {
        throw artifactIntegrityError('Widget artifact path changed during rename.');
      }
    }
    await this.#syncPinnedHierarchy(parent);
    const durable = await readPinnedFile(this.#roots, parent, target);
    this.#assertBytes(durable, digestSha256, args.bytes.byteLength);

    return Object.freeze({ kind: args.kind, digestSha256, byteSize: args.bytes.byteLength });
  }

  async readArtifact(descriptor: TWidgetArtifactDescriptor): Promise<Uint8Array> {
    this.#assertOrganization(descriptor.orgId);
    const digest = fnValidateArtifactDigest(descriptor.digestSha256);
    const parent = await this.#roots.resolveDirectory(['blobs', 'sha256', digest.slice(0, 2)]);
    if (parent === null) {
      throw artifactIntegrityError('Widget artifact bytes are missing.');
    }
    const target = fnArtifactBlobPath(join, {
      artifactsRoot: (await this.#roots.ensureRoot()).path,
      digestSha256: digest,
    });
    let bytes: Uint8Array;
    try {
      bytes = await readPinnedFile(this.#roots, parent, target);
    } catch (error) {
      if (!isMissing(error)) throw error;
      throw artifactIntegrityError('Widget artifact bytes are missing.');
    }
    this.#assertBytes(bytes, digest, descriptor.byteSize);
    return new Uint8Array(bytes);
  }

  async hasArtifact(descriptor: TWidgetArtifactDescriptor): Promise<boolean> {
    try {
      await this.readArtifact(descriptor);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'WIDGET_ARTIFACT_INTEGRITY_FAILED') {
        return false;
      }
      throw error;
    }
  }

  async deleteArtifact(descriptor: TWidgetArtifactDescriptor): Promise<void> {
    this.#assertOrganization(descriptor.orgId);
    const digestSha256 = fnValidateArtifactDigest(descriptor.digestSha256);
    const parent = await this.#roots.resolveDirectory([
      'blobs',
      'sha256',
      digestSha256.slice(0, 2),
    ]);
    if (parent === null) return;
    const target = fnArtifactBlobPath(join, {
      artifactsRoot: (await this.#roots.ensureRoot()).path,
      digestSha256,
    });
    const current = await this.#regularFileOrNull(target);
    if (current === null) return;
    await this.#roots.assertDirectory(parent);
    const beforeDelete = await lstat(target);
    if (
      !beforeDelete.isFile()
      || beforeDelete.isSymbolicLink()
      || beforeDelete.dev !== current.dev
      || beforeDelete.ino !== current.ino
    ) {
      throw artifactIntegrityError('Widget artifact path changed before deletion.');
    }
    await unlink(target);
    await this.#syncPinnedDirectory(parent);
  }

  async listBlobCandidates(): Promise<readonly TLocalWidgetArtifactBlobCandidate[]> {
    const digestRoot = await this.#roots.resolveDirectory(['blobs', 'sha256']);
    if (digestRoot === null) return [];
    const prefixes = await readdir(digestRoot.path, { withFileTypes: true });
    await this.#roots.assertDirectory(digestRoot);
    const candidates: TLocalWidgetArtifactBlobCandidate[] = [];
    for (const prefix of prefixes) {
      if (!/^[0-9a-f]{2}$/.test(prefix.name)) continue;
      const prefixRoot = await this.#roots.resolveDirectory(['blobs', 'sha256', prefix.name]);
      if (prefixRoot === null) continue;
      const entries = await readdir(prefixRoot.path, { withFileTypes: true });
      await this.#roots.assertDirectory(prefixRoot);
      for (const entry of entries) {
        const finalMatch = /^([0-9a-f]{64})$/.exec(entry.name);
        const tempMatch = /^([0-9a-f]{64})\.([0-9A-Za-z_-]{1,128})\.tmp$/.exec(entry.name);
        const digestSha256 = finalMatch?.[1] ?? tempMatch?.[1];
        if (digestSha256 === undefined || digestSha256.slice(0, 2) !== prefix.name) continue;
        fnValidateArtifactDigest(digestSha256);

        const metadata = await this.#regularFileOrNull(join(prefixRoot.path, entry.name));
        if (metadata === null) continue;
        const base = {
          digestSha256,
          modifiedAtMs: Number(metadata.mtimeMs),
          device: Number(metadata.dev),
          inode: Number(metadata.ino),
        };
        candidates.push(Object.freeze(tempMatch === null
          ? { ...base, form: 'final' as const }
          : { ...base, form: 'temp' as const, nonce: tempMatch[2]! }));
      }
      await this.#roots.assertDirectory(prefixRoot);
    }
    candidates.sort((left, right) => compareText(candidateSortKey(left), candidateSortKey(right)));
    return Object.freeze(candidates);
  }

  async listBlobDigests(): Promise<readonly string[]> {
    const digests = (await this.listBlobCandidates())
      .filter((candidate) => candidate.form === 'final')
      .map((candidate) => candidate.digestSha256);
    return Object.freeze(digests);
  }

  async deleteBlobCandidate(
    candidate: TLocalWidgetArtifactBlobCandidate,
    args: Readonly<{ notModifiedAfterMs: number }>,
  ): Promise<boolean> {
    const digestSha256 = fnValidateArtifactDigest(candidate.digestSha256);
    if (!Number.isFinite(args.notModifiedAfterMs) || args.notModifiedAfterMs < 0) {
      throw new TypeError('Artifact candidate cutoff timestamp is invalid.');
    }
    if (candidate.modifiedAtMs > args.notModifiedAfterMs) return false;

    const parent = await this.#roots.resolveDirectory([
      'blobs',
      'sha256',
      digestSha256.slice(0, 2),
    ]);
    if (parent === null) return false;
    const artifactsRoot = (await this.#roots.ensureRoot()).path;
    const target = candidate.form === 'final'
      ? fnArtifactBlobPath(join, { artifactsRoot, digestSha256 })
      : fnArtifactTempPath(join, {
          artifactsRoot,
          digestSha256,
          nonce: candidate.nonce,
        });
    const current = await this.#regularFileOrNull(target);
    if (
      current === null
      || Number(current.dev) !== candidate.device
      || Number(current.ino) !== candidate.inode
      || current.mtimeMs !== candidate.modifiedAtMs
      || current.mtimeMs > args.notModifiedAfterMs
    ) return false;

    await this.#roots.assertDirectory(parent);
    const beforeDelete = await this.#regularFileOrNull(target);
    if (
      beforeDelete === null
      || beforeDelete.dev !== current.dev
      || beforeDelete.ino !== current.ino
      || beforeDelete.mtimeMs !== current.mtimeMs
    ) return false;
    await unlink(target);
    await this.#syncPinnedDirectory(parent);
    return true;
  }

  async #regularFileOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    let value;
    try {
      value = await lstat(path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!value.isFile() || value.isSymbolicLink()) {
      throw artifactIntegrityError('Widget artifact path is not a regular file.');
    }
    return value;
  }

  async #syncPinnedDirectory(directory: TPinnedLocalDirectory): Promise<void> {
    await this.#roots.assertDirectory(directory);
    if (this.#syncDirectory === null) {
      await this.#roots.sync(directory);
    } else {
      await this.#syncDirectory(directory.path);
      await this.#roots.assertDirectory(directory);
    }
  }

  async #syncPinnedHierarchy(directory: TPinnedLocalDirectory): Promise<void> {
    if (this.#syncDirectory === null) {
      await this.#roots.syncHierarchy(directory);
    } else {
      await this.#roots.syncHierarchy(directory, this.#syncDirectory);
    }
  }

  #assertOrganization(orgId: string): void {
    if (orgId !== this.config.orgId) {
      throw Object.assign(new Error('Widget artifact was not found.'), { code: 'WIDGET_ARTIFACT_NOT_FOUND' });
    }
  }

  #assertBytes(bytes: Uint8Array, digestSha256: string, expectedByteSize: number): void {
    if (bytes.byteLength !== expectedByteSize || sha256(bytes) !== digestSha256) {
      throw artifactIntegrityError('Widget artifact integrity verification failed.');
    }
  }
}
