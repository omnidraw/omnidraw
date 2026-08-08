import { createHash, webcrypto } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { build as viteBuild, version as viteVersion } from 'vite';
import {
  OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  WidgetArtifactBuilderCapsule,
  buildCapsuleGuest,
  type CapsuleArtifactSigningKey,
} from '@omnidraw/capsule-omnidraw/build';
import {
  OMNIDRAW_CAPSULE_ALLOWED_APIS,
  OMNIDRAW_CAPSULE_HOST_LIMITS,
  OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID,
  OMNIDRAW_CAPSULE_TESTED_THREE_VERSION,
} from '@omnidraw/capsule-omnidraw/contract';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetExecutableProjection,
  fnProjectWidgetBrowserFunctionDescriptors,
} from '@omnidraw/widget-contract';
import type { TWidgetCapsuleApiGroup } from '@omnidraw/widget-contract';
import type { TOmnidrawDistributionBuild } from '@omnidraw/capsule-omnidraw/builder';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY as capsuleBuildIdentity,
} from '../../cli/src/services/CONSTANTS';

type TBuildRequest = Parameters<WidgetArtifactBuilderCapsule['build']>[0];
type TManifest = TBuildRequest['manifest'];
type TSnapshot = TBuildRequest['snapshot'];
type TSourceFile = Readonly<{ path: string; source: string }>;

type TFixtureBuild = Readonly<{
  name: string;
  slug: string;
  entry: string;
  files: readonly TSourceFile[];
  apis?: readonly TWidgetCapsuleApiGroup[];
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
const sdkFunctionClientSourcePath = join(
  repositoryRoot,
  'packages',
  'sdk',
  'src',
  'function-client.ts',
);
const builderIdentity = 'omnidraw-capsule-browser-acceptance-v1';

const sources = Object.freeze({
  plain: `
import {
  emitWidgetOutput,
  getWidgetProps,
  getWidgetTheme,
  subscribeWidgetProps,
  subscribeWidgetTheme,
} from '@omnidraw/sdk/widget';

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
import { emitWidgetOutput } from '@omnidraw/sdk/widget';

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
import { emitWidgetOutput } from '@omnidraw/sdk/widget';

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
import { emitWidgetOutput } from '@omnidraw/sdk/widget';

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
import { emitWidgetOutput } from '@omnidraw/sdk/widget';
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
  color: var(--omnidraw-inherited-accent, rgb(1 2 3));
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
  background: linear-gradient(135deg, rgb(16 185 129), rgb(14 116 144));
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
} from '@omnidraw/sdk/widget';

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
  previewFunctions: `
import { double } from '../server/double.server';
import {
  emitWidgetOutput,
  getWidgetProps,
  subscribeWidgetProps,
} from '@omnidraw/sdk/widget';

let invoked = false;

function emit(message: string, tone: 'success' | 'error' = 'success'): void {
  emitWidgetOutput({ type: 'notification', tone, message });
}

function invoke(): void {
  if (invoked) return;
  invoked = true;
  void (async (): Promise<void> => {
    const result = await double(
      { value: 21 },
      { timeoutMs: 3_000 },
    ) as Readonly<{ doubled: number }>;
    emit('preview-functions-invoked:' + String(result.doubled));
  })().catch(() => {
    emit('preview-functions-invoke-failed', 'error');
  });
}

const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Double';
button.addEventListener('click', invoke);
document.body.append(button);

function wantsInvoke(props: unknown): boolean {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) return false;
  return (props as Readonly<{ invoke?: unknown }>).invoke === true;
}

if (wantsInvoke(getWidgetProps())) invoke();
subscribeWidgetProps((props) => {
  if (wantsInvoke(props)) invoke();
});

emit('preview-functions-ready');
`.trim(),
  previewInspectionRunner: `
import { emitWidgetOutput } from '@omnidraw/sdk/widget';

document.body.style.margin = '0';
document.body.style.width = '640px';
document.body.style.height = '480px';
document.body.style.background = '#f8fafc';

const panel = document.createElement('main');
panel.style.position = 'relative';
panel.style.width = '640px';
panel.style.height = '480px';
document.body.append(panel);

const status = document.createElement('output');
status.id = 'inspection-status';
status.style.display = 'block';
const records: string[] = [];
function record(value: string): void {
  records.push(value);
  status.textContent = records.join(' | ');
}

const click = document.createElement('button');
click.id = 'pointer-target';
click.type = 'button';
click.textContent = 'Increment';
let clicks = 0;
click.addEventListener('click', () => {
  clicks += 1;
  record('click:' + String(clicks));
});
panel.append(click);

function labeledInput(id: string, labelText: string): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = labelText;
  wrapper.style.display = 'block';
  const input = document.createElement('input');
  input.id = id;
  input.type = 'text';
  wrapper.append(input);
  panel.append(wrapper);
  return input;
}

const noneInput = labeledInput('none-input', 'None input');
noneInput.addEventListener('input', () => record('none:' + noneInput.value));
const blurInput = labeledInput('blur-input', 'Blur input');
blurInput.addEventListener('blur', () => record('blur:' + blurInput.value));
const enterInput = labeledInput('enter-input', 'Enter input');
enterInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') record('enter:' + enterInput.value);
});

const sensitiveLabel = document.createElement('label');
sensitiveLabel.textContent = 'Secret input';
sensitiveLabel.style.display = 'block';
const sensitive = document.createElement('input');
sensitive.id = 'sensitive-input';
sensitive.type = 'password';
sensitiveLabel.append(sensitive);
panel.append(sensitiveLabel);

const redirected = labeledInput('focus-redirect-input', 'Redirect input');
const redirectSink = labeledInput('focus-redirect-sink', 'Redirect sink');
redirected.addEventListener('focus', () => redirectSink.focus());
redirectSink.addEventListener('input', () => record('sink:' + redirectSink.value));
const keyRedirected = labeledInput('keydown-redirect-input', 'Key redirect input');
keyRedirected.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
    redirectSink.focus();
  }
});

const hostileArea = document.createElement('section');
hostileArea.setAttribute('aria-label', 'Native keyboard guard fixtures');
hostileArea.style.fontSize = '10px';
panel.append(hostileArea);

function hostileInput(
  parent: HTMLElement,
  id: string,
  labelText: string,
): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = labelText;
  wrapper.style.display = 'inline-block';
  wrapper.style.width = '100px';
  wrapper.style.fontSize = '0';
  wrapper.style.lineHeight = '0';
  const input = document.createElement('input');
  input.id = id;
  input.type = 'text';
  input.style.display = 'block';
  input.style.width = '88px';
  input.style.height = '14px';
  input.style.fontSize = '10px';
  input.style.lineHeight = 'normal';
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

const deleteTargetSentinel = 'source';
const deleteSinkSentinel = 'sink';
const insertTargetSentinel = 'insert-target-sentinel';
const insertSinkSentinel = 'insert-sink-sentinel';
const enterSinkSentinel = 'enter-sink-sentinel';
const enterPayload = 'enter-guard-payload';

function hostileEditable(id: string, label: string, text: string): HTMLDivElement {
  const editable = document.createElement('div');
  editable.id = id;
  editable.contentEditable = 'true';
  editable.setAttribute('role', 'textbox');
  editable.setAttribute('aria-label', label);
  editable.style.display = 'inline-block';
  editable.style.width = '88px';
  editable.style.minHeight = '14px';
  editable.textContent = text;
  hostileArea.append(editable);
  return editable;
}

const deleteGuardTarget = hostileEditable(
  'delete-guard-target',
  'Delete guard target',
  deleteTargetSentinel,
);
const deleteGuardSink = hostileEditable(
  'delete-guard-sink',
  'Delete guard sink',
  deleteSinkSentinel,
);
deleteGuardSink.contentEditable = 'false';

const insertGuardTarget = hostileInput(
  hostileArea,
  'insert-guard-target',
  'Insert guard target',
);
insertGuardTarget.value = insertTargetSentinel;
const insertGuardSink = hostileInput(
  hostileArea,
  'insert-guard-sink',
  'Insert guard sink',
);
insertGuardSink.value = insertSinkSentinel;

const enterForm = document.createElement('form');
enterForm.style.display = 'block';
const enterTargetLabel = document.createElement('label');
enterTargetLabel.textContent = 'Enter guard target';
enterTargetLabel.style.display = 'inline-block';
enterTargetLabel.style.width = '100px';
enterTargetLabel.style.fontSize = '0';
enterTargetLabel.style.lineHeight = '0';
const enterGuardTarget = document.createElement('textarea');
enterGuardTarget.id = 'enter-guard-target';
enterGuardTarget.style.display = 'block';
enterGuardTarget.style.width = '88px';
enterGuardTarget.style.height = '14px';
enterGuardTarget.style.fontSize = '10px';
enterGuardTarget.style.lineHeight = 'normal';
enterTargetLabel.append(enterGuardTarget);
enterForm.append(enterTargetLabel);
const enterGuardSink = hostileInput(
  enterForm,
  'enter-guard-sink',
  'Enter guard sink',
);
enterGuardSink.value = enterSinkSentinel;
hostileArea.append(enterForm);

const hostileStatus = document.createElement('output');
hostileStatus.id = 'native-keyboard-guard-status';
hostileStatus.style.display = 'block';
let hostileSubmitCount = 0;
function publishHostileStatus(): void {
  const insertTargetState = insertGuardTarget.value === ''
    ? 'cleared'
    : insertGuardTarget.value === insertTargetSentinel
      ? 'sentinel'
      : 'changed';
  const enterTargetState = enterGuardTarget.value === enterPayload
    ? 'no-newline'
    : enterGuardTarget.value === ''
      ? 'empty'
      : 'changed';
  hostileStatus.textContent = [
    'delete-target:' + (deleteGuardTarget.textContent === deleteTargetSentinel ? 'intact' : 'changed'),
    'delete-sink-state:' + (deleteGuardSink.textContent === deleteSinkSentinel ? 'intact' : 'changed'),
    'insert-target:' + insertTargetState,
    'insert-sink-state:' + (insertGuardSink.value === insertSinkSentinel ? 'intact' : 'changed'),
    'enter-target:' + enterTargetState,
    'enter-sink-state:' + (enterGuardSink.value === enterSinkSentinel ? 'intact' : 'changed'),
    'enter-submit:' + (hostileSubmitCount === 0 ? 'none' : 'observed'),
  ].join(' | ');
}
for (const guardedControl of [
  deleteGuardTarget,
  deleteGuardSink,
  insertGuardTarget,
  insertGuardSink,
  enterGuardTarget,
  enterGuardSink,
]) {
  guardedControl.addEventListener('input', () => { publishHostileStatus(); });
}
deleteGuardTarget.addEventListener('beforeinput', (event) => {
  if (event.inputType !== 'deleteContentBackward') return;
  const sinkText = deleteGuardSink.firstChild;
  const selection = document.getSelection();
  if (sinkText === null || selection === null) {
    throw new Error('selection-only delete guard fixture is unavailable');
  }
  const sinkOffset = sinkText.textContent?.length ?? 0;
  selection.setBaseAndExtent(sinkText, sinkOffset, sinkText, sinkOffset);
  deleteGuardSink.contentEditable = 'true';
  event.stopImmediatePropagation();
  publishHostileStatus();
  throw new Error('intentional delete guard selection escape');
});
insertGuardTarget.addEventListener('beforeinput', (event) => {
  if (event.inputType !== 'insertText') return;
  insertGuardSink.focus();
  insertGuardSink.setSelectionRange(0, insertGuardSink.value.length);
  event.stopImmediatePropagation();
  publishHostileStatus();
});
enterGuardTarget.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  enterGuardSink.focus();
  enterGuardSink.setSelectionRange(0, enterGuardSink.value.length);
  event.stopImmediatePropagation();
  publishHostileStatus();
});
enterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  hostileSubmitCount += 1;
  publishHostileStatus();
});
hostileArea.append(hostileStatus);
publishHostileStatus();

const occlusion = document.createElement('div');
occlusion.style.position = 'relative';
occlusion.style.height = '48px';
const occluded = document.createElement('button');
occluded.id = 'occluded-target';
occluded.type = 'button';
occluded.textContent = 'Occluded';
occluded.style.width = '140px';
occluded.style.height = '40px';
const cover = document.createElement('span');
cover.textContent = 'cover';
cover.style.position = 'absolute';
cover.style.left = '0';
cover.style.top = '0';
cover.style.width = '140px';
cover.style.height = '40px';
cover.style.background = 'rgba(15, 23, 42, 0.75)';
cover.style.color = 'white';
cover.style.zIndex = '2';
occlusion.append(occluded, cover);
panel.append(occlusion);

const stale = document.createElement('button');
stale.id = 'stale-target';
stale.type = 'button';
stale.textContent = 'Stale target';
panel.append(stale);
const staleRemover = document.createElement('button');
staleRemover.id = 'stale-remove-target';
staleRemover.type = 'button';
staleRemover.textContent = 'Remove stale target';
staleRemover.addEventListener('click', () => stale.remove());
panel.append(staleRemover);

const canvas2d = document.createElement('canvas');
canvas2d.id = 'canvas-2d';
canvas2d.width = 96;
canvas2d.height = 64;
const context2d = canvas2d.getContext('2d');
if (context2d === null) throw new Error('Canvas2D unavailable');
context2d.fillStyle = '#4f46e5';
context2d.fillRect(0, 0, 96, 64);
panel.append(canvas2d);
panel.append(status);

const networkRequest = document.createElement('button');
networkRequest.id = 'network-request-target';
networkRequest.type = 'button';
networkRequest.textContent = 'Request network';
networkRequest.addEventListener('click', () => {
  const deniedImage = document.createElement('img');
  deniedImage.alt = 'Denied network fixture';
  deniedImage.addEventListener('error', () => record('network:blocked'));
  deniedImage.src = 'https://preview-inspection.invalid/forbidden.png';
  panel.append(deniedImage);
});
panel.append(networkRequest);

const runtimeError = document.createElement('button');
runtimeError.id = 'runtime-error-target';
runtimeError.type = 'button';
runtimeError.textContent = 'Runtime error';
runtimeError.addEventListener('click', () => {
  throw new Error('intentional preview inspection runtime event');
});
panel.append(runtimeError);

let frames = 0;
function animate(): void {
  frames += 1;
  status.dataset.frames = String(frames);
  if (frames < 12) requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'preview-inspection-runner-ready',
});
`.trim(),
  previewInspectionWebgl: `
import { emitWidgetOutput } from '@omnidraw/sdk/widget';

document.body.style.margin = '0';
const canvas = document.createElement('canvas');
canvas.width = 160;
canvas.height = 120;
canvas.setAttribute('aria-label', 'Inspection WebGL surface');
const context = canvas.getContext('webgl2');
if (context === null) throw new Error('WebGL2 unavailable');
context.clearColor(0.1, 0.7, 0.4, 1);
context.clear(context.COLOR_BUFFER_BIT);
document.body.append(canvas);
emitWidgetOutput({
  type: 'notification',
  tone: 'success',
  message: 'preview-inspection-webgl-ready',
});
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
  format: 'omnidraw-browser-acceptance-vite-v1',
  viteVersion,
  target: 'es2022',
  entry: 'main.js',
  external: Object.freeze(['capsule:bridge']),
});

const buildBrowserDistribution: TOmnidrawDistributionBuild = async (request) => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, 'distribution-'));
  const generatedRootName = basename(root);
  const normalizeGeneratedText = (value: string): string =>
    value.replaceAll(generatedRootName, 'distribution');
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
          '@omnidraw/sdk/widget': sdkWidgetSourcePath,
          '@omnidraw/sdk/function-client': sdkFunctionClientSourcePath,
        },
      },
      build: {
        write: false,
        target: browserDistributionConfiguration.target,
        sourcemap: 'hidden',
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
      .filter((output) => !output.fileName.endsWith('.map'))
      .map((output) => Object.freeze({
        path: output.fileName,
        bytes: output.type === 'chunk'
          ? encoder.encode(normalizeGeneratedText(output.code))
          : typeof output.source === 'string'
            ? encoder.encode(normalizeGeneratedText(output.source))
            : new Uint8Array(output.source),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const sourceMaps = outputs
      .flatMap((output) => output.type === 'chunk' && output.map !== null
        ? [Object.freeze({
            module: output.fileName,
            bytes: encoder.encode(normalizeGeneratedText(output.map.toString())),
          })]
        : [])
      .sort((left, right) => left.module.localeCompare(right.module));
    const cssRoots = files
      .map((file) => file.path)
      .filter((path) => path.endsWith('.css'));
    const lockBytes = new Uint8Array(await readFile(join(repositoryRoot, 'bun.lock')));
    return Object.freeze({
      kind: 'external-distribution',
      snapshot: Object.freeze({ files: Object.freeze(files) }),
      ...(sourceMaps.length === 0 ? {} : { sourceMaps: Object.freeze(sourceMaps) }),
      entry: browserDistributionConfiguration.entry,
      ...(cssRoots.length === 0
        ? {}
        : { cssRoots: Object.freeze(cssRoots) }),
      producer: Object.freeze({
        name: 'omnidraw-browser-acceptance-vite',
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
    schemaVersion: 1,
    ui: Object.freeze({
      runtime: 'capsule',
      entry: args.entry,
      apis: Object.freeze(['DOM' as const, ...(args.apis ?? [])]),
      state: Object.freeze({
        collaborative: args.collaborative ?? false,
        localStore: args.localStore ?? 'none',
      }),
      parkability: Object.freeze({ enabled: false }),
      ...(args.budgets === undefined ? {} : { budgets: args.budgets }),
    }),
    server: args.server ?? null,
    resources: Object.freeze([]),
  });
}

const ED25519_PKCS8_SEED_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

// Acceptance-only authorities are intentionally public and deterministic. They
// make independently generated signed fixtures byte-comparable; production
// Preview/release signing keys never enter this fixture generator.
const ACCEPTANCE_SIGNING_KEY_SEEDS = Object.freeze({
  preview: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  release: '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
  wrong: '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
});

async function importAcceptanceKey(
  keyId: string,
  seedHex: string,
): Promise<Readonly<{
  signing: CapsuleArtifactSigningKey;
  publicKeyBase64: string;
}>> {
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.byteLength !== 32 || seed.toString('hex') !== seedHex) {
    throw new Error('Acceptance signing seed is invalid.');
  }
  const pkcs8 = new Uint8Array(ED25519_PKCS8_SEED_PREFIX.byteLength + seed.byteLength);
  pkcs8.set(ED25519_PKCS8_SEED_PREFIX);
  pkcs8.set(seed, ED25519_PKCS8_SEED_PREFIX.byteLength);
  const privateKey = await webcrypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    'Ed25519',
    true,
    ['sign'],
  );
  const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);
  if (typeof jwk.x !== 'string') {
    throw new Error('Acceptance signing public key is unavailable.');
  }
  return Object.freeze({
    signing: Object.freeze({
      keyId,
      privateKey: privateKey as CryptoKey,
    }),
    publicKeyBase64: Buffer.from(jwk.x, 'base64url').toString('base64'),
  });
}

const [previewKey, releaseKey, wrongKey] = await Promise.all([
  importAcceptanceKey(
    OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID,
    ACCEPTANCE_SIGNING_KEY_SEEDS.preview,
  ),
  importAcceptanceKey(
    OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID,
    ACCEPTANCE_SIGNING_KEY_SEEDS.release,
  ),
  importAcceptanceKey(
    'capsule-browser-acceptance-wrong-key',
    ACCEPTANCE_SIGNING_KEY_SEEDS.wrong,
  ),
]);
const keys = Object.freeze({
  preview: previewKey.signing,
  release: releaseKey.signing,
});
const builder = new WidgetArtifactBuilderCapsule({
  tempRoot,
  builderIdentity,
  capsuleBuildIdentity,
  buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
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
  const apis = ['DOM', ...(args.apis ?? [])];
  console.log(
    `Constructing ${args.slug} (${args.entry}; apis=${apis.join(',')})…`,
  );
  return await builder.construct({
    snapshot: snapshot(args.files),
    manifest: widgetManifest,
    canonicalManifestJson: fnCanonicalizeWidgetExecutableProjection(widgetManifest),
    builderIdentity,
    capsuleBuildIdentity,
    buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  });
}

async function sign(
  construction: Awaited<ReturnType<typeof construct>>,
  signingPurpose: 'preview' | 'release',
) {
  const result = await builder.signConstruction({
    construction,
    signingPurpose,
  });
  const expectedKeyId = signingPurpose === 'preview'
    ? OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID
    : OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID;
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
  apis: ['WEBGL'],
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
  }),
  canvas: await build({
    name: 'Browser Canvas acceptance',
    slug: 'browser-canvas-acceptance',
    entry: 'src/canvas.ts',
    files: [{ path: 'src/canvas.ts', source: sources.canvas }],
    apis: ['CANVAS_2D'],
  }),
  three: threePair.preview,
  threeRelease: threePair.release,
  threePbr: await build({
    name: 'Browser Three.js unsupported PBR material',
    slug: 'browser-three-pbr-material',
    entry: 'src/three-pbr.ts',
    files: [{ path: 'src/three-pbr.ts', source: sources.threePbr }],
    apis: ['WEBGL'],
  }),
  threeClock: await build({
    name: 'Browser Three.js unsupported clock',
    slug: 'browser-three-clock',
    entry: 'src/three-clock.ts',
    files: [{ path: 'src/three-clock.ts', source: sources.threeClock }],
    apis: ['WEBGL'],
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
      runtimeAbi: 'omnidraw-function-v1',
    }),
    signingPurpose: 'release',
  }),
  previewFunctions: await build({
    name: 'Preview server-function binding acceptance',
    slug: 'preview-functions-acceptance',
    entry: 'ui/main.ts',
    files: [
      { path: 'ui/main.ts', source: sources.previewFunctions },
      { path: 'server/index.ts', source: sources.serverEntry },
      { path: 'server/double.server.ts', source: sources.server },
    ],
    server: Object.freeze({
      entry: 'server/index.ts',
      runtimeAbi: 'omnidraw-function-v1',
    }),
  }),
  previewInspectionRunner: await build({
    name: 'Preview inspection managed runner acceptance',
    slug: 'preview-inspection-runner-acceptance',
    entry: 'ui/main.ts',
    files: [{ path: 'ui/main.ts', source: sources.previewInspectionRunner }],
    apis: ['CANVAS_2D'],
  }),
  previewInspectionWebgl: await build({
    name: 'Preview inspection WebGL metadata acceptance',
    slug: 'preview-inspection-webgl-acceptance',
    entry: 'ui/main.ts',
    files: [{ path: 'ui/main.ts', source: sources.previewInspectionWebgl }],
    apis: ['WEBGL'],
  }),
});

const fixture = Object.freeze({
  format: 'omnidraw.capsule-browser-acceptance.v1',
  generatedFrom: Object.freeze({
    builderIdentity,
    capsuleBuildIdentity,
    buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  }),
  publicKeys: Object.freeze({
    preview: Object.freeze({
      keyId: OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID,
      algorithm: 'Ed25519',
      format: 'raw',
      publicKeyBase64: previewKey.publicKeyBase64,
    }),
    release: Object.freeze({
      keyId: OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID,
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
    allowedApis: OMNIDRAW_CAPSULE_ALLOWED_APIS,
    limits: OMNIDRAW_CAPSULE_HOST_LIMITS,
    previewSigningKeyId: OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID,
    releaseSigningKeyId: OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID,
  }),
  artifacts,
  threeConstructionContractDigestSha256: threePair.constructionContractDigestSha256,
  testedThreeVersion: OMNIDRAW_CAPSULE_TESTED_THREE_VERSION,
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
