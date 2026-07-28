import { describe, expect, test } from 'bun:test';
import { fnBuildWidgetCreateManifest } from '../src/tools/fn.widget-create';
import { txWriteWidgetScaffold } from '../src/tools/tx.scaffold';

describe('Capsule widget authoring scaffold', () => {
  test('creates a strict manifest-v3 plain-DOM widget with only supported dependencies', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'Focus Timer',
      description: 'A focused timer',
    });
    const changed = await txWriteWidgetScaffold({
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      join: (...paths) => paths.join('/'),
    }, {
      cwd: '/draft',
      manifest,
      sdkDependency: '0.1.0',
      capsuleDependency: '0.9.4',
    });

    expect(manifest).toEqual({
      schemaVersion: 3,
      name: 'Focus Timer',
      slug: 'focus-timer',
      description: 'A focused timer',
      ui: {
        runtime: 'capsule',
        entry: 'ui/main.ts',
        target: {
          runtimeAbi: 'quickjs-release-sync-v1',
          domProfile: 'dom-core-v2',
          featureProfiles: [
            'artifact-resources-v1',
            'css-network-images-v1',
            'shadow-browser-css-v1',
          ],
        },
      },
    });
    expect(changed).toEqual([
      'vibecanvas.json',
      'package.json',
      'vite.config.mjs',
      'tsconfig.json',
      'ui/main.ts',
      'ui/styles.css',
    ]);
    expect(JSON.parse(files.get('/draft/package.json')!)).toMatchObject({
      dependencies: {
        '@omnidraw/capsule': '0.9.4',
        '@vibecanvas/sdk': '0.1.0',
        zod: '4.4.3',
      },
      devDependencies: {
        typescript: '5.9.3',
        vite: '8.1.4',
      },
    });
    expect(files.get('/draft/vite.config.mjs')).toContain('entryFileNames: "main.js"');
    expect(files.get('/draft/vite.config.mjs')).not.toContain('preserveSymlinks');
    expect(JSON.parse(files.get('/draft/tsconfig.json')!)).toMatchObject({
      compilerOptions: { jsx: 'react-jsx' },
      include: expect.arrayContaining(['ui/**/*.ts', 'ui/**/*.tsx']),
    });
    expect(files.get('/draft/ui/main.ts')).toContain('document.createElement');
    expect(files.get('/draft/ui/main.ts')).toContain('document.body.append');
    expect(files.get('/draft/ui/main.ts')).not.toContain('@omnidraw/capsule/guest');
    expect(files.get('/draft/ui/main.ts')).not.toContain('export default');
  });
});
