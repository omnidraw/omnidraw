import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildCapsuleGuest,
  calculateCapsuleDependencyContentDigest,
  calculateCapsuleDependencyMetadataDigest,
  type CapsuleBuildRequest,
} from '@omnidraw/capsule/build';
import {
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
  CAPSULE_REACT_JSX_PLUGIN,
  CAPSULE_SVG_DOM_PROFILE,
} from '@omnidraw/capsule/protocol';
import { describe, expect, test } from 'bun:test';
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  VIBECANVAS_CAPSULE_GUEST_PUBLIC_TYPE_FILES,
  VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS,
} from '../src/build/CONSTANTS';
import {
  fxCreateVibecanvasBuildDependencies,
  type TVibecanvasBuildDependencies,
  type TVibecanvasReactPackageRoots,
} from '../src/build/fx.build-dependencies';
import {
  fnVibecanvasCapsuleBuildTarget,
} from '../src/build/fn.policy';

const encoder = new TextEncoder();
const BUILD_DIRECTORY = join(import.meta.dir, '../src/build');
let baseDependenciesPromise: Promise<TVibecanvasBuildDependencies> | undefined;
let reactDependenciesPromise: Promise<TVibecanvasBuildDependencies> | undefined;

function reactPackageRoots(): TVibecanvasReactPackageRoots {
  return Object.freeze(Object.fromEntries(
    VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS.map(({ name }) => [
      name,
      dirname(Bun.resolveSync(`${name}/package.json`, BUILD_DIRECTORY)),
    ]),
  )) as TVibecanvasReactPackageRoots;
}

function buildDependencies(useReact: boolean): Promise<TVibecanvasBuildDependencies> {
  const current = useReact ? reactDependenciesPromise : baseDependenciesPromise;
  if (current !== undefined) return current;
  const sdkWidgetPath = Bun.resolveSync('@vibecanvas/sdk/widget', BUILD_DIRECTORY);
  const sdkDist = dirname(sdkWidgetPath);
  const capsuleGuestPath = Bun.resolveSync('@omnidraw/capsule/guest', BUILD_DIRECTORY);
  const capsuleDist = dirname(capsuleGuestPath);
  const pending = fxCreateVibecanvasBuildDependencies({
    readFile: async (path) => new Uint8Array(await readFile(path)),
    joinPath: join,
    calculateDependencyMetadata: calculateCapsuleDependencyMetadataDigest,
    calculateDependencyContent: calculateCapsuleDependencyContentDigest,
  }, {
    sdkWidgetPath,
    sdkFunctionClientPath: Bun.resolveSync(
      '@vibecanvas/sdk/function-client',
      BUILD_DIRECTORY,
    ),
    sdkTypeFiles: [
      'collaborative-state-client.d.ts',
      'function-client.d.ts',
      'shared.d.ts',
      'widget-channels.d.ts',
      'widget.d.ts',
    ].map((path) => Object.freeze({ path, sourcePath: join(sdkDist, path) })),
    capsuleGuestPath,
    capsuleGuestTypeFiles: VIBECANVAS_CAPSULE_GUEST_PUBLIC_TYPE_FILES.map((path) => (
      Object.freeze({ path, sourcePath: join(capsuleDist, path) })
    )),
    ...(useReact ? { reactPackageRoots: reactPackageRoots() } : {}),
  });
  if (useReact) reactDependenciesPromise = pending;
  else baseDependenciesPromise = pending;
  return pending;
}

async function buildSource(args: Readonly<{
  revision: string;
  entry: string;
  source: string;
  featureProfiles?: readonly string[];
  requestedBudgets?: CapsuleBuildRequest['requestedBudgets'];
  useReact?: boolean;
}>) {
  const dependencies = await buildDependencies(args.useReact === true);
  return await buildCapsuleGuest({
    input: {
      kind: 'source',
      snapshot: {
        revision: args.revision,
        files: [{
          path: args.entry,
          bytes: encoder.encode(args.source),
        }],
      },
      entry: args.entry,
      dependencyLock: {
        formatVersion: 2,
        rootDependencies: dependencies.rootDependencies,
        entries: dependencies.lockEntries,
      },
      dependencyContent: { entries: dependencies.contentEntries },
    },
    providedPackages: dependencies.providedPackages,
    target: fnVibecanvasCapsuleBuildTarget({
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: args.featureProfiles ?? [],
      },
      entry: args.entry,
    }),
    capabilityRequests: [],
    parkability: { parkable: false },
    requestedBudgets: args.requestedBudgets ?? {},
    policy: VIBECANVAS_CAPSULE_BUILD_POLICY,
  });
}

describe('Capsule authored-widget dependency and profile construction', () => {
  test('builds a plain DOM widget through the public Vibecanvas SDK entry', async () => {
    const dependencies = await buildDependencies(false);

    expect(dependencies.providedPackages).toEqual([]);
    expect(dependencies.rootDependencies).toEqual({ '@vibecanvas/sdk': '0.1.0' });
    expect(dependencies.lockEntries.map(({ name }) => name)).toEqual([
      '@omnidraw/capsule',
      '@vibecanvas/sdk',
    ]);
    expect(dependencies.lockEntries[0]?.exports['./guest']).toEqual({
      runtime: 'guest.js',
      types: {
        package: '@omnidraw/capsule',
        path: 'types/guest.d.ts',
      },
    });

    const output = await buildSource({
      revision: 'plain-dom-sdk-smoke-v1',
      entry: 'src/main.ts',
      source: [
        "import { createServerFunctionProxy } from '@vibecanvas/sdk/widget';",
        'const output = document.createElement("output");',
        'output.textContent = typeof createServerFunctionProxy;',
        'document.body.append(output);',
      ].join('\n'),
    });

    expect(output.artifactBytes.byteLength).toBeGreaterThan(0);
    expect(output.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('builds Capsule-pinned React TSX from an exact closed package projection', async () => {
    const dependencies = await buildDependencies(true);
    const target = fnVibecanvasCapsuleBuildTarget({
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: [],
      },
      entry: 'src/main.tsx',
    });

    expect(dependencies.providedPackages).toEqual([]);
    expect(dependencies.rootDependencies).toEqual({
      '@vibecanvas/sdk': '0.1.0',
      react: '19.2.7',
      'react-dom': '19.2.7',
    });
    expect(dependencies.lockEntries.map(({ name, version }) => `${name}@${version}`)).toEqual([
      '@omnidraw/capsule@0.9.1',
      '@types/react@19.2.17',
      '@types/react-dom@19.2.3',
      '@vibecanvas/sdk@0.1.0',
      'csstype@3.2.3',
      'react@19.2.7',
      'react-dom@19.2.7',
      'scheduler@0.27.0',
    ]);
    expect(target.frameworkPlugins).toEqual([CAPSULE_REACT_JSX_PLUGIN]);

    const output = await buildSource({
      revision: 'react-tsx-smoke-v1',
      entry: 'src/main.tsx',
      useReact: true,
      source: [
        "import { getWidgetProps } from '@vibecanvas/sdk/widget';",
        "import { createRoot } from 'react-dom/client';",
        'function App() {',
        '  const props = getWidgetProps();',
        '  return <main data-library="react">Pinned React widget: {String(props)}</main>;',
        '}',
        'createRoot(document.body).render(<App />);',
      ].join('\n'),
    });

    expect(output.artifactBytes.byteLength).toBeGreaterThan(0);
    expect(output.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('constructs SVG and Canvas 2D artifacts only with their explicit profiles', async () => {
    const svg = await buildSource({
      revision: 'svg-profile-smoke-v1',
      entry: 'src/svg.ts',
      featureProfiles: [CAPSULE_SVG_DOM_PROFILE],
      source: [
        'const namespace = "http://www.w3.org/2000/svg";',
        'const svg = document.createElementNS(namespace, "svg");',
        'const circle = document.createElementNS(namespace, "circle");',
        'circle.setAttribute("r", "12");',
        'svg.append(circle);',
        'document.body.append(svg);',
      ].join('\n'),
    });
    const canvas = await buildSource({
      revision: 'canvas-2d-profile-smoke-v1',
      entry: 'src/canvas.ts',
      featureProfiles: [CAPSULE_CANVAS_2D_PROFILE],
      source: [
        'const canvas = document.createElement("canvas");',
        'const context = canvas.getContext("2d");',
        'if (context === null) throw new Error("Canvas 2D unavailable");',
        'context.fillStyle = "#4f46e5";',
        'context.fillRect(0, 0, 24, 24);',
        'document.body.append(canvas);',
      ].join('\n'),
    });

    expect(svg.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canvas.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(svg.artifactHash).not.toBe(canvas.artifactHash);
  });

  test('binds explicit WebGL/WebGPU profiles and GPU budgets into artifact identity', async () => {
    const webGl = await buildSource({
      revision: 'webgl-profile-smoke-v1',
      entry: 'src/webgl.js',
      featureProfiles: [CAPSULE_CANVAS_WEBGL_PROFILE],
      requestedBudgets: { gpuBytes: 8 * 1024 * 1024 },
      source: [
        'const canvas = document.createElement("canvas");',
        'const context = canvas.getContext("webgl2");',
        'if (context === null) throw new Error("WebGL2 unavailable");',
        'context.clearColor(0.1, 0.2, 0.3, 1);',
        'context.clear(context.COLOR_BUFFER_BIT);',
        'document.body.append(canvas);',
      ].join('\n'),
    });
    const webGpuSource = [
      'const canvas = document.createElement("canvas");',
      'const context = canvas.getContext("webgpu");',
      'if (context === null) throw new Error("WebGPU unavailable");',
      'document.body.append(canvas);',
    ].join('\n');
    const webGpu = await buildSource({
      revision: 'webgpu-profile-smoke-v1',
      entry: 'src/webgpu.js',
      featureProfiles: [CAPSULE_CANVAS_WEBGPU_PROFILE],
      requestedBudgets: { gpuBytes: 8 * 1024 * 1024 },
      source: webGpuSource,
    });
    const narrowerWebGpu = await buildSource({
      revision: 'webgpu-profile-smoke-v1',
      entry: 'src/webgpu.js',
      featureProfiles: [CAPSULE_CANVAS_WEBGPU_PROFILE],
      requestedBudgets: { gpuBytes: 4 * 1024 * 1024 },
      source: webGpuSource,
    });

    expect(webGl.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(webGpu.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(webGl.artifactHash).not.toBe(webGpu.artifactHash);
    expect(narrowerWebGpu.artifactHash).not.toBe(webGpu.artifactHash);
  });
});
