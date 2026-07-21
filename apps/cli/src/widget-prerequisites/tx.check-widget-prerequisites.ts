import type { TNotificationEvent } from '@vibecanvas/api/notification/contract';
import type { ICliConfig } from '../config';
import type { TExecFile, TWidgetExecutableProbe } from './fx.probe-widget-executable';
import { fxProbeWidgetExecutable } from './fx.probe-widget-executable';
import type { TWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';
import { fnWidgetPrerequisiteWarning } from './fn.widget-prerequisite-warning';

type TPortal = {
  execFile: TExecFile;
  warn: (message: string) => void;
  publishNotification: (event: TNotificationEvent) => void;
};

type TArgs = Pick<ICliConfig, 'command' | 'helpRequested' | 'versionRequested'> & {
  timeoutMs?: number;
};

export type TWidgetPrerequisiteCheck = {
  checked: boolean;
  probes: TWidgetExecutableProbe[];
  warning: TWidgetPrerequisiteWarning | null;
};

export async function txCheckWidgetPrerequisites(portal: TPortal, args: TArgs): Promise<TWidgetPrerequisiteCheck> {
  if (args.command !== 'serve' || args.helpRequested || args.versionRequested) {
    return { checked: false, probes: [], warning: null };
  }

  try {
    const timeoutMs = args.timeoutMs ?? 3_000;
    const probes = await Promise.all([
      fxProbeWidgetExecutable(portal, { executable: 'node', timeoutMs }),
      fxProbeWidgetExecutable(portal, { executable: 'npm', timeoutMs }),
    ]);
    const warning = fnWidgetPrerequisiteWarning(probes);

    if (warning) {
      try {
        portal.warn(warning.cliMessage);
      } catch {
        // Startup warnings are best-effort and must never prevent the server from loading.
      }
      try {
        portal.publishNotification(warning.notification);
      } catch {
        // The CLI warning remains useful if notification delivery is unavailable.
      }
    }

    return { checked: true, probes, warning };
  } catch {
    return { checked: true, probes: [], warning: null };
  }
}
