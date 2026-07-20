import { createHash } from 'node:crypto';
import type { ISecretStoreKeyProvider } from '../src/resources/SecretStoreKeyProvider';

export function testSecretStoreDatabaseHexKey(resourceId: string): string {
  return createHash('sha256').update(`vibecanvas-test-secret-store:${resourceId}`).digest('hex');
}

export const testSecretStoreKeyProvider: ISecretStoreKeyProvider = {
  async getDatabaseHexKey(resourceId) {
    return testSecretStoreDatabaseHexKey(resourceId);
  },
  async getOrCreateDatabaseHexKey(resourceId) {
    return testSecretStoreDatabaseHexKey(resourceId);
  },
};
