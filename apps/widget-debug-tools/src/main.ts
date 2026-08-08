import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  NodeWidgetFilesystemWorkspace,
  WidgetFilesystemCatalog,
} from '@omnidraw/service-agent';
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
  action: 'list' | 'inspect' | 'catalog';
  slug: string | null;
}>;

function usage(): string {
  return [
    'Usage:',
    '  bun run lab -- [--home <path>] list',
    '  bun run lab -- [--home <path>] inspect <slug>',
    '  bun run lab -- [--home <path>] catalog',
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
  if (action === 'catalog' && values.length === 0) {
    return Object.freeze({ widgetsRoot: join(home, 'widgets'), action, slug: null });
  }
  throw new Error(usage());
}

function capsulePortalNeverInspects(): never {
  throw new Error('The debug lab does not inspect Capsule artifacts.');
}

async function ensureLayout(widgetsRoot: string): Promise<void> {
  await mkdir(widgetsRoot, { recursive: true, mode: 0o700 });
  await Promise.all(MANAGED_WIDGET_DIRECTORIES.map((name) => (
    mkdir(join(widgetsRoot, name), { recursive: true, mode: 0o700 })
  )));
}

function createCatalog(widgetsRoot: string): WidgetFilesystemCatalog {
  return new WidgetFilesystemCatalog({
    rootPath: widgetsRoot,
    filesystem: new NodeWidgetCatalogFilesystem(),
    hash: new NodeWidgetCatalogHash(),
    capsule: {
      inspectCapsuleArtifact: capsulePortalNeverInspects,
    },
  });
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
  if (command.action === 'catalog') {
    await runCatalog(command);
    return;
  }
  const snapshot = await createCatalog(command.widgetsRoot).refresh();
  const observation = snapshot.entries[command.slug!]?.draft ?? null;
  if (
    observation === null
    || observation.health !== 'healthy'
    || observation.manifest === null
    || observation.manifestDigestSha256 === null
  ) {
    const issues = observation?.issues.map((issue) => issue.message).join(' ') ?? '';
    throw new Error([
      `Healthy widget draft '${command.slug!}' was not found.`,
      issues,
    ].filter(Boolean).join(' '));
  }
  process.stdout.write(`${JSON.stringify({
    widgetsRoot: workspace.rootPath,
    slug: observation.slug,
    manifestDigestSha256: observation.manifestDigestSha256,
    treeDigestSha256: observation.treeDigestSha256,
    manifest: observation.manifest,
  }, null, 2)}\n`);
}

async function runCatalog(command: TCommand): Promise<void> {
  const snapshot = await createCatalog(command.widgetsRoot).refresh();
  const summary = Object.fromEntries(Object.values(snapshot.entries).map((entry) => [
    entry.slug,
    {
      health: entry.health,
      placeable: entry.placeable,
      draft: entry.draft === null
        ? null
        : {
            health: entry.draft.health,
            issues: entry.draft.issues,
          },
      published: entry.published === null
        ? null
        : {
            health: entry.published.health,
            issues: entry.published.issues,
          },
    },
  ]));
  process.stdout.write(`${JSON.stringify({
    widgetsRoot: command.widgetsRoot,
    generation: snapshot.generation,
    digestSha256: snapshot.digestSha256,
    healthy: snapshot.healthy,
    issues: snapshot.issues,
    entries: summary,
  }, null, 2)}\n`);
}

await run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
