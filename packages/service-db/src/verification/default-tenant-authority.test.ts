import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryDirectory = join(import.meta.dir, '..', 'DbServiceTurso');

describe('service-db tenant authority audit', () => {
  test('keeps the OSS organization constant out of customer-data repositories', () => {
    const filesUsingDefaultOrganization = readdirSync(repositoryDirectory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => readFileSync(join(repositoryDirectory, file), 'utf8')
        .includes('DEFAULT_OSS_ORGANIZATION_ID'))
      .sort();

    expect(filesUsingDefaultOrganization).toEqual([
      'DbServiceTurso.ts',
      'tx.account.ts',
    ]);
  });
});
