import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  fnVibecanvasCapsuleBuildTarget,
  type CapsuleBuildRequest,
} from '../packages/capsule-vibecanvas/src/build/index';
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

  console.log(JSON.stringify({
    format: 'vibecanvas-capsule-oci-verification-v1',
    artifactHash: first.artifactHash,
    artifactBytes: first.artifactBytes.byteLength,
    deterministicRuns: 2,
    hostileImport,
  }));
} finally {
  await rm(scratchDirectory, { recursive: true, force: true });
}
