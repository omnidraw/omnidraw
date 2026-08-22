import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  PUBLIC_PACKAGE_DIRECTORIES,
  readQualifiedPublicPackages,
} from './public-packages';

const ROOT = resolve(import.meta.dir, '..');
const CANONICAL_REPOSITORY = 'git+https://github.com/omnidraw/omnidraw.git';

async function text(path: string): Promise<string> {
  return await readFile(join(ROOT, path), 'utf8');
}

const ACTIVE_TEXT_EXTENSION = /\.(?:cjs|css|html|js|json|jsx|md|mjs|sh|toml|ts|tsx|yaml|yml)$/i;

function trackedTextPaths(scopes: readonly string[]): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', ...scopes], {
    cwd: ROOT,
    encoding: 'utf8',
  }).split('\0').filter((path) => (
    path !== ''
    && ACTIVE_TEXT_EXTENSION.test(path)
    && existsSync(join(ROOT, path))
  ));
}

async function joinedTrackedText(paths: readonly string[]): Promise<string> {
  return (await Promise.all(paths.map(async (path) => `${path}\n${await text(path)}`))).join('\n');
}

describe('source release policy', () => {
  test('has one build-free production start command', async () => {
    const manifest = JSON.parse(await text('package.json')) as {
      scripts: Record<string, string | undefined>;
    };
    expect(manifest.scripts.start).toBe(
      'NODE_ENV=production bun run apps/backend/src/main.ts serve',
    );
    expect(manifest.scripts.prestart).toBeUndefined();
    expect(manifest.scripts['server:prod']).toBeUndefined();
    expect(manifest.scripts.start).not.toMatch(/\b(?:build|vite|tsc|install|stage)\b/);
    expect(manifest.scripts.build).toEndWith('bun run scripts/seal-source-release-build.ts');
  });

  test('keeps all publishable manifests on the canonical repository identity', async () => {
    const packages = await readQualifiedPublicPackages(ROOT);
    for (const entry of packages) {
      const repository = entry.manifest.repository as Record<string, unknown>;
      expect(repository).toEqual({
        type: 'git',
        url: CANONICAL_REPOSITORY,
        directory: PUBLIC_PACKAGE_DIRECTORIES[entry.name],
      });
    }
    expect((await Promise.all(packages.map((entry) => (
      text(`${PUBLIC_PACKAGE_DIRECTORIES[entry.name]}/package.json`)
    )))).join('\n')).not.toContain('vibecanvas/vibecanvas');
  });

  test('confines Git LFS to non-runtime documentation and task media', async () => {
    const rules = (await text('.gitattributes'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(/^(?:docs|tasks)\//);
      expect(rule).toMatch(/(?:filter=lfs|-filter)/);
    }
    const activeBuildSurface = await joinedTrackedText(trackedTextPaths([
      'apps',
      'packages',
      'scripts',
      '.github',
      'package.json',
      'bun.lock',
      'public-package-set.json',
      'tsconfig.json',
    ]));
    expect(activeBuildSurface).not.toMatch(/(?:docs|tasks)\/[^\s"']+\.(?:png|jpe?g|gif|webp|svg)/i);
  });

  test('keeps retired application release mechanisms out of active guidance', async () => {
    const fixedActivePaths = [
      'README.md',
      'package.json',
      'docs/internal/llm.how-to-deploy.md',
      ...Object.values(PUBLIC_PACKAGE_DIRECTORIES).flatMap((directory) => [
        `${directory}/package.json`,
        `${directory}/README.md`,
      ]),
    ];
    const discoveredActivePaths = trackedTextPaths(['scripts', '.github/workflows'])
      .filter((path) => path !== 'scripts/source-release-policy.test.ts');
    const activePaths = [...new Set([...fixedActivePaths, ...discoveredActivePaths])];
    const active = (await Promise.all(activePaths.map(async (path) => {
      try {
        return await text(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      }
    }))).join('\n');
    for (const retired of [
      /bun\s+build[^\n]*--compile/i,
      /bun run server:prod/i,
      /(?:npm|bun)\s+(?:install|add)[^\n]*(?:--global|\s-g\b)/i,
      /omnidraw\s+(?:self-update|upgrade|uninstall)\b/i,
      /(?:binary|executable)[-_ ](?:installer|updater|release workflow)/i,
    ]) expect(active).not.toMatch(retired);
  });

});
