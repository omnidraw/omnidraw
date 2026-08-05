import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ZWidgetManifestV1 } from '../packages/widget-contract/src';

const REPO_ROOT = resolve(import.meta.dir, '..');
const WIDGET_CONTRACT_SOURCE = 'packages/widget-contract/src';
const WIDGET_LOCAL_SOURCE = 'packages/widget-contract/src/local';
const WIDGET_FILESYSTEM_SOURCE = 'packages/service-agent/src/widget-filesystem';
const CLI_RUNTIME_CATALOG_SOURCE = 'apps/cli/src/services/WidgetFilesystemRuntimeCatalog.ts';
const CLI_RUNTIME_CATALOG_TEST = 'apps/cli/tests/WidgetFilesystemRuntimeCatalog.test.ts';
const RETIRED_WIDGET_CONTROL_OWNERS = [
  'packages/service-db/src/AgentAuthoringStoreTurso.ts',
  'packages/service-db/src/WidgetControlStoreTurso.ts',
  'packages/service-db/src/WidgetControlStoreTurso/fn.widget-control-store-row.ts',
  'packages/service-db/src/DbServiceTurso/fx.tool-group.ts',
  'packages/service-db/src/DbServiceTurso/tx.tool-group.ts',
  'packages/service-agent/src/widget-drafts/WidgetDraftController.ts',
  'packages/service-agent/src/widget-management/WidgetManagement.ts',
  'packages/widget-contract/src/local/LocalWidgetArtifactStore.ts',
  'packages/widget-contract/src/local/WidgetArtifactService.ts',
  'packages/widget-contract/src/local/WidgetPreviewService.ts',
  'packages/widget-contract/src/local/WidgetPublicationService.ts',
  'apps/cli/src/services/WidgetService.ts',
  'apps/cli/src/services/WidgetServicePool.ts',
] as const;

type TSource = Readonly<{
  path: string;
  text: string;
}>;

async function sourceFiles(root: string): Promise<string[]> {
  const absoluteRoot = resolve(REPO_ROOT, root);
  const rootFile = Bun.file(absoluteRoot);
  if (await rootFile.exists()) return [root];

  const files: string[] = [];
  const glob = new Bun.Glob('**/*.ts');
  for await (const path of glob.scan({ cwd: absoluteRoot, onlyFiles: true })) {
    if (/\.(?:test|spec)\.ts$/.test(path)) continue;
    files.push(`${root}/${path}`);
  }
  return files.sort();
}

async function sources(paths: readonly string[]): Promise<TSource[]> {
  return Promise.all(paths.map(async (path) => ({
    path,
    text: await Bun.file(resolve(REPO_ROOT, path)).text(),
  })));
}

function linesMatching(source: TSource, pattern: RegExp, message: string): string[] {
  return source.text.split('\n').flatMap((line, index) => (
    pattern.test(line) ? [`${source.path}:${index + 1}: ${message}`] : []
  ));
}

describe('filesystem-first widget artifact boundaries', () => {
  test('keeps the widget-contract root browser-safe and local implementations opt-in', async () => {
    const packageJson = await Bun.file(
      resolve(REPO_ROOT, 'packages/widget-contract/package.json'),
    ).json() as { readonly exports?: Record<string, string> };
    expect(packageJson.exports?.['.']).toBe('./src/index.ts');
    expect(packageJson.exports?.['./local']).toBe('./src/local/index.ts');

    const allContractFiles = await sourceFiles(WIDGET_CONTRACT_SOURCE);
    const browserFiles = allContractFiles.filter((path) => (
      !path.startsWith(`${WIDGET_LOCAL_SOURCE}/`)
    ));
    expect(browserFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const source of await sources(browserFiles)) {
      violations.push(...linesMatching(
        source,
        /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:|(?:assert|buffer|child_process|crypto|events|fs|os|path|stream|url|util|worker_threads)(?:\/|['"]))/,
        'browser root imports a Node builtin',
      ));
      violations.push(...linesMatching(
        source,
        /\b(?:Bun|Buffer|process)\b/,
        'browser root uses a server-only runtime global',
      ));
      violations.push(...linesMatching(
        source,
        /(?:from\s+|export\s+[^'";]*from\s+)['"]\.\/?local(?:\/|['"])/,
        'browser root re-exports a local implementation',
      ));
    }
    expect(violations).toEqual([]);

    const rootEntry = await Bun.file(
      resolve(REPO_ROOT, 'packages/widget-contract/src/index.ts'),
    ).text();
    expect(rootEntry).not.toMatch(/['"]\.\/?local(?:\/|['"])/);
  });

  test('keeps filesystem publication and runtime catalog independent from database authority', async () => {
    const files = [
      ...(await sourceFiles(WIDGET_FILESYSTEM_SOURCE)),
      CLI_RUNTIME_CATALOG_SOURCE,
    ];
    const violations: string[] = [];
    for (const source of await sources(files)) {
      violations.push(...linesMatching(
        source,
        /@omnidraw\/service-db|WidgetControlStore|AgentAuthoringStore|\btoolGroup\b|\b(?:widget_definitions|widget_definition_revisions|widget_revision_sources|artifact_references|widget_instances|resource_bindings|tool_groups|agent_drafts|agent_previews)\b/,
        'filesystem widget authority depends on the retired database control plane',
      ));
    }
    expect(violations).toEqual([]);
  });

  test('keeps retired database widget control-plane owners deleted', async () => {
    for (const path of RETIRED_WIDGET_CONTROL_OWNERS) {
      expect(await Bun.file(resolve(REPO_ROOT, path)).exists(), path).toBe(false);
    }
    const serviceAgentIndex = await Bun.file(resolve(
      REPO_ROOT,
      'packages/service-agent/src/index.ts',
    )).text();
    expect(serviceAgentIndex).not.toContain('widget-drafts');
    expect(serviceAgentIndex).not.toContain('widget-management');
  });

  test('strictly rejects database identity and release-pointer fields in filesystem manifests', () => {
    const portableManifest = {
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      name: 'Clock',
      slug: 'clock',
      description: 'A portable clock.',
      tool: { label: 'Clock', group: 'utilities', priority: 0 },
      ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    } as const;
    expect(ZWidgetManifestV1.safeParse(portableManifest).success).toBe(true);
    for (const field of ['definitionId', 'revisionId', 'artifactId', 'activeRevisionId']) {
      expect(ZWidgetManifestV1.safeParse({
        ...portableManifest,
        [field]: 'db-owned',
      }).success, field).toBe(false);
    }
    expect(ZWidgetManifestV1.safeParse({ ...portableManifest, $schema: 'https://example.test' }).success)
      .toBe(false);
  });

  test('keeps the production runtime capability generation-bound and filesystem-only', async () => {
    const { WidgetFilesystemRuntimeCatalog } = await import(
      '../apps/cli/src/services/WidgetFilesystemRuntimeCatalog'
    );
    const methods = Object.getOwnPropertyNames(WidgetFilesystemRuntimeCatalog.prototype);
    expect(methods).toEqual(expect.arrayContaining([
      'catalogObservation',
      'current',
      'isRuntimeResolutionCurrent',
      'publishedReferences',
      'refresh',
      'resolvePlacement',
      'resolveRuntime',
      'start',
      'subscribe',
    ]));
    for (const retired of [
      'getActiveRevision',
      'getRevision',
      'rollback',
      'readArtifact',
      'resolvePublishedPlacement',
    ]) {
      expect(methods).not.toContain(retired);
    }

    const source = await Bun.file(resolve(REPO_ROOT, CLI_RUNTIME_CATALOG_SOURCE)).text();
    expect(source).toContain('NodeWidgetCatalogFilesystem');
    expect(source).toContain('catalogGeneration');
    expect(source).toContain('withRead');
    expect(source).not.toMatch(/WidgetControlStore|DbServiceTurso|definitionId|revisionId|artifactId/);
    expect(await Bun.file(resolve(REPO_ROOT, CLI_RUNTIME_CATALOG_TEST)).exists()).toBe(true);
  });

  test('does not restore the mutable artifact directory or database compatibility reads', async () => {
    const files = [
      ...(await sourceFiles(WIDGET_FILESYSTEM_SOURCE)),
      CLI_RUNTIME_CATALOG_SOURCE,
      'apps/cli/src/setup-services.ts',
    ];
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const source of await sources(files)) {
      violations.push(...linesMatching(
        source,
        /artifacts[\\/]widgets[\\/]|artifacts\s*['"`]\s*,\s*['"`]widgets|\b(?:widget_definitions|widget_definition_revisions|widget_revision_sources|artifact_references|widget_instances|resource_bindings|tool_groups|agent_drafts|agent_previews)\b/,
        'uses a retired widget artifact path or database compatibility read',
      ));
    }
    expect(violations).toEqual([]);

    const setupSource = await Bun.file(resolve(REPO_ROOT, 'apps/cli/src/setup-services.ts')).text();
    expect(setupSource).toContain('widgetsRoot: config.home.widgetsRoot');
    expect(setupSource).not.toContain('WidgetServicePool');
  });
});
