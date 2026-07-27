import { describe, expect, test } from 'bun:test';
import { readFile, readdir, readlink, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

async function openFileNames(pid: number): Promise<string[]> {
  const procFd = `/proc/${pid}/fd`;
  if (await stat(procFd).then(() => true, () => false)) {
    const names = await readdir(procFd);
    return (await Promise.all(names.map((name) => (
      readlink(join(procFd, name)).catch(() => '')
    )))).filter(Boolean);
  }

  const command = Bun.spawn(['lsof', '-Fn', '-p', String(pid)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, output] = await Promise.all([
    command.exited,
    new Response(command.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`Unable to inspect open files for process ${pid}.`);
  return output.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

const descriptorInspectionAvailable = await openFileNames(process.pid).then(
  () => true,
  () => false,
);
const descriptorInspectionRequired = process.env.VIBECANVAS_REQUIRE_FD_INSPECTION === '1';
describe('M4 resource runtime boundaries', () => {
  test('provides file-descriptor inspection when final acceptance requires it', () => {
    if (!descriptorInspectionRequired) return;
    expect(
      descriptorInspectionAvailable,
      'VIBECANVAS_REQUIRE_FD_INSPECTION=1 requires readable /proc/<pid>/fd or a working lsof command.',
    ).toBe(true);
  });

  test('keeps resource-runtime independent from database and API implementations', async () => {
    const roots = [
      join(REPO_ROOT, 'packages/resource-runtime/src'),
      join(REPO_ROOT, 'packages/api/src/resource'),
    ];
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const name = relative(REPO_ROOT, file);
      if (file.includes(`${sep}resource-runtime${sep}`) && /@vibecanvas\/(?:service-db|api)/.test(source)) {
        violations.push(`${name}: resource runtime imports a database/API implementation`);
      }
      if (file.includes(`${sep}api${sep}src${sep}resource${sep}`) && /@vibecanvas\/service-db/.test(source)) {
        violations.push(`${name}: neutral resource API imports a database implementation`);
      }
    }

    expect(violations).toEqual([]);
  });

});
