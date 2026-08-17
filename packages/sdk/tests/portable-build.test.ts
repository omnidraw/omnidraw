import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  WIDGET_BUILD_RECEIPT_PATH,
  fnWidgetBuildReceiptIdentityMatches,
  parseWidgetBuildReceiptJson,
} from '../src/artifact';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const cliPath = join(repositoryRoot, 'packages/sdk/dist/cli.js');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

async function storedPackage(prefix: string, relativePath: string): Promise<string> {
  const store = join(repositoryRoot, 'node_modules/.bun');
  const name = (await readdir(store)).find((entry) => entry.startsWith(prefix));
  if (name === undefined) throw new Error(`Missing Bun store package ${prefix}.`);
  return join(store, name, 'node_modules', relativePath);
}

async function createProject(root: string): Promise<void> {
  await mkdir(join(root, 'ui'), { recursive: true });
  await mkdir(join(root, 'node_modules/@omnidraw'), { recursive: true });
  await symlink(
    await storedPackage('vite@8.1.4', 'vite'),
    join(root, 'node_modules/vite'),
    'dir',
  );
  await symlink(
    join(repositoryRoot, 'packages/sdk'),
    join(root, 'node_modules/@omnidraw/sdk'),
    'dir',
  );
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: 'portable-build-fixture',
    private: true,
    type: 'module',
    scripts: { build: 'omnidraw-widget build .' },
    dependencies: { '@omnidraw/sdk': '0.12.0' },
    devDependencies: { vite: '8.1.4' },
  }, null, 2)}\n`);
  await writeFile(join(root, 'omnidraw.json'), `${JSON.stringify({
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Portable Build Fixture',
    slug: 'portable-build-fixture',
    description: 'Exercises the external portable builder.',
    tool: { label: 'Portable Build Fixture', group: null, priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  }, null, 2)}\n`);
  await writeFile(join(root, 'ui/main.ts'), [
    'const node = document.createElement("div");',
    'node.textContent = "portable build ready";',
    'document.body.append(node);',
    '',
  ].join('\n'));
}

async function runBuild(root: string): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn(['node', cliPath, 'build', '.'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      OMNIDRAW_HOME: join(root, 'must-not-be-read'),
      OMNIDRAW_HOST_TOKEN: 'must-not-be-forwarded',
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

describe('omnidraw-widget portable build', () => {
  test('atomically emits deterministic outputs and an identity-valid receipt without host access', async () => {
    const root = await mkdtemp('/tmp/omnidraw-portable-build-');
    try {
      await createProject(root);
      const first = await runBuild(root);
      expect(first).toMatchObject({ exitCode: 0, stderr: '' });
      const firstReceiptText = await readFile(join(root, WIDGET_BUILD_RECEIPT_PATH), 'utf8');
      const firstMain = await readFile(join(root, 'dist/main.js'), 'utf8');
      const receipt = parseWidgetBuildReceiptJson(firstReceiptText);
      expect(fnWidgetBuildReceiptIdentityMatches({ receipt, digestSha256: digest })).toBe(true);
      expect(receipt.outputs.some((output) => output.path === 'dist/main.js')).toBe(true);
      expect(firstReceiptText).not.toContain(root);
      expect(firstReceiptText).not.toContain('must-not-be-forwarded');

      const second = await runBuild(root);
      expect(second.exitCode).toBe(0);
      expect(await readFile(join(root, WIDGET_BUILD_RECEIPT_PATH), 'utf8')).toBe(firstReceiptText);
      expect(await readFile(join(root, 'dist/main.js'), 'utf8')).toBe(firstMain);

      await writeFile(join(root, 'ui/main.ts'), 'this is not valid TypeScript !!!\n');
      const failed = await runBuild(root);
      expect(failed.exitCode).toBe(1);
      expect(await readFile(join(root, WIDGET_BUILD_RECEIPT_PATH), 'utf8')).toBe(firstReceiptText);
      expect(await readFile(join(root, 'dist/main.js'), 'utf8')).toBe(firstMain);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
