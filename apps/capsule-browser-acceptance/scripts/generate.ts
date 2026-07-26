import { createHash, webcrypto } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
  VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  WidgetArtifactBuilderCapsule,
  buildCapsuleGuest,
  type CapsuleArtifactSigningKey,
} from '@vibecanvas/capsule-vibecanvas/build';
import {
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_RUNTIME_ABI,
  CAPSULE_SVG_DOM_PROFILE,
  VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from '@vibecanvas/capsule-vibecanvas/contract';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
} from '@vibecanvas/widget-contract';

type TBuildRequest = Parameters<WidgetArtifactBuilderCapsule['build']>[1];
type TTenant = Parameters<WidgetArtifactBuilderCapsule['build']>[0];
type TManifest = TBuildRequest['manifest'];
type TSnapshot = TBuildRequest['snapshot'];
type TSourceFile = Readonly<{ path: string; source: string }>;

type TFixtureBuild = Readonly<{
  name: string;
  slug: string;
  entry: string;
  files: readonly TSourceFile[];
  featureProfiles?: readonly string[];
  localStore?: 'none' | 'ephemeral';
  collaborative?: boolean;
  server?: Readonly<{ entry: string; runtimeAbi: string }>;
  signingPurpose?: 'preview' | 'release';
}>;

const encoder = new TextEncoder();
const outputDirectory = join(import.meta.dir, '..', 'generated');
const tempRoot = join(import.meta.dir, '..', '.tmp');
const builderIdentity = 'vibecanvas-capsule-browser-acceptance-v1';
const capsuleBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '0.9.2',
  packageDigest:
    'sha256:9ac71bab6984a60d7abc3ecd99c5b3733028a312ab97095615332ec8471f8753' as const,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest:
    'sha256:8d6786bf0775f33724c74ea6f71841f5e61dd86d0de7c2b6c3d6c61f9d4ea146' as const,
});
const tenant = Object.freeze({
  orgId: 'capsule-browser-acceptance',
  accountId: 'capsule-browser-acceptance',
  cellId: 'local',
  placementEpoch: 1,
  roles: Object.freeze([]),
  capabilities: Object.freeze([]),
  requestId: 'capsule-browser-acceptance',
}) satisfies TTenant;

const sources = Object.freeze({
  plain: `
import {
  emitWidgetOutput,
  getWidgetProps,
  getWidgetTheme,
  subscribeWidgetProps,
  subscribeWidgetTheme,
} from '@vibecanvas/sdk/widget';

const root = document.createElement('main');
const status = document.createElement('output');
root.append(status);
document.body.append(root);

function count(value: unknown): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return -1;
  const candidate = (value as { count?: unknown }).count;
  return typeof candidate === 'number' ? candidate : -1;
}

function render(): void {
  const props = getWidgetProps();
  const theme = getWidgetTheme();
  status.textContent = String(count(props)) + ':' + theme.appearance;
}

render();
emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'plain-ready:' + status.textContent,
});
subscribeWidgetProps((props) => {
  render();
  emitWidgetOutput({
    type: 'notification',
    tone: 'info',
    message: 'props:' + String(count(props)),
  });
});
subscribeWidgetTheme((theme) => {
  render();
  emitWidgetOutput({
    type: 'notification',
    tone: 'info',
    message: 'theme:' + theme.appearance,
  });
});
`.trim(),
  svg: `
import { emitWidgetOutput } from '@vibecanvas/sdk/widget';

const namespace = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(namespace, 'svg');
svg.setAttribute('viewBox', '0 0 32 32');
const circle = document.createElementNS(namespace, 'circle');
circle.setAttribute('cx', '16');
circle.setAttribute('cy', '16');
circle.setAttribute('r', '12');
circle.setAttribute('fill', '#22c55e');
svg.append(circle);
document.body.append(svg);
emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'svg-ready',
});
`.trim(),
  canvas: `
import { emitWidgetOutput } from '@vibecanvas/sdk/widget';

const canvas = document.createElement('canvas');
canvas.width = 32;
canvas.height = 32;
const context = canvas.getContext('2d');
if (context === null) throw new Error('Canvas 2D unavailable');
context.fillStyle = '#4f46e5';
context.fillRect(0, 0, 32, 32);
document.body.append(canvas);
emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'canvas-ready',
});
`.trim(),
  react: `
import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { emitWidgetOutput } from '@vibecanvas/sdk/widget';

function App() {
  useLayoutEffect(() => {
    emitWidgetOutput({
      type: 'notification',
      tone: 'success',
      message: 'react-ready',
    });
  }, []);
  return <main data-runtime="react-19.2.7">Pinned React TSX</main>;
}

const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(<App />);
`.trim(),
  published: `
import { double } from '../server/double.server';
import {
  changeCollaborativeState,
  emitWidgetOutput,
  getCollaborativeState,
  subscribeCollaborativeState,
  subscribeWidgetLifecycle,
} from '@vibecanvas/sdk/widget';

type TCount = Readonly<{ count: number }>;

function emit(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
  emitWidgetOutput({ type: 'notification', tone, message });
}

subscribeWidgetLifecycle((event) => {
  emit('lifecycle:' + event.state + ':' + String(event.generation));
});

void (async (): Promise<void> => {
  const initial = await getCollaborativeState<TCount>();

  let resolveInitialStream: (() => void) | undefined;
  let resolveChangedStream: (() => void) | undefined;
  const initialStream = new Promise<void>((resolve) => {
    resolveInitialStream = resolve;
  });
  const changedStream = new Promise<void>((resolve) => {
    resolveChangedStream = resolve;
  });
  const unsubscribe = subscribeCollaborativeState<TCount>((value) => {
    emit('collab-stream:' + String(value.count));
    if (value.count === 0) resolveInitialStream?.();
    if (value.count === 1) resolveChangedStream?.();
  });
  await initialStream;

  const changed = await changeCollaborativeState<TCount>({ count: 1 });
  await changedStream;

  const result = await double(
    { value: 21 },
    { timeoutMs: 3_000 },
  ) as Readonly<{ doubled: number }>;
  let schemaRejected = false;
  try {
    await double({ value: 'invalid' } as never, { timeoutMs: 3_000 });
  } catch {
    schemaRejected = true;
  }
  unsubscribe();
  emit(
    'published-ready:'
      + String(initial.count)
      + ':' + String(changed.count)
      + ':' + String(result.doubled)
      + ':' + (schemaRejected ? 'schema-rejected' : 'schema-unexpected'),
    schemaRejected ? 'success' : 'error',
  );
})().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  emit('published-failed:' + message, 'error');
});
`.trim(),
  server: `
export async function double(
  input: Readonly<{ value: number }>,
): Promise<Readonly<{ doubled: number }>> {
  return Object.freeze({ doubled: input.value * 2 });
}
`.trim(),
  serverEntry: `
import './double.server';
`.trim(),
});

const SERVER_FUNCTION_DESCRIPTOR = Object.freeze({
  schemaVersion: 1 as const,
  exportName: 'double',
  effect: 'fn' as const,
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze(['value']),
    properties: Object.freeze({
      value: Object.freeze({ type: 'number' }),
    }),
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: Object.freeze(['doubled']),
    properties: Object.freeze({
      doubled: Object.freeze({ type: 'number' }),
    }),
  }),
  resources: Object.freeze([]),
  limits: Object.freeze({
    timeoutMs: 5_000,
    memoryTier: 'small' as const,
    outputByteLimit: 4_096,
    logByteLimit: 0,
  }),
  retry: Object.freeze({
    mode: 'none' as const,
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  }),
});

function snapshotDigest(
  files: readonly Readonly<{ path: string; bytes: Uint8Array }>[],
): string {
  const digest = createHash('sha256');
  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    digest.update(`${pathBytes.byteLength}:`);
    digest.update(pathBytes);
    digest.update(`:${file.bytes.byteLength}:`);
    digest.update(file.bytes);
    digest.update(';');
  }
  return digest.digest('hex');
}

function snapshot(files: readonly TSourceFile[]): TSnapshot {
  const ordered = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, source }) => Object.freeze({
      path,
      bytes: encoder.encode(source),
    }));
  const digestSha256 = snapshotDigest(ordered);
  return Object.freeze({
    id: `capsule-browser-acceptance-${digestSha256}`,
    digestSha256,
    files: Object.freeze(ordered),
    createdAtMs: 0,
  }) as unknown as TSnapshot;
}

function manifest(args: TFixtureBuild): TManifest {
  return Object.freeze({
    schemaVersion: 3,
    name: args.name,
    slug: args.slug,
    ui: Object.freeze({
      runtime: 'capsule',
      entry: args.entry,
      target: Object.freeze({
        runtimeAbi: CAPSULE_RUNTIME_ABI,
        domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
        featureProfiles: Object.freeze([...(args.featureProfiles ?? [])].sort()),
      }),
      state: Object.freeze({
        collaborative: args.collaborative ?? false,
        localStore: args.localStore ?? 'none',
      }),
      parkability: Object.freeze({ enabled: false }),
    }),
    ...(args.server === undefined ? {} : { server: args.server }),
  });
}

async function generateKey(keyId: string): Promise<Readonly<{
  signing: CapsuleArtifactSigningKey;
  publicKeyBase64: string;
}>> {
  const pair = await webcrypto.subtle.generateKey(
    'Ed25519',
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const publicKey = await webcrypto.subtle.exportKey('raw', pair.publicKey);
  return Object.freeze({
    signing: Object.freeze({
      keyId,
      privateKey: pair.privateKey as CryptoKey,
    }),
    publicKeyBase64: Buffer.from(publicKey).toString('base64'),
  });
}

const [previewKey, releaseKey, wrongKey] = await Promise.all([
  generateKey(VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID),
  generateKey(VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID),
  generateKey('capsule-browser-acceptance-wrong-key'),
]);
const keys = Object.freeze({
  preview: previewKey.signing,
  release: releaseKey.signing,
});
const builder = new WidgetArtifactBuilderCapsule({
  tempRoot,
  builderIdentity,
  capsuleBuildIdentity,
  buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  capsuleBuild: buildCapsuleGuest,
  functionDescriptorExtractor: Object.freeze({
    async extractServerFunctionDescriptors() {
      return Object.freeze([SERVER_FUNCTION_DESCRIPTOR]);
    },
  }),
  async loadSigningKeys(purpose) {
    return Object.freeze([keys[purpose]]);
  },
});

async function build(args: TFixtureBuild) {
  const widgetManifest = manifest(args);
  const signingPurpose = args.signingPurpose ?? 'preview';
  const featureProfiles = args.featureProfiles ?? [];
  console.log(
    `Building ${args.slug} (${args.entry}; ${signingPurpose}; profiles=${featureProfiles.join(',') || 'none'})…`,
  );
  const result = await builder.build(tenant, {
    snapshot: snapshot(args.files),
    manifest: widgetManifest,
    canonicalManifestJson: JSON.stringify(widgetManifest),
    builderIdentity,
    capsuleBuildIdentity,
    buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
    signingPurpose,
  });
  const expectedKeyId = signingPurpose === 'preview'
    ? VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID
    : VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID;
  if (
    result.uiArtifact.runtimeDescriptor.signatureKeyIds.length !== 1
    || result.uiArtifact.runtimeDescriptor.signatureKeyIds[0] !== expectedKeyId
  ) {
    throw new Error(`${args.slug} was not signed by the ${signingPurpose} authority.`);
  }
  const functionDescriptors = fnProjectWidgetBrowserFunctionDescriptors(
    result.functionDescriptors,
  );
  return Object.freeze({
    digestSha256: result.uiArtifact.digestSha256,
    bytesBase64: Buffer.from(result.uiArtifact.bytes).toString('base64'),
    capsuleArtifactHash: result.uiArtifact.capsuleArtifactHash,
    runtimeDescriptor: result.uiArtifact.runtimeDescriptor,
    sourceDigestSha256: result.sourceDigestSha256,
    functionDescriptors: Object.freeze(functionDescriptors),
    browserFunctionDescriptorsDigestSha256: createHash('sha256')
      .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(functionDescriptors))
      .digest('hex'),
    serverArtifact: result.serverArtifact === null
      ? null
      : Object.freeze({
          digestSha256: result.serverArtifact.digestSha256,
          runtimeAbi: result.serverArtifact.runtimeAbi,
        }),
    diagnostics: result.diagnostics,
  });
}

const artifacts = Object.freeze({
  plain: await build({
    name: 'Browser channel acceptance',
    slug: 'browser-channel-acceptance',
    entry: 'src/plain.ts',
    files: [{ path: 'src/plain.ts', source: sources.plain }],
    localStore: 'ephemeral',
  }),
  svg: await build({
    name: 'Browser SVG acceptance',
    slug: 'browser-svg-acceptance',
    entry: 'src/svg.ts',
    files: [{ path: 'src/svg.ts', source: sources.svg }],
    featureProfiles: [CAPSULE_SVG_DOM_PROFILE],
  }),
  canvas: await build({
    name: 'Browser Canvas acceptance',
    slug: 'browser-canvas-acceptance',
    entry: 'src/canvas.ts',
    files: [{ path: 'src/canvas.ts', source: sources.canvas }],
    featureProfiles: [CAPSULE_CANVAS_2D_PROFILE],
  }),
  react: await build({
    name: 'Browser React acceptance',
    slug: 'browser-react-acceptance',
    entry: 'src/react.tsx',
    files: [{ path: 'src/react.tsx', source: sources.react }],
  }),
  published: await build({
    name: 'Published authority acceptance',
    slug: 'published-authority-acceptance',
    entry: 'ui/main.ts',
    files: [
      { path: 'ui/main.ts', source: sources.published },
      { path: 'server/index.ts', source: sources.serverEntry },
      { path: 'server/double.server.ts', source: sources.server },
    ],
    collaborative: true,
    server: Object.freeze({
      entry: 'server/index.ts',
      runtimeAbi: 'vibecanvas-function-v1',
    }),
    signingPurpose: 'release',
  }),
});

const fixture = Object.freeze({
  format: 'vibecanvas.capsule-browser-acceptance.v1',
  generatedFrom: Object.freeze({
    builderIdentity,
    capsuleBuildIdentity,
    buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  }),
  publicKeys: Object.freeze({
    preview: Object.freeze({
      keyId: VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
      algorithm: 'Ed25519',
      format: 'raw',
      publicKeyBase64: previewKey.publicKeyBase64,
    }),
    release: Object.freeze({
      keyId: VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
      algorithm: 'Ed25519',
      format: 'raw',
      publicKeyBase64: releaseKey.publicKeyBase64,
    }),
    wrong: Object.freeze({
      keyId: 'capsule-browser-acceptance-wrong-key',
      algorithm: 'Ed25519',
      format: 'raw',
      publicKeyBase64: wrongKey.publicKeyBase64,
    }),
  }),
  host: Object.freeze({
    generation: 'capsule-browser-acceptance-v1',
    targetBase: Object.freeze({
      runtimeAbi: CAPSULE_RUNTIME_ABI,
      domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
    }),
    allowedFeatureProfiles: Object.freeze([
      CAPSULE_CANVAS_2D_PROFILE,
      CAPSULE_SVG_DOM_PROFILE,
    ].sort()),
    budgetCeiling: VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
    budgetDefaults: VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
    previewSigningKeyId: VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
    releaseSigningKeyId: VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
  }),
  artifacts,
});
const serialized = `${JSON.stringify(fixture)}\n`;
if (/private|pkcs8/i.test(serialized)) {
  throw new Error('Browser fixture output unexpectedly contains private-key material.');
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'fixtures.json'), serialized, {
  encoding: 'utf8',
  mode: 0o600,
});
console.log(
  `Generated ${Object.keys(artifacts).length} preview/release-signed Capsule browser artifacts.`,
);
