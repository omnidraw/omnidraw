import type { CapsuleOciSandboxAuthority } from '@vibecanvas/capsule-vibecanvas/build-runner';
import {
  WIDGET_CAPSULE_DARWIN_DOCKER_PATH,
  WIDGET_CAPSULE_DARWIN_DOCKER_SHA256,
} from './CONSTANTS';

export type TWidgetCapsuleOciEnvironment =
  Readonly<Record<string, string | undefined>>;

export type TWidgetCapsuleOciEngineSelection = Readonly<{
  engine: 'docker' | 'podman';
  enginePath: string;
  engineSha256: CapsuleOciSandboxAuthority['engineSha256'];
}>;

type TArgs = Readonly<{
  environment: TWidgetCapsuleOciEnvironment;
  platform: NodeJS.Platform;
}>;

function configured(
  environment: TWidgetCapsuleOciEnvironment,
  name: string,
  fallback?: string,
): string {
  const value = environment[name] ?? fallback;
  if (value === undefined || value.length === 0) {
    throw new Error(`Capsule OCI build authority requires ${name}.`);
  }
  return value;
}

/** Resolves the same pinned OCI client identity used by production builds. */
export function fnWidgetCapsuleOciEngineSelection(
  args: TArgs,
): TWidgetCapsuleOciEngineSelection {
  const defaultEngine = args.platform === 'darwin' ? 'docker' : undefined;
  const engine = configured(
    args.environment,
    'VIBECANVAS_CAPSULE_OCI_ENGINE',
    defaultEngine,
  );
  if (engine !== 'docker' && engine !== 'podman') {
    throw new Error('Capsule OCI build authority requires docker or podman.');
  }
  const engineSha256 = configured(
    args.environment,
    'VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256',
    args.platform === 'darwin' && engine === 'docker'
      ? WIDGET_CAPSULE_DARWIN_DOCKER_SHA256
      : undefined,
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(engineSha256)) {
    throw new Error(
      'Capsule OCI build authority requires a canonical SHA-256 engine digest.',
    );
  }
  return Object.freeze({
    engine,
    enginePath: configured(
      args.environment,
      'VIBECANVAS_CAPSULE_OCI_ENGINE_PATH',
      args.platform === 'darwin' && engine === 'docker'
        ? WIDGET_CAPSULE_DARWIN_DOCKER_PATH
        : undefined,
    ),
    engineSha256: engineSha256 as CapsuleOciSandboxAuthority['engineSha256'],
  });
}
