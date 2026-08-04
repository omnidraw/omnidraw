import { describe, expect, test } from 'bun:test';
import {
  EphemeralPreviewService,
  PreviewCancelledError,
  type TPreviewConstructionCompatibility,
  type TPreviewPorts,
} from '../../src/widget-filesystem/preview/index';

type TFakePreview = ReturnType<typeof previewHarness>;

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const COMPATIBILITY: TPreviewConstructionCompatibility = Object.freeze({
  builderIdentity: 'omnidraw-builder-v1',
  buildPolicyId: 'preview-policy-v1',
  environmentIdentity: 'isolated-linux-x64',
  capsuleBuildIdentity: Object.freeze({
    packageName: '@omnidraw/capsule',
    packageVersion: '1.2.3',
    packageDigest: `sha256:${'c'.repeat(64)}`,
    buildApiVersion: 'v2',
    runtimeBuildDigest: `sha256:${'d'.repeat(64)}`,
  }),
  serverRuntimeAbi: 'bun-v1',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function previewHarness(config: Readonly<{
  build?: TPreviewPorts<string, string, string>['buildConstruction'];
}> = {}) {
  const calls = {
    prepare: [] as string[],
    remove: [] as string[],
    build: [] as string[],
    validate: [] as string[],
    sign: [] as string[],
    mount: [] as string[],
    unmount: [] as string[],
  };
  const ports: TPreviewPorts<string, string, string> = {
    async prepareTempPath({ relativePath }) {
      calls.prepare.push(relativePath);
    },
    async removeTempPath({ relativePath }) {
      calls.remove.push(relativePath);
    },
    buildConstruction: config.build ?? (async ({ sessionId, reportDiagnostic }) => {
      calls.build.push(sessionId);
      reportDiagnostic({ severity: 'info', message: `built ${sessionId}` });
      return `construction:${sessionId}`;
    }),
    async validateConstruction({ construction }) {
      calls.validate.push(construction);
    },
    async signConstruction({ construction }) {
      calls.sign.push(construction);
      return `signed:${construction}:${calls.sign.length}`;
    },
    async mount({ sessionId, signedArtifact }) {
      calls.mount.push(sessionId);
      return `handle:${sessionId}:${signedArtifact}`;
    },
    async unmount({ handle }) {
      calls.unmount.push(handle);
    },
  };
  return {
    calls,
    ports,
    service: new EphemeralPreviewService(ports),
  };
}

function openArgs(
  sessionId: string,
  overrides: Partial<{
    executableInputDigestSha256: string;
    compatibility: TPreviewConstructionCompatibility;
  }> = {},
) {
  return {
    sessionId,
    widgetKey: 'counter',
    executableInputDigestSha256: overrides.executableInputDigestSha256 ?? DIGEST_A,
    compatibility: overrides.compatibility ?? COMPATIBILITY,
  };
}

describe('EphemeralPreviewService', () => {
  test('reuses validated construction only for the exact digest and compatibility policy', async () => {
    const harness = previewHarness();
    const first = await harness.service.open(openArgs('session-1'));
    const exact = await harness.service.open(openArgs('session-2'));
    const changedPolicy = Object.freeze({
      ...COMPATIBILITY,
      buildPolicyId: 'preview-policy-v2',
    });
    const policyMiss = await harness.service.open(openArgs('session-3', {
      compatibility: changedPolicy,
    }));
    const digestMiss = await harness.service.open(openArgs('session-4', {
      executableInputDigestSha256: DIGEST_B,
    }));

    expect(first.session.constructionReused).toBe(false);
    expect(exact.session.constructionReused).toBe(true);
    expect(policyMiss.session.constructionReused).toBe(false);
    expect(digestMiss.session.constructionReused).toBe(false);
    expect(harness.calls.build).toEqual(['session-1', 'session-3', 'session-4']);
    expect(harness.calls.validate).toHaveLength(3);
    expect(harness.calls.sign).toHaveLength(4);
    expect(harness.service.reusableConstruction({
      executableInputDigestSha256: DIGEST_A,
      compatibility: COMPATIBILITY,
    })).toMatchObject({
      ownerSessionId: 'session-1',
      validated: true,
      construction: 'construction:session-1',
    });
    expect(harness.service.reusableConstruction({
      executableInputDigestSha256: DIGEST_A,
      compatibility: Object.freeze({ ...COMPATIBILITY, environmentIdentity: 'host-darwin-arm64' }),
    })).toBeNull();
    await harness.service.close('session-1');
    expect(harness.service.reusableConstruction({
      executableInputDigestSha256: DIGEST_A,
      compatibility: COMPATIBILITY,
    })).toMatchObject({
      validated: true,
      construction: 'construction:session-1',
    });
    await harness.service.shutdown();
  });

  test('a new process service has no session or reusable construction to recover', async () => {
    const harness = previewHarness();
    await harness.service.open(openArgs('process-owned'));
    expect(harness.service.get('process-owned')?.phase).toBe('ready');

    const restarted = new EphemeralPreviewService(harness.ports);
    expect(restarted.get('process-owned')).toBeNull();
    expect(restarted.reusableConstruction({
      executableInputDigestSha256: DIGEST_A,
      compatibility: COMPATIBILITY,
    })).toBeNull();
    expect(harness.calls.prepare).toEqual(['.preview/sessions/process-owned']);

    await restarted.shutdown();
    await harness.service.shutdown();
  });

  test('copies compatibility authority instead of retaining caller-owned mutable input', async () => {
    const harness = previewHarness();
    const compatibility = {
      builderIdentity: COMPATIBILITY.builderIdentity,
      buildPolicyId: COMPATIBILITY.buildPolicyId,
      environmentIdentity: COMPATIBILITY.environmentIdentity,
      capsuleBuildIdentity: COMPATIBILITY.capsuleBuildIdentity,
      serverRuntimeAbi: COMPATIBILITY.serverRuntimeAbi,
    };
    await harness.service.open(openArgs('copied-policy', {
      executableInputDigestSha256: 'c'.repeat(64),
      compatibility,
    }));
    compatibility.builderIdentity = 'mutated-after-open';
    expect(harness.service.get('copied-policy')?.compatibility.builderIdentity)
      .toBe(COMPATIBILITY.builderIdentity);
    await harness.service.shutdown();
  });

  test('cancels in-flight construction and cleans its bounded temp path', async () => {
    const build = deferred<string>();
    let buildSignal: AbortSignal | null = null;
    const harness = previewHarness({
      async build({ sessionId, signal }) {
        harness.calls.build.push(sessionId);
        buildSignal = signal;
        return build.promise;
      },
    });
    const opening = harness.service.open(openArgs('cancel-me'));
    while (buildSignal === null) await Promise.resolve();
    const cancelling = harness.service.cancel('cancel-me');
    expect((buildSignal as unknown as AbortSignal).aborted).toBe(true);
    build.resolve('late-construction');

    await expect(opening).rejects.toBeInstanceOf(PreviewCancelledError);
    await expect(cancelling).resolves.toBe(true);
    expect(harness.service.get('cancel-me')).toMatchObject({
      phase: 'cancelled',
      mountedHandleCount: 0,
    });
    expect(harness.calls.validate).toEqual([]);
    expect(harness.calls.mount).toEqual([]);
    expect(harness.calls.remove).toEqual(['.preview/sessions/cancel-me']);
    await harness.service.shutdown();
  });

  test('bounds diagnostics, resources, sessions, and mounted handles and cleans ready handles', async () => {
    const calls: string[] = [];
    const ports: TPreviewPorts<string, string, string> = {
      async prepareTempPath() {},
      async removeTempPath({ relativePath }) { calls.push(`remove:${relativePath}`); },
      async buildConstruction({ reportDiagnostic }) {
        reportDiagnostic({ severity: 'warning', message: '123456789' });
        reportDiagnostic({ severity: 'warning', message: 'second' });
        return 'construction';
      },
      async validateConstruction() {},
      async signConstruction() { return 'signed'; },
      async mount({ sessionId }) { return `handle:${sessionId}`; },
      async unmount({ handle }) { calls.push(`unmount:${handle}`); },
    };
    const service = new EphemeralPreviewService(ports, {
      maxSessions: 1,
      maxCachedConstructions: 1,
      maxMountedHandles: 1,
      maxDiagnosticsPerSession: 1,
      maxDiagnosticCharacters: 5,
      maxSelectedResources: 1,
    });
    const ready = await service.open({
      ...openArgs('bounded'),
      selectedResources: [{ slot: 'todos', resourceId: 'resource-1', effect: 'read' }],
    });
    expect(ready.session.diagnostics).toEqual([{
      severity: 'warning',
      message: '12345',
      code: null,
      path: null,
    }]);
    expect(ready.session.droppedDiagnosticCount).toBe(1);
    await expect(service.open(openArgs('too-many'))).rejects.toThrow('session limit');

    await expect(service.close('bounded')).resolves.toBe(true);
    expect(calls).toEqual([
      'unmount:handle:bounded',
      'remove:.preview/sessions/bounded',
    ]);
    await service.shutdown();
  });
});
