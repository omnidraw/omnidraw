import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSourceReleaseBuild,
  sealSourceReleaseBuild,
  sourceReleaseBuildErrorMessage,
} from '../src/shell/release/source-release-build';

const OUTPUT_DIRECTORIES = [
  'apps/frontend/dist',
  'packages/canvas-contract/dist',
  'packages/canvas/dist',
  'packages/sdk/dist',
  'packages/component-ai-chat/dist',
  'packages/theme/dist',
] as const;

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function sourceReleaseFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-source-release-build-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
  for (const directory of OUTPUT_DIRECTORIES) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(
      join(root, directory, directory === 'apps/frontend/dist' ? 'index.html' : 'index.js'),
      `${directory}\n`,
    );
  }
  return root;
}

describe('source-release build receipt', () => {
  test('accepts the exact sealed inputs and outputs', async () => {
    const root = await sourceReleaseFixture();
    await sealSourceReleaseBuild(root);
    await expect(assertSourceReleaseBuild(root)).resolves.toBeUndefined();
  });

  test('rejects missing, stale, and changed release builds with actionable guidance', async () => {
    const root = await sourceReleaseFixture();
    await expect(assertSourceReleaseBuild(root)).rejects.toThrow('receipt is missing');

    await sealSourceReleaseBuild(root);
    await writeFile(join(root, 'package.json'), '{"name":"changed"}\n');
    await expect(assertSourceReleaseBuild(root)).rejects.toThrow('Source inputs changed');

    await sealSourceReleaseBuild(root);
    await writeFile(join(root, 'apps/frontend/dist/index.html'), 'changed output\n');
    await expect(assertSourceReleaseBuild(root)).rejects.toThrow('Built release outputs');

    expect(sourceReleaseBuildErrorMessage(new Error('detail'))).toContain(
      'Run `bun run build` and try again.',
    );
  });
});
