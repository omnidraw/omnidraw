import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { WIDGET_TYPESCRIPT_VERSION } from '../core/CONSTANTS';
import { fnWidgetDraftFilesFromManifest } from '../core/fn.widget-draft-files';

type TPortal = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  manifest: TVibecanvasJson;
  sdkDependency: string;
};

function toExportName(functionName: string) {
  const [prefix = 'fn', rest = 'generated'] = functionName.split('.', 2);
  const words = rest.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const pascal = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('') || 'Generated';
  return `${prefix}${pascal}`;
}

function resetErrorTransaction() {
  return [
    'import type { TTxArgs, TTxPortal } from "@vibecanvas/sdk/actor";',
    ``,
    'type TPortal = TTxPortal;',
    'type TArgs = TTxArgs;',
    ``,
    'export async function txResetError(portal: TPortal, args: TArgs) {',
    `  void args;`,
    `  await portal.next();`,
    `}`,
    ``,
  ].join('\n');
}

function actorTypes(manifest: TVibecanvasJson) {
  const resourceSlots = Object.keys(manifest.actor.resources ?? {});
  const resourceSlotType = resourceSlots.length > 0
    ? resourceSlots.map((slot) => JSON.stringify(slot)).join(' | ')
    : 'never';

  return [
    `export type TActorData = Record<string, never>;`,
    `export type TActorResourceSlot = ${resourceSlotType};`,
    '',
  ].join('\n');
}

function functionsRegistry(manifest: TVibecanvasJson) {
  const functionNames = fnWidgetDraftFilesFromManifest(manifest);
  const imports = functionNames.map((functionName) => `import { ${toExportName(functionName)} } from "./${functionName}";`);
  const groups = {
    fn: functionNames.filter((name) => name.startsWith('fn.')),
    fx: functionNames.filter((name) => name.startsWith('fx.')),
    tx: functionNames.filter((name) => name.startsWith('tx.')),
  };

  const groupLines = (names: string[]) => names.map((name) => `    "${name}": ${toExportName(name)},`).join('\n');

  return [
    ...imports,
    imports.length > 0 ? '' : '',
    'export default {',
    '  fn: {',
    groupLines(groups.fn),
    '  },',
    '  fx: {',
    groupLines(groups.fx),
    '  },',
    '  tx: {',
    groupLines(groups.tx),
    '  },',
    '};',
    '',
  ].join('\n');
}

function packageJson(manifest: TVibecanvasJson, sdkDependency: string) {
  return `${JSON.stringify({
    name: manifest.slug,
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@arrow-js/core': '^1.0.6',
      '@vibecanvas/sdk': sdkDependency,
    },
    devDependencies: {
      typescript: `^${WIDGET_TYPESCRIPT_VERSION}`,
    },
  }, null, 2)}\n`;
}

function tsconfigJson() {
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
    include: ['actor/**/*.ts', 'widget/**/*.ts'],
  }, null, 2)}\n`;
}

export async function txWriteWidgetScaffold(portal: TPortal, args: TArgs) {
  const changedFiles = ['vibecanvas.json', 'package.json', 'tsconfig.json', 'actor/functions.ts', 'actor/types.ts', 'actor/tx.resetError.ts', 'widget/main.ts', 'widget/main.css'];
  await portal.mkdir(portal.join(args.cwd, 'actor'), { recursive: true });
  await portal.mkdir(portal.join(args.cwd, 'widget'), { recursive: true });
  await portal.writeFile(portal.join(args.cwd, 'vibecanvas.json'), `${JSON.stringify(args.manifest, null, 2)}\n`, 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'package.json'), packageJson(args.manifest, args.sdkDependency), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'tsconfig.json'), tsconfigJson(), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'actor', 'functions.ts'), functionsRegistry(args.manifest), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'actor', 'types.ts'), actorTypes(args.manifest), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'actor', 'tx.resetError.ts'), resetErrorTransaction(), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'widget', 'main.ts'), [
    'import { html } from "@arrow-js/core";',
    'import { actor } from "@vibecanvas/sdk/widget";',
    '',
    'const isStateFamily = (family: "booting" | "error") => {',
    '  const state = actor.state.value;',
    '  return state === family || state.startsWith(`${family}.`);',
    '};',
    '',
    'const resetError = () => {',
    '  void actor.sendMessage("in.resetError", {});',
    '};',
    '',
    'const viewForState = () => {',
    '  if (isStateFamily("booting")) {',
    '    return html`<div class="widget-status"><p>Starting widget...</p></div>`;',
    '  }',
    '  if (isStateFamily("error")) {',
    '    return html`',
    '      <div class="widget-status widget-status--error">',
    '        <p>Widget encountered an error.</p>',
    '        <button type="button" @click="${resetError}">Reset</button>',
    '      </div>',
    '    `;',
    '  }',
    '  return html`<div class="widget-status"><p>Widget under construction...</p></div>`;',
    '};',
    '',
    'export default html`',
    '  <section class="vibecanvas-widget" aria-live="polite">',
    '    ${viewForState}',
    '  </section>',
    '`;',
    '',
  ].join('\n'), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'widget', 'main.css'), [
    '.vibecanvas-widget {',
    '  box-sizing: border-box;',
    '  display: grid;',
    '  min-height: 100%;',
    '  place-items: center;',
    '  padding: 20px;',
    '  background: #ffffff;',
    '  color: #1f2937;',
    '  font: 14px/1.5 system-ui, sans-serif;',
    '}',
    '',
    '.widget-status {',
    '  text-align: center;',
    '}',
    '',
    '.widget-status p {',
    '  margin: 0;',
    '}',
    '',
    '.widget-status--error {',
    '  color: #991b1b;',
    '}',
    '',
    '.widget-status button {',
    '  margin-top: 12px;',
    '  padding: 6px 12px;',
    '  border: 1px solid currentColor;',
    '  background: transparent;',
    '  color: inherit;',
    '  font: inherit;',
    '  cursor: pointer;',
    '}',
    '',
    '.widget-status button:focus-visible {',
    '  outline: 2px solid #2563eb;',
    '  outline-offset: 2px;',
    '}',
    '',
  ].join('\n'), 'utf8');

  return changedFiles;
}
