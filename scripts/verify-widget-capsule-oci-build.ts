import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  WidgetArtifactBuilderCapsule,
  fnVibecanvasCapsuleBuildTarget,
  type CapsuleBuildRequest,
  type TVibecanvasCapsuleBuild,
} from '../packages/capsule-vibecanvas/src/build/index';
import {
  fnCanonicalizeWidgetManifest,
  type TWidgetManifestV3,
} from '../packages/widget-contract/src/index';
import { WidgetSourceSnapshot } from '../packages/widget-contract/src/local/index';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
} from '../apps/cli/src/services/CONSTANTS';
import { createWidgetCapsuleOciBuild } from '../apps/cli/src/services/WidgetCapsuleOciBuild';

const encoder = new TextEncoder();

function request(source: string, revision: string): CapsuleBuildRequest {
  return Object.freeze({
    input: Object.freeze({
      kind: 'source',
      snapshot: Object.freeze({
        revision,
        files: Object.freeze([
          Object.freeze({
            path: 'main.js',
            bytes: encoder.encode(source),
          }),
        ]),
      }),
      entry: 'main.js',
      dependencyLock: Object.freeze({
        formatVersion: 2,
        rootDependencies: Object.freeze({}),
        entries: Object.freeze([]),
      }),
      dependencyContent: Object.freeze({ entries: Object.freeze([]) }),
    }),
    target: fnVibecanvasCapsuleBuildTarget({
      target: Object.freeze({
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: Object.freeze([]),
      }),
      entry: 'main.js',
    }),
    capabilityRequests: Object.freeze([]),
    parkability: Object.freeze({ parkable: false }),
    requestedBudgets: Object.freeze({}),
    policy: VIBECANVAS_CAPSULE_BUILD_POLICY,
  });
}

const HELLO_WORLD_FILES = Object.freeze({
  'ui/main.tsx': `import { getWidgetTheme, subscribeWidgetTheme } from "@vibecanvas/sdk/widget";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function HelloWorld() {
  const [theme, setTheme] = useState(getWidgetTheme);
  useEffect(() => subscribeWidgetTheme(setTheme), []);

  return (
    <main
      className="hello-world-widget"
      style={{
        backgroundColor: theme.tokens.background,
        color: theme.tokens.foreground,
      }}
    >
      <section
        className="hello-world-widget__card"
        aria-labelledby="hello-title"
        style={{
          backgroundColor: theme.tokens.surface,
          color: theme.tokens.surfaceForeground,
          borderColor: theme.tokens.border,
        }}
      >
        <h1 id="hello-title">Hello, world!</h1>
        <p style={{ color: theme.tokens.mutedForeground }}>
          This example widget is rendered with React.
        </p>
      </section>
    </main>
  );
}

const container = document.createElement("div");
document.body.append(container);
createRoot(container).render(<HelloWorld />);
`,
  'ui/main.ts': '\n',
  'ui/styles.css': `.hello-world-widget {
  box-sizing: border-box;
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 20px;
  overflow: auto;
  font: 14px/1.5 system-ui, sans-serif;
}

.hello-world-widget * {
  box-sizing: border-box;
}

.hello-world-widget__card {
  display: grid;
  justify-items: center;
  gap: 14px;
  max-width: 28rem;
  padding: 24px;
  text-align: center;
  border: 1px solid;
  border-radius: 14px;
}

.hello-world-widget h1,
.hello-world-widget p {
  margin: 0;
}
`,
  'vibecanvas.json': `${JSON.stringify({
    schemaVersion: 3,
    name: 'Hello World',
    slug: 'hello-world',
    description: 'A simple React hello world widget.',
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.tsx',
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: ['artifact-resources-v1'],
      },
    },
  }, null, 2)}\n`,
  'package.json': `${JSON.stringify({
    name: 'hello-world',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@vibecanvas/sdk': 'file:/trusted/widget-sdk',
      react: '19.2.7',
      'react-dom': '19.2.7',
      zod: '4.4.3',
    },
    devDependencies: {
      '@types/react': '19.2.17',
      '@types/react-dom': '19.2.3',
      typescript: '5.9.3',
    },
  }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      jsx: 'react-jsx',
      lib: ['ES2022', 'DOM'],
    },
    include: ['ui/**/*.ts', 'ui/**/*.tsx', 'server/**/*.ts', 'shared/**/*.ts'],
  }, null, 2)}\n`,
});

async function verifyHelloWorldWidget(
  build: TVibecanvasCapsuleBuild,
  scratchDirectory: string,
): Promise<Readonly<{ artifactHash: string; sourceRevision: string }>> {
  const sourceRoot = join(scratchDirectory, 'hello-world-source');
  for (const [path, contents] of Object.entries(HELLO_WORLD_FILES)) {
    const target = join(sourceRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const snapshot = await new WidgetSourceSnapshot().capture(sourceRoot, {
    id: '00000000-0000-4000-8000-000000000001',
    createdAtMs: 0,
  });
  const manifest: TWidgetManifestV3 = {
    schemaVersion: 3,
    name: 'Hello World',
    slug: 'hello-world',
    description: 'A simple React hello world widget.',
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.tsx',
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: ['artifact-resources-v1'],
      },
    },
  };
  const builderIdentity = 'vibecanvas-oci-react-verification';
  const builder = new WidgetArtifactBuilderCapsule({
    tempRoot: join(scratchDirectory, 'widget-builder'),
    builderIdentity,
    capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
    buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    capsuleBuild: build,
    functionDescriptorExtractor: {
      async extractServerFunctionDescriptors() {
        return Object.freeze([]);
      },
    },
    async loadSigningKeys() {
      return Object.freeze([{
        keyId: 'vibecanvas-oci-react-verification',
        privateKey: {} as CryptoKey,
      }]);
    },
    capsuleSign: async (bytes) => new Uint8Array(bytes),
  });
  const result = await builder.build({
    orgId: '00000000-0000-4000-8000-000000000001',
    accountId: '00000000-0000-4000-8000-000000000001',
    cellId: '00000000-0000-4000-8000-000000000001',
    placementEpoch: 1,
    roles: [],
    capabilities: [],
    requestId: 'vibecanvas-oci-react-verification',
  }, {
    snapshot,
    manifest,
    canonicalManifestJson: fnCanonicalizeWidgetManifest(manifest),
    builderIdentity,
    capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
    buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    signingPurpose: 'preview',
  });
  if (result.uiArtifact.bytes.byteLength === 0) {
    throw new Error('Capsule OCI Hello World widget build returned an empty artifact.');
  }
  return Object.freeze({
    artifactHash: result.uiArtifact.capsuleArtifactHash,
    sourceRevision: snapshot.digestSha256,
  });
}

const scratchDirectory = await mkdtemp(
  join(tmpdir(), 'vibecanvas-capsule-oci-verification-'),
);

try {
  const build = createWidgetCapsuleOciBuild({ scratchDirectory });
  const accepted = request(
    'globalThis.capsuleOciVerification = 42;',
    'vibecanvas-oci-verification-v1',
  );
  const [first, second] = await Promise.all([build(accepted), build(accepted)]);
  if (
    first.artifactHash !== second.artifactHash
    || Buffer.compare(first.artifactBytes, second.artifactBytes) !== 0
  ) {
    throw new Error('Capsule OCI build did not reproduce exact artifact bytes.');
  }

  let hostileImport = 'accepted';
  try {
    await build(request(
      "import 'node:fs'; globalThis.capsuleOciVerification = 42;",
      'vibecanvas-oci-hostile-import-v1',
    ));
  } catch (error) {
    hostileImport = (
      error !== null
      && typeof error === 'object'
      && 'code' in error
      && typeof error.code === 'string'
    ) ? error.code : 'unknown';
  }
  if (hostileImport !== 'SANDBOX_EXECUTION_FAILED') {
    throw new Error(`Capsule OCI hostile import result was ${hostileImport}.`);
  }
  const helloWorld = await verifyHelloWorldWidget(build, scratchDirectory);

  console.log(JSON.stringify({
    format: 'vibecanvas-capsule-oci-verification-v1',
    artifactHash: first.artifactHash,
    artifactBytes: first.artifactBytes.byteLength,
    deterministicRuns: 2,
    hostileImport,
    helloWorld,
  }));
} finally {
  await rm(scratchDirectory, { recursive: true, force: true });
}
