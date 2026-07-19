/**
 * @file Host-owned custody and per-resource derivation for secret-store database keys.
 */
import { hkdfSync, randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from 'node:crypto';
import { constants as fsConstants, type Dirent } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ActorResourceError } from './ActorResourceError';

const MASTER_KEY_BYTE_LENGTH = 32;
const MASTER_KEY_HEX_LENGTH = MASTER_KEY_BYTE_LENGTH * 2;
const MASTER_KEY_FILE_MODE = 0o600;
const MASTER_KEY_DIRECTORY_MODE = 0o700;
const SECRET_DATABASE_HKDF_INFO = 'vibecanvas/secret-store/turso/aegis256/v1';
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'ascii');
const TURSO_ENCRYPTED_HEADER = Buffer.from('Turso\0', 'ascii');
const DATABASE_STATE_FILE_NAMES = new Set([
  'data.db',
  'data.db.encryption-v2.tmp',
  'data.db.plaintext-v1.recovery',
]);

export const SECRET_STORE_MASTER_KEY_RELATIVE_PATH = join(
  'keys',
  'secret-store-master-key.v1.hex',
);

export interface ISecretStoreKeyProvider {
  getDatabaseHexKey(resourceId: string): Promise<string>;
}

export type TSecretStoreMasterKeyProviderConfig = {
  readonly configRoot: string;
  readonly dataRoot: string;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly platform?: NodeJS.Platform;
  readonly getUid?: () => number;
  readonly readDirectory?: (directoryPath: string) => Promise<Dirent[]>;
  readonly syncDirectory?: (directoryPath: string) => Promise<void>;
};

function keyUnavailable(): ActorResourceError {
  return new ActorResourceError(
    'SECRET_STORE_KEY_UNAVAILABLE',
    'The installation secret-store key is unavailable or unsafe.',
  );
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isExclusiveCreateConflict(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
}

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix);
}

export class SecretStoreMasterKeyProvider implements ISecretStoreKeyProvider {
  readonly #configRoot: string;
  readonly #dataRoot: string;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #platform: NodeJS.Platform;
  readonly #getUid: (() => number) | undefined;
  readonly #readDirectory: (directoryPath: string) => Promise<Dirent[]>;
  readonly #syncDirectoryOverride: ((directoryPath: string) => Promise<void>) | undefined;
  #masterKeyPromise: Promise<Buffer> | null = null;

  constructor(config: TSecretStoreMasterKeyProviderConfig) {
    this.#configRoot = config.configRoot;
    this.#dataRoot = config.dataRoot;
    this.#randomBytes = config.randomBytes ?? nodeRandomBytes;
    this.#platform = config.platform ?? process.platform;
    this.#getUid = config.getUid ?? process.getuid?.bind(process);
    this.#readDirectory = config.readDirectory
      ?? ((directoryPath) => readdir(directoryPath, { withFileTypes: true }));
    this.#syncDirectoryOverride = config.syncDirectory;
  }

  async getDatabaseHexKey(resourceId: string): Promise<string> {
    if (typeof resourceId !== 'string' || resourceId.length === 0) throw keyUnavailable();
    const masterKey = await this.#masterKey();
    const derived = Buffer.from(hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(resourceId, 'utf8'),
      Buffer.from(SECRET_DATABASE_HKDF_INFO, 'utf8'),
      MASTER_KEY_BYTE_LENGTH,
    ));
    try {
      return derived.toString('hex');
    } finally {
      derived.fill(0);
    }
  }

  #masterKey(): Promise<Buffer> {
    if (!this.#masterKeyPromise) {
      this.#masterKeyPromise = this.#loadOrCreateMasterKey().catch((error) => {
        if (error instanceof ActorResourceError) throw error;
        throw keyUnavailable();
      });
    }
    return this.#masterKeyPromise;
  }

  async #loadOrCreateMasterKey(): Promise<Buffer> {
    if (this.#platform === 'win32') {
      // Node does not provide a current-user-only ACL primitive. Fail closed until
      // the Windows host supplies an ACL-enforcing key provider.
      throw keyUnavailable();
    }

    const keyPath = join(this.#configRoot, SECRET_STORE_MASTER_KEY_RELATIVE_PATH);
    const pendingKeyPath = `${keyPath}.${process.pid}.${nodeRandomUUID()}.pending`;
    const keyDirectory = join(this.#configRoot, 'keys');
    this.#assertOutsideDataRoot(resolve(this.#dataRoot), resolve(keyPath));
    const firstCreatedDirectory = await mkdir(
      keyDirectory,
      { recursive: true, mode: MASTER_KEY_DIRECTORY_MODE },
    );
    await this.#assertPrivateDirectory(keyDirectory);
    if (firstCreatedDirectory !== undefined) {
      await this.#syncDirectory(this.#configRoot);
    }
    const [canonicalDataRoot, canonicalKeyDirectory] = await Promise.all([
      realpath(this.#dataRoot).catch((error) => {
        if (isMissingFileError(error)) return resolve(this.#dataRoot);
        throw error;
      }),
      realpath(keyDirectory),
    ]);
    this.#assertOutsideDataRoot(canonicalDataRoot, join(canonicalKeyDirectory, 'secret-store-master-key.v1.hex'));

    try {
      return await this.#readExistingKey(keyPath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    if (!(await this.#existingSecretFilesAllowNewKey())) {
      try {
        return await this.#readExistingKey(keyPath);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
      throw keyUnavailable();
    }

    const generated = Buffer.from(this.#randomBytes(MASTER_KEY_BYTE_LENGTH));
    if (generated.length !== MASTER_KEY_BYTE_LENGTH) {
      generated.fill(0);
      throw keyUnavailable();
    }
    const encoded = Buffer.from(generated.toString('hex'), 'ascii');
    generated.fill(0);

    let handle;
    try {
      handle = await open(
        pendingKeyPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        MASTER_KEY_FILE_MODE,
      );
      await handle.writeFile(encoded);
      await handle.sync();
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        await unlink(pendingKeyPath).catch(() => undefined);
      }
      throw error;
    } finally {
      encoded.fill(0);
      await handle?.close().catch(() => undefined);
    }

    await this.#publishPendingKey(pendingKeyPath, keyPath, keyDirectory);
    return this.#readExistingKey(keyPath);
  }

  async #publishPendingKey(pendingKeyPath: string, keyPath: string, keyDirectory: string): Promise<void> {
    const pendingKey = await this.#readExistingKey(pendingKeyPath);
    pendingKey.fill(0);
    try {
      await link(pendingKeyPath, keyPath);
      await this.#syncDirectory(keyDirectory);
    } catch (error) {
      if (!isExclusiveCreateConflict(error)) throw error;
    }
    await unlink(pendingKeyPath).catch((error) => {
      if (!isMissingFileError(error)) throw error;
    });
    await this.#syncDirectory(keyDirectory);
  }

  async #readExistingKey(keyPath: string): Promise<Buffer> {
    const before = await lstat(keyPath);
    if (before.isSymbolicLink() || !before.isFile()) throw keyUnavailable();
    this.#assertPrivateFileMetadata(before);

    const handle = await open(keyPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile()
        || opened.dev !== before.dev
        || opened.ino !== before.ino
      ) {
        throw keyUnavailable();
      }
      this.#assertPrivateFileMetadata(opened);
      const encoded = await handle.readFile();
      try {
        if (
          encoded.length !== MASTER_KEY_HEX_LENGTH
          || !/^[0-9a-f]{64}$/.test(encoded.toString('ascii'))
        ) {
          throw keyUnavailable();
        }
        return Buffer.from(encoded.toString('ascii'), 'hex');
      } finally {
        encoded.fill(0);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async #assertPrivateDirectory(directoryPath: string): Promise<void> {
    const details = await lstat(directoryPath);
    if (details.isSymbolicLink() || !details.isDirectory()) throw keyUnavailable();
    if ((details.mode & 0o777) !== MASTER_KEY_DIRECTORY_MODE) throw keyUnavailable();
    this.#assertOwner(details.uid);
  }

  #assertPrivateFileMetadata(details: { readonly mode: number; readonly uid: number }): void {
    if ((details.mode & 0o777) !== MASTER_KEY_FILE_MODE) throw keyUnavailable();
    this.#assertOwner(details.uid);
  }

  #assertOwner(uid: number): void {
    if (!this.#getUid || uid !== this.#getUid()) throw keyUnavailable();
  }

  #assertOutsideDataRoot(dataRoot: string, keyPath: string): void {
    const relativePath = relative(dataRoot, keyPath);
    if (
      relativePath === ''
      || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
    ) {
      throw keyUnavailable();
    }
  }

  async #existingSecretFilesAllowNewKey(): Promise<boolean> {
    const secretRoot = join(this.#dataRoot, 'actor-resources', 'secret-store');
    let resourceDirectories;
    try {
      resourceDirectories = await this.#readDirectory(secretRoot);
    } catch (error) {
      if (isMissingFileError(error)) return true;
      throw error;
    }

    for (const resourceDirectory of resourceDirectories) {
      if (!resourceDirectory.isDirectory() || resourceDirectory.isSymbolicLink()) return false;
      const files = await this.#readDirectory(join(secretRoot, resourceDirectory.name));
      const fileNames = new Set(files.map((file) => file.name));
      if (![...DATABASE_STATE_FILE_NAMES].some((databaseFileName) => fileNames.has(databaseFileName))) {
        return false;
      }
      for (const databaseFileName of DATABASE_STATE_FILE_NAMES) {
        const hasOrphanedSidecar = ['-wal', '-shm', '-tshm'].some((suffix) => (
          fileNames.has(`${databaseFileName}${suffix}`) && !fileNames.has(databaseFileName)
        ));
        if (hasOrphanedSidecar) return false;
      }
      for (const file of files) {
        if (!DATABASE_STATE_FILE_NAMES.has(file.name)) continue;
        if (!file.isFile() || file.isSymbolicLink()) return false;
        if (!(await this.#isPlaintextDatabaseFile(join(secretRoot, resourceDirectory.name, file.name)))) return false;
      }
    }
    return true;
  }

  async #isPlaintextDatabaseFile(databasePath: string): Promise<boolean> {
    const before = await lstat(databasePath);
    if (before.isSymbolicLink() || !before.isFile()) return false;
    const handle = await open(databasePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const header = Buffer.alloc(SQLITE_HEADER.length);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return false;
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const contents = header.subarray(0, bytesRead);
      if (startsWith(contents, TURSO_ENCRYPTED_HEADER)) return false;
      return startsWith(contents, SQLITE_HEADER);
    } finally {
      header.fill(0);
      await handle.close().catch(() => undefined);
    }
  }

  async #syncDirectory(directoryPath: string): Promise<void> {
    if (this.#syncDirectoryOverride) {
      await this.#syncDirectoryOverride(directoryPath);
      return;
    }
    const directory = await open(directoryPath, fsConstants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close().catch(() => undefined);
    }
  }
}
