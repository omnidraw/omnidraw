import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ZWidgetManifestV3 } from '../packages/widget-contract/src';
import { fnArtifactBlobRelativePath } from '../packages/widget-contract/src/local/fn.artifact-path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const WIDGET_CONTRACT_SOURCE = 'packages/widget-contract/src';
const WIDGET_LOCAL_SOURCE = 'packages/widget-contract/src/local';
const WIDGET_CONTROL_STORE_SOURCE = 'packages/service-db/src/WidgetControlStoreTurso';
const CLI_WIDGET_INTEGRATION_TEST = 'apps/cli/tests/WidgetService.test.ts';

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

async function cliWidgetServiceFiles(): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob('apps/cli/src/services/WidgetService*.ts');
  for await (const path of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) files.push(path);
  return files.sort();
}

function linesMatching(source: TSource, pattern: RegExp, message: string): string[] {
  return source.text.split('\n').flatMap((line, index) => (
    pattern.test(line) ? [`${source.path}:${index + 1}: ${message}`] : []
  ));
}

function declarationBody(source: string, declarationName: string): string | null {
  const declaration = new RegExp(
    `(?:export\\s+)?(?:type|interface)\\s+${declarationName}\\b[^={]*[={]`,
    'm',
  ).exec(source);
  if (declaration === null) return null;

  const openingIndex = source.indexOf(
    declaration[0].endsWith('{') ? '{' : '=',
    declaration.index,
  );
  if (openingIndex < 0) return null;
  const bodyStart = source.indexOf('{', openingIndex);
  if (bodyStart < 0) return null;

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index + 1);
  }
  return null;
}

describe('M5 immutable widget artifact boundaries', () => {
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

  test('keeps immutable storage, local publication, and dedicated CLI widget services runtime-neutral', async () => {
    const controlStoreFiles = [
      'packages/service-db/src/WidgetControlStoreTurso.ts',
      ...(await sourceFiles(WIDGET_CONTROL_STORE_SOURCE)),
    ].filter((path, index, files) => files.indexOf(path) === index);
    const files = [
      ...(await sourceFiles(WIDGET_CONTRACT_SOURCE)),
      ...controlStoreFiles,
      ...(await cliWidgetServiceFiles()),
    ];
    const existingFiles: string[] = [];
    for (const path of files) {
      if (await Bun.file(resolve(REPO_ROOT, path)).exists()) existingFiles.push(path);
    }

    const violations: string[] = [];
    for (const source of await sources(existingFiles)) {
      violations.push(...linesMatching(
        source,
        /@vibecanvas\/service-actor|(?:^|[^A-Za-z])ActorService(?:[^A-Za-z]|$)/,
        'widget publication depends on a retired resident runtime',
      ));
    }
    expect(violations).toEqual([]);
  });

  test('contains no durable Draft Preview records or writers', async () => {
    const writers = new Set<string>();
    for (const source of await sources(await sourceFiles('packages/service-db/src'))) {
      if (/\b(?:INSERT\s+INTO|UPDATE)\s+agent_previews\b/i.test(source.text)) {
        writers.add(source.path);
      }
    }

    expect([...writers].sort()).toEqual([]);
    const authoringStore = await Bun.file(resolve(
      REPO_ROOT,
      'packages/service-db/src/AgentAuthoringStoreTurso.ts',
    )).text();
    expect(authoringStore).not.toContain('IWidgetPreviewStore');
    expect(authoringStore).not.toContain('agent_preview');
  });

  test('strictly rejects fields outside the current widget manifest', () => {
    const validManifest = {
      schemaVersion: 3,
      name: 'Clock',
      slug: 'clock',
      ui: {
        runtime: 'capsule',
        entry: 'src/ui.ts',
        apis: ['DOM'],
      },
    } as const;
    expect(ZWidgetManifestV3.safeParse(validManifest).success).toBe(true);
    expect(ZWidgetManifestV3.safeParse({
      ...validManifest,
      residentRuntime: {
        entry: 'src/runtime.ts',
      },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      schemaVersion: 2,
      name: 'Old widget',
      slug: 'old-widget',
      ui: { entry: 'src/ui.ts' },
    }).success).toBe(false);
  });

  test('keeps the production widget capability narrow and identity-bound', async () => {
    const serviceFiles = await cliWidgetServiceFiles();
    const integrationExists = await Bun.file(
      resolve(REPO_ROOT, CLI_WIDGET_INTEGRATION_TEST),
    ).exists();

    if (integrationExists) expect(serviceFiles.length).toBeGreaterThan(0);
    if (serviceFiles.length > 0) {
      const { createWidgetServiceCapability } = await import(
        '../apps/cli/src/services/WidgetServicePool'
      );
      const method = () => Promise.resolve(undefined);
      const capability = createWidgetServiceCapability({
        publish: method,
        rollback: method,
        getRevision: method,
        getActiveRevision: method,
        issueBrowserUiArtifactReadCapability: method,
        getArtifact: method,
        readArtifact: method,
        forTenant: method,
        controlStore: {},
        artifactsPath: '/host/private',
        deleteArtifact: method,
        collect: method,
      } as never);
      expect(Object.isFrozen(capability)).toBe(true);
      expect(Reflect.ownKeys(capability).sort()).toEqual([
        'getActiveRevision',
        'getArtifact',
        'getRevision',
        'getRevisionSource',
        'issueBrowserUiArtifactReadCapability',
        'listPublishedPlacements',
        'publish',
        'readArtifact',
        'resolvePublishedPlacement',
        'rollback',
      ]);
      for (const forbidden of [
        'forTenant',
        'controlStore',
        'path',
        'artifactsPath',
        'delete',
        'deleteArtifact',
        'collect',
        'digestSha256',
        'issueArtifactReadCapability',
        'issueSourceBuildArtifactReadCapability',
        'issueUiPreviewArtifactReadCapability',
        'issueServerExecutionArtifactReadCapability',
        'buildPreview',
        'getPreview',
        'getPreviewRevision',
        'stopPreview',
        'captureSource',
      ]) {
        expect(forbidden in capability).toBe(false);
      }
    }

    const capabilitySource = serviceFiles.find((path) => path.endsWith('WidgetServicePool.ts'));
    if (capabilitySource !== undefined) {
      const source = await Bun.file(resolve(REPO_ROOT, capabilitySource)).text();
      expect(source).toMatch(
        /type\s+TWidgetServiceCapability\s*=\s*Omit<IWidgetPublicationService,\s*'archive'>/,
      );
      expect(source).toMatch(/\bIWidgetArtifactReader\b/);
      expect(source).toMatch(/\bIWidgetBrowserUiArtifactReadCapabilityIssuer\b/);
      expect(source).toMatch(/createWidgetServerArtifactCapability/);
    }

    const artifactReadRequest = await Bun.file(
      resolve(REPO_ROOT, 'packages/widget-contract/src/types.ts'),
    ).text();
    const readRequestBody = declarationBody(artifactReadRequest, 'TWidgetArtifactReadRequest');
    expect(readRequestBody).not.toBeNull();
    expect(readRequestBody).toMatch(/\bartifactId\b/);
    expect(readRequestBody).toMatch(/\breadCapability\b/);
    expect(readRequestBody).toMatch(/\bpurpose\b/);
    expect(readRequestBody).not.toMatch(/\baudience\b/);
    expect(readRequestBody).not.toMatch(/\bdigestSha256\b/);
  });

  test('does not restore mutable slug-addressed artifact writes in the M5 implementation', async () => {
    const files = [
      ...(await sourceFiles(WIDGET_LOCAL_SOURCE)),
      ...(await cliWidgetServiceFiles()),
      'apps/cli/src/setup-services.ts',
    ];
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const source of await sources(files)) {
      violations.push(...linesMatching(
        source,
        /artifacts[\\/]widgets[\\/]|artifacts\s*['"`]\s*,\s*['"`]widgets|widgets\s*['"`]\s*,\s*(?:manifest\.)?slug/,
        'writes an artifact beneath mutable artifacts/widgets/<slug>',
      ));
      if (
        /artifacts[\\/]widgets[\\/]/.test(source.text)
        || /['"`]artifacts['"`]\s*,\s*['"`]widgets['"`]/.test(source.text)
        || /['"`]widgets['"`]\s*,\s*(?:manifest\.)?slug\b/.test(source.text)
      ) {
        violations.push(
          `${source.path}: writes an artifact beneath mutable artifacts/widgets/<slug>`,
        );
      }
    }
    expect(violations).toEqual([]);

    const artifactPathSource = await Bun.file(
      resolve(REPO_ROOT, 'packages/widget-contract/src/local/fn.artifact-path.ts'),
    ).text();
    const digest = `ab${'0'.repeat(62)}`;
    expect(fnArtifactBlobRelativePath(digest)).toBe(`blobs/sha256/ab/${digest}`);
    expect(artifactPathSource).toMatch(/WIDGET_ARTIFACT_BLOB_DIRECTORY/);
    expect(artifactPathSource).toMatch(/WIDGET_ARTIFACT_DIGEST_ALGORITHM/);
    expect(artifactPathSource).not.toMatch(/['"]widgets['"]/);
  });
});
