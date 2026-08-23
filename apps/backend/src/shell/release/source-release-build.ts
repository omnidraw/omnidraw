import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export const SOURCE_RELEASE_RECEIPT_FORMAT = 'omnidraw.source-release-build.v1';
export const SOURCE_RELEASE_RECEIPT_PATH = 'apps/frontend/dist/.omnidraw-source-release-build.json';

const PUBLIC_PACKAGE_DIRECTORIES = [
  'packages/canvas-contract',
  'packages/canvas',
  'packages/sdk',
  'packages/component-ai-chat',
  'packages/theme',
] as const;

const SOURCE_INPUT_PATHS = [
  'package.json',
  'bun.lock',
  'public-package-set.json',
  'tsconfig.json',
  'scripts/seal-source-release-build.ts',
  'apps/backend/src/shell/release/source-release-build.ts',
  'apps/frontend/package.json',
  'apps/frontend/tsconfig.json',
  'apps/frontend/index.html',
  'apps/frontend/inspection',
  'apps/frontend/public',
  'apps/frontend/scripts',
  'apps/frontend/src',
  'apps/frontend/vite.config.ts',
  'apps/frontend/vite.inspection.config.ts',
  ...PUBLIC_PACKAGE_DIRECTORIES.flatMap((directory) => [
    `${directory}/package.json`,
    `${directory}/scripts`,
    `${directory}/src`,
    `${directory}/tsconfig.json`,
    `${directory}/tsconfig.build.json`,
    `${directory}/vite.config.ts`,
  ]),
] as const;

const SOURCE_OUTPUT_PATHS = [
  'apps/frontend/dist',
  ...PUBLIC_PACKAGE_DIRECTORIES.map((directory) => `${directory}/dist`),
] as const;

type TFileRecord = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

type TSourceReleaseReceipt = Readonly<{
  format: typeof SOURCE_RELEASE_RECEIPT_FORMAT;
  inputs: readonly TFileRecord[];
  outputs: readonly TFileRecord[];
}>;

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function collectFiles(root: string, configuredPaths: readonly string[]): Promise<string[]> {
  const files = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (metadata.isFile()) {
      if (normalizedRelative(root, path) !== SOURCE_RELEASE_RECEIPT_PATH) files.add(path);
      return;
    }
    if (!metadata.isDirectory()) return;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await visit(join(path, entry.name));
    }
  };
  for (const configuredPath of configuredPaths) await visit(resolve(root, configuredPath));
  return [...files].sort((left, right) => normalizedRelative(root, left).localeCompare(normalizedRelative(root, right)));
}

async function recordFiles(root: string, configuredPaths: readonly string[]): Promise<readonly TFileRecord[]> {
  const files = await collectFiles(root, configuredPaths);
  return await Promise.all(files.map(async (path) => {
    const bytes = await readFile(path);
    return Object.freeze({
      path: normalizedRelative(root, path),
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }));
}

function equalRecords(left: readonly TFileRecord[], right: readonly TFileRecord[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseReceipt(value: unknown): TSourceReleaseReceipt | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Partial<TSourceReleaseReceipt>;
  if (receipt.format !== SOURCE_RELEASE_RECEIPT_FORMAT) return null;
  if (!Array.isArray(receipt.inputs) || !Array.isArray(receipt.outputs)) return null;
  const validRecords = (records: readonly unknown[]): records is readonly TFileRecord[] => records.every((record) => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
    const candidate = record as Partial<TFileRecord>;
    return typeof candidate.path === 'string'
      && typeof candidate.bytes === 'number'
      && Number.isSafeInteger(candidate.bytes)
      && candidate.bytes >= 0
      && typeof candidate.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(candidate.sha256);
  });
  return validRecords(receipt.inputs) && validRecords(receipt.outputs)
    ? receipt as TSourceReleaseReceipt
    : null;
}

export async function collectSourceReleaseOutputRecords(repositoryRoot: string): Promise<readonly TFileRecord[]> {
  return await recordFiles(repositoryRoot, SOURCE_OUTPUT_PATHS);
}

export async function sealSourceReleaseBuild(repositoryRoot: string): Promise<TSourceReleaseReceipt> {
  const inputs = await recordFiles(repositoryRoot, SOURCE_INPUT_PATHS);
  const outputs = await collectSourceReleaseOutputRecords(repositoryRoot);
  const completeOutputs = SOURCE_OUTPUT_PATHS.every((directory) => (
    outputs.some((record) => record.path.startsWith(`${directory}/`))
  ));
  if (inputs.length === 0 || !completeOutputs || !outputs.some((record) => record.path === 'apps/frontend/dist/index.html')) {
    throw new Error('The complete source release has not been built.');
  }
  const receipt = Object.freeze({
    format: SOURCE_RELEASE_RECEIPT_FORMAT,
    inputs,
    outputs,
  });
  await writeFile(resolve(repositoryRoot, SOURCE_RELEASE_RECEIPT_PATH), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function assertSourceReleaseBuild(repositoryRoot: string): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(repositoryRoot, SOURCE_RELEASE_RECEIPT_PATH), 'utf8'));
  } catch {
    throw new Error('The source-release build receipt is missing or unreadable.');
  }
  const receipt = parseReceipt(value);
  if (receipt === null) throw new Error('The source-release build receipt is malformed.');
  const [inputs, outputs] = await Promise.all([
    recordFiles(repositoryRoot, SOURCE_INPUT_PATHS),
    collectSourceReleaseOutputRecords(repositoryRoot),
  ]);
  if (!equalRecords(receipt.inputs, inputs)) throw new Error('Source inputs changed after the release build.');
  if (!equalRecords(receipt.outputs, outputs)) throw new Error('Built release outputs are incomplete or changed.');
}

export function sourceReleaseBuildErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Omnidraw cannot start because the built application is missing or stale. Run \`bun run build\` and try again.\n${detail}`;
}
