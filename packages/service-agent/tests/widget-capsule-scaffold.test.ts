import { describe, expect, test } from 'bun:test';
import { fnBuildWidgetCreateManifest } from '../src/tools/fn.widget-create';
import { txWriteWidgetScaffold } from '../src/tools/tx.scaffold';

describe('Capsule widget authoring scaffold', () => {
  test('creates a strict manifest-v3 plain-DOM widget with only supported dependencies', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'Focus Timer',
      description: 'A focused timer named __OMNIDRAW_SDK_DEPENDENCY__',
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
      capsuleDependency: '0.10.2',
      template: 'plain',
      server: false,
    });

    expect(manifest).toEqual({
      schemaVersion: 3,
      name: 'Focus Timer',
      slug: 'focus-timer',
      description: 'A focused timer named __OMNIDRAW_SDK_DEPENDENCY__',
      ui: {
        runtime: 'capsule',
        entry: 'ui/main.ts',
        apis: ['DOM'],
      },
    });
    expect(changed).toEqual([
      'omnidraw.json',
      'package.json',
      'vite.config.mjs',
      'tsconfig.json',
      'ui/main.ts',
      'ui/styles.css',
    ]);
    expect(files.get('/draft/omnidraw.json')).toContain('__OMNIDRAW_SDK_DEPENDENCY__');
    expect([...files.entries()].filter(([path]) => path !== '/draft/omnidraw.json')
      .every(([, content]) => !content.includes('__OMNIDRAW_'))).toBe(true);
    expect(JSON.parse(files.get('/draft/package.json')!)).toMatchObject({
      dependencies: {
        '@omnidraw/capsule': '0.10.2',
        '@omnidraw/sdk': '0.1.0',
        zod: '4.4.3',
      },
      overrides: {
        '@omnidraw/capsule': '0.10.2',
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
    expect(files.get('/draft/ui/styles.css')).toContain('height: 100%');
    expect(files.get('/draft/ui/main.ts')).not.toContain('@omnidraw/capsule/guest');
    expect(files.get('/draft/ui/main.ts')).not.toContain('export default');
  });

  test('creates a ready React scaffold without a second dependency edit', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'React Counter',
      description: 'A React counter',
      template: 'react',
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
      capsuleDependency: '0.10.2',
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
    expect(files.has('/draft/ui/main.ts')).toBe(false);
  });

  test('creates a valid server-function starter in the initial scaffold', async () => {
    const files = new Map<string, string>();
    const manifest = fnBuildWidgetCreateManifest({
      name: 'Server Probe',
      template: 'react',
      server: true,
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
      capsuleDependency: '0.10.2',
      template: 'react',
      server: true,
    });

    expect(manifest.server).toEqual({
      entry: 'server/main.server.ts',
      runtimeAbi: 'omnidraw-function-v1',
    });
    expect(changed).toContain('server/main.server.ts');
    expect([...files.values()].every((content) => !content.includes('__OMNIDRAW_'))).toBe(true);
    expect(files.get('/draft/server/main.server.ts')).toContain(
      'export const run = defineServerFunction',
    );
    expect(files.get('/draft/server/main.server.ts')).toContain('effect: "fn"');
  });
});
