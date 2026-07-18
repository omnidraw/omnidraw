import { describe, expect, test } from 'bun:test';
import type { TNotificationEvent } from '@vibecanvas/api-notification/contract';
import type { TExecFile, TExecFileError, TWidgetExecutable } from '../src/widget-prerequisites/fx.probe-widget-executable';
import { txCheckWidgetPrerequisites } from '../src/widget-prerequisites/tx.check-widget-prerequisites';

type TOutcome =
  | { status: 'available'; version: string }
  | { status: 'missing' | 'unusable' };

function createHarness(outcomes: Record<TWidgetExecutable, TOutcome>) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const notifications: TNotificationEvent[] = [];
  const execFile: TExecFile = (file, args, _options, callback) => {
    calls.push(`${file} ${args.join(' ')}`);
    const outcome = outcomes[file as TWidgetExecutable];
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
    notifications,
    warnings,
    portal: {
      execFile,
      warn: (message: string) => warnings.push(message),
      publishNotification: (event: TNotificationEvent) => notifications.push(event),
    },
  };
}

const serveArgs = { command: 'serve' as const, helpRequested: false, versionRequested: false, timeoutMs: 25 };

describe('widget startup prerequisites', () => {
  test('does not warn when Node.js and npm are both available', async () => {
    const harness = createHarness({
      node: { status: 'available', version: 'v22.0.0' },
      npm: { status: 'available', version: '10.8.0' },
    });

    const result = await txCheckWidgetPrerequisites(harness.portal, serveArgs);

    expect(result).toEqual({
      checked: true,
      probes: [
        { executable: 'node', status: 'available', version: 'v22.0.0' },
        { executable: 'npm', status: 'available', version: '10.8.0' },
      ],
      warning: null,
    });
    expect(harness.calls).toEqual(['node --version', 'npm --version']);
    expect(harness.warnings).toEqual([]);
    expect(harness.notifications).toEqual([]);
  });

  test.each([
    ['Node.js missing', { node: { status: 'missing' }, npm: { status: 'available', version: '10.8.0' } }, 'Node.js (missing)'],
    ['npm missing', { node: { status: 'available', version: 'v22.0.0' }, npm: { status: 'missing' } }, 'npm (missing)'],
    ['Node.js unusable', { node: { status: 'unusable' }, npm: { status: 'available', version: '10.8.0' } }, 'Node.js (unusable)'],
  ] as const)('emits an actionable warning when %s', async (_name, outcomes, expectedUnavailable) => {
    const harness = createHarness(outcomes);

    const result = await txCheckWidgetPrerequisites(harness.portal, serveArgs);

    expect(result.warning?.cliMessage).toContain(expectedUnavailable);
    expect(result.warning?.cliMessage).toContain('https://nodejs.org/');
    expect(harness.warnings).toEqual([result.warning?.cliMessage]);
    expect(harness.notifications).toEqual([{
      type: 'warning',
      title: 'Widget tooling prerequisites unavailable',
      description: result.warning?.notification.description,
    }]);
  });

  test('consolidates both missing tools into one CLI warning and one notification', async () => {
    const harness = createHarness({ node: { status: 'missing' }, npm: { status: 'missing' } });

    const result = await txCheckWidgetPrerequisites(harness.portal, serveArgs);

    expect(result.warning?.cliMessage).toContain('Node.js (missing), npm (missing)');
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
    const harness = createHarness({ node: { status: 'missing' }, npm: { status: 'missing' } });

    expect(await txCheckWidgetPrerequisites(harness.portal, args)).toEqual({ checked: false, probes: [], warning: null });
    expect(harness.calls).toEqual([]);
    expect(harness.warnings).toEqual([]);
    expect(harness.notifications).toEqual([]);
  });

  test('keeps startup successful when warning sinks fail', async () => {
    const harness = createHarness({ node: { status: 'missing' }, npm: { status: 'missing' } });

    await expect(txCheckWidgetPrerequisites({
      ...harness.portal,
      warn: () => { throw new Error('stderr unavailable'); },
      publishNotification: () => { throw new Error('publisher unavailable'); },
    }, serveArgs)).resolves.toMatchObject({ checked: true, warning: { notification: { type: 'warning' } } });
  });
});
