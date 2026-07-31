import type { TWidgetManifestV3 } from '@omnidraw/widget-contract';
import {
  WIDGET_REACT_DOM_TYPES_VERSION,
  WIDGET_REACT_TYPES_VERSION,
  WIDGET_REACT_VERSION,
  WIDGET_TYPESCRIPT_VERSION,
  WIDGET_VITE_VERSION,
  WIDGET_ZOD_VERSION,
} from '../core/CONSTANTS';
import type { TWidgetCreateInput } from '../workspace/types';

type TPortal = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  manifest: TWidgetManifestV3;
  sdkDependency: string;
  capsuleDependency: string;
  template: NonNullable<TWidgetCreateInput['template']>;
  server: boolean;
};

function packageJson(
  manifest: TWidgetManifestV3,
  sdkDependency: string,
  capsuleDependency: string,
  template: NonNullable<TWidgetCreateInput['template']>,
): string {
  const react = template === 'react';
  return `${JSON.stringify({
    name: manifest.slug,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build --config vite.config.mjs',
    },
    dependencies: {
      '@omnidraw/capsule': capsuleDependency,
      '@omnidraw/sdk': sdkDependency,
      ...(react ? {
        react: WIDGET_REACT_VERSION,
        'react-dom': WIDGET_REACT_VERSION,
      } : {}),
      zod: WIDGET_ZOD_VERSION,
    },
    overrides: {
      '@omnidraw/capsule': capsuleDependency,
    },
    devDependencies: {
      ...(react ? {
        '@types/react': WIDGET_REACT_TYPES_VERSION,
        '@types/react-dom': WIDGET_REACT_DOM_TYPES_VERSION,
      } : {}),
      typescript: WIDGET_TYPESCRIPT_VERSION,
      vite: WIDGET_VITE_VERSION,
    },
  }, null, 2)}\n`;
}

function viteConfig(): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { defineConfig } from "vite";',
    '',
    'const manifest = JSON.parse(readFileSync(new URL("./omnidraw.json", import.meta.url), "utf8"));',
    '',
    'export default defineConfig({',
    '  build: {',
    '    target: "es2022",',
    '    outDir: "dist",',
    '    emptyOutDir: true,',
    "    sourcemap: 'hidden',",
    '    minify: false,',
    '    cssCodeSplit: false,',
    '    assetsInlineLimit: 0,',
    '    rollupOptions: {',
    '      input: manifest.ui.entry,',
    '      external: ["capsule:bridge"],',
    '      output: {',
    '        format: "es",',
    '        entryFileNames: "main.js",',
    '        chunkFileNames: "chunks/[name]-[hash].mjs",',
    '        assetFileNames: "assets/[name]-[hash][extname]",',
    '      },',
    '    },',
    '  },',
    '});',
    '',
  ].join('\n');
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
      jsx: 'react-jsx',
      lib: ['ES2022', 'DOM'],
    },
    include: ['ui/**/*.ts', 'ui/**/*.tsx', 'server/**/*.ts', 'shared/**/*.ts'],
  }, null, 2)}\n`;
}

function plainUiSource(): string {
  return [
    'import "./styles.css";',
    '',
    'const root = document.createElement("section");',
    'root.className = "omnidraw-widget";',
    '',
    'const message = document.createElement("p");',
    'message.textContent = "Widget under construction";',
    '',
    'const output = document.createElement("output");',
    'let count = 0;',
    'const render = () => {',
    '  output.textContent = `Local count: ${count}`;',
    '};',
    '',
    'const button = document.createElement("button");',
    'button.type = "button";',
    'button.textContent = "Increment";',
    'button.addEventListener("click", () => {',
    '  count += 1;',
    '  render();',
    '});',
    '',
    'root.append(message, output, button);',
    'document.body.append(root);',
    'render();',
    '',
  ].join('\n');
}

function reactUiSource(): string {
  return [
    'import { useState } from "react";',
    'import { createRoot } from "react-dom/client";',
    'import "./styles.css";',
    '',
    'function App() {',
    '  const [count, setCount] = useState(0);',
    '  return (',
    '    <section className="omnidraw-widget">',
    '      <p>Widget under construction</p>',
    '      <output aria-live="polite">Local count: {count}</output>',
    '      <button type="button" onClick={() => setCount((value) => value + 1)}>',
    '        Increment',
    '      </button>',
    '    </section>',
    '  );',
    '}',
    '',
    'const root = document.createElement("div");',
    'root.className = "omnidraw-widget-root";',
    'document.body.append(root);',
    'createRoot(root).render(<App />);',
    '',
  ].join('\n');
}

function serverSource(): string {
  return [
    'import { defineServerFunction } from "@omnidraw/sdk/server";',
    'import { z } from "zod";',
    '',
    'export const run = defineServerFunction({',
    '  effect: "fn",',
    '  input: z.object({ value: z.number().finite() }),',
    '  output: z.object({ value: z.number().finite() }),',
    '}, async (_context, input) => ({ value: input.value }));',
    '',
  ].join('\n');
}

export async function txWriteWidgetScaffold(portal: TPortal, args: TArgs): Promise<string[]> {
  const uiEntry = args.template === 'react' ? 'ui/main.tsx' : 'ui/main.ts';
  const changedFiles = [
    'omnidraw.json',
    'package.json',
    'vite.config.mjs',
    'tsconfig.json',
    uiEntry,
    'ui/styles.css',
    ...(args.server ? ['server/main.server.ts'] : []),
  ];
  await portal.mkdir(portal.join(args.cwd, 'ui'), { recursive: true });
  // Keep the optional server root available without granting the model a
  // general mkdir or shell capability. UI-only snapshots remain server-free
  // because an empty directory contributes no source artifact files.
  await portal.mkdir(portal.join(args.cwd, 'server'), { recursive: true });
  await portal.writeFile(
    portal.join(args.cwd, 'omnidraw.json'),
    `${JSON.stringify(args.manifest, null, 2)}\n`,
    'utf8',
  );
  await portal.writeFile(portal.join(args.cwd, 'vite.config.mjs'), viteConfig(), 'utf8');
  await portal.writeFile(
    portal.join(args.cwd, 'package.json'),
    packageJson(args.manifest, args.sdkDependency, args.capsuleDependency, args.template),
    'utf8',
  );
  await portal.writeFile(portal.join(args.cwd, 'tsconfig.json'), tsconfigJson(), 'utf8');
  await portal.writeFile(
    portal.join(args.cwd, uiEntry),
    args.template === 'react' ? reactUiSource() : plainUiSource(),
    'utf8',
  );
  await portal.writeFile(portal.join(args.cwd, 'ui', 'styles.css'), [
    '.omnidraw-widget {',
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
    '.omnidraw-widget p,',
    '.omnidraw-widget output { margin: 0; }',
    '',
    '.omnidraw-widget button {',
    '  padding: 6px 12px;',
    '  border: 1px solid;',
    '  border-radius: 6px;',
    '  background: transparent;',
    '  cursor: pointer;',
    '}',
    '',
  ].join('\n'), 'utf8');
  if (args.server) {
    await portal.writeFile(
      portal.join(args.cwd, 'server', 'main.server.ts'),
      serverSource(),
      'utf8',
    );
  }

  return changedFiles;
}
