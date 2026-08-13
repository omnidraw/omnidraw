import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const dist = resolve(import.meta.dir, '..', 'dist');
const publicRoots = [
  'index.d.ts',
  'extension.d.ts',
  'types.d.ts',
  'debug-trace/index.d.ts',
] as const;

async function filesBelow(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }))).flat();
}

async function declarationTarget(source: string, specifier: string): Promise<string | null> {
  const base = resolve(dirname(source), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.d.ts`, join(base, 'index.d.ts')]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

const retained = new Set<string>();
const pending = publicRoots.map((path) => join(dist, path));
while (pending.length > 0) {
  const source = pending.pop()!;
  if (retained.has(source)) continue;
  retained.add(source);
  const text = await readFile(source, 'utf8');
  for (const match of text.matchAll(/["'](\.[^"']+)["']/g)) {
    const target = await declarationTarget(source, match[1]!);
    if (target !== null && !retained.has(target)) pending.push(target);
  }
}

for (const file of await filesBelow(dist)) {
  if (file.endsWith('.d.ts') && !retained.has(file)) await rm(file);
}

console.log(
  `[canvas] retained ${retained.size} public declaration files: ${[...retained]
    .map((path) => relative(dist, path))
    .sort()
    .join(', ')}`,
);
