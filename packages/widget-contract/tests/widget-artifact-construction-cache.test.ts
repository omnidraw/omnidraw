import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type {
  IWidgetArtifactConstructionBuilder,
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetBuildResult,
} from '../src';
import { WidgetArtifactConstructionCache } from '../src/local';

const tenant = {
  orgId: 'org-1',
  accountId: 'account-1',
  cellId: 'cell-1',
  placementEpoch: 1,
  roles: [],
  capabilities: [],
  requestId: 'request-1',
} as unknown as TTenantContext;

function request(
  sourceDigestSha256 = 'a'.repeat(64),
): TWidgetArtifactConstructionRequest {
  return {
    snapshot: {
      id: 'snapshot-1',
      digestSha256: sourceDigestSha256,
      files: [],
      createdAtMs: 1,
    },
    manifest: {
      schemaVersion: 3,
      name: 'Clock',
      slug: 'clock',
      ui: {
        runtime: 'capsule',
        entry: 'ui/main.ts',
        apis: ['DOM'],
      },
    },
    canonicalManifestJson: '{"schemaVersion":3}',
    builderIdentity: 'builder-1',
    capsuleBuildIdentity: {
      packageName: '@omnidraw/capsule',
      packageVersion: '0.10.2',
      packageDigest: `sha256:${'b'.repeat(64)}`,
      buildApiVersion: '0.1.0',
      runtimeBuildDigest: `sha256:${'c'.repeat(64)}`,
    },
    buildPolicyId: 'policy-1',
  };
}

describe('WidgetArtifactConstructionCache', () => {
  test('reuses equal source content across distinct capture events with exact provenance', async () => {
    let constructions = 0;
    const constructedSnapshotIds: string[] = [];
    const builder = {
      async construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        constructions += 1;
        constructedSnapshotIds.push(constructionRequest.snapshot.id);
        return {
          sourceSnapshotId: constructionRequest.snapshot.id,
          sourceDigestSha256: constructionRequest.snapshot.digestSha256,
        } as unknown as TWidgetArtifactConstructionResult;
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });
    const digest = 'a'.repeat(64);
    const first = request(digest);
    const second = {
      ...first,
      snapshot: {
        ...first.snapshot,
        id: 'capture-2',
        captureId: 'event-2',
        createdAtMs: 2,
      },
    };

    const [firstConstruction, secondConstruction] = await Promise.all([
      cache.construct(tenant, first),
      cache.construct(tenant, second),
    ]);

    expect(firstConstruction).toBe(secondConstruction);
    expect(firstConstruction).toMatchObject({
      sourceSnapshotId: digest,
      sourceDigestSha256: digest,
    });
    expect(constructedSnapshotIds).toEqual([digest]);
    expect(constructions).toBe(1);
  });

  test('single-flights construction but signs Preview and release separately', async () => {
    let constructions = 0;
    const purposes: string[] = [];
    const construction = { marker: 'construction' } as unknown as TWidgetArtifactConstructionResult;
    const builder = {
      async construct() {
        constructions += 1;
        return construction;
      },
      async signConstruction(
        _tenant: TTenantContext,
        signRequest: TWidgetArtifactConstructionSignRequest,
      ) {
        purposes.push(signRequest.signingPurpose);
        return { purpose: signRequest.signingPurpose } as unknown as TWidgetBuildResult;
      },
      async build() {
        throw new Error('Compatibility build should be owned by the cache.');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'host:node-24:npm-11:darwin-arm64',
    });

    const preview = cache.build(tenant, { ...request(), signingPurpose: 'preview' });
    const release = cache.build(tenant, { ...request(), signingPurpose: 'release' });
    await Promise.all([preview, release]);

    expect(constructions).toBe(1);
    expect(purposes.toSorted()).toEqual(['preview', 'release']);
  });

  test('does not retain failed construction attempts', async () => {
    let calls = 0;
    const builder = {
      async construct() {
        calls += 1;
        throw new Error('build failed');
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });

    await expect(cache.construct(tenant, request())).rejects.toThrow('build failed');
    await expect(cache.construct(tenant, request())).rejects.toThrow('build failed');
    expect(calls).toBe(2);
  });

  test('reuses one exact construction and invalidates every trusted key input', async () => {
    let constructions = 0;
    const construction = {
      marker: 'keyed-construction',
    } as unknown as TWidgetArtifactConstructionResult;
    const builder = {
      async construct() {
        constructions += 1;
        return construction;
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: '{"format":"test-environment-v1"}',
    });
    const exact = request();

    await cache.construct(tenant, exact);
    await cache.construct(tenant, exact);
    expect(constructions).toBe(1);

    const variants: TWidgetArtifactConstructionRequest[] = [
      request('d'.repeat(64)),
      {
        ...exact,
        canonicalManifestJson: '{"schemaVersion":3,"name":"Changed"}',
      },
      { ...exact, builderIdentity: 'builder-2' },
      {
        ...exact,
        capsuleBuildIdentity: {
          ...exact.capsuleBuildIdentity,
          packageVersion: '0.9.5',
        },
      },
      { ...exact, buildPolicyId: 'policy-2' },
    ];
    for (const variant of variants) await cache.construct(tenant, variant);
    await cache.construct({
      ...tenant,
      accountId: 'account-2',
    }, exact);

    expect(constructions).toBe(7);
  });

  test('keeps a shared construction alive when its first owner cancels', async () => {
    let constructions = 0;
    let underlyingSignal: AbortSignal | undefined;
    let reportUnderlyingProgress:
      TWidgetArtifactConstructionRequest['reportProgress'];
    let resolveConstruction:
      ((value: TWidgetArtifactConstructionResult) => void) | undefined;
    const firstProgress: string[] = [];
    const secondProgress: string[] = [];
    const construction = {
      marker: 'shared-construction',
    } as unknown as TWidgetArtifactConstructionResult;
    const builder = {
      construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        constructions += 1;
        underlyingSignal = constructionRequest.signal;
        reportUnderlyingProgress = constructionRequest.reportProgress;
        return new Promise<TWidgetArtifactConstructionResult>((resolve) => {
          resolveConstruction = resolve;
        });
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = cache.construct(tenant, {
      ...request(),
      signal: firstController.signal,
      reportProgress: (phase) => firstProgress.push(phase),
    });
    const second = cache.construct(tenant, {
      ...request(),
      signal: secondController.signal,
      reportProgress: (phase) => secondProgress.push(phase),
    });
    const firstOutcome = first.then(
      () => 'resolved',
      (error: unknown) => error,
    );

    await Promise.resolve();
    expect(constructions).toBe(1);
    reportUnderlyingProgress?.('installing');
    expect(firstProgress).toEqual(['installing']);
    expect(secondProgress).toEqual(['installing']);
    firstController.abort(new Error('first owner superseded'));
    expect(await firstOutcome).toEqual(new Error('first owner superseded'));
    expect(underlyingSignal?.aborted).toBe(false);
    reportUnderlyingProgress?.('building');
    expect(firstProgress).toEqual(['installing']);
    expect(secondProgress).toEqual(['installing', 'building']);

    resolveConstruction?.(construction);
    await expect(second).resolves.toBe(construction);
    await expect(cache.construct(tenant, request())).resolves.toBe(construction);
    expect(constructions).toBe(1);
  });

  test('releases each owner demand and aborts only after all owners cancel', async () => {
    let constructions = 0;
    let underlyingAborts = 0;
    const construction = {
      marker: 'replacement-construction',
    } as unknown as TWidgetArtifactConstructionResult;
    const builder = {
      construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        constructions += 1;
        if (constructions > 1) return Promise.resolve(construction);
        return new Promise<TWidgetArtifactConstructionResult>((_resolve, reject) => {
          const signal = constructionRequest.signal!;
          signal.addEventListener('abort', () => {
            underlyingAborts += 1;
            reject(signal.reason);
          }, { once: true });
        });
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = cache.construct(tenant, {
      ...request(),
      signal: firstController.signal,
    });
    const second = cache.construct(tenant, {
      ...request(),
      signal: secondController.signal,
    });
    const firstOutcome = first.catch((error: unknown) => error);
    const secondOutcome = second.catch((error: unknown) => error);

    await Promise.resolve();
    secondController.abort(new Error('second owner closed'));
    expect(await secondOutcome).toEqual(new Error('second owner closed'));
    expect(underlyingAborts).toBe(0);

    firstController.abort(new Error('first owner closed'));
    expect(await firstOutcome).toEqual(new Error('first owner closed'));
    expect(underlyingAborts).toBe(1);

    await expect(cache.construct(tenant, request())).resolves.toBe(construction);
    expect(constructions).toBe(2);
  });

  test('keeps demanded flights resident under cache pressure', async () => {
    let constructions = 0;
    const resolvers = new Map<
      string,
      (value: TWidgetArtifactConstructionResult) => void
    >();
    const builder = {
      construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        constructions += 1;
        return new Promise<TWidgetArtifactConstructionResult>((resolve) => {
          resolvers.set(constructionRequest.snapshot.digestSha256, resolve);
        });
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
      maxEntries: 1,
    });
    const firstResult = {
      marker: 'first-construction',
    } as unknown as TWidgetArtifactConstructionResult;
    const secondResult = {
      marker: 'second-construction',
    } as unknown as TWidgetArtifactConstructionResult;
    const first = cache.construct(tenant, request('a'.repeat(64)));
    const second = cache.construct(tenant, request('b'.repeat(64)));
    const firstJoiner = cache.construct(tenant, request('a'.repeat(64)));

    await Promise.resolve();
    expect(constructions).toBe(2);
    resolvers.get('a'.repeat(64))?.(firstResult);
    resolvers.get('b'.repeat(64))?.(secondResult);

    await expect(first).resolves.toBe(firstResult);
    await expect(firstJoiner).resolves.toBe(firstResult);
    await expect(second).resolves.toBe(secondResult);
    expect(constructions).toBe(2);
  });

  test('aborts and awaits in-flight construction during close', async () => {
    let underlyingSignal: AbortSignal | undefined;
    let finishAbortCleanup: (() => void) | undefined;
    let builderCloses = 0;
    let closeSettled = false;
    const abortCleanup = new Promise<void>((resolve) => {
      finishAbortCleanup = resolve;
    });
    const builder = {
      construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        underlyingSignal = constructionRequest.signal;
        return new Promise<TWidgetArtifactConstructionResult>((_resolve, reject) => {
          constructionRequest.signal?.addEventListener('abort', () => {
            void abortCleanup.then(() => reject(constructionRequest.signal?.reason));
          }, { once: true });
        });
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
      async close() {
        builderCloses += 1;
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });
    const inFlight = cache.construct(tenant, request());
    const inFlightOutcome = inFlight.catch((error: unknown) => error);

    await Promise.resolve();
    const closing = cache.close().then(() => {
      closeSettled = true;
    });
    await Promise.resolve();

    expect(underlyingSignal?.aborted).toBe(true);
    expect(builderCloses).toBe(1);
    expect(closeSettled).toBe(false);

    finishAbortCleanup?.();
    expect(await inFlightOutcome).toEqual(underlyingSignal?.reason);
    await closing;
    expect(closeSettled).toBe(true);
  });

  test('does not await an injected builder without a cleanup hook', async () => {
    let underlyingSignal: AbortSignal | undefined;
    const builder = {
      construct(
        _tenant: TTenantContext,
        constructionRequest: TWidgetArtifactConstructionRequest,
      ) {
        underlyingSignal = constructionRequest.signal;
        return new Promise<TWidgetArtifactConstructionResult>(() => undefined);
      },
      async signConstruction() {
        throw new Error('unreachable');
      },
      async build() {
        throw new Error('unreachable');
      },
    } as unknown as IWidgetArtifactConstructionBuilder;
    const cache = new WidgetArtifactConstructionCache({
      builder,
      environmentIdentity: 'test-environment',
    });
    void cache.construct(tenant, request());

    await Promise.resolve();
    await cache.close();

    expect(underlyingSignal?.aborted).toBe(true);
  });
});
