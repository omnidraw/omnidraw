import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
] as const;

const IMMUTABLE_SYSTEM_SCOPE_ALLOWLIST = new Set([
  'apps/cli/src/plugins/auth/CONSTANTS.ts',
  'packages/canvas/src/CONSTANTS.ts',
  'packages/service-db/src/CONSTANTS.ts',
  'packages/service-db/src/DbServiceTurso/DbServiceTurso.ts',
  'packages/service-db/src/DbServiceTurso/tx.account.ts',
  'packages/shared-functions/src/vibecanvas-config/CONSTANTS.ts',
  'packages/shared-functions/src/vibecanvas-config/fn.resolve-vibecanvas-home.ts',
]);

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of ['apps', 'packages']) {
    const glob = new Bun.Glob(`${root}/**/*.{ts,tsx}`);
    for await (const path of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
      if (path.includes('/node_modules/') || path.includes('/dist/')) continue;
      if (/\.(test|spec)\.[^.]+$/.test(path) || path.includes('/tests/')) continue;
      files.push(path);
    }
  }
  return files.sort();
}

describe('tenant authority boundary', () => {
  test('keeps default deployment IDs inside the reviewed immutable-system allowlist', async () => {
    const offenders: string[] = [];
    for (const path of await sourceFiles()) {
      const source = await Bun.file(resolve(REPO_ROOT, path)).text();
      if (!DEFAULT_IDS.some((id) => source.includes(id)) && !source.includes('DEFAULT_OSS_')) continue;
      if (!IMMUTABLE_SYSTEM_SCOPE_ALLOWLIST.has(path)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test('does not expose organization authority in public API payload source', async () => {
    const offenders: string[] = [];
    const glob = new Bun.Glob('packages/api/src/**/contract.ts');
    for await (const absolutePath of glob.scan({ cwd: REPO_ROOT, absolute: true, onlyFiles: true })) {
      const source = await Bun.file(absolutePath).text();
      if (/\b(?:orgId|organizationId)\b/.test(source)) {
        offenders.push(absolutePath.slice(REPO_ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
