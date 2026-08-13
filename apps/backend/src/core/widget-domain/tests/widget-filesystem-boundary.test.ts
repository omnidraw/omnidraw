import { describe, expect, test } from 'bun:test';

const PORTABLE_FILES = [
  '../filesystem/typed.ts',
  '../filesystem/schema.ts',
  '../filesystem/index.ts',
  '../fn.filesystem-path.ts',
  '../fn.filesystem-manifest.ts',
  '../fn.filesystem-input.ts',
  '../fn.filesystem-change.ts',
  '../fn.filesystem-release.ts',
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
