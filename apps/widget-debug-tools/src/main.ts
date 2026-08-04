import { NodeWidgetFilesystemWorkspace } from '@omnidraw/service-agent';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const DEFAULT_HOME = join(REPOSITORY_ROOT, '.omnidraw');
const MANAGED_WIDGET_DIRECTORIES = Object.freeze([
  'drafts',
  'published',
  '.staging',
  '.preview',
  '.trash',
  '.quarantine',
]);

type TCommand = Readonly<{
  widgetsRoot: string;
  action: 'list' | 'inspect';
  slug: string | null;
}>;

function usage(): string {
  return [
    'Usage:',
    '  bun run lab -- [--home <path>] list',
    '  bun run lab -- [--home <path>] inspect <slug>',
    '',
    'This lab reads only the managed filesystem widget root.',
  ].join('\n');
}

function parseCommand(argv: readonly string[]): TCommand {
  const values = [...argv];
  let home = DEFAULT_HOME;
  const homeIndex = values.indexOf('--home');
  if (homeIndex !== -1) {
    const selected = values[homeIndex + 1];
    if (selected === undefined || selected.trim() === '') {
      throw new Error('--home requires a path.');
    }
    home = resolve(process.cwd(), selected);
    values.splice(homeIndex, 2);
  }
  const action = values.shift();
  if (action === 'list' && values.length === 0) {
    return Object.freeze({ widgetsRoot: join(home, 'widgets'), action, slug: null });
  }
  if (action === 'inspect' && values.length === 1 && values[0] !== '') {
    return Object.freeze({ widgetsRoot: join(home, 'widgets'), action, slug: values[0]! });
  }
  throw new Error(usage());
}

async function ensureLayout(widgetsRoot: string): Promise<void> {
  await mkdir(widgetsRoot, { recursive: true, mode: 0o700 });
  await Promise.all(MANAGED_WIDGET_DIRECTORIES.map((name) => (
    mkdir(join(widgetsRoot, name), { recursive: true, mode: 0o700 })
  )));
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  await ensureLayout(command.widgetsRoot);
  const workspace = await NodeWidgetFilesystemWorkspace.open({
    rootPath: command.widgetsRoot,
  });
  const signal = new AbortController().signal;
  if (command.action === 'list') {
    const drafts = await workspace.listDraftDirectoryNames({ signal });
    process.stdout.write(`${JSON.stringify({ widgetsRoot: workspace.rootPath, drafts }, null, 2)}\n`);
    return;
  }
  const observation = await workspace.inspectManagedManifest({
    relativePath: `drafts/${command.slug!}`,
    signal,
  });
  process.stdout.write(`${JSON.stringify({
    widgetsRoot: workspace.rootPath,
    slug: observation.slug,
    manifestDigestSha256: observation.manifestDigestSha256,
    treeDigestSha256: observation.treeDigestSha256,
    manifest: observation.manifest,
  }, null, 2)}\n`);
}

await run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
