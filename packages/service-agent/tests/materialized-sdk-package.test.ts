import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { SDK_PACKAGE_ASSETS } from '../src/workspace/CONSTANTS';

const RELATIVE_IMPORT = /(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g;

describe('materialized widget SDK package', () => {
  test('contains the complete relative TypeScript module closure', async () => {
    const assets = new Map<string, string>(SDK_PACKAGE_ASSETS.map((asset) => [
      asset.relativePath,
      asset.sourcePath,
    ]));

    for (const [relativePath, sourcePath] of assets) {
      const source = await readFile(sourcePath, 'utf8');
      for (const match of source.matchAll(RELATIVE_IMPORT)) {
        const specifier = match[1]!;
        const resolved = posix.normalize(posix.join(
          posix.dirname(relativePath),
          specifier.endsWith('.ts') ? specifier : `${specifier}.ts`,
        ));
        expect(assets.has(resolved), `${relativePath} imports missing ${resolved}`).toBe(true);
      }
    }
  });
});
