import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { hkdfSync } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActorResourceError } from '../src/resources/ActorResourceError';
import {
  SECRET_STORE_MASTER_KEY_RELATIVE_PATH,
  SecretStoreMasterKeyProvider,
} from '../src/resources/SecretStoreKeyProvider';

describe('SecretStoreMasterKeyProvider', () => {
  let rootDir = '';
  let configRoot = '';
  let dataRoot = '';

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-secret-store-key-'));
    configRoot = join(rootDir, 'config');
    dataRoot = join(rootDir, 'data');
    await mkdir(dataRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('atomically creates one private installation key and derives distinct deterministic resource keys', async () => {
    const masterKey = Buffer.alloc(32, 0x5a);
    const provider = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => masterKey,
    });
    const first = await provider.getDatabaseHexKey('resource-a');
    const second = await provider.getDatabaseHexKey('resource-b');
    const restarted = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0xff),
    });

    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
    expect(await restarted.getDatabaseHexKey('resource-a')).toBe(first);
    expect(first).toBe(Buffer.from(hkdfSync(
      'sha256',
      masterKey,
      Buffer.from('resource-a'),
      Buffer.from('vibecanvas/secret-store/turso/aegis256/v1'),
      32,
    )).toString('hex'));

    const keyPath = join(configRoot, SECRET_STORE_MASTER_KEY_RELATIVE_PATH);
    expect(await readFile(keyPath, 'utf8')).toBe(masterKey.toString('hex'));
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(configRoot, 'keys'))).mode & 0o777).toBe(0o700);
  });

  test('separate providers racing first use load the single atomically published winner', async () => {
    const first = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x11),
    });
    const second = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x22),
    });

    const [firstKey, secondKey] = await Promise.all([
      first.getDatabaseHexKey('shared-resource'),
      second.getDatabaseHexKey('shared-resource'),
    ]);
    expect(firstKey).toBe(secondKey);
    const persisted = await readFile(join(configRoot, SECRET_STORE_MASTER_KEY_RELATIVE_PATH), 'utf8');
    expect([Buffer.alloc(32, 0x11).toString('hex'), Buffer.alloc(32, 0x22).toString('hex')]).toContain(persisted);
  });

  test('syncs the config root when creating the keys directory but not when it already exists', async () => {
    const firstSyncs: string[] = [];
    const first = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x23),
      syncDirectory: async (directoryPath) => {
        firstSyncs.push(directoryPath);
      },
    });
    await first.getDatabaseHexKey('resource');

    const keyDirectory = join(configRoot, 'keys');
    expect(firstSyncs).toEqual([configRoot, keyDirectory, keyDirectory]);

    const existingSyncs: string[] = [];
    const restarted = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      syncDirectory: async (directoryPath) => {
        existingSyncs.push(directoryPath);
      },
    });
    await restarted.getDatabaseHexKey('resource');
    expect(existingSyncs).toEqual([]);
  });

  test('re-reads a key published while a stale provider is rejecting new key creation', async () => {
    const secretRoot = join(dataRoot, 'actor-resources', 'secret-store');
    let releaseScan: () => void = () => undefined;
    let markScanStarted: () => void = () => undefined;
    const scanStarted = new Promise<void>((resolve) => {
      markScanStarted = resolve;
    });
    const scanReleased = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    let paused = false;
    let staleGenerated = false;
    const stale = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => {
        staleGenerated = true;
        return Buffer.alloc(32, 0x77);
      },
      readDirectory: async (directoryPath) => {
        if (!paused && directoryPath === secretRoot) {
          paused = true;
          markScanStarted();
          await scanReleased;
        }
        return readdir(directoryPath, { withFileTypes: true });
      },
    });
    const staleKeyPromise = stale.getDatabaseHexKey('shared-resource');
    await scanStarted;

    const winner = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x88),
    });
    const winnerKey = await winner.getDatabaseHexKey('shared-resource');
    const secretDirectory = join(secretRoot, 'encrypted-resource');
    await mkdir(secretDirectory, { recursive: true });
    await writeFile(join(secretDirectory, 'data.db'), Buffer.from('Turso\0encrypted'));
    releaseScan();

    await expect(staleKeyPromise).resolves.toBe(winnerKey);
    expect(staleGenerated).toBe(false);
  });

  test('ignores an unpublished partial crash candidate without exposing a partial final key', async () => {
    const keyDirectory = join(configRoot, 'keys');
    await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(keyDirectory, 'secret-store-master-key.v1.hex.123.crashed.pending'),
      'partial',
      { mode: 0o600 },
    );
    const provider = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x33),
    });

    await expect(provider.getDatabaseHexKey('resource')).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(configRoot, SECRET_STORE_MASTER_KEY_RELATIVE_PATH), 'utf8'))
      .toBe(Buffer.alloc(32, 0x33).toString('hex'));
  });

  test('fails closed for malformed keys, permission drift, symlinks, and unenforceable ACL platforms', async () => {
    const keyPath = join(configRoot, SECRET_STORE_MASTER_KEY_RELATIVE_PATH);
    await mkdir(join(configRoot, 'keys'), { recursive: true, mode: 0o700 });
    await writeFile(keyPath, 'not-a-key', { mode: 0o600 });
    await expect(new SecretStoreMasterKeyProvider({ configRoot, dataRoot }).getDatabaseHexKey('resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    await writeFile(keyPath, 'aa'.repeat(32), { mode: 0o600 });
    await chmod(keyPath, 0o644);
    await expect(new SecretStoreMasterKeyProvider({ configRoot, dataRoot }).getDatabaseHexKey('resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    await unlink(keyPath);
    const targetPath = join(rootDir, 'symlink-target');
    await writeFile(targetPath, 'aa'.repeat(32), { mode: 0o600 });
    await symlink(targetPath, keyPath);
    await expect(new SecretStoreMasterKeyProvider({ configRoot, dataRoot }).getDatabaseHexKey('resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    await expect(new SecretStoreMasterKeyProvider({ configRoot, dataRoot, platform: 'win32' }).getDatabaseHexKey('resource'))
      .rejects.toBeInstanceOf(ActorResourceError);
  });

  test('rejects short randomness and refuses to replace a missing key beside encrypted files', async () => {
    const short = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(31),
    });
    await expect(short.getDatabaseHexKey('resource')).rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    await rm(configRoot, { recursive: true, force: true });
    const secretDirectory = join(dataRoot, 'actor-resources', 'secret-store', 'encrypted-resource');
    await mkdir(secretDirectory, { recursive: true });
    await writeFile(join(secretDirectory, 'data.db'), Buffer.from('Turso\0encrypted'));
    let generated = false;
    const missing = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0x44);
      },
    });
    await expect(missing.getDatabaseHexKey('resource')).rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    expect(generated).toBe(false);

    await rm(join(secretDirectory, 'data.db'));
    await writeFile(join(secretDirectory, 'data.db-wal'), Buffer.from('encrypted-or-unknown-wal'));
    const orphanedWal = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0x45);
      },
    });
    await expect(orphanedWal.getDatabaseHexKey('resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    expect(generated).toBe(false);
  });

  test('permits first-upgrade key creation only when existing database candidates are plaintext', async () => {
    const secretDirectory = join(dataRoot, 'actor-resources', 'secret-store', 'legacy-resource');
    await mkdir(secretDirectory, { recursive: true });
    await writeFile(join(secretDirectory, 'data.db'), Buffer.from('SQLite format 3\0legacy'));
    const provider = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => Buffer.alloc(32, 0x55),
    });
    await expect(provider.getDatabaseHexKey('legacy-resource')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  test('refuses key creation for an empty pre-existing secret resource directory', async () => {
    await mkdir(join(dataRoot, 'actor-resources', 'secret-store', 'unknown-resource'), { recursive: true });
    let generated = false;
    const provider = new SecretStoreMasterKeyProvider({
      configRoot,
      dataRoot,
      randomBytes: () => {
        generated = true;
        return Buffer.alloc(32, 0x66);
      },
    });
    await expect(provider.getDatabaseHexKey('unknown-resource'))
      .rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
    expect(generated).toBe(false);
  });

  test('keeps the key outside the data root, including canonical symlink nesting', async () => {
    const nestedConfig = join(dataRoot, 'config');
    await expect(new SecretStoreMasterKeyProvider({
      configRoot: nestedConfig,
      dataRoot,
    }).getDatabaseHexKey('resource')).rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });

    const canonicalNested = join(dataRoot, 'canonical-config');
    await mkdir(canonicalNested, { recursive: true });
    const linkedConfig = join(rootDir, 'linked-config');
    await symlink(canonicalNested, linkedConfig);
    await expect(new SecretStoreMasterKeyProvider({
      configRoot: linkedConfig,
      dataRoot,
    }).getDatabaseHexKey('resource')).rejects.toMatchObject({ code: 'SECRET_STORE_KEY_UNAVAILABLE' });
  });
});
