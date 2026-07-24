import { describe, expect, test } from 'bun:test';
import type {
  CapsuleOciSandboxAuthority,
  CapsuleOciSandboxLimits,
} from '@vibecanvas/capsule-vibecanvas/build-runner';
import { createWidgetCapsuleOciBuild } from '../src/services/WidgetCapsuleOciBuild';

describe('production Capsule OCI build port', () => {
  test('passes exact hostile input through pinned networkless authority and limits', async () => {
    let captured: Readonly<{
      authority: CapsuleOciSandboxAuthority;
      limits: CapsuleOciSandboxLimits;
      request: unknown;
    }> | undefined;
    const build = createWidgetCapsuleOciBuild({
      scratchDirectory: '/private/tmp/capsule-build-scratch',
      platform: 'linux',
      environment: {
        HOME: '/srv/vibecanvas',
        PATH: '/usr/bin:/bin',
        VIBECANVAS_CAPSULE_OCI_ENGINE: 'docker',
        VIBECANVAS_CAPSULE_OCI_ENGINE_PATH: '/usr/bin/docker',
        VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256: `sha256:${'1'.repeat(64)}`,
        VIBECANVAS_CAPSULE_OCI_IMAGE_ID: `sha256:${'2'.repeat(64)}`,
      },
      run: async (request, limits, authority) => {
        captured = Object.freeze({ request, limits, authority });
        return Object.freeze({
          artifactBytes: new Uint8Array([1, 2, 3]),
          artifactHash: `sha256:${'3'.repeat(64)}`,
          diagnostics: Object.freeze({
            format: 'capsule-oci-build-result-v1',
            engine: 'docker',
            imageId: `sha256:${'2'.repeat(64)}`,
            platform: 'linux/amd64',
            inputBytes: 10,
            outputBytes: 3,
            network: 'none',
            rootFilesystem: 'read-only',
          }),
        });
      },
    });
    const request = { source: 'hostile' } as never;

    await expect(build(request)).resolves.toEqual({
      artifactBytes: new Uint8Array([1, 2, 3]),
      artifactHash: `sha256:${'3'.repeat(64)}`,
      diagnostics: [],
    });
    expect(captured).toEqual({
      request,
      limits: {
        maxInputBytes: 32 * 1024 * 1024,
        maxOutputBytes: 16 * 1024 * 1024,
        memoryBytes: 2 * 1024 * 1024 * 1024,
        cpuSeconds: 120,
        cpuCores: 2,
        maxProcesses: 64,
        maxOpenFiles: 256,
        maxFileBytes: 16 * 1024 * 1024,
        temporaryBytes: 128 * 1024 * 1024,
        wallClockMs: 180_000,
      },
      authority: {
        format: 'capsule-oci-build-authority-v1',
        engine: 'docker',
        enginePath: '/usr/bin/docker',
        engineSha256: `sha256:${'1'.repeat(64)}`,
        imageId: `sha256:${'2'.repeat(64)}`,
        platform: 'linux/amd64',
        scratchDirectory: '/private/tmp/capsule-build-scratch',
        engineEnvironment: {
          HOME: '/private/tmp/capsule-build-scratch',
          PATH: '/usr/bin:/bin',
        },
      },
    });
  });

  test('uses the verified Darwin Docker authority without ambient credentials', async () => {
    let authority: CapsuleOciSandboxAuthority | undefined;
    const build = createWidgetCapsuleOciBuild({
      scratchDirectory: '/private/tmp/capsule-build-scratch',
      platform: 'darwin',
      environment: {
        HOME: '/Users/widget-host',
        PATH: '/usr/bin:/bin',
      },
      run: async (_request, _limits, currentAuthority) => {
        authority = currentAuthority;
        return Object.freeze({
          artifactBytes: new Uint8Array([1]),
          artifactHash: `sha256:${'3'.repeat(64)}`,
          diagnostics: Object.freeze({
            format: 'capsule-oci-build-result-v1',
            engine: 'docker',
            imageId: currentAuthority.imageId,
            platform: 'linux/amd64',
            inputBytes: 1,
            outputBytes: 1,
            network: 'none',
            rootFilesystem: 'read-only',
          }),
        });
      },
    });

    await build({} as never);
    expect(authority).toMatchObject({
      engine: 'docker',
      enginePath: '/Applications/Docker.app/Contents/Resources/bin/docker',
      engineSha256:
        'sha256:90255fa86cc6dcd832a8a75034c5583385cb22c7d601113484f7d9cb42e7852b',
      imageId:
        'sha256:83ff7d9b53672ef765853d72f8b0f6065fbcfdf9707bb0dde9a0029b689daac3',
      engineEnvironment: {
        HOME: '/private/tmp/capsule-build-scratch',
        PATH: '/usr/bin:/bin',
        DOCKER_HOST: 'unix:///Users/widget-host/.docker/run/docker.sock',
      },
    });
  });

  test('fails closed without explicit non-Darwin engine identity', () => {
    expect(() => createWidgetCapsuleOciBuild({
      scratchDirectory: '/private/tmp/capsule-build-scratch',
      platform: 'linux',
      environment: {
        HOME: '/srv/vibecanvas',
        PATH: '/usr/bin:/bin',
      },
    })).toThrow(/VIBECANVAS_CAPSULE_OCI_ENGINE/);
  });
});
