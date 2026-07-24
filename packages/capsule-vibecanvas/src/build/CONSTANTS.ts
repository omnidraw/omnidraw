import {
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V2_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V3_PROFILE,
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_DOM_SELECTION_PROFILE,
  CAPSULE_REACT_JSX_PLUGIN,
  CAPSULE_RUNTIME_ABI,
  CAPSULE_SVG_DOM_PROFILE,
} from '@omnidraw/capsule/protocol';

export const VIBECANVAS_CAPSULE_BUILD_POLICY_ID = 'vibecanvas-capsule-widget-v1';

/**
 * Exact declaration closure behind the public `@omnidraw/capsule/guest`
 * export in the pinned Capsule 0.9.1 distribution.
 */
export const VIBECANVAS_CAPSULE_GUEST_PUBLIC_TYPE_FILES = Object.freeze([
  'types/guest.d.ts',
  'types/internal/guest-bridge/index.d.ts',
  'types/internal/guest-bridge/snapshot-hooks.d.ts',
  'types/internal/protocol/index.d.ts',
  'types/internal/schema/errors.d.ts',
  'types/internal/schema/index.d.ts',
  'types/internal/schema/public.d.ts',
  'types/internal/schema/registry.d.ts',
  'types/internal/schema/schema.d.ts',
  'types/internal/schema/types.d.ts',
  'types/internal/schema/value.d.ts',
  'types/internal/schema/wire.d.ts',
]);

/**
 * Capsule 0.9.1's reviewed React JSX projection. These exact versions,
 * exports, dependency edges, and file subsets are independently digest-pinned
 * by Capsule's public builder before the trusted React transform is admitted.
 */
export const VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS = Object.freeze([
  Object.freeze({
    name: '@types/react',
    version: '19.2.17',
    exports: Object.freeze({
      '.': Object.freeze({
        types: Object.freeze({ package: '@types/react', path: 'index.d.ts' }),
      }),
      './jsx-runtime': Object.freeze({
        types: Object.freeze({ package: '@types/react', path: 'jsx-runtime.d.ts' }),
      }),
    }),
    dependencies: Object.freeze({ csstype: '^3.2.2' }),
    filePaths: Object.freeze(['global.d.ts', 'index.d.ts', 'jsx-runtime.d.ts']),
  }),
  Object.freeze({
    name: '@types/react-dom',
    version: '19.2.3',
    exports: Object.freeze({
      '.': Object.freeze({
        types: Object.freeze({ package: '@types/react-dom', path: 'index.d.ts' }),
      }),
      './client': Object.freeze({
        types: Object.freeze({ package: '@types/react-dom', path: 'client.d.ts' }),
      }),
    }),
    dependencies: Object.freeze({ react: '^19.2.0' }),
    filePaths: Object.freeze(['client.d.ts', 'index.d.ts']),
  }),
  Object.freeze({
    name: 'csstype',
    version: '3.2.3',
    exports: Object.freeze({
      '.': Object.freeze({
        types: Object.freeze({ package: 'csstype', path: 'index.d.ts' }),
      }),
    }),
    dependencies: Object.freeze({}),
    filePaths: Object.freeze(['index.d.ts']),
  }),
  Object.freeze({
    name: 'react',
    version: '19.2.7',
    exports: Object.freeze({
      '.': Object.freeze({
        runtime: 'cjs/react.production.js',
        types: Object.freeze({ package: '@types/react', path: 'index.d.ts' }),
      }),
      './jsx-runtime': Object.freeze({
        runtime: 'cjs/react-jsx-runtime.production.js',
        types: Object.freeze({ package: '@types/react', path: 'jsx-runtime.d.ts' }),
      }),
    }),
    dependencies: Object.freeze({ '@types/react': '19.2.17' }),
    filePaths: Object.freeze([
      'cjs/react-jsx-runtime.production.js',
      'cjs/react.production.js',
    ]),
  }),
  Object.freeze({
    name: 'react-dom',
    version: '19.2.7',
    exports: Object.freeze({
      '.': Object.freeze({
        runtime: 'cjs/react-dom.production.js',
        types: Object.freeze({ package: '@types/react-dom', path: 'index.d.ts' }),
      }),
      './client': Object.freeze({
        runtime: 'cjs/react-dom-client.production.js',
        types: Object.freeze({ package: '@types/react-dom', path: 'client.d.ts' }),
      }),
    }),
    dependencies: Object.freeze({
      '@types/react-dom': '19.2.3',
      react: '^19.2.7',
      scheduler: '^0.27.0',
    }),
    filePaths: Object.freeze([
      'cjs/react-dom-client.production.js',
      'cjs/react-dom.production.js',
    ]),
  }),
  Object.freeze({
    name: 'scheduler',
    version: '0.27.0',
    exports: Object.freeze({
      '.': Object.freeze({ runtime: 'cjs/scheduler.production.js' }),
    }),
    dependencies: Object.freeze({}),
    filePaths: Object.freeze(['cjs/scheduler.production.js']),
  }),
]);

export type TVibecanvasCapsuleReactPackageName =
  (typeof VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS)[number]['name'];

export const VIBECANVAS_CAPSULE_REACT_ROOT_DEPENDENCIES = Object.freeze({
  react: '19.2.7',
  'react-dom': '19.2.7',
});

export const VIBECANVAS_CAPSULE_REACT_PACKAGE_MANIFEST_SPECIFIERS = Object.freeze(
  VIBECANVAS_CAPSULE_REACT_PACKAGE_PROJECTIONS.map(
    ({ name }) => `${name}/package.json`,
  ),
);

export const VIBECANVAS_CAPSULE_REACT_JSX_PLUGIN = CAPSULE_REACT_JSX_PLUGIN;

export const VIBECANVAS_CAPSULE_DEFAULT_BUDGETS = Object.freeze({
  cpuMs: 750,
  memoryBytes: 32 * 1024 * 1024,
  domNodes: 2_000,
  handles: 4_000,
  messageBytes: 64 * 1024,
  streamBytes: 256 * 1024,
  assetBytes: 4 * 1024 * 1024,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 256 * 1024,
});

export const VIBECANVAS_CAPSULE_BUDGET_CEILINGS = Object.freeze({
  cpuMs: 2_000,
  memoryBytes: 64 * 1024 * 1024,
  domNodes: 10_000,
  handles: 20_000,
  messageBytes: 1024 * 1024,
  streamBytes: 1024 * 1024,
  assetBytes: 16 * 1024 * 1024,
  networkBytes: 0,
  gpuBytes: 64 * 1024 * 1024,
  lifecycleBytes: 1024 * 1024,
});

export const VIBECANVAS_CAPSULE_ALLOWED_TARGET = Object.freeze({
  runtimeAbi: CAPSULE_RUNTIME_ABI,
  domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
});

export const VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES = Object.freeze([
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V2_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V3_PROFILE,
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
  CAPSULE_DOM_SELECTION_PROFILE,
  CAPSULE_SVG_DOM_PROFILE,
]);

export const VIBECANVAS_CAPSULE_BUILD_POLICY = Object.freeze({
  maxFiles: 1_024,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPathBytes: 256,
  maxPathDepth: 24,
  maxPackages: 16,
  maxPackageExports: 64,
  maxDependencyEdges: 64,
  maxDependencyMetadataBytes: 32 * 1024,
  maxModules: 1_024,
  maxOutputBytes: 16 * 1024 * 1024,
  budgetDefaults: VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  budgetCeilings: VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
});

export const VIBECANVAS_CAPSULE_ALLOWED_UI_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/function-client',
  '@vibecanvas/sdk/widget',
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]);

export const VIBECANVAS_CAPSULE_ALLOWED_SERVER_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);

export const VIBECANVAS_SERVER_ARTIFACT_FORMAT =
  'vibecanvas.server-artifact.v1';
