import {
  runCapsuleOciBuild,
  type CapsuleOciSandboxAuthority,
  type CapsuleOciSandboxLimits,
  type TVibecanvasCapsuleBuild,
} from '@vibecanvas/capsule-vibecanvas/build-runner';
import {
  fnWidgetCapsuleOciEngineSelection,
  type TWidgetCapsuleOciEnvironment,
} from './widget-capsule-oci/fn.engine-selection';
import { WIDGET_CAPSULE_OCI_IMAGE_ID } from './widget-capsule-oci/CONSTANTS';

type TEnvironment = TWidgetCapsuleOciEnvironment;

type TConfig = Readonly<{
  scratchDirectory: string;
  environment?: TEnvironment;
  platform?: NodeJS.Platform;
  run?: typeof runCapsuleOciBuild;
}>;

export { WIDGET_CAPSULE_OCI_IMAGE_ID };

const CAPSULE_OCI_LIMITS: CapsuleOciSandboxLimits = Object.freeze({
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
});

export function resolveWidgetCapsuleOciImageId(
  environment: TEnvironment = process.env,
): CapsuleOciSandboxAuthority['imageId'] {
  return configured(
    environment,
    'VIBECANVAS_CAPSULE_OCI_IMAGE_ID',
    WIDGET_CAPSULE_OCI_IMAGE_ID,
  ) as CapsuleOciSandboxAuthority['imageId'];
}

function configured(
  environment: TEnvironment,
  name: string,
  fallback?: string,
): string {
  const value = environment[name] ?? fallback;
  if (value === undefined || value.length === 0) {
    throw new Error(`Capsule OCI build authority requires ${name}.`);
  }
  return value;
}

function engineEnvironment(
  scratchDirectory: string,
  environment: TEnvironment,
  platform: NodeJS.Platform,
  engine: 'docker' | 'podman',
): Readonly<Record<string, string>> {
  const ambientHome = configured(environment, 'HOME');
  const result: Record<string, string> = {
    // The engine client gets a fresh home, not ambient credential/config files.
    HOME: scratchDirectory,
    PATH: configured(environment, 'PATH', '/usr/local/bin:/usr/bin:/bin'),
  };
  for (const name of ['DOCKER_HOST', 'XDG_RUNTIME_DIR'] as const) {
    const value = environment[name];
    if (value !== undefined && value.length > 0) result[name] = value;
  }
  if (
    engine === 'docker'
    && platform === 'darwin'
    && result.DOCKER_HOST === undefined
  ) {
    result.DOCKER_HOST = `unix://${ambientHome}/.docker/run/docker.sock`;
  }
  return Object.freeze(result);
}

function authority(
  scratchDirectory: string,
  environment: TEnvironment,
  platform: NodeJS.Platform,
): CapsuleOciSandboxAuthority {
  const selection = fnWidgetCapsuleOciEngineSelection({ environment, platform });
  return Object.freeze({
    format: 'capsule-oci-build-authority-v1',
    engine: selection.engine,
    enginePath: selection.enginePath,
    engineSha256: selection.engineSha256,
    imageId: resolveWidgetCapsuleOciImageId(environment),
    platform: 'linux/amd64',
    scratchDirectory,
    engineEnvironment: engineEnvironment(
      scratchDirectory,
      environment,
      platform,
      selection.engine,
    ),
  });
}

/**
 * Creates the only production UI compiler port. Hostile source and dependency
 * bytes cross the pinned networkless OCI boundary before Capsule compilation.
 */
export function createWidgetCapsuleOciBuild(
  config: TConfig,
): TVibecanvasCapsuleBuild {
  const sandboxAuthority = authority(
    config.scratchDirectory,
    config.environment ?? process.env,
    config.platform ?? process.platform,
  );
  const run = config.run ?? runCapsuleOciBuild;
  return async (request) => {
    const result = await run(request, CAPSULE_OCI_LIMITS, sandboxAuthority);
    return Object.freeze({
      artifactBytes: result.artifactBytes,
      artifactHash: result.artifactHash,
      // OCI output is independently verified artifact bytes. Compiler
      // diagnostics are intentionally not transported from the hostile worker.
      diagnostics: Object.freeze([]),
    });
  };
}

export type {
  TConfig as TWidgetCapsuleOciBuildConfig,
};
