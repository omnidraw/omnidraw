import { describe, expect, test } from 'bun:test';
import { fnBuildWidgetCreateManifest } from '../tools/fn.widget-create';
import { writeWidgetScaffold } from '../tools/widget-scaffold';

describe('portable widget authoring scaffold', () => {
  test('creates a strict manifest-v1 plain-DOM widget with only supported dependencies', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'Focus Timer',
      description: 'A focused timer named __OMNIDRAW_SDK_DEPENDENCY__',
    });
    const changed = await writeWidgetScaffold({
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      join: (...paths) => paths.join('/'),
    }, {
      cwd: '/draft',
      manifest,
      sdkDependency: '0.1.0',
      template: 'plain',
      server: false,
    });

    expect(manifest).toEqual({
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      name: 'Focus Timer',
      slug: 'focus-timer',
      description: 'A focused timer named __OMNIDRAW_SDK_DEPENDENCY__',
      tool: {
        label: 'Focus Timer',
        group: null,
        priority: 0,
      },
      ui: {
        runtime: 'capsule',
        entry: 'ui/main.ts',
        apis: ['DOM'],
      },
    });
    expect(changed).toEqual([
      'README.md',
      'omnidraw.json',
      'package.json',
      'vite.config.mjs',
      'tsconfig.json',
      'ui/assets.d.ts',
      'ui/main.ts',
      'ui/styles.css',
    ]);
    expect(files.get('/draft/omnidraw.json')).toContain('__OMNIDRAW_SDK_DEPENDENCY__');
    expect([...files.entries()].filter(([path]) => path !== '/draft/omnidraw.json')
      .every(([, content]) => !content.includes('__OMNIDRAW_'))).toBe(true);
    expect(JSON.parse(files.get('/draft/package.json')!)).toMatchObject({
      scripts: {
        check: 'omnidraw-widget check .',
        build: 'omnidraw-widget build .',
      },
      dependencies: {
        '@omnidraw/sdk': '0.1.0',
      },
      devDependencies: {
        typescript: '5.9.3',
        vite: '8.1.4',
      },
    });
    expect(files.get('/draft/vite.config.mjs')).toContain('entryFileNames: "main.js"');
    expect(files.get('/draft/vite.config.mjs')).not.toContain('preserveSymlinks');
    expect(files.get('/draft/vite.config.mjs')).toContain('.omnidraw/build-manifest.json');
    expect(files.get('/draft/vite.config.mjs')).not.toContain('./omnidraw.json');
    expect(JSON.parse(files.get('/draft/tsconfig.json')!)).toMatchObject({
      compilerOptions: { jsx: 'react-jsx' },
      include: expect.arrayContaining(['ui/**/*.ts', 'ui/**/*.tsx']),
    });
    expect(files.get('/draft/ui/main.ts')).toContain('document.createElement');
    expect(files.get('/draft/ui/main.ts')).toContain('document.body.append');
    expect(files.get('/draft/ui/styles.css')).toContain('height: 100%');
    expect(files.get('/draft/ui/main.ts')).not.toContain('@omnidraw/capsule/guest');
    expect(files.get('/draft/ui/main.ts')).not.toContain('export default');
    expect(files.get('/draft/README.md')).toContain('does not prove that a resource id exists');
  });

  test('creates a ready React scaffold without a second dependency edit', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'React Counter',
      description: 'A React counter',
      template: 'react',
    });
    const changed = await writeWidgetScaffold({
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      join: (...paths) => paths.join('/'),
    }, {
      cwd: '/draft',
      manifest,
      sdkDependency: '0.1.0',
      template: 'react',
      server: false,
    });

    expect(manifest.ui.entry).toBe('ui/main.tsx');
    expect(changed).toContain('ui/main.tsx');
    expect(changed).not.toContain('ui/main.ts');
    expect(changed).not.toContain('server/main.server.ts');
    expect([...files.values()].every((content) => !content.includes('__OMNIDRAW_'))).toBe(true);
    expect(JSON.parse(files.get('/draft/package.json')!)).toMatchObject({
      dependencies: {
        react: '19.2.7',
        'react-dom': '19.2.7',
      },
      devDependencies: {
        '@types/react': '19.2.17',
        '@types/react-dom': '19.2.3',
      },
    });
    expect(files.get('/draft/ui/main.tsx')).toContain('useState');
    expect(files.get('/draft/ui/main.tsx')).toContain('createRoot(root).render(<App />)');
    expect(files.get('/draft/ui/styles.css')).toContain('.omnidraw-widget-root,');
    expect(files.get('/draft/ui/styles.css')).toContain('height: 100%');
    expect(files.get('/draft/vite.config.mjs')).toContain('.omnidraw/build-manifest.json');
    expect(files.get('/draft/vite.config.mjs')).not.toContain('./omnidraw.json');
    expect(files.has('/draft/ui/main.ts')).toBe(false);
  });

  test('creates a valid server-function starter in the initial scaffold', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'Server Probe',
      template: 'react',
      server: true,
    });
    const changed = await writeWidgetScaffold({
      mkdir: async () => undefined,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      join: (...paths) => paths.join('/'),
    }, {
      cwd: '/draft',
      manifest,
      sdkDependency: '0.1.0',
      template: 'react',
      server: true,
    });

    expect(manifest.server).toEqual({
      entry: 'server/main.server.ts',
    });
    expect(changed).toContain('server/main.server.ts');
    expect([...files.values()].every((content) => !content.includes('__OMNIDRAW_'))).toBe(true);
    expect(files.get('/draft/server/main.server.ts')).toContain(
      'export const run = defineServerFunction',
    );
    expect(files.get('/draft/server/main.server.ts')).toContain('effect: "fn"');
    expect(files.get('/draft/server/main.server.ts')).toContain('toJSONSchema()');
    expect(files.get('/draft/server/main.server.ts')).not.toContain('from "zod"');
  });
});
