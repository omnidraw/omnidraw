import { describe, expect, test } from 'bun:test';
import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type {
  TExecFile,
  TExecFileError,
} from '../src/widget-prerequisites/interface';
import {
  WIDGET_CAPSULE_DARWIN_DOCKER_SHA256,
  WIDGET_CAPSULE_OCI_IMAGE_ID,
} from '../src/services/widget-capsule-oci/CONSTANTS';
import { txCheckWidgetPrerequisites } from '../src/widget-prerequisites/tx.check-widget-prerequisites';

type TOutcome =
  | { status: 'available'; version: string }
  | { status: 'missing' | 'unusable' };

function createHarness(
  outcome: TOutcome,
  fileSha256: `sha256:${string}` = ENGINE_SHA256,
  imageStatus: 'available' | 'unusable' = 'available',
) {
  const calls: string[] = [];
  const digestCalls: string[] = [];
  const warnings: string[] = [];
  const notifications: TNotificationEvent[] = [];
  const execFile: TExecFile = (file, args, _options, callback) => {
    calls.push(`${file} ${args.join(' ')}`);
    if (args[0] === 'image') {
      if (imageStatus === 'available') {
        callback(null, `${WIDGET_CAPSULE_OCI_IMAGE_ID}\n`, '');
        return;
      }
      callback(Object.assign(new Error('daemon unavailable'), { code: 1 }), '', 'daemon unavailable');
      return;
    }
    if (outcome.status === 'available') {
      callback(null, `${outcome.version}\n`, '');
      return;
    }
    const error = Object.assign(new Error(`${file} failed`), {
      code: outcome.status === 'missing' ? 'ENOENT' : 1,
    }) as TExecFileError;
    callback(error, '', `${file} failed`);
  };

  return {
    calls,
    digestCalls,
    notifications,
    warnings,
    portal: {
      execFile,
      readFileSha256: async (path: string) => {
        digestCalls.push(path);
        return fileSha256;
      },
      warn: (message: string) => warnings.push(message),
      publishNotification: (event: TNotificationEvent) => notifications.push(event),
    },
  };
}

const ENGINE_SHA256 = `sha256:${'1'.repeat(64)}`;

function configuredEnvironment(
  engine: 'docker' | 'podman',
  enginePath: string,
): Readonly<Record<string, string>> {
  return {
    VIBECANVAS_CAPSULE_OCI_ENGINE: engine,
    VIBECANVAS_CAPSULE_OCI_ENGINE_PATH: enginePath,
    VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256: ENGINE_SHA256,
  };
}

function serveArgs(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = 'linux',
) {
  return {
    command: 'serve' as const,
    helpRequested: false,
    versionRequested: false,
    environment,
    platform,
    timeoutMs: 25,
  };
}

describe('widget startup prerequisites', () => {
  test.each([
    {
      engine: 'docker' as const,
      enginePath: '/opt/capsule/bin/docker',
      version: 'Docker version 27.5.1',
    },
    {
      engine: 'podman' as const,
      enginePath: '/opt/capsule/bin/podman',
      version: 'podman version 5.4.0',
    },
  ])('probes the configured $engine executable path', async ({
    engine,
    enginePath,
    version,
  }) => {
    const harness = createHarness({ status: 'available', version });

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs(configuredEnvironment(engine, enginePath)),
    );

    expect(result).toEqual({
      checked: true,
      probes: [{
        subject: 'engine',
        engine,
        enginePath,
        status: 'available',
        version,
      }],
      warning: null,
    });
    expect(harness.calls).toEqual([
      `${enginePath} --version`,
      `${enginePath} image inspect --format={{.Id}} ${WIDGET_CAPSULE_OCI_IMAGE_ID}`,
    ]);
    expect(harness.digestCalls).toEqual([enginePath]);
    expect(harness.warnings).toEqual([]);
    expect(harness.notifications).toEqual([]);
  });

  test('uses the production Darwin Docker default', async () => {
    const harness = createHarness(
      {
        status: 'available',
        version: 'Docker version 27.5.1',
      },
      WIDGET_CAPSULE_DARWIN_DOCKER_SHA256,
    );

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs({}, 'darwin'),
    );

    expect(result.probes).toEqual([{
      subject: 'engine',
      engine: 'docker',
      enginePath: '/Applications/Docker.app/Contents/Resources/bin/docker',
      status: 'available',
      version: 'Docker version 27.5.1',
    }]);
    expect(harness.calls).toEqual([
      '/Applications/Docker.app/Contents/Resources/bin/docker --version',
      `/Applications/Docker.app/Contents/Resources/bin/docker image inspect --format={{.Id}} ${WIDGET_CAPSULE_OCI_IMAGE_ID}`,
    ]);
    expect(harness.digestCalls).toEqual([
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    ]);
    expect(result.warning).toBeNull();
  });

  test.each([
    ['missing', 'Docker OCI engine (missing)'],
    ['unusable', 'Docker OCI engine (unusable)'],
  ] as const)('warns when the configured OCI engine is %s', async (
    status,
    expectedUnavailable,
  ) => {
    const harness = createHarness({ status });
    const enginePath = '/opt/capsule/bin/docker';

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs(configuredEnvironment('docker', enginePath)),
    );

    expect(result.warning?.cliMessage).toContain(expectedUnavailable);
    expect(result.warning?.cliMessage).toContain('VIBECANVAS_CAPSULE_OCI_ENGINE_PATH');
    expect(harness.calls).toEqual([`${enginePath} --version`]);
    expect(harness.digestCalls).toEqual([enginePath]);
    expect(harness.warnings).toEqual([result.warning?.cliMessage]);
    expect(harness.notifications).toEqual([{
      type: 'warning',
      title: 'Widget tooling prerequisites unavailable',
      description: result.warning?.notification.description,
    }]);
  });

  test('warns when the client exists but the daemon or pinned image is unavailable', async () => {
    const enginePath = '/opt/capsule/bin/docker';
    const harness = createHarness(
      { status: 'available', version: 'Docker version 27.5.1' },
      ENGINE_SHA256,
      'unusable',
    );

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs(configuredEnvironment('docker', enginePath)),
    );

    expect(result.probes).toEqual([{
      subject: 'engine',
      engine: 'docker',
      enginePath,
      status: 'unusable',
    }]);
    expect(result.warning?.notification.description).toContain(
      'ensure the engine daemon is running and the pinned image is loaded',
    );
    expect(harness.calls).toEqual([
      `${enginePath} --version`,
      `${enginePath} image inspect --format={{.Id}} ${WIDGET_CAPSULE_OCI_IMAGE_ID}`,
    ]);
  });

  test.each([
    [
      'missing engine',
      {},
      'VIBECANVAS_CAPSULE_OCI_ENGINE',
    ],
    [
      'missing engine path',
      {
        VIBECANVAS_CAPSULE_OCI_ENGINE: 'podman',
        VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256: ENGINE_SHA256,
      },
      'VIBECANVAS_CAPSULE_OCI_ENGINE_PATH',
    ],
    [
      'missing engine digest',
      {
        VIBECANVAS_CAPSULE_OCI_ENGINE: 'podman',
        VIBECANVAS_CAPSULE_OCI_ENGINE_PATH: '/opt/capsule/bin/podman',
      },
      'VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256',
    ],
    [
      'unsupported engine',
      {
        VIBECANVAS_CAPSULE_OCI_ENGINE: 'containerd',
      },
      'docker or podman',
    ],
    [
      'invalid engine digest',
      {
        VIBECANVAS_CAPSULE_OCI_ENGINE: 'podman',
        VIBECANVAS_CAPSULE_OCI_ENGINE_PATH: '/opt/capsule/bin/podman',
        VIBECANVAS_CAPSULE_OCI_ENGINE_SHA256: 'sha256:not-a-digest',
      },
      'canonical SHA-256 engine digest',
    ],
  ] as const)('warns without executing when configuration has %s', async (
    _name,
    environment,
    expectedReason,
  ) => {
    const harness = createHarness({
      status: 'available',
      version: 'must not execute',
    });

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs(environment),
    );

    expect(result.probes).toEqual([{
      subject: 'configuration',
      status: 'unusable',
      reason: expect.stringContaining(expectedReason),
    }]);
    expect(result.warning?.cliMessage).toContain(
      'Capsule OCI engine configuration (unusable)',
    );
    expect(result.warning?.cliMessage).toContain('VIBECANVAS_CAPSULE_OCI_ENGINE');
    expect(harness.calls).toEqual([]);
    expect(harness.digestCalls).toEqual([]);
    expect(harness.warnings).toHaveLength(1);
    expect(harness.notifications).toHaveLength(1);
  });

  test.each([
    { command: 'upgrade' as const, helpRequested: false, versionRequested: false },
    { command: 'uninstall' as const, helpRequested: false, versionRequested: false },
    { command: 'unknown' as const, helpRequested: false, versionRequested: false },
    { command: 'serve' as const, helpRequested: true, versionRequested: false },
    { command: 'serve' as const, helpRequested: false, versionRequested: true },
  ])('skips non-server startup path %#', async (args) => {
    const harness = createHarness({ status: 'missing' });

    expect(await txCheckWidgetPrerequisites(harness.portal, {
      ...args,
      environment: {},
      platform: 'linux',
    })).toEqual({ checked: false, probes: [], warning: null });
    expect(harness.calls).toEqual([]);
    expect(harness.warnings).toEqual([]);
    expect(harness.notifications).toEqual([]);
  });

  test('keeps startup successful when warning sinks fail', async () => {
    const harness = createHarness({ status: 'missing' });

    await expect(txCheckWidgetPrerequisites({
      ...harness.portal,
      warn: () => { throw new Error('stderr unavailable'); },
      publishNotification: () => { throw new Error('publisher unavailable'); },
    }, serveArgs(
      configuredEnvironment('docker', '/opt/capsule/bin/docker'),
    ))).resolves.toMatchObject({
      checked: true,
      warning: { notification: { type: 'warning' } },
    });
  });

  test('warns when the executable bytes do not match the pinned digest', async () => {
    const enginePath = '/opt/capsule/bin/docker';
    const harness = createHarness(
      { status: 'available', version: 'Docker version 27.5.1' },
      `sha256:${'2'.repeat(64)}`,
    );

    const result = await txCheckWidgetPrerequisites(
      harness.portal,
      serveArgs(configuredEnvironment('docker', enginePath)),
    );

    expect(result.probes).toEqual([{
      subject: 'engine',
      engine: 'docker',
      enginePath,
      status: 'unusable',
    }]);
    expect(result.warning?.cliMessage).toContain('Docker OCI engine (unusable)');
    expect(harness.digestCalls).toEqual([enginePath]);
    expect(harness.calls).toEqual([]);
  });
});
