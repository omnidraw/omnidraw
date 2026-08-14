import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  NodeWidgetFilesystemWorkspace,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import {
  fnCanonicalizeWidgetBuildReceipt,
  fnCreateWidgetBuildReceipt,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  type TWidgetManifestV1,
} from '@omnidraw/sdk/contract';
import { WidgetBuildGenerationService } from '../src/shell/widget/WidgetBuildGenerationService';
import { fnWidgetBuildGenerationPollOrder } from '../src/shell/widget/fn.widget-build-generation';

const temporaryRoots: string[] = [];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const manifest: TWidgetManifestV1 = {
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Generation Fixture',
  slug: 'generation-fixture',
  description: 'Build observation fixture.',
  tool: { label: 'Generation Fixture', group: null, priority: 0 },
  ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
};

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-build-generation-'));
  temporaryRoots.push(root);
  const widgetRoot = join(root, 'drafts', manifest.slug);
  await Promise.all([
    mkdir(join(widgetRoot, 'ui'), { recursive: true }),
    mkdir(join(widgetRoot, 'dist'), { recursive: true }),
    mkdir(join(root, 'published'), { recursive: true }),
    mkdir(join(root, '.staging'), { recursive: true }),
    mkdir(join(root, '.preview'), { recursive: true }),
    mkdir(join(root, '.trash'), { recursive: true }),
    mkdir(join(root, '.quarantine'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(widgetRoot, 'omnidraw.json'), `${JSON.stringify(manifest)}\n`),
    writeFile(join(widgetRoot, 'ui', 'main.ts'), 'export default 1;\n'),
    writeFile(join(widgetRoot, 'package.json'), '{"private":true}\n'),
    writeFile(join(widgetRoot, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{"name":"fixture"}}}\n'),
    writeFile(join(widgetRoot, 'dist', 'main.js'), 'export default 1;\n'),
  ]);
  const outputBytes = new TextEncoder().encode('export default 1;\n');
  const independentlyBuiltBytes = new TextEncoder().encode('export default "host validated";\n');
  const hostBuiltBytes = new TextEncoder().encode('export default "private host build";\n');
  let portableOutputBytes = hostBuiltBytes;
  const closedWorkspaces: string[] = [];
  const portableBuildFiles: string[][] = [];
  let portableFailure: unknown;
  let corruptPortableReceipt = false;
  let beforePortableReturn: (() => Promise<void>) | undefined;
  const builder = {
    async construct() {
      return {
        executableInputDigestSha256: 'a'.repeat(64),
        executableManifestDigestSha256: 'b'.repeat(64),
        canonicalExecutableManifestJson: '{}',
        distributionDigestSha256: sha256(independentlyBuiltBytes),
        construction: {},
        distFiles: [{ path: 'dist/main.js', bytes: independentlyBuiltBytes }],
      };
    },
    async sign(construction: unknown) {
      return { construction };
    },
    async buildPortable(request: Readonly<{
      manifest: TWidgetManifestV1;
      files: readonly Readonly<{ path: string; bytes: Uint8Array }>[];
      signal?: AbortSignal;
    }>) {
      portableBuildFiles.push(request.files.map((file) => file.path));
      if (portableFailure !== undefined) throw portableFailure;
      await beforePortableReturn?.();
      if (request.signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
      const outputs = [{
        path: 'dist/main.js',
        byteSize: portableOutputBytes.byteLength,
        sha256: sha256(portableOutputBytes),
      }];
      const receipt = fnCreateWidgetBuildReceipt({
        sourceDigestSha256: fnWidgetPortableSourceDigest({
          files: request.files,
          digestSha256: sha256,
        }),
        manifestDigestSha256: fnWidgetManifestV1Digest({
          manifest: request.manifest,
          digestSha256: sha256,
        }),
        executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
          manifest: request.manifest,
          files: request.files,
          digestSha256: sha256,
        }),
        sdkVersion: '1.2.3',
        outputs,
        digestSha256: sha256,
      });
      return {
        construction: await this.construct(),
        receipt: corruptPortableReceipt ? { ...receipt, sdkVersion: '9.9.9' } : receipt,
        distFiles: [{ path: 'dist/main.js', bytes: portableOutputBytes }],
      };
    },
    async closeWorkspace(workspaceId: string) {
      closedWorkspaces.push(workspaceId);
    },
  } as unknown as WidgetFilesystemBuildService;
  let refreshes = 0;
  let operationId = 0;
  const changed: string[] = [];
  const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: root });
  let captureCount = 0;
  let beforeCapture: ((captureNumber: number) => Promise<void>) | undefined;
  const service = new WidgetBuildGenerationService({
    widgetsRoot: root,
    workspace: Promise.resolve({
      async captureDraftBuildInput(args) {
        captureCount += 1;
        await beforeCapture?.(captureCount);
        return workspace.captureDraftBuildInput(args);
      },
    }),
    builder,
    sdkVersion: '1.2.3',
    createId: () => `test-${operationId += 1}`,
    catalog: {
      async refresh() {
        refreshes += 1;
      },
      notifyBuildGenerationChanged(widgetKey) {
        changed.push(widgetKey);
      },
    },
    now: Date.now,
    scheduleInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    cancelInterval: (timer) => clearInterval(timer),
  });
  const writeReceipt = async () => {
    const capture = await workspace.captureDraftBuildInput({
      slug: manifest.slug,
      signal: new AbortController().signal,
    });
    const receipt = fnCreateWidgetBuildReceipt({
      sourceDigestSha256: fnWidgetPortableSourceDigest({
        files: capture.files,
        digestSha256: sha256,
      }),
      manifestDigestSha256: fnWidgetManifestV1Digest({
        manifest: capture.manifest,
        digestSha256: sha256,
      }),
      executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
        manifest: capture.manifest,
        files: capture.files,
        digestSha256: sha256,
      }),
      sdkVersion: '1.2.3',
      outputs: [{
        path: 'dist/main.js',
        byteSize: outputBytes.byteLength,
        sha256: sha256(outputBytes),
      }],
      digestSha256: sha256,
    });
    await writeFile(
      join(widgetRoot, 'dist', 'omnidraw.build.json'),
      fnCanonicalizeWidgetBuildReceipt(receipt),
    );
    return receipt;
  };
  return {
    service,
    widgetRoot,
    writeReceipt,
    changed,
    closedWorkspaces,
    portableBuildFiles,
    setBeforePortableReturn(value: (() => Promise<void>) | undefined) {
      beforePortableReturn = value;
    },
    captures: () => captureCount,
    setBeforeCapture(value: ((captureNumber: number) => Promise<void>) | undefined) {
      beforeCapture = value;
    },
    setPortableFailure(value: unknown) {
      portableFailure = value;
    },
    setPortableOutput(value: string) {
      portableOutputBytes = new TextEncoder().encode(value);
    },
    corruptPortableReceipt() {
      corruptPortableReceipt = true;
    },
    refreshes: () => refreshes,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('WidgetBuildGenerationService', () => {
  test('rotates the bounded polling order so later drafts receive a turn', () => {
    const entries = Array.from({ length: 20 }, (_value, index) => index);
    const first = fnWidgetBuildGenerationPollOrder({ entries, cursor: 0 });
    const second = fnWidgetBuildGenerationPollOrder({ entries, cursor: 16 });

    expect(first.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_value, index) => index));
    expect(second.slice(0, 4)).toEqual([16, 17, 18, 19]);
    expect(second.slice(4, 8)).toEqual([0, 1, 2, 3]);
  });

  test('accepts one complete receipt idempotently and keeps it while source becomes stale', async () => {
    const harness = await createHarness();
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'unbuilt',
      acceptedGeneration: null,
    });
    const receipt = await harness.writeReceipt();
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedGeneration: 1,
      acceptedBuildIdentity: receipt.buildIdentity,
      current: true,
    });
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      acceptedGeneration: 1,
      current: true,
    });
    expect(harness.changed).toEqual([manifest.slug]);
    expect(harness.refreshes()).toBe(1);

    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 2;\n');
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'build_required',
      acceptedGeneration: 1,
      current: false,
    });
    expect(harness.service.accepted(manifest.slug)?.receipt.buildIdentity)
      .toBe(receipt.buildIdentity);
    await harness.service.stop();
  });

  test('builds a lockfile-only draft in the private host boundary and atomically admits its output', async () => {
    const harness = await createHarness();
    const accepted = await harness.service.rebuild(manifest.slug);

    expect(accepted.generation).toBe(1);
    expect(harness.portableBuildFiles).toEqual([[
      'package-lock.json',
      'package.json',
      'ui/main.ts',
    ]]);
    await expect(access(join(harness.widgetRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toContain('private host build');
    expect(JSON.parse(await readFile(
      join(harness.widgetRoot, 'dist', 'omnidraw.build.json'),
      'utf8',
    )).buildIdentity).toBe(accepted.receipt.buildIdentity);
    expect((await readdir(join(dirname(harness.widgetRoot), '..', '.staging')))
      .filter((name) => name.startsWith('preview-build-generation-fixture-'))).toEqual([]);
    await harness.service.stop();
    expect(harness.closedWorkspaces).toEqual(['generation_generation-fixture']);
  });

  test('recovers a pre-commit crash backup before observing or accepting a generation', async () => {
    const harness = await createHarness();
    const receipt = await harness.writeReceipt();
    const stagingRoot = join(dirname(harness.widgetRoot), '..', '.staging');
    const stageRoot = join(stagingRoot, 'preview-build-generation-fixture-crashed');
    await mkdir(stageRoot, { recursive: false });
    await rename(join(harness.widgetRoot, 'dist'), join(stageRoot, 'previous-dist'));

    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedGeneration: 1,
      acceptedBuildIdentity: receipt.buildIdentity,
      current: true,
    });
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default 1;\n');
    await expect(access(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await harness.service.stop();
  });

  test('an incomplete stage created before projection cannot remove live output', async () => {
    const harness = await createHarness();
    const liveReceipt = await harness.writeReceipt();
    const stageRoot = join(
      dirname(harness.widgetRoot),
      '..',
      '.staging',
      'preview-build-generation-fixture-before-projection',
    );
    await mkdir(stageRoot, { recursive: false });

    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedBuildIdentity: liveReceipt.buildIdentity,
      current: true,
    });
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default 1;\n');
    await expect(access(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await harness.service.stop();
  });

  test('restores last-known-good after a post-projection pre-verification crash', async () => {
    const harness = await createHarness();
    const lastKnownGood = await harness.writeReceipt();
    const stagingRoot = join(dirname(harness.widgetRoot), '..', '.staging');
    const stageRoot = join(stagingRoot, 'preview-build-generation-fixture-post-projection');
    await mkdir(stageRoot, { recursive: false });
    await rename(join(harness.widgetRoot, 'dist'), join(stageRoot, 'previous-dist'));
    await mkdir(join(harness.widgetRoot, 'dist'), { recursive: false });
    await Promise.all([
      writeFile(join(harness.widgetRoot, 'dist', 'main.js'), 'export default "interrupted";\n'),
      writeFile(join(harness.widgetRoot, 'dist', 'omnidraw.build.json'), '{"format":'),
    ]);

    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedGeneration: 1,
      acceptedBuildIdentity: lastKnownGood.buildIdentity,
      current: true,
    });
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default 1;\n');
    expect(JSON.parse(await readFile(
      join(harness.widgetRoot, 'dist', 'omnidraw.build.json'),
      'utf8',
    )).buildIdentity).toBe(lastKnownGood.buildIdentity);
    await expect(access(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await harness.service.stop();
  });

  test('keeps independently valid live output after a durable commit marker', async () => {
    const harness = await createHarness();
    const committed = await harness.writeReceipt();
    const stageRoot = join(
      dirname(harness.widgetRoot),
      '..',
      '.staging',
      'preview-build-generation-fixture-committed',
    );
    await mkdir(join(stageRoot, 'previous-dist'), { recursive: true });
    await Promise.all([
      writeFile(join(stageRoot, 'previous-dist', 'main.js'), 'export default "older";\n'),
      writeFile(join(stageRoot, 'commit.json'), `${JSON.stringify({
        format: 'omnidraw.preview-build-commit.v1',
        widgetKey: manifest.slug,
        buildIdentity: committed.buildIdentity,
      })}\n`),
    ]);

    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedBuildIdentity: committed.buildIdentity,
      current: true,
    });
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default 1;\n');
    await expect(access(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await harness.service.stop();
  });

  test('coalesces concurrent callers onto one exact private build', async () => {
    const harness = await createHarness();
    let releaseBuild!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseBuild = resolve; });
    harness.setBeforePortableReturn(() => blocked);

    const first = harness.service.rebuild(manifest.slug);
    const second = harness.service.rebuild(manifest.slug);
    await Bun.sleep(5);
    expect(harness.portableBuildFiles).toHaveLength(1);
    releaseBuild();
    const [left, right] = await Promise.all([first, second]);

    expect(left.generation).toBe(right.generation);
    expect(left.receipt.buildIdentity).toBe(right.receipt.buildIdentity);
    await harness.service.stop();
  });

  test('keeps the last accepted generation and cleans staging when a newer build fails', async () => {
    const harness = await createHarness();
    const first = await harness.service.rebuild(manifest.slug);
    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 2;\n');
    harness.setPortableFailure(Object.assign(new Error('dependency install failed'), {
      code: 'WIDGET_COMMAND_FAILED',
    }));

    await expect(harness.service.rebuild(manifest.slug)).rejects.toThrow('dependency install failed');
    expect(harness.service.accepted(manifest.slug)?.generation).toBe(first.generation);
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toContain('private host build');
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'rejected',
      acceptedGeneration: first.generation,
      current: false,
      diagnostics: [{ code: 'WIDGET_COMMAND_FAILED' }],
    });
    await harness.service.stop();
  });

  test('rejects an invalid private-build receipt before projection and preserves last-known-good', async () => {
    const harness = await createHarness();
    const first = await harness.service.rebuild(manifest.slug);
    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 2;\n');
    harness.corruptPortableReceipt();

    await expect(harness.service.rebuild(manifest.slug)).rejects.toMatchObject({
      code: 'BUILD_RECEIPT_INVALID',
    });
    expect(harness.service.accepted(manifest.slug)?.generation).toBe(first.generation);
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toContain('private host build');
    await harness.service.stop();
  });

  test('cancellation and source drift cannot project or accept private build output', async () => {
    const cancelled = await createHarness();
    let releaseCancelled!: () => void;
    const blockedCancellation = new Promise<void>((resolve) => { releaseCancelled = resolve; });
    cancelled.setBeforePortableReturn(() => blockedCancellation);
    const controller = new AbortController();
    const pending = cancelled.service.rebuild(manifest.slug, controller.signal);
    await Bun.sleep(5);
    controller.abort();
    releaseCancelled();
    await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await Bun.sleep(5);
    expect(cancelled.service.accepted(manifest.slug)).toBeNull();
    await cancelled.service.stop();

    const drifted = await createHarness();
    drifted.setBeforePortableReturn(async () => {
      await writeFile(join(drifted.widgetRoot, 'ui', 'main.ts'), 'export default "drift";\n');
    });
    await expect(drifted.service.rebuild(manifest.slug)).rejects.toMatchObject({
      code: 'BUILD_STALE',
    });
    expect(drifted.service.accepted(manifest.slug)).toBeNull();
    expect(await readFile(join(drifted.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default 1;\n');
    await drifted.service.stop();
  });

  test('source drift after projection rolls back the candidate before acceptance', async () => {
    const harness = await createHarness();
    const lastKnownGood = await harness.service.rebuild(manifest.slug);
    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 2;\n');
    harness.setPortableOutput('export default "stale projected candidate";\n');
    const capturesBeforeRebuild = harness.captures();
    harness.setBeforeCapture(async (captureNumber) => {
      if (captureNumber === capturesBeforeRebuild + 3) {
        await writeFile(
          join(harness.widgetRoot, 'ui', 'main.ts'),
          'export default "drifted during projection";\n',
        );
      }
    });

    await expect(harness.service.rebuild(manifest.slug)).rejects.toMatchObject({
      code: 'BUILD_STALE',
    });
    expect(harness.captures()).toBe(capturesBeforeRebuild + 3);
    expect(harness.service.accepted(manifest.slug)?.generation).toBe(lastKnownGood.generation);
    expect(harness.service.accepted(manifest.slug)?.receipt.buildIdentity)
      .toBe(lastKnownGood.receipt.buildIdentity);
    expect(await readFile(join(harness.widgetRoot, 'dist', 'main.js'), 'utf8'))
      .toBe('export default "private host build";\n');
    expect(JSON.parse(await readFile(
      join(harness.widgetRoot, 'dist', 'omnidraw.build.json'),
      'utf8',
    )).buildIdentity).toBe(lastKnownGood.receipt.buildIdentity);
    expect((await readdir(join(dirname(harness.widgetRoot), '..', '.staging')))
      .filter((name) => name.startsWith('preview-build-generation-fixture-'))).toEqual([]);
    await harness.service.stop();
  });

  test('rejects partial and stale receipts without replacing the accepted generation', async () => {
    const harness = await createHarness();
    await writeFile(join(harness.widgetRoot, 'dist', 'omnidraw.build.json'), '{');
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'rejected',
      acceptedGeneration: null,
    });

    const acceptedReceipt = await harness.writeReceipt();
    expect((await harness.service.requireCurrent(manifest.slug)).receipt.buildIdentity)
      .toBe(acceptedReceipt.buildIdentity);
    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 3;\n');
    await writeFile(join(harness.widgetRoot, 'dist', 'omnidraw.build.json'), '{"format":');
    const rejected = await harness.service.view(manifest.slug);
    expect(rejected.phase).toBe('rejected');
    expect(rejected.acceptedGeneration).toBe(1);
    expect(rejected.current).toBe(false);
    expect(harness.service.accepted(manifest.slug)?.receipt.buildIdentity)
      .toBe(acceptedReceipt.buildIdentity);
    await harness.service.stop();
  });

  test('retires accepted state and its construction workspace for a deleted draft', async () => {
    const harness = await createHarness();
    await harness.writeReceipt();
    expect((await harness.service.requireCurrent(manifest.slug)).generation).toBe(1);
    expect(harness.service.accepted(manifest.slug)).not.toBeNull();

    await harness.service.retire(manifest.slug);

    expect(harness.service.accepted(manifest.slug)).toBeNull();
    expect(harness.closedWorkspaces).toEqual([`generation_${manifest.slug}`]);
    await harness.service.stop();
  });
});
