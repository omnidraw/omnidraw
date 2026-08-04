import { describe, expect, test } from 'bun:test';

const PORTABLE_FILES = [
  '../src/filesystem/typed.ts',
  '../src/filesystem/schema.ts',
  '../src/filesystem/index.ts',
  '../src/core/fn.filesystem-path.ts',
  '../src/core/fn.filesystem-manifest.ts',
  '../src/core/fn.filesystem-input.ts',
  '../src/core/fn.filesystem-change.ts',
  '../src/core/fn.filesystem-release.ts',
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
