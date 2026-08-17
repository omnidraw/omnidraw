/** @file Pure source transforms and fixed Vite configuration for the portable widget builder. */

export function fnBootstrapWidgetUiEntry(
  source: string,
  bootstrapSpecifier: string,
): string {
  const bootstrapImport = `import ${JSON.stringify(bootstrapSpecifier)};`;
  if (source.startsWith(`${bootstrapImport}\n`)) return source;

  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom === '' ? source : source.slice(1);
  if (!body.startsWith('#!')) return `${bom}${bootstrapImport}\n${body}`;

  const lineEnd = body.indexOf('\n');
  if (lineEnd === -1) return `${bom}${body}\n${bootstrapImport}\n`;
  return `${bom}${body.slice(0, lineEnd + 1)}${bootstrapImport}\n${body.slice(lineEnd + 1)}`;
}

export function fnWidgetGuestBridgeBootstrapSource(): string {
  return [
    "import { subscribeWidgetLifecycle } from '@omnidraw/sdk/widget';",
    'subscribeWidgetLifecycle(() => undefined)();',
    '',
  ].join('\n');
}

export function fnWidgetPortableViteConfigSource(): string {
  return [
    'import { readFileSync } from "node:fs";',
    'import { defineConfig } from "vite";',
    '',
    'const manifest = JSON.parse(readFileSync(new URL("./build-manifest.json", import.meta.url), "utf8"));',
    '',
    'export default defineConfig({',
    '  build: {',
    '    target: "es2022",',
    '    outDir: "dist",',
    '    emptyOutDir: true,',
    '    sourcemap: "hidden",',
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
