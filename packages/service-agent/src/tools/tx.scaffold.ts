import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import { WIDGET_TYPESCRIPT_VERSION } from '../core/CONSTANTS';

type TPortal = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  manifest: TWidgetManifestV2;
  sdkDependency: string;
};

function packageJson(manifest: TWidgetManifestV2, sdkDependency: string): string {
  return `${JSON.stringify({
    name: manifest.slug,
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@arrow-js/core': '^1.0.6',
      '@vibecanvas/sdk': sdkDependency,
      zod: '^4.4.3',
    },
    devDependencies: {
      typescript: `^${WIDGET_TYPESCRIPT_VERSION}`,
    },
  }, null, 2)}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ['ES2022', 'DOM'],
    },
    include: ['ui/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts'],
  }, null, 2)}\n`;
}

export async function txWriteWidgetScaffold(portal: TPortal, args: TArgs): Promise<string[]> {
  const changedFiles = [
    'vibecanvas.json',
    'package.json',
    'tsconfig.json',
    'ui/main.ts',
    'ui/styles.css',
  ];
  await portal.mkdir(portal.join(args.cwd, 'ui'), { recursive: true });
  // Keep the optional server root available without granting the model a
  // general mkdir or shell capability. UI-only snapshots remain server-free
  // because an empty directory contributes no source artifact files.
  await portal.mkdir(portal.join(args.cwd, 'server'), { recursive: true });
  await portal.writeFile(
    portal.join(args.cwd, 'vibecanvas.json'),
    `${JSON.stringify(args.manifest, null, 2)}\n`,
    'utf8',
  );
  await portal.writeFile(
    portal.join(args.cwd, 'package.json'),
    packageJson(args.manifest, args.sdkDependency),
    'utf8',
  );
  await portal.writeFile(portal.join(args.cwd, 'tsconfig.json'), tsconfigJson(), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'ui', 'main.ts'), [
    'import { html, reactive } from "@arrow-js/core";',
    'import "./styles.css";',
    '',
    'const state = reactive({ count: 0 });',
    '',
    'const increment = () => {',
    '  state.count += 1;',
    '};',
    '',
    'export default html`',
    '  <section class="vibecanvas-widget">',
    '    <p>Widget under construction</p>',
    '    <button type="button" @click="${increment}">',
    '      Local count: ${() => state.count}',
    '    </button>',
    '  </section>',
    '`;',
    '',
  ].join('\n'), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'ui', 'styles.css'), [
    '.vibecanvas-widget {',
    '  box-sizing: border-box;',
    '  display: grid;',
    '  min-height: 100%;',
    '  place-items: center;',
    '  gap: 12px;',
    '  padding: 20px;',
    '  background: #ffffff;',
    '  color: #1f2937;',
    '  font: 14px/1.5 system-ui, sans-serif;',
    '}',
    '',
    '.vibecanvas-widget p { margin: 0; }',
    '',
    '.vibecanvas-widget button {',
    '  padding: 6px 12px;',
    '  border: 1px solid currentColor;',
    '  border-radius: 6px;',
    '  background: transparent;',
    '  color: inherit;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '',
    '.vibecanvas-widget button:focus-visible {',
    '  outline: 2px solid #2563eb;',
    '  outline-offset: 2px;',
    '}',
    '',
  ].join('\n'), 'utf8');

  return changedFiles;
}
