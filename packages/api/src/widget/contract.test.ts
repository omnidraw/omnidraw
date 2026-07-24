import { describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ORPCError } from '@orpc/contract';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  type TWidgetRevisionDescriptor,
  type TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { router } from '../router';
import {
  ZWidgetCapsuleHostConfiguration,
  ZWidgetRuntimeLoadInput,
  ZWidgetRuntimeLoadOutput,
} from './contract';
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
const artifactBytes = new TextEncoder().encode('capsule-signed-artifact-bytes');
const digestSha256 = createHash('sha256').update(artifactBytes).digest('hex');
const capsuleArtifactHash = `sha256:${'b'.repeat(64)}` as const;
const capsuleTarget = Object.freeze({
  runtimeAbi: 'quickjs-release-sync-v1',
  domProfile: 'dom-core-v2',
  featureProfiles: ['artifact-resources-v1'],
});
const capsuleBudgets = Object.freeze({
  cpuMs: 50,
  memoryBytes: 8 * 1_024 * 1_024,
  domNodes: 1_000,
  handles: 1_000,
  messageBytes: 1_024 * 1_024,
  streamBytes: 1_024 * 1_024,
  assetBytes: 4 * 1_024 * 1_024,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1_024,
});
const serverFunctionDescriptor: TWidgetServerFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'loadGreeting',
  modulePath: 'src/private/server.ts',
  effect: 'fn',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  resources: [],
  limits: {
    timeoutMs: 1_000,
    memoryTier: 'small' as const,
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
  retry: {
    mode: 'none' as const,
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  },
});
const functionDescriptors = Object.freeze([serverFunctionDescriptor]);
const functionDescriptorsDigestSha256 = createHash('sha256')
  .update(fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors))
  .digest('hex');
const browserFunctionDescriptors =
  fnProjectWidgetBrowserFunctionDescriptors(functionDescriptors);
const browserFunctionDescriptorsDigestSha256 = createHash('sha256')
  .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(browserFunctionDescriptors))
  .digest('hex');
const hostConfiguration = Object.freeze({
  generation: 'a'.repeat(64),
  targetBase: Object.freeze({
    runtimeAbi: capsuleTarget.runtimeAbi,
    domProfile: capsuleTarget.domProfile,
  }),
  allowedFeatureProfiles: Object.freeze([
    'artifact-resources-v1',
    'canvas-2d-v1',
  ]),
  budgetCeiling: capsuleBudgets,
  budgetDefaults: Object.freeze({
    ...capsuleBudgets,
    cpuMs: 25,
    domNodes: 500,
  }),
  previewSigningKeyId: 'vibecanvas-preview-v1',
  releaseSigningKeyId: 'vibecanvas-release-v1',
  signingKeys: Object.freeze([
    Object.freeze({
      keyId: 'vibecanvas-preview-v1',
      algorithm: 'Ed25519' as const,
      format: 'raw' as const,
      publicKeyBase64: Buffer.from(new Uint8Array(32).fill(1)).toString('base64'),
    }),
    Object.freeze({
      keyId: 'vibecanvas-release-v1',
      algorithm: 'Ed25519' as const,
      format: 'raw' as const,
      publicKeyBase64: Buffer.from(new Uint8Array(32).fill(2)).toString('base64'),
    }),
  ]),
});
const runtimeDescriptor = Object.freeze({
  format: 'vibecanvas.capsule-runtime.v1' as const,
  capsuleArtifactHash,
  target: capsuleTarget,
  budgets: capsuleBudgets,
  capabilityRequests: [{
    id: `vibecanvas.widget.functions.h${browserFunctionDescriptorsDigestSha256}`,
    versionRange: '1.0.0',
    contractHash: `sha256:${browserFunctionDescriptorsDigestSha256}` as const,
    required: true,
    operations: ['loadGreeting'],
  }],
  channels: null,
  parkability: { parkable: false as const },
  signatureKeyIds: ['vibecanvas-release-v1'],
});
const revision: TWidgetRevisionDescriptor = Object.freeze({
  orgId: tenant.orgId,
  id: request.revisionId,
  definitionId: request.definitionId,
  revisionNumber: 7,
  manifest: {
    schemaVersion: 3 as const,
    name: 'Pinned widget',
    slug: 'pinned-widget',
    ui: {
      runtime: 'capsule' as const,
      entry: 'src/main.ts',
      target: capsuleTarget,
    },
    server: { entry: 'src/private/server.ts', runtimeAbi: 'vibecanvas:1' },
  },
  canonicalManifestJson: '{}',
  functionDescriptors,
  functionDescriptorsDigestSha256,
  capabilityContractDigestSha256: 'd'.repeat(64),
  channelContractDigestSha256: 'e'.repeat(64),
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
  uiRuntime: runtimeDescriptor,
  serverArtifact: null,
  serverRuntimeAbi: 'vibecanvas:1',
  capsuleBuildIdentity: {
    packageName: '@omnidraw/capsule' as const,
    packageVersion: '0.9.1',
    packageDigest: `sha256:${'f'.repeat(64)}` as const,
    buildApiVersion: 'capsule-build-v1',
    runtimeBuildDigest: `sha256:${'1'.repeat(64)}` as const,
  },
  buildPolicyId: 'vibecanvas-release-v1',
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
  readHostConfiguration?: TWidgetApiContext['widgetCapsuleHostConfiguration']['read'];
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
    widgetCapsuleHostConfiguration: {
      read: args.readHostConfiguration ?? (async () => hostConfiguration),
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
  test('returns only bounded public Capsule host configuration', async () => {
    const read = mock(async () => hostConfiguration);
    const config = router.api.widget.runtime.config.callable({
      context: context({ readHostConfiguration: read }),
    });

    const result = await config();

    expect(result).toEqual(hostConfiguration);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith();
    expect(ZWidgetCapsuleHostConfiguration.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...result,
      signingKeys: result.signingKeys.map((key, index) => index === 0
        ? { ...key, privateKeyBase64: 'forbidden' }
        : key),
    }).success).toBe(false);
  });

  test('rejects ambiguous or incomplete Capsule host trust configuration', () => {
    const [previewKey, releaseKey] = hostConfiguration.signingKeys;
    expect(previewKey).toBeDefined();
    expect(releaseKey).toBeDefined();

    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      signingKeys: [previewKey, { ...releaseKey, keyId: previewKey!.keyId }],
    }).success).toBe(false);
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      signingKeys: [
        previewKey,
        { ...releaseKey, publicKeyBase64: previewKey!.publicKeyBase64 },
      ],
    }).success).toBe(false);
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      previewSigningKeyId: 'missing-preview-key',
    }).success).toBe(false);
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      releaseSigningKeyId: hostConfiguration.previewSigningKeyId,
    }).success).toBe(false);
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      allowedFeatureProfiles: [
        ...hostConfiguration.allowedFeatureProfiles,
        hostConfiguration.allowedFeatureProfiles[0],
      ],
    }).success).toBe(false);
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      budgetDefaults: {
        ...hostConfiguration.budgetDefaults,
        cpuMs: hostConfiguration.budgetCeiling.cpuMs + 1,
      },
    }).success).toBe(false);
    const { lifecycleBytes: _lifecycleBytes, ...incompleteBudget } =
      hostConfiguration.budgetCeiling;
    expect(ZWidgetCapsuleHostConfiguration.safeParse({
      ...hostConfiguration,
      budgetCeiling: incompleteBudget,
    }).success).toBe(false);
  });

  test('fails closed before transporting private or malformed signing keys', async () => {
    const config = router.api.widget.runtime.config.callable({
      context: context({
        readHostConfiguration: async () => ({
          ...hostConfiguration,
          signingKeys: hostConfiguration.signingKeys.map((key, index) =>
            index === 0 ? { ...key, privateKey: 'forbidden' } : key),
        }),
      }),
    });

    await expect(config()).rejects.toBeInstanceOf(Error);
  });

  test('accepts only exact authority-free persisted identity', () => {
    expect(ZWidgetRuntimeLoadInput.parse(request)).toEqual(request);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, orgId: tenant.orgId }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, actorInstanceId: 'actor-a' }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, activeRevisionId: 'revision-latest' }).success).toBe(false);
    expect(ZWidgetRuntimeLoadInput.safeParse({ ...request, artifactDigestSha256: digestSha256 }).success).toBe(false);
  });

  test('returns only the exact CRDT-pinned revision and signed Capsule artifact', async () => {
    const load = router.api.widget.runtime.load.callable({ context: context() });
    const result = await load(request);

    expect(result.identity).toEqual(request);
    expect(result.identity).not.toHaveProperty('orgId');
    expect(result.manifest.name).toBe('Pinned widget');
    expect(result.manifest).not.toHaveProperty('server');
    expect(result.artifact).toEqual({
      digestSha256,
      byteSize: artifactBytes.byteLength,
      bytesBase64: Buffer.from(artifactBytes).toString('base64'),
    });
    expect(result.runtimeDescriptor).toEqual(runtimeDescriptor);
    const { modulePath: _modulePath, ...browserFunction } = revision.functionDescriptors[0]!;
    expect(result.functionDescriptors).toEqual([browserFunction]);
    expect(result.browserFunctionDescriptorsDigestSha256)
      .toBe(browserFunctionDescriptorsDigestSha256);
    expect(result.runtimeDescriptor.capabilityRequests[0]?.contractHash)
      .toBe(`sha256:${browserFunctionDescriptorsDigestSha256}`);
    expect(browserFunctionDescriptorsDigestSha256)
      .not.toBe(functionDescriptorsDigestSha256);
    expect(result.functionDescriptors[0]).not.toHaveProperty('modulePath');
    expect(ZWidgetRuntimeLoadOutput.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('modulePath');
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      functionDescriptors: [{ ...result.functionDescriptors[0], modulePath: 'src/private/server.ts' }],
    }).success).toBe(false);
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      browserFunctionDescriptorsDigestSha256: undefined,
    }).success).toBe(false);
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      browserFunctionDescriptorsDigestSha256: 'A'.repeat(64),
    }).success).toBe(false);
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      artifact: { ...result.artifact, byteSize: result.artifact.byteSize + 1 },
    }).success).toBe(false);
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      runtimeDescriptor: { ...result.runtimeDescriptor, signatureKeyIds: [] },
    }).success).toBe(false);
    expect(ZWidgetRuntimeLoadOutput.safeParse({
      ...result,
      runtimeDescriptor: { ...result.runtimeDescriptor, privateKey: 'forbidden' },
    }).success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('read-capability');
    expect(JSON.stringify(result)).not.toContain('privateKey');
  });

  test('fails closed when persisted function fields change without a new signed contract', async () => {
    const mutations: readonly TWidgetServerFunctionDescriptor[] = [
      { ...serverFunctionDescriptor, modulePath: 'src/private/changed.ts' },
      {
        ...serverFunctionDescriptor,
        inputSchema: { type: 'object', required: ['name'] },
      },
      { ...serverFunctionDescriptor, effect: 'tx' },
      {
        ...serverFunctionDescriptor,
        limits: { ...serverFunctionDescriptor.limits, timeoutMs: 2_000 },
      },
    ];

    for (const descriptor of mutations) {
      const load = router.api.widget.runtime.load.callable({
        context: context({
          storedRevision: {
            ...revision,
            functionDescriptors: [descriptor],
          },
        }),
      });
      await expect(load(request)).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Widget runtime operation failed.',
      });
    }
  });

  test('fails closed when changed descriptors and digest retain the old signed request', async () => {
    const changedDescriptors = [{
      ...serverFunctionDescriptor,
      outputSchema: { type: 'object', required: ['message'] },
    }];
    const changedDigest = createHash('sha256')
      .update(fnCanonicalizeWidgetServerFunctionDescriptors(changedDescriptors))
      .digest('hex');
    const load = router.api.widget.runtime.load.callable({
      context: context({
        storedRevision: {
          ...revision,
          functionDescriptors: changedDescriptors,
          functionDescriptorsDigestSha256: changedDigest,
        },
      }),
    });

    await expect(load(request)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Widget runtime operation failed.',
    });
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

  test('denies same-size bytes that do not match the pinned exact-byte digest', async () => {
    const alteredBytes = new Uint8Array(artifactBytes.byteLength);
    alteredBytes.fill(0x78);
    const load = router.api.widget.runtime.load.callable({
      context: context({ readArtifact: async () => alteredBytes }),
    });

    await expect(load(request)).rejects.toMatchObject({
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
