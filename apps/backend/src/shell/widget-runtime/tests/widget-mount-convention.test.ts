import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CapsuleBuildOutput,
  CapsuleApiGroupBuildRequest,
} from '@omnidraw/capsule/build';
import type { CapsuleArtifactSigningKey } from '@omnidraw/capsule/sign';
import { describe, expect, test } from 'bun:test';
import {
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnWidgetBrowserFunctionCapabilityRequestMatches,
  fnWidgetServerFunctionCapabilityRequestMatches,
  type TWidgetBuildRequest,
  type TWidgetRuntimeBuildIdentity,
  type TWidgetExecutableManifestProjection,
  type TWidgetServerFunctionDescriptor,
  type TWidgetSourceSnapshot,
} from '@omnidraw/sdk/contract';
import {
  OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  WidgetArtifactBuilderCapsule,
} from '../build';
import { WidgetSourceSnapshot } from '#backend/shell/widget-domain/local';

// E42 regression pin: the builder signs the one canonical path-free descriptor
// digest into the capability request. Host and client verification must use
// that same contract for preview and release signatures.

const encoder = new TextEncoder();
const sha256 = (value: Uint8Array | string): string => (
  createHash('sha256').update(value).digest('hex')
);
const BUILDER_IDENTITY = 'e42-mount-convention-test';
const CAPSULE_BUILD_IDENTITY: TWidgetRuntimeBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.10.2',
  packageDigest: `sha256:${'b'.repeat(64)}`,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: `sha256:${'c'.repeat(64)}`,
});
const SIGNING_KEY = Object.freeze({
  keyId: 'e42-mount-convention-key',
  privateKey: {} as CryptoKey,
}) satisfies CapsuleArtifactSigningKey;
const EMPTY_CAPSULE_OUTPUT = Object.freeze({
  artifactBytes: Uint8Array.of(1, 2, 3),
  artifactHash: `sha256:${'a'.repeat(64)}`,
  diagnostics: Object.freeze([]),
}) satisfies CapsuleBuildOutput;
const FN_READ_DESCRIPTOR = Object.freeze({
  schemaVersion: 1,
  exportName: 'readCount',
  effect: 'fn',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({}),
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({ count: { type: 'number' } }),
  }),
  resources: Object.freeze([]),
  limits: Object.freeze({
    timeoutMs: 1_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 0,
  }),
}) satisfies TWidgetServerFunctionDescriptor;

function snapshot(): TWidgetSourceSnapshot {
  const files = Object.freeze([
    Object.freeze({
      path: 'server/entry.ts',
      bytes: encoder.encode('import "./functions.server";\n'),
    }),
    Object.freeze({
      path: 'server/functions.server.ts',
      bytes: encoder.encode(
        'export function readCount(): { count: number } { return { count: 1 }; }',
      ),
    }),
    Object.freeze({
      path: 'ui/main.ts',
      bytes: encoder.encode([
        'import { readCount } from "../server/functions.server";',
        'void readCount;',
      ].join('\n')),
    }),
  ]);
  const hash = createHash('sha256');
  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
    hash.update(';');
  }
  const digestSha256 = hash.digest('hex');
  return Object.freeze({
    id: digestSha256,
    digestSha256,
    files,
    createdAtMs: 0,
  });
}

function manifest(): TWidgetExecutableManifestProjection {
  return Object.freeze({
    schemaVersion: 1,
    ui: Object.freeze({
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: Object.freeze(['DOM'] as const),
    }),
    server: Object.freeze({
      entry: 'server/entry.ts',
    }),
    resources: Object.freeze([]),
  });
}

describe('widget mount signing convention (E42)', () => {
  test('preview and release mounts share one builder-signed capability convention', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'e42-mount-convention-'));
    try {
      const widgetManifest = manifest();
      const artifactBuilder = new WidgetArtifactBuilderCapsule({
        tempRoot,
        builderIdentity: BUILDER_IDENTITY,
        capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
        buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
        snapshotService: new WidgetSourceSnapshot({ nowMs: () => 0 }),
        resolveTrustedPackageImport: (specifier) => Bun.resolveSync(specifier, import.meta.dir),
        capsuleBuild: async (_value: CapsuleApiGroupBuildRequest) => EMPTY_CAPSULE_OUTPUT,
        distributionBuild: async (value) => Object.freeze({
          kind: 'external-distribution',
          snapshot: Object.freeze({
            files: Object.freeze([Object.freeze({
              path: 'main.js',
              bytes: new Uint8Array([1, 2, 3]),
            })]),
          }),
          entry: 'main.js',
          producer: Object.freeze({
            name: 'e42-convention-test',
            version: '1',
            digest: `sha256:${'1'.repeat(64)}`,
          }),
          sourceRevision: value.sourceRevision,
          dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
          buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
        }),
        functionDescriptorExtractor: Object.freeze({
          async extractServerFunctionDescriptors() {
            return Object.freeze([FN_READ_DESCRIPTOR]);
          },
        }),
        loadSigningKeys: async () => Object.freeze([SIGNING_KEY]),
        capsuleSign: async (bytes) => new Uint8Array(bytes),
        bunBuild: Bun.build,
      });
      const buildRequest: TWidgetBuildRequest = Object.freeze({
        snapshot: snapshot(),
        manifest: widgetManifest,
        canonicalManifestJson: fnCanonicalizeWidgetExecutableProjection(widgetManifest),
        builderIdentity: BUILDER_IDENTITY,
        capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
        buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
        signingPurpose: 'preview',
      });
      const construction = await artifactBuilder.construct({
        snapshot: buildRequest.snapshot,
        manifest: buildRequest.manifest,
        canonicalManifestJson: buildRequest.canonicalManifestJson,
        builderIdentity: buildRequest.builderIdentity,
        capsuleBuildIdentity: buildRequest.capsuleBuildIdentity,
        buildPolicyId: buildRequest.buildPolicyId,
      });

      const descriptors = construction.functionDescriptors;
      expect(descriptors).toEqual([FN_READ_DESCRIPTOR]);
      const descriptorDigestSha256 = sha256(
        fnCanonicalizeWidgetServerFunctionDescriptors(descriptors),
      );
      expect(construction.functionDescriptorsDigestSha256)
        .toBe(descriptorDigestSha256);
      expect(construction.serverArtifact).toMatchObject({
        kind: 'server_module',
        format: WIDGET_SERVER_MODULE_FORMAT,
        abi: WIDGET_SERVER_MODULE_ABI,
        moduleDigestSha256: sha256(construction.serverArtifact!.moduleBytes),
        functionDescriptorsDigestSha256: descriptorDigestSha256,
        functionDescriptors: descriptors,
      });

      for (const signingPurpose of ['preview', 'release'] as const) {
        const signed = await artifactBuilder.signConstruction({
          construction,
          signingPurpose,
        });
        const requests = signed.uiArtifact.runtimeDescriptor.capabilityRequests;
        expect(requests).toHaveLength(1);

        expect(fnWidgetServerFunctionCapabilityRequestMatches(
          descriptorDigestSha256,
          descriptors,
          requests,
        )).toBe(true);

        // The client verifies the same path-free descriptors without a second
        // browser projection or filesystem metadata.
        expect(fnWidgetBrowserFunctionCapabilityRequestMatches(
          requests[0]!,
          descriptors,
        )).toBe(true);

        expect(requests[0]!.contractHash).toBe(`sha256:${descriptorDigestSha256}`);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
