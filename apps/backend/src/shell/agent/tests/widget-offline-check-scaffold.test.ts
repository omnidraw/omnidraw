import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { fnBuildWidgetCreateManifest } from '../tools/fn.widget-create';
import { writeWidgetScaffold } from '../tools/widget-scaffold';

const repositoryRoot = resolve(import.meta.dir, '../../../../../..');
const cliPath = join(repositoryRoot, 'packages/sdk/dist/cli.js');

async function storedPackage(prefix: string, relativePath: string): Promise<string> {
  const store = join(repositoryRoot, 'node_modules/.bun');
  const name = (await readdir(store)).find((entry) => entry.startsWith(prefix));
  if (name === undefined) throw new Error(`Missing Bun store package ${prefix}.`);
  return join(store, name, 'node_modules', relativePath);
}

async function linkPackage(root: string, target: string, packagePath: string): Promise<void> {
  const destination = join(root, 'node_modules', ...packagePath.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await symlink(target, destination, 'dir');
}

async function runCheck(root: string): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn(['node', cliPath, 'check', '.', '--json'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      OMNIDRAW_HOME: join(root, '..', 'absent-home'),
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
  return { exitCode, stdout, stderr };
}

describe('generated widget offline check scripts', () => {
  for (const template of ['plain', 'react'] as const) {
    test(`${template} scaffold passes the public SDK checker without an Omnidraw host`, async () => {
      const root = await mkdtemp(`/tmp/omnidraw-${template}-offline-scaffold-`);
      try {
        const manifest = fnBuildWidgetCreateManifest({
          name: `${template} Offline Fixture`,
          template,
        });
        await writeWidgetScaffold({
          mkdir: async (path) => mkdir(path, { recursive: true }).then(() => undefined),
          writeFile: async (path, content) => {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content);
          },
          join,
        }, {
          cwd: root,
          manifest,
          sdkDependency: '0.9.1',
          template,
          server: false,
        });
        await linkPackage(root, await storedPackage('typescript@6.0.3', 'typescript'), 'typescript');
        if (template === 'react') {
          await linkPackage(root, await storedPackage('react@19.2.7', 'react'), 'react');
          await linkPackage(root, await storedPackage('react-dom@19.2.7', 'react-dom'), 'react-dom');
          await linkPackage(root, await storedPackage('@types+react@19.2.17', '@types/react'), '@types/react');
          await linkPackage(root, await storedPackage('@types+react-dom@19.2.3', '@types/react-dom'), '@types/react-dom');
        }
        const result = await runCheck(root);
        expect(result).toMatchObject({ exitCode: 0, stderr: '' });
        expect(JSON.parse(result.stdout)).toEqual({
          schemaVersion: 1,
          ok: true,
          scope: 'offline-project',
          checks: [],
          limitations: ['resource-existence-not-checked', 'preview-runtime-not-checked'],
          truncated: false,
        });
        const packageJson = JSON.parse(await Bun.file(join(root, 'package.json')).text());
        expect(packageJson.scripts).toEqual({
          check: 'omnidraw-widget check .',
          build: 'omnidraw-widget build .',
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
