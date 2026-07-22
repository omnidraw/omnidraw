import { describe, expect, mock, test } from 'bun:test';
import { ORPCError } from '@orpc/contract';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TWidgetRevisionDescriptor } from '@vibecanvas/widget-contract';
import { router } from '../router';
import { ZWidgetRuntimeLoadInput, ZWidgetRuntimeLoadOutput } from './contract';
import type { TWidgetApiContext } from './types';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
});
const request = Object.freeze({
  canvasId: uuid(1),
  elementId: 'element-a',
  widgetInstanceId: uuid(2),
  definitionId: uuid(3),
  revisionId: uuid(4),
});
const artifactBytes = new TextEncoder().encode('{"format":"vibecanvas.widget-artifact.v1"}');
const digestSha256 = 'a'.repeat(64);
const revision: TWidgetRevisionDescriptor = Object.freeze({
  orgId: tenant.orgId,
  id: request.revisionId,
  definitionId: request.definitionId,
  revisionNumber: 7,
  manifest: {
    schemaVersion: 2 as const,
    name: 'Pinned widget',
    slug: 'pinned-widget',
    ui: { entry: 'src/main.ts' },
    server: { entry: 'src/private/server.ts', runtimeAbi: 'vibecanvas:1' },
  },
  canonicalManifestJson: '{}',
  functionDescriptors: [{
    schemaVersion: 1,
    exportName: 'loadGreeting',
    modulePath: 'src/private/server.ts',
    effect: 'fn',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    resources: [],
    limits: {
      timeoutMs: 1_000,
      memoryTier: 'small',
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    },
    retry: {
      mode: 'none',
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    },
  }] as const,
  functionDescriptorsDigestSha256: 'b'.repeat(64),
  contractDigestSha256: 'c'.repeat(64),
  uiArtifact: {
    orgId: tenant.orgId,
    id: 'artifact-a',
    kind: 'ui' as const,
    digestSha256,
    byteSize: artifactBytes.byteLength,
    retentionState: 'pinned' as const,
    retainUntilMs: null,
    createdAtMs: 1,
  },
  serverArtifact: null,
  createdAtMs: 1,
});

function widgetData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'widget-instance',
    definitionId: request.definitionId,
    revisionId: request.revisionId,
    instanceId: request.widgetInstanceId,
    w: 640,
    h: 480,
    expanded: true,
    window: 'contained',
    ...overrides,
  };
}

function delayedArtifactRead(): Readonly<{
  entered: Promise<void>;
  readArtifact: TWidgetApiContext['widget']['readArtifact'];
  resolve: (
    value: Awaited<ReturnType<TWidgetApiContext['widget']['readArtifact']>>,
  ) => void;
}> {
  let resolve!: (
    value: Awaited<ReturnType<TWidgetApiContext['widget']['readArtifact']>>,
  ) => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((settle) => { markEntered = settle; });
  const readArtifact: TWidgetApiContext['widget']['readArtifact'] = async () => {
    markEntered();
    return await new Promise((settle) => { resolve = settle; });
  };
  return { entered, readArtifact, resolve: (value) => resolve(value) };
}

function context(args: Readonly<{
  canvasExists?: boolean;
  canvasFailure?: Error;
  data?: Record<string, unknown>;
  storedRevision?: TWidgetRevisionDescriptor | null;
  tenant?: TTenantContext;
  readinessFailure?: Error;
  onRelease?: () => void;
  admission?: TWidgetApiContext['widgetRuntimeLoadAdmission'];
  findCanvas?: TWidgetApiContext['db']['canvas']['findById'];
  findDocument?: TWidgetApiContext['automerge']['findDocument'];
  getRevision?: TWidgetApiContext['widget']['getRevision'];
  issueBrowserCapability?: TWidgetApiContext['widget']['issueBrowserUiArtifactReadCapability'];
  readArtifact?: TWidgetApiContext['widget']['readArtifact'];
  releaseDocument?: TWidgetApiContext['automerge']['releaseDocument'];
}> = {}): TWidgetApiContext {
  const data = args.data ?? widgetData();
  const handle = {
    whenReady: async () => {
      if (args.readinessFailure) throw args.readinessFailure;
    },
    doc: () => ({ elements: { [request.elementId]: { id: request.elementId, data } } }),
  } as never;
  return {
    tenant: args.tenant ?? tenant,
    db: {
      canvas: {
        create: async (_tenant, value) => ({ ...value, created_at: '1970-01-01T00:00:00.001Z' }),
        deleteById: async () => [],
        findById: args.findCanvas ?? (async () => {
          if (args.canvasFailure) throw args.canvasFailure;
          return args.canvasExists === false ? null : ({
            id: request.canvasId,
            name: 'Canvas',
            automerge_url: 'automerge:canvas-a',
            created_at: '1970-01-01T00:00:00.001Z',
          });
        }),
        findByName: async () => null,
        listAll: async () => [],
        renameById: async () => null,
      },
    },
    automerge: {
      findDocument: args.findDocument ?? (async () => handle),
      releaseDocument: args.releaseDocument ?? (async () => { args.onRelease?.(); }),
    },
    widget: {
      getRevision: args.getRevision
        ?? (async () => args.storedRevision === undefined ? revision : args.storedRevision),
      getActiveRevision: async () => {
        throw new Error('The runtime must never substitute the active revision.');
      },
      issueBrowserUiArtifactReadCapability: args.issueBrowserCapability
        ?? (async () => 'read-capability'),
      getArtifact: async () => revision.uiArtifact,
      readArtifact: args.readArtifact ?? (async () => artifactBytes),
    },
    widgetRuntimeLoadAdmission: args.admission ?? {
      run: async (_tenant, signal, operation) => await operation(
        signal ?? new AbortController().signal,
        (cleanup) => {
          try {
            void cleanup().catch(() => undefined);
          } catch {
            // The production admission service observes cleanup failures.
          }
        },
      ),
    },
  };
}

describe('widget runtime API', () => {
  test('accepts only exact authority-free persisted identity', () => {
    expect(ZWidgetRuntimeLoadInput.parse(request)).toEqual(request);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, orgId: tenant.orgId }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, actorInstanceId: 'actor-a' }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, activeRevisionId: 'revision-latest' }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, artifactDigestSha256: digestSha256 }).success).toBe(false);
  });

  test('returns only the exact CRDT-pinned revision and content-addressed browser envelope', async () => {
    const load = router.api.widget.runtime.load.callable({ context: context() });
    const result = await load(request);

    expect(result.identity).toEqual(request);
    expect(result.identity).not.toHaveProperty('orgId');
    expect(result.manifest.name).toBe('Pinned widget');
    expect(result.manifest).not.toHaveProperty('server');
    expect(result.artifact).toEqual({
      digestSha256,
      bytesBase64: Buffer.from(artifactBytes).toString('base64'),
    });
    const { modulePath: _modulePath, ...browserFunction } = revision.functionDescriptors[0]!;
    expect(result.functionDescriptors).toEqual([browserFunction]);
    expect(result.functionDescriptors[0]).not.toHaveProperty('modulePath');
    expect(ZWidgetRuntimeLoadOutput.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('modulePath');
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      functionDescriptors: [{ ...result.functionDescriptors[0], modulePath: 'src/private/server.ts' }],
    }).success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('read-capability');
  });

  test('denies a widget repin that lands while the artifact read is delayed', async () => {
    let document = {
      elements: {
        [request.elementId]: { id: request.elementId, data: widgetData() },
      },
    };
    const delayed = delayedArtifactRead();
    const load = router.api.widget.runtime.load.callable({
      context: context({
        findDocument: async () => ({
          whenReady: async () => {},
          doc: () => document,
        }) as never,
        readArtifact: delayed.readArtifact,
      }),
    });
    const pending = load(request);
    await delayed.entered;
    document = {
      elements: {
        [request.elementId]: {
          id: request.elementId,
          data: widgetData({
            instanceId: uuid(20),
            definitionId: uuid(21),
            revisionId: uuid(22),
          }),
        },
      },
    };
    delayed.resolve(artifactBytes);

    await expect(pending).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Widget runtime target not found.',
    });
  });

  test('denies a widget removal that lands while the artifact read is delayed', async () => {
    let document: Readonly<{
      elements: Record<string, Readonly<{ id: string; data: Record<string, unknown> }>>;
    }> = {
      elements: {
        [request.elementId]: { id: request.elementId, data: widgetData() },
      },
    };
    const delayed = delayedArtifactRead();
    const load = router.api.widget.runtime.load.callable({
      context: context({
        findDocument: async () => ({
          whenReady: async () => {},
          doc: () => document,
        }) as never,
        readArtifact: delayed.readArtifact,
      }),
    });
    const pending = load(request);
    await delayed.entered;
    document = { elements: {} };
    delayed.resolve(artifactBytes);

    await expect(pending).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Widget runtime target not found.',
    });
  });

  test('denies membership revocation that lands while the artifact read is delayed', async () => {
    let membershipActive = true;
    let canvasReads = 0;
    const findCanvas: TWidgetApiContext['db']['canvas']['findById'] = async () => {
      canvasReads += 1;
      return membershipActive
        ? {
          id: request.canvasId,
          name: 'Canvas',
          automerge_url: 'automerge:canvas-a',
          created_at: '1970-01-01T00:00:00.001Z',
        }
        : null;
    };
    const delayed = delayedArtifactRead();
    const load = router.api.widget.runtime.load.callable({
      context: context({ findCanvas, readArtifact: delayed.readArtifact }),
    });
    const pending = load(request);
    await delayed.entered;
    membershipActive = false;
    delayed.resolve(artifactBytes);

    await expect(pending).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Widget runtime target not found.',
    });
    expect(canvasReads).toBe(2);
  });

  test('uses one indistinguishable NOT_FOUND result for missing membership or identity mismatch', async () => {
    const cases = [
      context({ canvasExists: false }),
      context({ tenant: { ...tenant, canvasId: 'another-canvas' } }),
      context({ data: { type: 'widget-instance', ...request, instanceId: 'other' } }),
      context({ storedRevision: null }),
      context({ storedRevision: { ...revision, id: 'other-revision' } }),
      context({ storedRevision: { ...revision, definitionId: 'other-definition' } }),
    ];
    const signatures: string[] = [];
    for (const candidate of cases) {
      const load = router.api.widget.runtime.load.callable({ context: candidate });
      try {
        await load(request);
        throw new Error('Expected runtime target denial.');
      } catch (error) {
        expect(error).toMatchObject({ code: 'NOT_FOUND' });
        signatures.push(JSON.stringify(error));
      }
    }
    expect(new Set(signatures).size).toBe(1);
  });

  test('sanitizes infrastructure failures without exposing host paths', async () => {
    const sentinel = '/organizations/org-a/main.db';
    const load = router.api.widget.runtime.load.callable({
      context: context({ canvasFailure: new Error(sentinel) }),
    });
    try {
      await load(request);
      throw new Error('Expected runtime infrastructure rejection.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });

  test('canonicalizes nested transport errors instead of exposing their messages', async () => {
    const sentinel = '/organizations/org-a/private-artifacts/widget.tar';
    const load = router.api.widget.runtime.load.callable({
      context: context({ canvasFailure: new ORPCError('NOT_FOUND', { message: sentinel }) }),
    });
    try {
      await load(request);
      throw new Error('Expected runtime target rejection.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Widget runtime target not found.',
      });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });

  test('releases an admitted document when readiness rejects', async () => {
    let releaseCount = 0;
    const load = router.api.widget.runtime.load.callable({
      context: context({
        readinessFailure: new Error('peer load failed'),
        onRelease: () => { releaseCount += 1; },
      }),
    });
    await expect(load(request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(releaseCount).toBe(1);
  });

  test('does not hold an authorized response behind delayed document release', async () => {
    let releaseDocument!: () => void;
    let markReleaseEntered!: () => void;
    const releaseEntered = new Promise<void>((resolve) => { markReleaseEntered = resolve; });
    const releaseGate = new Promise<void>((resolve) => { releaseDocument = resolve; });
    const release = mock(async () => {
      markReleaseEntered();
      await releaseGate;
    });
    const load = router.api.widget.runtime.load.callable({
      context: context({ releaseDocument: release }),
    });

    const pending = load(request);
    await releaseEntered;
    await expect(pending).resolves.toMatchObject({ identity: request });
    expect(release).toHaveBeenCalledTimes(1);

    releaseDocument();
  });

  test('stops before downstream authority work when an early lookup settles after cancellation', async () => {
    let resolveCanvas!: (value: Awaited<ReturnType<TWidgetApiContext['db']['canvas']['findById']>>) => void;
    let markCanvasEntered!: () => void;
    const canvasEntered = new Promise<void>((resolve) => { markCanvasEntered = resolve; });
    const findCanvas = mock(() => {
      markCanvasEntered();
      return new Promise<Awaited<ReturnType<TWidgetApiContext['db']['canvas']['findById']>>>(
        (resolve) => { resolveCanvas = resolve; },
      );
    });
    const findDocument = mock(async () => { throw new Error('must not run'); });
    const readArtifact = mock(async () => artifactBytes);
    const load = router.api.widget.runtime.load.callable({
      context: context({ findCanvas, findDocument, readArtifact }),
    });
    const controller = new AbortController();
    const pending = load(request, { signal: controller.signal });
    await canvasEntered;
    controller.abort();
    resolveCanvas({
      id: request.canvasId,
      name: 'Canvas',
      automerge_url: 'automerge:canvas-a',
      created_at: '1970-01-01T00:00:00.001Z',
    });

    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
    expect(findDocument).not.toHaveBeenCalled();
    expect(readArtifact).not.toHaveBeenCalled();
  });

  test('starts release without delaying cancellation after later authority work', async () => {
    let resolveRevision!: (value: TWidgetRevisionDescriptor | null) => void;
    let markRevisionEntered!: () => void;
    let releaseDocument!: () => void;
    const revisionEntered = new Promise<void>((resolve) => { markRevisionEntered = resolve; });
    const releaseGate = new Promise<void>((resolve) => { releaseDocument = resolve; });
    const getRevision = mock(() => {
      markRevisionEntered();
      return new Promise<TWidgetRevisionDescriptor | null>((resolve) => { resolveRevision = resolve; });
    });
    const issueBrowserCapability = mock(async () => 'read-capability');
    const readArtifact = mock(async () => artifactBytes);
    const release = mock(async () => releaseGate);
    const load = router.api.widget.runtime.load.callable({
      context: context({
        getRevision,
        issueBrowserCapability,
        readArtifact,
        releaseDocument: release,
      }),
    });
    const controller = new AbortController();
    const pending = load(request, { signal: controller.signal });
    await revisionEntered;
    controller.abort();
    resolveRevision(revision);
    await Promise.resolve();
    await Promise.resolve();

    expect(issueBrowserCapability).not.toHaveBeenCalled();
    expect(readArtifact).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
    expect(issueBrowserCapability).not.toHaveBeenCalled();
    expect(readArtifact).not.toHaveBeenCalled();

    releaseDocument();
  });
});
