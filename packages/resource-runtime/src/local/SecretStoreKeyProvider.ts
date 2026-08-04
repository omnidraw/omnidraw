/**
 * @file Database-backed per-resource encryption-key custody for secret stores.
 */
import { randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from 'node:crypto';
import { ResourceError } from '../ResourceError';

const DATABASE_KEY_BYTE_LENGTH = 32;
const DATABASE_KEY_HEX_LENGTH = DATABASE_KEY_BYTE_LENGTH * 2;

export const SECRET_STORE_DATABASE_KEY_PURPOSE = 'resource-data';
export const SECRET_STORE_DATABASE_KEY_ALGORITHM = 'aegis-256';

export interface ISecretStoreKeyProvider {
  getDatabaseHexKey(resourceId: string): Promise<string>;
  getOrCreateDatabaseHexKey(resourceId: string): Promise<string>;
}

export type TStoredEncryptionKey = {
  readonly id: string;
  readonly purpose: string;
  readonly algorithm: string;
  readonly keyHex: string;
  readonly createdAtSec: string;
};

export interface IResourceEncryptionKeyStore {
  get(args: { resourceId: string }): Promise<TStoredEncryptionKey | null>;
  getOrCreate(args: {
    resourceId: string;
    keyId: string;
    purpose: string;
    algorithm: string;
    keyHex: string;
  }): Promise<TStoredEncryptionKey>;
}

export type TSecretStoreDatabaseKeyProviderConfig = {
  readonly encryptionKeys: IResourceEncryptionKeyStore;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly randomUUID?: () => string;
};

function keyUnavailable(): ResourceError {
  return new ResourceError(
    'SECRET_STORE_KEY_UNAVAILABLE',
    'The secret-store database encryption key is unavailable or invalid.',
  );
}

function decodeStoredDatabaseKey(stored: TStoredEncryptionKey): string {
  if (
    stored.id.length === 0
    || stored.purpose !== SECRET_STORE_DATABASE_KEY_PURPOSE
    || stored.algorithm !== SECRET_STORE_DATABASE_KEY_ALGORITHM
    || stored.keyHex.length !== DATABASE_KEY_HEX_LENGTH
    || !/^[0-9a-f]{64}$/.test(stored.keyHex)
  ) {
    throw keyUnavailable();
  }
  return stored.keyHex;
}

export class SecretStoreDatabaseKeyProvider implements ISecretStoreKeyProvider {
  readonly #encryptionKeys: IResourceEncryptionKeyStore;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #randomUUID: () => string;
  readonly #databaseKeys = new Map<string, string>();
  readonly #databaseKeyCreationPromises = new Map<string, Promise<string>>();

  constructor(config: TSecretStoreDatabaseKeyProviderConfig) {
    this.#encryptionKeys = config.encryptionKeys;
    this.#randomBytes = config.randomBytes ?? nodeRandomBytes;
    this.#randomUUID = config.randomUUID ?? nodeRandomUUID;
  }

  async getDatabaseHexKey(resourceId: string): Promise<string> {
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw keyUnavailable();
    }

    const cached = this.#databaseKeys.get(resourceId);
    if (cached) return cached;

    try {
      const existing = await this.#encryptionKeys.get({ resourceId });
      if (!existing) throw keyUnavailable();
      const databaseHexKey = decodeStoredDatabaseKey(existing);
      this.#databaseKeys.set(resourceId, databaseHexKey);
      return databaseHexKey;
    } catch (error) {
      if (error instanceof ResourceError) throw error;
      throw keyUnavailable();
    }
  }

  getOrCreateDatabaseHexKey(resourceId: string): Promise<string> {
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      return Promise.reject(keyUnavailable());
    }

    const cached = this.#databaseKeys.get(resourceId);
    if (cached) return Promise.resolve(cached);

    const pending = this.#databaseKeyCreationPromises.get(resourceId);
    if (pending) return pending;

    const creation = this.#loadOrCreateDatabaseKey(resourceId)
      .then((databaseHexKey) => {
        this.#databaseKeys.set(resourceId, databaseHexKey);
        return databaseHexKey;
      })
      .catch((error) => {
        if (error instanceof ResourceError) throw error;
        throw keyUnavailable();
      })
      .finally(() => {
        this.#databaseKeyCreationPromises.delete(resourceId);
      });
    this.#databaseKeyCreationPromises.set(resourceId, creation);
    return creation;
  }

  async #loadOrCreateDatabaseKey(resourceId: string): Promise<string> {
    const existing = await this.#encryptionKeys.get({ resourceId });
    if (existing) return decodeStoredDatabaseKey(existing);

    const generated = Buffer.from(this.#randomBytes(DATABASE_KEY_BYTE_LENGTH));
    if (generated.length !== DATABASE_KEY_BYTE_LENGTH) {
      generated.fill(0);
      throw keyUnavailable();
    }

    let candidateHex = '';
    try {
      candidateHex = generated.toString('hex');
    } finally {
      generated.fill(0);
    }

    const stored = await this.#encryptionKeys.getOrCreate({
      resourceId,
      keyId: this.#randomUUID(),
      purpose: SECRET_STORE_DATABASE_KEY_PURPOSE,
      algorithm: SECRET_STORE_DATABASE_KEY_ALGORITHM,
      keyHex: candidateHex,
    });
    return decodeStoredDatabaseKey(stored);
  }
}
