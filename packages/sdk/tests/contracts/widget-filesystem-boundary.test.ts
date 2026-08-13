import { describe, expect, test } from 'bun:test';

const PORTABLE_FILES = [
  '../../src/contracts/filesystem/typed.ts',
  '../../src/contracts/schema.ts',
  '../../src/contracts/index.ts',
  '../../src/contracts/core/fn.filesystem-path.ts',
  '../../src/contracts/core/fn.filesystem-manifest.ts',
  '../../src/contracts/core/fn.filesystem-input.ts',
  '../../src/contracts/core/fn.filesystem-change.ts',
  '../../src/contracts/core/fn.filesystem-release.ts',
] as const;

describe('filesystem widget contract package boundary', () => {
  test('imports no database, application, filesystem, identity, or mutable service authority', async () => {
    for (const relativePath of PORTABLE_FILES) {
      const source = await Bun.file(new URL(relativePath, import.meta.url)).text();
      for (const forbidden of [
        '@omnidraw/service-',
        'service-db',
        '/apps/',
        "'node:fs",
        "'node:path",
        'Bun.file(',
        'process.',
      ]) expect(source, `${relativePath} contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});
