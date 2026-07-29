import { createHash, webcrypto } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build as viteBuild, version as viteVersion } from 'vite';
import {
  VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
  VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  WidgetArtifactBuilderCapsule,
  buildCapsuleGuest,
  type CapsuleArtifactSigningKey,
} from '@vibecanvas/capsule-vibecanvas/build';
import {
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_RUNTIME_ABI,
  CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
  CAPSULE_SVG_DOM_PROFILE,
  VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
  VIBECANVAS_CAPSULE_TESTED_THREE_VERSION,
} from '@vibecanvas/capsule-vibecanvas/contract';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnProjectWidgetBrowserFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import type { TVibecanvasDistributionBuild } from '@vibecanvas/capsule-vibecanvas/builder';

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
  budgets?: Readonly<{ gpuBytes?: number; messageBytes?: number }>;
  localStore?: 'none' | 'ephemeral';
  collaborative?: boolean;
  server?: Readonly<{ entry: string; runtimeAbi: string }>;
  signingPurpose?: 'preview' | 'release';
}>;

const encoder = new TextEncoder();
const outputDirectory = join(import.meta.dir, '..', 'generated');
const tempRoot = join(import.meta.dir, '..', '.tmp');
const repositoryRoot = join(import.meta.dir, '..', '..', '..');
const sdkWidgetSourcePath = join(repositoryRoot, 'packages', 'sdk', 'src', 'widget.ts');
const builderIdentity = 'vibecanvas-capsule-browser-acceptance-v1';
const capsuleBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '0.9.4',
  packageDigest:
    'sha256:0d39b40a978fc0ce483c64c40f83eb25fd77f6f970d361feb5a4875de6758189' as const,
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
  three: `
import * as THREE from 'three';
import { emitWidgetOutput } from '@vibecanvas/sdk/widget';

if (THREE.REVISION !== '185') {
  throw new Error('Unexpected Three.js revision ' + THREE.REVISION);
}

const canvas = document.createElement('canvas');
canvas.width = 192;
canvas.height = 128;
canvas.setAttribute('aria-label', 'Three.js WebGL acceptance surface');
document.body.append(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: false,
  antialias: false,
});
renderer.setPixelRatio(1);
renderer.setSize(192, 128, false);
renderer.setClearColor(0x05070d, 1);

const spherePositions: number[] = [];
const sphereNormals: number[] = [];
const sphereIndices: number[] = [];
const widthSegments = 24;
const heightSegments = 16;
for (let y = 0; y <= heightSegments; y += 1) {
  const v = y / heightSegments;
  const phi = v * Math.PI;
  for (let x = 0; x <= widthSegments; x += 1) {
    const u = x / widthSegments;
    const theta = u * Math.PI * 2;
    const nx = -Math.cos(theta) * Math.sin(phi);
    const ny = Math.cos(phi);
    const nz = Math.sin(theta) * Math.sin(phi);
    sphereNormals.push(nx, ny, nz);
    spherePositions.push(nx * 1.35, ny * 1.35, nz * 1.35);
  }
}
for (let y = 0; y < heightSegments; y += 1) {
  for (let x = 0; x < widthSegments; x += 1) {
    const first = y * (widthSegments + 1) + x;
    const second = first + widthSegments + 1;
    sphereIndices.push(first, second, first + 1, second, second + 1, first + 1);
  }
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(spherePositions, 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sphereNormals, 3));
geometry.setIndex(sphereIndices);
const material = new THREE.RawShaderMaterial({
  uniforms: {
    time: { value: 0 },
  },
  vertexShader: [
    'precision highp float;',
    'attribute vec3 position;',
    'attribute vec3 normal;',
    'uniform mat4 projectionMatrix;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat3 normalMatrix;',
    'uniform float time;',
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'void main() {',
    '  vNormal = normalize(normalMatrix * normal);',
    '  float pulse = 1.0 + 0.055 * sin(time * 2.0 + position.y * 5.0);',
    '  vec3 transformed = position * pulse;',
    '  vPosition = transformed;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
    '}',
  ].join('\\n'),
  fragmentShader: [
    'precision highp float;',
    'uniform float time;',
    'varying vec3 vNormal;',
    'varying vec3 vPosition;',
    'void main() {',
    '  float rim = pow(1.0 - abs(vNormal.z), 2.1);',
    '  float bands = 0.5 + 0.5 * sin(vPosition.y * 9.0 - time * 2.4);',
    '  vec3 magenta = vec3(1.0, 0.03, 0.72);',
    '  vec3 cyan = vec3(0.04, 0.9, 1.0);',
    '  vec3 color = mix(magenta, cyan, bands);',
    '  gl_FragColor = vec4(color * (0.35 + 1.65 * rim), 1.0);',
    '}',
  ].join('\\n'),
  depthTest: false,
  depthWrite: false,
});
const scene = new THREE.Scene();
const orb = new THREE.Mesh(geometry, material);
scene.add(orb);
const camera = new THREE.PerspectiveCamera(42, 192 / 128, 0.1, 100);
camera.position.set(0, 0, 5);
let frames = 0;
let startedAtMs: number | null = null;
function render(timestampMs: number): void {
  if (startedAtMs === null) startedAtMs = timestampMs;
  const elapsedSeconds = (timestampMs - startedAtMs) / 1000;
  material.uniforms.time.value = elapsedSeconds;
  orb.rotation.x = elapsedSeconds * 0.75;
  orb.rotation.y = elapsedSeconds * 1.2;
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 2) {
    emitWidgetOutput({
      type: 'notification',
      tone: 'success',
      message: 'three-ready:' + frames,
    });
  }
  if (frames < 3) requestAnimationFrame(render);
}
requestAnimationFrame(render);
window.addEventListener('pagehide', () => {
  geometry.dispose();
  material.dispose();
  renderer.dispose();
}, { once: true });
`.trim(),
  threePbr: `
import * as THREE from 'three';

const canvas = document.createElement('canvas');
canvas.width = 192;
canvas.height = 128;
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: false,
  antialias: false,
});
renderer.setSize(192, 128, false);
const scene = new THREE.Scene();
scene.add(new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.82, 4),
  new THREE.MeshPhysicalMaterial({
    color: 0x6c5cff,
    emissive: 0x24107a,
    emissiveIntensity: 2.6,
    metalness: 0.35,
    roughness: 0.22,
    clearcoat: 1,
  }),
));
scene.add(new THREE.HemisphereLight(0xb8dfff, 0x18072e, 2.1));
const camera = new THREE.PerspectiveCamera(42, 192 / 128, 0.1, 100);
camera.position.z = 5;
renderer.render(scene, camera);
`.trim(),
  threeClock: `
import * as THREE from 'three';

const clock = new THREE.Clock();
if (clock.getDelta() < 0) throw new Error('unreachable');
`.trim(),
  react: `
import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emitWidgetOutput } from '@vibecanvas/sdk/widget';
import './react.css';

function App() {
  const [count, setCount] = useState(0);
  const card = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (card.current === null) throw new Error('React counter did not commit');
    card.current.style.font = 'inherit';
    card.current.style.setProperty('--dynamic-gap', '7px');
    card.current.style.paddingInline = 'var(--dynamic-gap)';
    const inheritedColor = getComputedStyle(card.current).color.replaceAll(' ', '');
    emitWidgetOutput({
      type: 'notification',
      tone: 'success',
      message: 'react-css-ready:' + inheritedColor,
    });
  }, []);
  return (
    <main ref={card} className="react-counter" data-runtime="react-19.2.7">
      <output className="react-counter__value">{count}</output>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Increment
      </button>
      <span className="react-counter__network-image" aria-hidden="true" />
    </main>
  );
}

const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(<App />);
`.trim(),
  reactCss: `
:root {
  --counter-surface: rgb(245 247 250);
}

.react-counter {
  container-type: inline-size;
  box-sizing: border-box;
  display: grid;
  inline-size: clamp(12rem, 60vi, 42rem);
  min-block-size: max(10rem, 30vb);
  padding-block: calc(0.75rem + 1vi);
  color: var(--vibecanvas-inherited-accent, rgb(1 2 3));
  background-color: var(--counter-surface);
  background-image: linear-gradient(135deg, transparent, rgb(255 255 255 / 0.8));
  font: 16px/1.4 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  transition: opacity 120ms ease;
  animation: counter-enter 1ms ease-out;
}

.react-counter *,
.react-counter *::before,
.react-counter *::after {
  box-sizing: border-box;
}

.react-counter button {
  font: inherit;
}

.react-counter__network-image {
  display: block;
  inline-size: 24px;
  block-size: 24px;
  background-image: url("/capsule-network-image.svg");
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
}

@media (min-width: 20rem) {
  .react-counter {
    grid-template-columns: 1fr auto;
  }
}

@container (min-width: 12rem) {
  .react-counter__value {
    font-size: min(10vi, 2rem);
  }
}

@supports (display: grid) {
  .react-counter {
    gap: 0.75rem;
  }
}

@keyframes counter-enter {
  from { opacity: 0.5; }
  to { opacity: 1; }
}
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

function capsuleHash(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const browserDistributionConfiguration = Object.freeze({
  format: 'vibecanvas-browser-acceptance-vite-v1',
  viteVersion,
  target: 'es2022',
  entry: 'main.js',
  external: Object.freeze(['capsule:bridge']),
});

const buildBrowserDistribution: TVibecanvasDistributionBuild = async (request) => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, 'distribution-'));
  try {
    for (const file of request.files) {
      const path = join(root, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes);
    }
    const result = await viteBuild({
      root,
      configFile: false,
      logLevel: 'error',
      resolve: {
        // Acceptance fixtures compile the SDK source directly so this gate does
        // not depend on ignored/generated SDK dist files.
        alias: {
          '@vibecanvas/sdk/widget': sdkWidgetSourcePath,
        },
      },
      build: {
        write: false,
        target: browserDistributionConfiguration.target,
        sourcemap: false,
        minify: false,
        cssCodeSplit: false,
        rollupOptions: {
          input: join(root, ...request.entry.split('/')),
          external: [...browserDistributionConfiguration.external],
          output: {
            format: 'es',
            entryFileNames: browserDistributionConfiguration.entry,
            chunkFileNames: 'chunks/[name]-[hash].mjs',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result])
      .flatMap((value) => {
        if (!('output' in value)) {
          throw new Error('Browser fixture distribution unexpectedly entered Vite watch mode.');
        }
        return value.output;
      });
    const files = outputs
      .map((output) => Object.freeze({
        path: output.fileName,
        bytes: output.type === 'chunk'
          ? encoder.encode(output.code)
          : typeof output.source === 'string'
            ? encoder.encode(output.source)
            : new Uint8Array(output.source),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const cssRoots = files
      .map((file) => file.path)
      .filter((path) => path.endsWith('.css'));
    const lockBytes = new Uint8Array(await readFile(join(repositoryRoot, 'bun.lock')));
    return Object.freeze({
      kind: 'external-distribution',
      snapshot: Object.freeze({ files: Object.freeze(files) }),
      entry: browserDistributionConfiguration.entry,
      ...(cssRoots.length === 0
        ? {}
        : { cssRoots: Object.freeze(cssRoots) }),
      producer: Object.freeze({
        name: 'vibecanvas-browser-acceptance-vite',
        version: viteVersion,
        digest: capsuleHash(JSON.stringify(browserDistributionConfiguration)),
      }),
      sourceRevision: request.sourceRevision,
      dependencyLockDigest: capsuleHash(lockBytes),
      buildConfigurationDigest: capsuleHash(JSON.stringify({
        configuration: browserDistributionConfiguration,
        sourceEntry: request.entry,
      })),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

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
      ...(args.budgets === undefined ? {} : { budgets: args.budgets }),
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
  distributionBuild: buildBrowserDistribution,
  functionDescriptorExtractor: Object.freeze({
    async extractServerFunctionDescriptors() {
      return Object.freeze([SERVER_FUNCTION_DESCRIPTOR]);
    },
  }),
  async loadSigningKeys(purpose) {
    return Object.freeze([keys[purpose]]);
  },
});

async function construct(args: TFixtureBuild) {
  const widgetManifest = manifest(args);
  const featureProfiles = args.featureProfiles ?? [];
  console.log(
    `Constructing ${args.slug} (${args.entry}; profiles=${featureProfiles.join(',') || 'none'})…`,
  );
  return await builder.construct(tenant, {
    snapshot: snapshot(args.files),
    manifest: widgetManifest,
    canonicalManifestJson: fnCanonicalizeWidgetManifest(widgetManifest),
    builderIdentity,
    capsuleBuildIdentity,
    buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  });
}

async function sign(
  construction: Awaited<ReturnType<typeof construct>>,
  signingPurpose: 'preview' | 'release',
) {
  const result = await builder.signConstruction(tenant, {
    construction,
    signingPurpose,
  });
  const expectedKeyId = signingPurpose === 'preview'
    ? VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID
    : VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID;
  if (
    result.uiArtifact.runtimeDescriptor.signatureKeyIds.length !== 1
    || result.uiArtifact.runtimeDescriptor.signatureKeyIds[0] !== expectedKeyId
  ) {
    throw new Error(`Capsule artifact was not signed by the ${signingPurpose} authority.`);
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

async function build(args: TFixtureBuild) {
  return await sign(await construct(args), args.signingPurpose ?? 'preview');
}

async function buildSigningPair(args: TFixtureBuild) {
  const construction = await construct(args);
  const [preview, release] = await Promise.all([
    sign(construction, 'preview'),
    sign(construction, 'release'),
  ]);
  return Object.freeze({
    preview,
    release,
    constructionContractDigestSha256: construction.constructionContractDigestSha256,
  });
}

const threePair = await buildSigningPair({
  name: 'Browser Three.js acceptance',
  slug: 'browser-three-acceptance',
  entry: 'src/three.ts',
  files: [{ path: 'src/three.ts', source: sources.three }],
  featureProfiles: [CAPSULE_CANVAS_WEBGL_PROFILE],
  budgets: Object.freeze({
    gpuBytes: 8 * 1024 * 1024,
    messageBytes: 256 * 1024,
  }),
});

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
  three: threePair.preview,
  threeRelease: threePair.release,
  threePbr: await build({
    name: 'Browser Three.js unsupported PBR material',
    slug: 'browser-three-pbr-material',
    entry: 'src/three-pbr.ts',
    files: [{ path: 'src/three-pbr.ts', source: sources.threePbr }],
    featureProfiles: [CAPSULE_CANVAS_WEBGL_PROFILE],
    budgets: Object.freeze({ gpuBytes: 8 * 1024 * 1024 }),
  }),
  threeClock: await build({
    name: 'Browser Three.js unsupported clock',
    slug: 'browser-three-clock',
    entry: 'src/three-clock.ts',
    files: [{ path: 'src/three-clock.ts', source: sources.threeClock }],
    featureProfiles: [CAPSULE_CANVAS_WEBGL_PROFILE],
    budgets: Object.freeze({ gpuBytes: 8 * 1024 * 1024 }),
  }),
  threeMissingAuthority: await build({
    name: 'Browser Three.js missing authority',
    slug: 'browser-three-missing-authority',
    entry: 'src/three.ts',
    files: [{ path: 'src/three.ts', source: sources.three }],
  }),
  react: await build({
    name: 'Browser React acceptance',
    slug: 'browser-react-acceptance',
    entry: 'src/react.tsx',
    files: [
      { path: 'src/react.tsx', source: sources.react },
      { path: 'src/react.css', source: sources.reactCss },
    ],
    featureProfiles: [
      CAPSULE_ARTIFACT_RESOURCES_PROFILE,
      CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
      CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
    ],
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
      CAPSULE_ARTIFACT_RESOURCES_PROFILE,
      CAPSULE_CANVAS_2D_PROFILE,
      CAPSULE_CANVAS_WEBGL_PROFILE,
      CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
      CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
      CAPSULE_SVG_DOM_PROFILE,
    ].sort()),
    budgetCeiling: VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
    budgetDefaults: VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
    previewSigningKeyId: VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
    releaseSigningKeyId: VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
  }),
  artifacts,
  threeConstructionContractDigestSha256: threePair.constructionContractDigestSha256,
  testedThreeVersion: VIBECANVAS_CAPSULE_TESTED_THREE_VERSION,
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
