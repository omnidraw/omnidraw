import { describe, expect, test } from 'bun:test';
import { posix } from 'node:path';
import {
  walkFiles,
  type TDirent,
  type TEffectsWalkFiles,
} from '../workspace/walk-files';

type TVirtualTree = Readonly<Record<string, readonly TDirent[]>>;

function file(name: string): TDirent {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  };
}

function directory(name: string): TDirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  };
}

function effects(tree: TVirtualTree): TEffectsWalkFiles {
  return {
    readdir: async (path) => [...(tree[path] ?? [])],
    join: posix.join,
    relative: posix.relative,
  };
}

describe('walkFiles', () => {
  test('returns deterministic authored files and skips dependency and generated trees', async () => {
    const dependencyFiles = Array.from(
      { length: 7_116 },
      (_, index) => file(`dependency-${index}.js`),
    );
    const tree: TVirtualTree = {
      '/widget': [
        directory('node_modules'),
        directory('dist'),
        directory('.cache'),
        directory('ui'),
        file('omnidraw.json'),
        file('package.json'),
      ],
      '/widget/node_modules': dependencyFiles,
      '/widget/dist': [file('bundle.js')],
      '/widget/.cache': [file('metadata.json')],
      '/widget/ui': [
        directory('build'),
        directory('node_modules'),
        file('styles.css'),
        file('main.ts'),
      ],
      '/widget/ui/build': [file('authored-entry.ts')],
      '/widget/ui/node_modules': [file('nested-dependency.js')],
    };

    await expect(walkFiles(effects(tree), { root: '/widget' })).resolves.toEqual([
      'omnidraw.json',
      'package.json',
      'ui/build/authored-entry.ts',
      'ui/main.ts',
      'ui/styles.css',
    ]);
  });
});
