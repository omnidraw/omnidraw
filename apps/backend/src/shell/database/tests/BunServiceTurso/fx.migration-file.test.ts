import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../../DbServiceTurso/read-migration-file';

describe('immutable migration file reads', () => {
  test('derives SQL and checksum from one exact byte snapshot', async () => {
    const firstSql = 'CREATE TABLE exact_bytes (id INTEGER PRIMARY KEY) STRICT;';
    const replacementSql = 'CREATE TABLE swapped_bytes (id INTEGER PRIMARY KEY) STRICT;';
    const firstBytes = new TextEncoder().encode(firstSql);
    let arrayBufferReads = 0;
    let textReads = 0;
    const fakeBun = {
      CryptoHasher: Bun.CryptoHasher,
      file: () => ({
        arrayBuffer: async () => {
          arrayBufferReads += 1;
          return firstBytes.slice().buffer;
        },
        text: async () => {
          textReads += 1;
          return replacementSql;
        },
      }),
    } as unknown as Pick<typeof Bun, 'CryptoHasher' | 'file'>;

    const migration = await readMigrationFile(
      { Bun: fakeBun, TextDecoder },
      { path: 'swapping-migration.sql' },
    );
    const expectedChecksum = new Bun.CryptoHasher('sha256')
      .update(firstBytes)
      .digest('hex');

    expect(migration).toEqual({
      checksumSha256: expectedChecksum,
      sql: firstSql,
    });
    expect(arrayBufferReads).toBe(1);
    expect(textReads).toBe(0);
  });
});
