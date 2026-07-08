import type { TFunctionName, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { fnWidgetDraftFilesFromManifest } from '../core/fn.widget-draft-files';

type TPortal = {
  mkdir: (path: string, options: { recursive: true }) => Promise<string | undefined>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  join: (...paths: string[]) => string;
};

type TArgs = {
  cwd: string;
  manifest: TVibecanvasJson;
};

function toExportName(functionName: string) {
  const [prefix = 'fn', rest = 'generated'] = functionName.split('.', 2);
  const words = rest.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const pascal = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('') || 'Generated';
  return `${prefix}${pascal}`;
}

function functionStub(functionName: TFunctionName) {
  const exportName = toExportName(functionName);
  const prefix = functionName.split('.', 1)[0];
  const shouldContinue = prefix === 'fn' || prefix === 'fx';

  return [
    `type TPortal = {`,
    `  next?: () => Promise<unknown>;`,
    `  setData?: (data: unknown) => Promise<unknown>;`,
    `  emitMessage?: (message: { type: string; payload: unknown }) => Promise<unknown>;`,
    `};`,
    ``,
    `type TArgs = {`,
    `  data: unknown;`,
    `  msg: unknown;`,
    `};`,
    ``,
    `export async function ${exportName}(portal: TPortal, args: TArgs) {`,
    `  void args;`,
    shouldContinue ? `  return portal.next?.();` : `  throw new Error("${functionName} is not implemented yet");`,
    `}`,
    ``,
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

function packageJson(manifest: TVibecanvasJson) {
  return `${JSON.stringify({
    name: manifest.slug,
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@arrow-js/core': '^1.0.6',
      '@vibecanvas/sdk': '^0.1.0',
    },
    devDependencies: {
      typescript: '^5.9.3',
    },
  }, null, 2)}\n`;
}

export async function txWriteWidgetScaffold(portal: TPortal, args: TArgs) {
  const changedFiles = ['vibecanvas.json', 'package.json', 'actor/functions.ts', 'actor/types.ts', 'widget/main.ts', 'widget/main.css'];
  await portal.mkdir(portal.join(args.cwd, 'actor'), { recursive: true });
  await portal.mkdir(portal.join(args.cwd, 'widget'), { recursive: true });
  await portal.writeFile(portal.join(args.cwd, 'vibecanvas.json'), `${JSON.stringify(args.manifest, null, 2)}\n`, 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'package.json'), packageJson(args.manifest), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'actor', 'functions.ts'), functionsRegistry(args.manifest), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'actor', 'types.ts'), `export type TActorData = ${JSON.stringify(args.manifest.actor.initialData, null, 2)};\n`, 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'widget', 'main.ts'), [
    'import { html } from "@arrow-js/core";',
    'import { actor } from "@vibecanvas/sdk/widget";',
    '',
    'export default html`<section class="vibecanvas-widget">',
    `  <h1>${args.manifest.widget.tool.label}</h1>`,
    '  <p>Actor state: ${() => actor.state.value}</p>',
    '  <pre>${() => JSON.stringify(actor.context.value, null, 2)}</pre>',
    '</section>`;',
    '',
  ].join('\n'), 'utf8');
  await portal.writeFile(portal.join(args.cwd, 'widget', 'main.css'), '.vibecanvas-widget { font: 14px system-ui; padding: 12px; }\n', 'utf8');

  for (const functionName of fnWidgetDraftFilesFromManifest(args.manifest)) {
    const relPath = `actor/${functionName}.ts`;
    await portal.writeFile(portal.join(args.cwd, relPath), functionStub(functionName), 'utf8');
    changedFiles.push(relPath);
  }

  return changedFiles;
}
