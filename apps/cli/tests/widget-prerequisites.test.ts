import { describe, expect, test } from 'bun:test';
import type { TNotificationEvent } from '@omnidraw/api/notification/contract';
import { txCheckWidgetPrerequisites } from '../src/widget-prerequisites/tx.check-widget-prerequisites';
import type { TExecFile } from '../src/widget-prerequisites/interface';

function harness(outcome: 'available' | 'missing') {
  const warnings: string[] = [];
  const notifications: TNotificationEvent[] = [];
  const calls: string[] = [];
  const execFile: TExecFile = (file, args, _options, callback) => {
    calls.push(`${file} ${args.join(' ')}`);
    if (outcome === 'available') callback(null, '11.0.0\n', '');
    else callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), '', '');
  };
  return {
    calls,
    warnings,
    notifications,
    portal: {
      execFile,
      warn: (message: string) => warnings.push(message),
      publishNotification: (event: TNotificationEvent) => notifications.push(event),
    },
  };
}

describe('widget startup prerequisites', () => {
  test('requires npm but no container engine', async () => {
    const value = harness('available');
    await expect(txCheckWidgetPrerequisites(value.portal, {
      command: 'serve',
      helpRequested: false,
      versionRequested: false,
    })).resolves.toEqual({
      checked: true,
      probes: [{ subject: 'npm', status: 'available', version: '11.0.0' }],
      warning: null,
    });
    expect(value.calls).toEqual(['npm --version']);
  });

  test('warns without blocking startup when npm is missing', async () => {
    const value = harness('missing');
    const result = await txCheckWidgetPrerequisites(value.portal, {
      command: 'serve',
      helpRequested: false,
      versionRequested: false,
    });
    expect(result.warning?.cliMessage).toContain('npm (missing)');
    expect(value.warnings).toEqual([result.warning?.cliMessage]);
    expect(value.notifications).toHaveLength(1);
  });
});
